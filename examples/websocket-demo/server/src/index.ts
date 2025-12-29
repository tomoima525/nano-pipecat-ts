/**
 * WebSocket Demo Server
 *
 * A simple Hono server that demonstrates the pipecat-ts transport layer.
 * This server echoes audio back to the client.
 */

import { serve } from "@hono/node-server";
import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { WSContext } from "hono/ws";

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
app.get("/", (c) => {
  return c.json({ status: "ok", message: "WebSocket Demo Server" });
});

// WebSocket endpoint for audio streaming
app.get(
  "/ws",
  upgradeWebSocket((c) => {
    console.log("[Server] New WebSocket connection request");

    return {
      onOpen(event: Event, ws: WSContext) {
        console.log("[Server] WebSocket connection opened");

        // Send a welcome message
        const welcomeMessage = JSON.stringify({
          type: "message",
          data: { status: "connected", message: "Welcome to the echo server!" },
        });
        ws.send(welcomeMessage);
      },

      onMessage(event: MessageEvent, ws: WSContext) {
        const data = event.data;

        if (data instanceof ArrayBuffer) {
          // Binary data - treat as audio and echo it back
          console.log(`[Server] Received audio data: ${data.byteLength} bytes`);

          // Echo the audio back to the client
          ws.send(data);
        } else if (typeof data === "string") {
          // Text data - parse as JSON message
          try {
            const message = JSON.parse(data);
            console.log("[Server] Received message:", message);

            // Handle different message types
            if (message.type === "ping") {
              ws.send(
                JSON.stringify({
                  type: "pong",
                  data: { timestamp: Date.now() },
                })
              );
            } else if (message.type === "message") {
              // Echo the message back
              ws.send(
                JSON.stringify({
                  type: "message",
                  data: {
                    echo: true,
                    original: message.data,
                  },
                })
              );
            }
          } catch (error) {
            console.error("[Server] Error parsing message:", error);
          }
        }
      },

      onClose(event: CloseEvent, ws: WSContext) {
        console.log(
          `[Server] WebSocket connection closed: ${event.code} ${event.reason}`
        );
      },

      onError(event: Event, ws: WSContext) {
        console.error("[Server] WebSocket error:", event);
      },
    };
  })
);

const PORT = parseInt(process.env.PORT || "3000", 10);

const server = serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.log(`[Server] Running on http://localhost:${info.port}`);
    console.log(`[Server] WebSocket endpoint: ws://localhost:${info.port}/ws`);
  }
);

injectWebSocket(server);

// Handle shutdown gracefully
process.on("SIGINT", () => {
  console.log("\n[Server] Shutting down...");
  process.exit(0);
});
