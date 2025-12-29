# WebSocket Demo

A simple example demonstrating WebSocket-based real-time audio streaming using pipecat-ts.

## Overview

This demo consists of:

- **Server**: A Hono-based WebSocket server that echoes audio back to the client
- **Client**: A Vite-based web application that records audio and plays back the echoed response

## Prerequisites

- Node.js >= 18
- pnpm

## Getting Started

### 1. Install dependencies

From the `examples/websocket-demo` directory:

```bash
pnpm install
```

Then install dependencies for both server and client:

```bash
cd server && pnpm install && cd ..
cd client && pnpm install && cd ..
```

### 2. Run the demo

Start both server and client:

```bash
pnpm run dev
```

Or run them separately:

```bash
# Terminal 1 - Server
cd server && pnpm run dev

# Terminal 2 - Client
cd client && pnpm run dev
```

### 3. Use the demo

1. Open your browser to http://localhost:5173
2. Click "Connect" to establish a WebSocket connection
3. Click "Start Recording" to begin recording audio
4. Speak into your microphone - your audio will be sent to the server and echoed back
5. Click "Stop Recording" to stop

## Architecture

```
┌─────────────────┐     WebSocket      ┌─────────────────┐
│                 │ ←───────────────── │                 │
│  Vite Client    │                    │   Hono Server   │
│  (Audio I/O)    │ ───────────────→ │   (Echo)        │
│                 │    Binary Audio    │                 │
└─────────────────┘                    └─────────────────┘
```

### Client Flow

1. Records audio from microphone using Web Audio API
2. Converts Float32 audio to Int16 PCM
3. Sends audio chunks over WebSocket as binary data
4. Receives echoed audio from server
5. Converts Int16 PCM back to Float32
6. Plays audio through speakers

### Server Flow

1. Accepts WebSocket connections
2. Receives binary audio data
3. Echoes audio back to client
4. Handles JSON messages for control

## Configuration

### Audio Settings

- Sample Rate: 16000 Hz
- Channels: 1 (mono)
- Chunk Size: 20ms
- Format: 16-bit PCM (Int16)

### Server Port

Default: 3000

Set via environment variable:

```bash
PORT=8080 pnpm run dev:server
```

### Client Port

Default: 5173 (Vite default)

Configure in `client/vite.config.ts`.

## Files

```
websocket-demo/
├── README.md
├── package.json
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       └── index.ts        # Hono WebSocket server
└── client/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.ts         # Client application
        └── style.css       # Styles
```
