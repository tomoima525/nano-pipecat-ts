/**
 * xAI WebSocket Demo Server - Voice Agent
 *
 * A Hono server that implements a voice agent using xAI's realtime API.
 * Pipeline: Audio -> XAIRealtimeLLMService (speech-to-speech) -> Audio
 *
 * xAI handles VAD internally, so audio is streamed directly without batching.
 */

import "dotenv/config";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { WSContext } from "hono/ws";

import {
  Pipeline,
  WebSocketServerTransport,
  XAIRealtimeLLMService,
  type XAIVoice,
} from "pipecat-ts";

// Configuration from environment variables
const config = {
  xaiApiKey: process.env.XAI_API_KEY || "",
  xaiVoice: (process.env.XAI_VOICE || "Ara") as XAIVoice,
  port: parseInt(process.env.PORT || "3000", 10),
  systemPrompt:
    process.env.SYSTEM_PROMPT ||
    "You are a helpful voice assistant. Keep your responses concise and natural for spoken conversation. Respond in 1-2 sentences unless the user asks for more detail.",
};

// Validate required API keys
function validateConfig(): boolean {
  if (!config.xaiApiKey) {
    console.error("[Server] Error: XAI_API_KEY is required");
    console.error("[Server] Set XAI_API_KEY in your .env file");
    return false;
  }
  return true;
}

const hasValidConfig = validateConfig();

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Enable CORS for the client
app.use(
  "*",
  cors({
    origin: ["http://localhost:5173", "http://127.0.0.1:5173"],
  })
);

// Health check endpoint
app.get("/", c => {
  return c.json({
    status: hasValidConfig ? "ok" : "error",
    message: "xAI Voice Agent Server",
    mode: "xai-realtime",
  });
});

/**
 * Session data for each WebSocket connection
 */
interface Session {
  transport: WebSocketServerTransport;
  pipeline: Pipeline;
}

/**
 * Create an xAI voice agent pipeline for a WebSocket connection
 */
function createXAIVoiceAgentSession(ws: WSContext): Session {
  // Create transport with audio configuration
  // xAI uses 24000 Hz by default
  const transport = new WebSocketServerTransport({
    ws,
    params: {
      audioIn: { enabled: true, sampleRate: 24000, numChannels: 1, chunkSizeMs: 20 },
      audioOut: { enabled: true, sampleRate: 24000, numChannels: 1, chunkSizeMs: 20 },
    },
  });

  console.log("[Server] Creating xAI voice agent pipeline");

  // Create xAI realtime service
  const xai = new XAIRealtimeLLMService({
    apiKey: config.xaiApiKey,
    sessionProperties: {
      instructions: config.systemPrompt,
      voice: config.xaiVoice,
    },
  });

  // Build pipeline: Input -> xAI (handles STT+LLM+TTS internally) -> Output
  const pipeline = new Pipeline([transport.input(), xai, transport.output()]);

  return { transport, pipeline };
}

// Store active sessions
const activeSessions = new Map<WSContext, Session>();

// WebSocket endpoint for voice agent
app.get(
  "/ws",
  upgradeWebSocket(c => {
    console.log("[Server] New WebSocket connection request");

    return {
      onOpen(event: Event, ws: WSContext) {
        console.log("[Server] WebSocket connection opened");

        if (!hasValidConfig) {
          console.error("[Server] Cannot create session: missing XAI_API_KEY");
          ws.close(1008, "Missing API key configuration");
          return;
        }

        // Create session for this connection
        const session = createXAIVoiceAgentSession(ws);
        activeSessions.set(ws, session);

        session.pipeline.start().then(() => {
          console.log("[Server] Pipeline started");

          // Send welcome message
          session.transport.sendMessage({
            type: "message",
            data: {
              status: "connected",
              mode: "xai-realtime",
              message: "xAI voice agent ready. Start speaking!",
            },
          });
        });
      },

      onMessage(event: MessageEvent, ws: WSContext) {
        const session = activeSessions.get(ws);
        if (!session) return;

        const data = event.data;

        if (data instanceof ArrayBuffer) {
          // Binary data - audio
          const audioData = new Uint8Array(data);
          session.transport.onAudioData(audioData);
        } else if (typeof data === "string") {
          // Text data - JSON message
          try {
            const message = JSON.parse(data);
            console.log("[Server] Received message:", message);

            if (message.type === "config") {
              // Handle configuration updates
              console.log("[Server] Config update:", message.data);
            } else {
              // Forward to transport
              session.transport.onMessage(message);
            }
          } catch (error) {
            console.error("[Server] Error parsing message:", error);
          }
        }
      },

      onClose(event: CloseEvent, ws: WSContext) {
        console.log(`[Server] WebSocket closed: ${event.code} ${event.reason}`);

        // Stop and remove session
        const session = activeSessions.get(ws);
        if (session) {
          session.pipeline.stop().then(() => {
            console.log("[Server] Pipeline stopped");
          });
          activeSessions.delete(ws);
        }
      },

      onError(event: Event, ws: WSContext) {
        console.error("[Server] WebSocket error:", event);
      },
    };
  })
);

const server = serve(
  {
    fetch: app.fetch,
    port: config.port,
  },
  info => {
    console.log(`[Server] Running on http://localhost:${info.port}`);
    console.log(`[Server] WebSocket endpoint: ws://localhost:${info.port}/ws`);
    console.log(`[Server] Mode: xAI Realtime Voice Agent`);
    console.log(`[Server] Voice: ${config.xaiVoice}`);
    if (!hasValidConfig) {
      console.error("[Server] WARNING: XAI_API_KEY not set - connections will be rejected");
    }
  }
);

injectWebSocket(server);

// Handle shutdown gracefully
process.on("SIGINT", async () => {
  console.log("\n[Server] Shutting down...");

  // Stop all active sessions
  for (const [_, session] of activeSessions) {
    await session.pipeline.stop();
  }

  process.exit(0);
});
