# Pipecat TypeScript Implementation Specification

## Overview

This specification outlines the design and implementation requirements for a minimal TypeScript version of Pipecat, a real-time voice and multimodal conversational AI framework. The TypeScript implementation will focus on core functionality while maintaining the same architectural principles as the Python version.

## Core Architecture

### 1. Frame System

The frame system is the fundamental data unit that flows through the entire pipeline.

#### Base Frame Interface

```typescript
interface Frame {
  id: string;
  name: string;
  pts?: number; // presentation timestamp
  metadata?: Record<string, any>;
}
```

#### Frame Categories

**System Frames** (High Priority)

- `StartFrame`: Pipeline initialization
- `CancelFrame`: Operation cancellation
- `ErrorFrame`: Error propagation
- `InterruptionFrame`: User interruption handling

**Data Frames** (Content Carriers)

- `InputAudioRawFrame`: Raw audio input data
- `OutputAudioRawFrame`: Processed audio output
- `TextFrame`: Text content
- `TranscriptionFrame`: Speech-to-text results
- `LLMResponseStartFrame`: LLM response beginning
- `LLMResponseEndFrame`: LLM response completion

**Control Frames** (Flow Control)

- `EndFrame`: Processing completion
- `TTSStartFrame`: TTS processing start
- `TTSStopFrame`: TTS processing stop

### 2. Frame Processor Architecture

Base processor class that handles frame queuing and processing.

```typescript
abstract class FrameProcessor {
  // Priority queues for different frame types
  private systemQueue: Frame[] = [];
  private dataQueue: Frame[] = [];

  // Processor linking
  public upstreamProcessor?: FrameProcessor;
  public downstreamProcessor?: FrameProcessor;

  // Core methods
  abstract processFrame(frame: Frame): Promise<void>;
  public queueFrame(frame: Frame): void;
  public pushFrame(frame: Frame, direction: "upstream" | "downstream"): void;
  public link(processor: FrameProcessor): void;
  public setup(): Promise<void>;
  public cleanup(): Promise<void>;
}
```

#### Key Features

- Bidirectional frame flow (upstream/downstream)
- Priority queuing (system frames bypass normal queues)
- Async processing with concurrency control
- Processor chaining via `link()` method
- Lifecycle management (setup/cleanup)

### 3. Pipeline Implementation

```typescript
class Pipeline {
  private processors: FrameProcessor[] = [];
  private source: PipelineSource;
  private sink: PipelineSink;

  constructor(processors: FrameProcessor[]) {
    // Link processors sequentially
    // Setup source and sink
  }

  public async start(): Promise<void>;
  public async stop(): Promise<void>;
  public pushFrame(frame: Frame): void;
}

class PipelineSource extends FrameProcessor {
  // Entry point for external frames
}

class PipelineSink extends FrameProcessor {
  // Exit point - handles final output
}
```

### 4. Service Interfaces

#### STT Service (Speech-to-Text)

```typescript
abstract class STTService extends FrameProcessor {
  abstract runSTT(audio: Uint8Array): Promise<string>;

  protected async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof InputAudioRawFrame) {
      const transcription = await this.runSTT(frame.audio);
      this.pushFrame(new TranscriptionFrame(transcription), "downstream");
    }
  }
}

class DeepgramSTTService extends STTService {
  // Deepgram API implementation
}
```

#### TTS Service (Text-to-Speech)

```typescript
abstract class TTSService extends FrameProcessor {
  abstract runTTS(text: string): Promise<Uint8Array>;

  protected async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof TextFrame) {
      this.pushFrame(new TTSStartFrame(), "downstream");
      const audio = await this.runTTS(frame.text);
      this.pushFrame(new OutputAudioRawFrame(audio), "downstream");
      this.pushFrame(new TTSStopFrame(), "downstream");
    }
  }
}

class CartesiaTTSService extends TTSService {
  // Cartesia API implementation
}
```

#### LLM Service (Language Model)

```typescript
abstract class LLMService extends FrameProcessor {
  protected context: string[] = [];

  abstract runLLM(messages: ChatMessage[]): Promise<string>;

  protected async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof TranscriptionFrame) {
      this.context.push(frame.text);
      this.pushFrame(new LLMResponseStartFrame(), "downstream");
      const response = await this.runLLM(this.buildMessages());
      this.pushFrame(new TextFrame(response), "downstream");
      this.pushFrame(new LLMResponseEndFrame(), "downstream");
    }
  }
}

class OpenAILLMService extends LLMService {
  // OpenAI API implementation
}
```

### 5. Audio Processing (VAD)

Voice Activity Detection with state machine implementation.

```typescript
enum VADState {
  QUIET = "quiet",
  STARTING = "starting",
  SPEAKING = "speaking",
  STOPPING = "stopping",
}

class VADAnalyzer extends FrameProcessor {
  private state: VADState = VADState.QUIET;
  private volumeThreshold: number = 0.01;
  private startFrames: number = 3;
  private stopFrames: number = 10;

  public analyzeAudio(buffer: Uint8Array): VADState {
    const volume = this.calculateVolume(buffer);
    const isSpeech = volume > this.volumeThreshold;

    // State machine logic
    switch (this.state) {
      case VADState.QUIET:
        if (isSpeech) this.state = VADState.STARTING;
        break;
      case VADState.STARTING:
        // Transition to speaking after consistent speech
        break;
      case VADState.SPEAKING:
        if (!isSpeech) this.state = VADState.STOPPING;
        break;
      case VADState.STOPPING:
        // Transition to quiet after consistent silence
        break;
    }

    return this.state;
  }

  private calculateVolume(buffer: Uint8Array): number {
    // RMS volume calculation
  }
}
```

### 6. Transport Layer

```typescript
abstract class BaseTransport extends FrameProcessor {
  abstract input(): AsyncGenerator<Frame>;
  abstract output(frame: Frame): Promise<void>;
}

class WebSocketTransport extends BaseTransport {
  private ws: WebSocket;
  private audioContext: AudioContext;

  constructor(url: string, audioConfig: AudioConfig) {
    // WebSocket setup
    // WebAudio API initialization
  }

  async *input(): AsyncGenerator<Frame> {
    // Yield audio frames from microphone
    // Handle WebSocket messages
  }

  async output(frame: Frame): Promise<void> {
    // Send audio to speakers
    // Send WebSocket messages
  }
}
```

## Minimal Implementation Requirements

### Essential Components

1. **Frame System**
   - Base frame interface and core frame types
   - Frame serialization for network transport
   - Priority queuing system

2. **Pipeline Architecture**
   - FrameProcessor base class with async processing
   - Pipeline orchestration and lifecycle management
   - Bidirectional frame flow

3. **Core Services**
   - One STT implementation (Deepgram)
   - One TTS implementation (Cartesia)
   - One LLM implementation (Grok)

4. **Audio Processing**
   - Basic VAD using volume detection
   - WebAudio API integration
   - Audio buffer management

5. **Transport**
   - WebSocket transport for real-time communication
   - Audio input/output via WebAudio API

### Technology Stack

- **Runtime**: Node.js/Browser
- **Language**: TypeScript
- **Audio**: WebAudio API
- **Network**: WebSocket API
- **HTTP**: Fetch API
- **Async**: Promises/AsyncGenerators

### Project Structure

```
src/
├── frames/
│   ├── base.ts
│   ├── system.ts
│   ├── data.ts
│   └── control.ts
├── processors/
│   ├── base.ts
│   ├── vad.ts
│   └── aggregators.ts
├── pipeline/
│   ├── pipeline.ts
│   ├── source.ts
│   └── sink.ts
├── services/
│   ├── base.ts
│   ├── stt/
│   │   └── deepgram.ts
│   ├── tts/
│   │   └── cartesia.ts
│   └── llm/
│       └── openai.ts
├── transports/
│   ├── base.ts
│   └── websocket.ts
├── audio/
│   ├── vad.ts
│   └── utils.ts
└── utils/
    ├── async.ts
    └── time.ts
```

### Example Usage

```typescript
// Simple conversational pipeline
const pipeline = new Pipeline([
  new WebSocketTransport("ws://localhost:8080"),
  new VADAnalyzer(),
  new DeepgramSTTService({ apiKey: "xxx" }),
  new OpenAILLMService({ apiKey: "xxx" }),
  new CartesiaTTSService({ apiKey: "xxx" }),
]);

await pipeline.start();
```

## Implementation Phases

### Phase 1: Core Infrastructure

- Frame system and base classes
- FrameProcessor architecture
- Pipeline orchestration

### Phase 2: Audio Processing

- VAD implementation
- WebAudio API integration
- Basic audio utilities

### Phase 3: Services

- Service base classes
- One implementation each (STT/TTS/LLM)
- API integration

### Phase 4: Transport

- WebSocket transport
- Audio input/output
- Real-time communication

### Phase 5: Integration & Testing

- End-to-end pipeline testing
- Example applications
- Documentation

This specification provides the foundation for building a functional TypeScript version of Pipecat that maintains the core architectural principles while being suitable for web and Node.js environments.
