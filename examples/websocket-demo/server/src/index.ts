/**
 * WebSocket Demo Server - Voice Agent
 *
 * A Hono server that implements a voice agent using pipecat-ts.
 * Pipeline: Audio -> STT (Deepgram) -> LLM (OpenAI) -> TTS (Cartesia) -> Audio
 */

import "dotenv/config";
import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { WSContext } from "hono/ws";

import {
  Pipeline,
  FrameProcessor,
  Frame,
  InputAudioRawFrame,
  OutputAudioRawFrame,
  DeepgramSTTService,
  OpenAILLMService,
  CartesiaTTSService,
  AudioBufferProcessor,
  SimpleVADProcessor,
  WebSocketServerTransport,
} from "pipecat-ts";

// Configuration from environment variables
const config = {
  deepgramApiKey: process.env.DEEPGRAM_API_KEY || "",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  cartesiaApiKey: process.env.CARTESIA_API_KEY || "",
  cartesiaVoiceId: process.env.CARTESIA_VOICE_ID || "a0e99841-438c-4a64-b679-ae501e7d6091",
  port: parseInt(process.env.PORT || "3000", 10),
  systemPrompt:
    process.env.SYSTEM_PROMPT ||
    "You are a helpful voice assistant. Keep your responses concise and natural for spoken conversation. Respond in 1-2 sentences unless the user asks for more detail.",
};

// Validate required API keys
function validateConfig() {
  const missing: string[] = [];
  if (!config.deepgramApiKey) missing.push("DEEPGRAM_API_KEY");
  if (!config.openaiApiKey) missing.push("OPENAI_API_KEY");
  if (!config.cartesiaApiKey) missing.push("CARTESIA_API_KEY");

  if (missing.length > 0) {
    console.warn(`[Server] Warning: Missing API keys: ${missing.join(", ")}`);
    console.warn("[Server] The server will run in echo mode without AI services.");
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
    status: "ok",
    message: "Voice Agent Server",
    mode: hasValidConfig ? "ai" : "echo",
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
 * Create a voice agent pipeline for a WebSocket connection
 */
function createVoiceAgentSession(ws: WSContext): Session {
  // Create transport with audio configuration
  const transport = new WebSocketServerTransport({
    ws,
    params: {
      audioIn: { enabled: true, sampleRate: 16000, numChannels: 1, chunkSizeMs: 20 },
      audioOut: { enabled: true, sampleRate: 24000, numChannels: 1, chunkSizeMs: 20 },
    },
    sendTranscriptions: true,
  });

  if (!hasValidConfig) {
    // Echo mode - just echo audio back
    console.log("[Server] Creating echo pipeline (no AI services)");
    const echoProcessor = new (class extends FrameProcessor {
      constructor() {
        super({ name: "EchoProcessor" });
      }
      protected async processFrame(frame: Frame): Promise<void> {
        if (frame instanceof InputAudioRawFrame) {
          // Convert input to output and send back
          const outputFrame = new OutputAudioRawFrame(
            frame.audio,
            frame.sampleRate,
            frame.numChannels
          );
          await this.pushFrame(outputFrame, "downstream");
        }
        await this.pushFrame(frame, "downstream");
      }
    })();

    const pipeline = new Pipeline([transport.input(), echoProcessor, transport.output()]);

    return { transport, pipeline };
  }

  console.log("[Server] Creating voice agent pipeline");

  // Create services
  const stt = new DeepgramSTTService({
    apiKey: config.deepgramApiKey,
    model: "flux-general-en",
    language: "en",
    smartFormat: true,
  });

  const llm = new OpenAILLMService({
    apiKey: config.openaiApiKey,
    model: "gpt-4o-mini",
    systemPrompt: config.systemPrompt,
    temperature: 0.7,
    maxTokens: 150,
  });

  const tts = new CartesiaTTSService({
    apiKey: config.cartesiaApiKey,
    voiceId: config.cartesiaVoiceId,
    model: "sonic-3",
    language: "en",
    sampleRate: 24000,
  });

  // Create processors
  const vad = new SimpleVADProcessor({
    threshold: 0.01,
    startFrames: 3,
    stopFrames: 15,
  });

  const audioBuffer = new AudioBufferProcessor({ sampleRate: 16000, numChannels: 1 });

  // Build pipeline: Input -> VAD -> AudioBuffer -> STT -> LLM -> TTS -> Output
  const pipeline = new Pipeline([
    transport.input(),
    vad,
    audioBuffer,
    stt,
    llm,
    tts,
    transport.output(),
  ]);

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

        // Create session for this connection
        const session = createVoiceAgentSession(ws);
        activeSessions.set(ws, session);

        session.pipeline.start().then(() => {
          console.log("[Server] Pipeline started");

          // Send welcome message
          session.transport.sendMessage({
            type: "message",
            data: {
              status: "connected",
              mode: hasValidConfig ? "ai" : "echo",
              message: hasValidConfig
                ? "Voice agent ready. Start speaking!"
                : "Echo mode active. Your audio will be echoed back.",
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
    console.log(`[Server] Mode: ${hasValidConfig ? "AI Voice Agent" : "Echo"}`);
    if (!hasValidConfig) {
      console.log(
        "[Server] Set DEEPGRAM_API_KEY, OPENAI_API_KEY, and CARTESIA_API_KEY for AI mode"
      );
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
