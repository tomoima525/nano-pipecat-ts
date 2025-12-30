# WebSocket Demo - Voice Agent

A complete voice agent example demonstrating the pipecat-ts library with WebSocket-based real-time audio streaming.

## Overview

This demo implements a full voice agent pipeline:

```
┌─────────────────┐         ┌─────────────────────────────────────────────────────────┐
│                 │  Audio  │                    Voice Agent Server                   │
│  Browser Client │ ──────> │  VAD -> AudioBuffer -> STT -> LLM -> TTS -> WebSocket  │
│  (Vite + TS)    │ <────── │                                                         │
│                 │  Audio  │  Deepgram      OpenAI     Cartesia                     │
└─────────────────┘         └─────────────────────────────────────────────────────────┘
```

**Pipeline Components:**
- **VAD (Voice Activity Detection)**: Detects when the user starts/stops speaking
- **AudioBuffer**: Collects audio while user speaks, sends batch to STT
- **STT (Deepgram)**: Converts speech to text
- **LLM (OpenAI)**: Generates conversational responses
- **TTS (Cartesia)**: Converts text responses to speech

## Prerequisites

- Node.js >= 18
- pnpm
- API keys for:
  - [Deepgram](https://deepgram.com/) - Speech-to-Text
  - [OpenAI](https://openai.com/) - Language Model
  - [Cartesia](https://cartesia.ai/) - Text-to-Speech

## Getting Started

### 1. Build the main library

From the repository root:

```bash
pnpm install
pnpm build
```

### 2. Install example dependencies

```bash
cd examples/websocket-demo
pnpm install
cd server && pnpm install && cd ..
cd client && pnpm install && cd ..
```

### 3. Configure API keys

Create a `.env` file in the `server` directory:

```bash
cp server/.env.example server/.env
```

Edit `server/.env` with your API keys:

```env
DEEPGRAM_API_KEY=your_deepgram_api_key
OPENAI_API_KEY=your_openai_api_key
CARTESIA_API_KEY=your_cartesia_api_key
```

### 4. Run the demo

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

### 5. Use the voice agent

1. Open your browser to http://localhost:5173
2. Click "Connect" to establish a WebSocket connection
3. Click "Start Recording" to begin
4. Speak into your microphone
5. Wait for the AI response (audio will play automatically)
6. Click "Stop Recording" when done

## Echo Mode (No API Keys)

If API keys are not configured, the server runs in "echo mode" which simply echoes your audio back. This is useful for testing the audio pipeline without incurring API costs.

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DEEPGRAM_API_KEY` | Deepgram API key for STT | Required |
| `OPENAI_API_KEY` | OpenAI API key for LLM | Required |
| `CARTESIA_API_KEY` | Cartesia API key for TTS | Required |
| `CARTESIA_VOICE_ID` | Cartesia voice ID | `a0e99841-438c-4a64-b679-ae501e7d6091` |
| `SYSTEM_PROMPT` | Custom system prompt for LLM | Default assistant prompt |
| `PORT` | Server port | `3000` |

### Audio Settings

| Setting | Input | Output |
|---------|-------|--------|
| Sample Rate | 16000 Hz | 24000 Hz |
| Channels | 1 (mono) | 1 (mono) |
| Format | 16-bit PCM | 16-bit PCM |
| Chunk Size | 20ms | Variable |

### VAD Settings

| Setting | Value | Description |
|---------|-------|-------------|
| Threshold | 0.01 | RMS volume threshold for speech detection |
| Start Frames | 3 | Consecutive speech frames to start |
| Stop Frames | 15 | Consecutive silence frames to stop |

## Architecture

### Server (`server/src/index.ts`)

The server uses Hono with WebSocket support and creates a pipecat-ts pipeline for each connection:

```typescript
// Pipeline components
const vad = new SimpleVADProcessor();
const audioBuffer = new AudioBufferProcessor();
const stt = new DeepgramSTTService({ apiKey, model: "nova-2" });
const llm = new OpenAILLMService({ apiKey, model: "gpt-4o-mini" });
const tts = new CartesiaTTSService({ apiKey, voiceId });
const wsOutput = new WebSocketOutputProcessor(ws);

// Build pipeline
const pipeline = new Pipeline([vad, audioBuffer, stt, llm, tts, wsOutput]);
```

### Client (`client/src/main.ts`)

The client uses the Web Audio API to:
1. Record audio from the microphone at 16kHz
2. Send audio chunks over WebSocket as binary data
3. Receive TTS audio at 24kHz and play it back

## Files

```
websocket-demo/
├── README.md
├── package.json
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── .env.example
│   └── src/
│       └── index.ts        # Voice agent server
└── client/
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.ts         # Client application
        └── style.css       # Styles
```

## Troubleshooting

### No audio playback
- Check browser console for errors
- Ensure microphone permissions are granted
- Verify WebSocket connection is established

### No transcription
- Check server logs for STT errors
- Verify Deepgram API key is valid
- Ensure audio is being sent (check "Sent bytes" counter)

### No AI response
- Check server logs for LLM errors
- Verify OpenAI API key is valid
- Check for rate limiting

### No TTS audio
- Check server logs for TTS errors
- Verify Cartesia API key is valid
- Check voice ID is valid
