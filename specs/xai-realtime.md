# xAI Realtime Voice Agent Specification

## Overview

This specification defines the implementation of an xAI (Grok) realtime voice agent for pipecat-ts. The service provides speech-to-speech capabilities via WebSocket connection to xAI's realtime API, bypassing the traditional STT+LLM+TTS pipeline.

Based on:
- [xAI Voice Agent API Documentation](https://docs.x.ai/docs/guides/voice/agent)
- Python pipecat `GrokRealtimeLLMService` implementation

## Requirements

- **Standalone speech-to-speech service** - single processor handling audio in/out directly
- **No function calling support** - basic audio streaming only (initial implementation)
- **Default 24000 Hz sample rate**
- **Server-side VAD** - Voice Activity Detection handled by xAI

## Architecture

### Class Hierarchy

```
FrameProcessor (base)
    └── XAIRealtimeLLMService
```

The service extends `FrameProcessor` directly (not `LLMService`) because it handles the complete audio pipeline internally rather than just LLM text generation.

### Component Overview

```
┌─────────────────────────────────────────────────────────────┐
│                   XAIRealtimeLLMService                      │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │   Frame     │    │   WebSocket  │    │   xAI API     │  │
│  │  Processing │◄──►│   Manager    │◄──►│  (Realtime)   │  │
│  └─────────────┘    └──────────────┘    └───────────────┘  │
│         │                  │                    │           │
│         ▼                  ▼                    ▼           │
│  ┌─────────────┐    ┌──────────────┐    ┌───────────────┐  │
│  │InputAudioRaw│    │ base64 encode│    │Server-side VAD│  │
│  │    Frame    │───►│   /decode    │    │  Turn Detect  │  │
│  └─────────────┘    └──────────────┘    └───────────────┘  │
│         ▲                  │                               │
│         │                  ▼                               │
│  ┌──────────────┐   ┌──────────────┐                      │
│  │OutputAudioRaw│◄──│ Audio Delta  │                      │
│  │    Frame     │   │   Events     │                      │
│  └──────────────┘   └──────────────┘                      │
└─────────────────────────────────────────────────────────────┘
```

## API Types

### Audio Configuration

```typescript
/** Supported sample rates for PCM audio */
type SupportedSampleRate = 8000 | 16000 | 21050 | 24000 | 32000 | 44100 | 48000;

/** PCM audio format configuration */
interface PCMAudioFormat {
  type: "audio/pcm";
  rate: SupportedSampleRate;
}

/** PCMU (G.711 μ-law) audio format - fixed 8000 Hz */
interface PCMUAudioFormat {
  type: "audio/pcmu";
}

/** PCMA (G.711 A-law) audio format - fixed 8000 Hz */
interface PCMAAudioFormat {
  type: "audio/pcma";
}

type AudioFormat = PCMAudioFormat | PCMUAudioFormat | PCMAAudioFormat;

interface AudioInput {
  format?: AudioFormat;
}

interface AudioOutput {
  format?: AudioFormat;
}

interface AudioConfiguration {
  input?: AudioInput;
  output?: AudioOutput;
}
```

### Voice and Turn Detection

```typescript
/** Available xAI voice options */
type XAIVoice = "Ara" | "Rex" | "Sal" | "Eve" | "Leo";

/** Turn detection configuration */
interface TurnDetection {
  type: "server_vad" | null;  // null = manual mode
}
```

### Session Properties

```typescript
interface SessionProperties {
  /** System instructions for the assistant */
  instructions?: string;
  /** Voice for audio responses (default: "Ara") */
  voice?: XAIVoice;
  /** Turn detection mode (default: server_vad) */
  turnDetection?: TurnDetection;
  /** Audio configuration for input/output */
  audio?: AudioConfiguration;
}
```

## Client Events (Sent to xAI)

### SessionUpdateEvent
Update session configuration.

```typescript
interface SessionUpdateEvent {
  type: "session.update";
  event_id: string;
  session: SessionProperties;
}
```

### InputAudioBufferAppendEvent
Send audio data to the input buffer.

```typescript
interface InputAudioBufferAppendEvent {
  type: "input_audio_buffer.append";
  event_id: string;
  audio: string;  // base64-encoded PCM audio
}
```

### InputAudioBufferCommitEvent
Commit the input buffer (manual mode only).

```typescript
interface InputAudioBufferCommitEvent {
  type: "input_audio_buffer.commit";
  event_id: string;
}
```

### InputAudioBufferClearEvent
Clear the input buffer.

```typescript
interface InputAudioBufferClearEvent {
  type: "input_audio_buffer.clear";
  event_id: string;
}
```

### ResponseCreateEvent
Create a new assistant response.

```typescript
interface ResponseCreateEvent {
  type: "response.create";
  event_id: string;
  response?: {
    modalities?: ("text" | "audio")[];
  };
}
```

### ResponseCancelEvent
Cancel the current response.

```typescript
interface ResponseCancelEvent {
  type: "response.cancel";
  event_id: string;
}
```

## Server Events (Received from xAI)

### ConversationCreatedEvent
First event after WebSocket connection.

```typescript
interface ConversationCreatedEvent {
  type: "conversation.created";
  event_id: string;
  conversation: {
    id: string;
    object: "realtime.conversation";
  };
}
```

### SessionUpdatedEvent
Session configuration has been updated.

```typescript
interface SessionUpdatedEvent {
  type: "session.updated";
  event_id: string;
  session: SessionProperties;
}
```

### ResponseAudioDeltaEvent
Streaming audio data from the assistant.

```typescript
interface ResponseAudioDeltaEvent {
  type: "response.output_audio.delta";
  event_id: string;
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string;  // base64-encoded PCM audio
}
```

### ResponseAudioDoneEvent
Audio output is complete.

```typescript
interface ResponseAudioDoneEvent {
  type: "response.output_audio.done";
  event_id: string;
  response_id: string;
  item_id: string;
}
```

### SpeechStartedEvent
User speech detected (server VAD mode).

```typescript
interface SpeechStartedEvent {
  type: "input_audio_buffer.speech_started";
  event_id: string;
  item_id: string;
}
```

### SpeechStoppedEvent
User speech ended (server VAD mode).

```typescript
interface SpeechStoppedEvent {
  type: "input_audio_buffer.speech_stopped";
  event_id: string;
  item_id: string;
}
```

### ResponseDoneEvent
Response generation is complete.

```typescript
interface ResponseDoneEvent {
  type: "response.done";
  event_id: string;
  response: {
    id: string;
    object: "realtime.response";
    status: "completed" | "cancelled" | "failed";
    output: ConversationItem[];
    usage?: {
      total_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  };
}
```

### ErrorEvent
Error from the API.

```typescript
interface ErrorEvent {
  type: "error";
  event_id: string;
  error: {
    type?: string;
    code?: string;
    message: string;
    param?: string;
  };
}
```

## Service Implementation

### XAIRealtimeOptions

```typescript
interface XAIRealtimeOptions extends FrameProcessorOptions {
  /** xAI API key */
  apiKey: string;
  /** WebSocket base URL (default: "wss://api.x.ai/v1/realtime") */
  baseUrl?: string;
  /** Session configuration */
  sessionProperties?: SessionProperties;
  /** Start with audio input paused (default: false) */
  startAudioPaused?: boolean;
}
```

### XAIRealtimeLLMService

```typescript
class XAIRealtimeLLMService extends FrameProcessor {
  // Configuration
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private sessionProperties: SessionProperties;

  // State
  private websocket: WebSocket | null;
  private audioInputPaused: boolean;
  private apiSessionReady: boolean;
  private disconnecting: boolean;

  constructor(options: XAIRealtimeOptions);

  // Lifecycle
  public async setup(): Promise<void>;
  public async cleanup(): Promise<void>;

  // Frame processing
  protected async processFrame(frame: Frame): Promise<void>;

  // Public methods
  public setAudioInputPaused(paused: boolean): void;

  // Private: WebSocket
  private async connect(): Promise<void>;
  private async disconnect(): Promise<void>;
  private async sendEvent(event: ClientEvent): Promise<void>;
  private async handleMessage(data: string): Promise<void>;

  // Private: Audio
  private async sendUserAudio(frame: InputAudioRawFrame): Promise<void>;
  private async handleAudioDelta(event: ResponseAudioDeltaEvent): Promise<void>;
  private getOutputSampleRate(): number;

  // Private: Event handlers
  private async handleConversationCreated(event: ConversationCreatedEvent): Promise<void>;
  private async handleSessionUpdated(event: SessionUpdatedEvent): Promise<void>;
  private async handleSpeechStarted(event: SpeechStartedEvent): Promise<void>;
  private async handleSpeechStopped(event: SpeechStoppedEvent): Promise<void>;
  private async handleResponseDone(event: ResponseDoneEvent): Promise<void>;
  private async handleError(event: ErrorEvent): Promise<void>;

  // Private: Interruption
  private async handleInterruption(): Promise<void>;
}
```

## Frame Processing Flow

### Input Flow (User → xAI)

```
InputAudioRawFrame
    │
    ▼
┌──────────────────────┐
│ Check audioInputPaused│
│ (skip if paused)     │
└──────────────────────┘
    │
    ▼
┌──────────────────────┐
│ Encode audio to base64│
└──────────────────────┘
    │
    ▼
┌──────────────────────┐
│ Send via WebSocket   │
│ input_audio_buffer   │
│ .append              │
└──────────────────────┘
```

### Output Flow (xAI → Pipeline)

```
response.output_audio.delta (WebSocket)
    │
    ▼
┌──────────────────────┐
│ Decode base64 to     │
│ Uint8Array           │
└──────────────────────┘
    │
    ▼
┌──────────────────────┐
│ Create               │
│ OutputAudioRawFrame  │
│ (sampleRate, mono)   │
└──────────────────────┘
    │
    ▼
pushFrame(frame, "downstream")
```

### VAD Flow (Server-side)

```
User speaks
    │
    ▼
input_audio_buffer.speech_started
    │
    ├──► Push UserStartedSpeakingFrame (upstream)
    │
    ▼
[Audio streaming continues]
    │
    ▼
input_audio_buffer.speech_stopped
    │
    ├──► Push UserStoppedSpeakingFrame
    │
    ▼
[xAI auto-creates response]
    │
    ▼
response.output_audio.delta (streaming)
```

### Interruption Flow

When user starts speaking during bot response:

```
UserStartedSpeakingFrame (from VAD)
    │
    ▼
┌──────────────────────┐
│ Clear input buffer   │
│ (if manual VAD)      │
└──────────────────────┘
    │
    ▼
┌──────────────────────┐
│ Cancel current       │
│ response             │
└──────────────────────┘
    │
    ▼
┌──────────────────────┐
│ Push InterruptionFrame│
│ downstream           │
└──────────────────────┘
```

## WebSocket Connection Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│                    Connection Lifecycle                       │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  setup()                                                     │
│     │                                                        │
│     ▼                                                        │
│  ┌─────────────────┐                                        │
│  │ Open WebSocket  │                                        │
│  │ with auth header│                                        │
│  └─────────────────┘                                        │
│     │                                                        │
│     ▼                                                        │
│  conversation.created (received)                            │
│     │                                                        │
│     ▼                                                        │
│  ┌─────────────────┐                                        │
│  │ Send session    │                                        │
│  │ .update         │                                        │
│  └─────────────────┘                                        │
│     │                                                        │
│     ▼                                                        │
│  session.updated (received)                                 │
│     │                                                        │
│     ▼                                                        │
│  apiSessionReady = true                                     │
│     │                                                        │
│     ▼                                                        │
│  [Ready for audio streaming]                                │
│     │                                                        │
│     │  (frames flowing)                                      │
│     ▼                                                        │
│  cleanup()                                                  │
│     │                                                        │
│     ▼                                                        │
│  ┌─────────────────┐                                        │
│  │ Close WebSocket │                                        │
│  └─────────────────┘                                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Default Configuration

```typescript
const DEFAULT_BASE_URL = "wss://api.x.ai/v1/realtime";

const DEFAULT_SESSION_PROPERTIES: SessionProperties = {
  voice: "Ara",
  turnDetection: { type: "server_vad" },
  audio: {
    input: { format: { type: "audio/pcm", rate: 24000 } },
    output: { format: { type: "audio/pcm", rate: 24000 } }
  }
};
```

## Dependencies

- `ws` package for WebSocket in Node.js environment

## File Structure

```
src/services/xai/
├── index.ts          # Exports
├── events.ts         # Event types and interfaces
└── realtime.ts       # XAIRealtimeLLMService implementation
```

## Usage Example

```typescript
import { Pipeline, WebSocketServerTransport } from "pipecat-ts";
import { XAIRealtimeLLMService } from "pipecat-ts/services/xai";

const xai = new XAIRealtimeLLMService({
  apiKey: process.env.XAI_API_KEY!,
  sessionProperties: {
    instructions: "You are a helpful voice assistant.",
    voice: "Ara",
  }
});

const pipeline = new Pipeline([
  transport.input(),
  xai,  // Handles STT+LLM+TTS internally
  transport.output()
]);

await pipeline.start();
```

## Future Enhancements

The following features may be added in future versions:

1. **Function Calling Support** - Enable tool use with xAI
2. **Input Audio Transcription** - Emit transcription frames for user speech
3. **Output Transcript Streaming** - Emit text frames alongside audio
4. **Multiple Audio Formats** - Support PCMU/PCMA for telephony
5. **Manual VAD Mode** - Allow client-side voice activity detection
