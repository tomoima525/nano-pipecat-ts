# Pipecat-TS Frame Processing Workflow

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PIPELINE                                        │
│                                                                              │
│  ┌──────────┐   ┌─────┐   ┌─────┐   ┌─────┐   ┌───────────┐                │
│  │ Transport│──▶│ STT │──▶│ LLM │──▶│ TTS │──▶│ Transport │                │
│  │  Input   │   │     │   │     │   │     │   │  Output   │                │
│  └──────────┘   └─────┘   └─────┘   └─────┘   └───────────┘                │
│                                                                              │
│                    ───────▶ DOWNSTREAM (user → bot response)                │
│                    ◀─────── UPSTREAM (control/system frames)                │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Detailed Frame Flow

### 1. User Speaks → Audio Input

```
┌─────────────┐      WebSocket       ┌────────────────────┐
│    User     │ ──────────────────▶  │ WebSocketTransport │
│ (Microphone)│    Raw PCM Audio     │      Input         │
└─────────────┘                      └─────────┬──────────┘
                                               │
                                               ▼
                                     ┌─────────────────────┐
                                     │ InputAudioRawFrame  │
                                     │ - audioData: Buffer │
                                     │ - sampleRate: 16000 │
                                     │ - numChannels: 1    │
                                     └─────────────────────┘
```

### 2. Speech-to-Text Processing

```
┌─────────────────────┐                    ┌──────────────────────┐
│ InputAudioRawFrame  │ ────────────────▶  │  DeepgramSTTService  │
└─────────────────────┘                    │  (FrameProcessor)    │
                                           └──────────┬───────────┘
                                                      │
                         ┌────────────────────────────┼────────────────────────┐
                         │                            │                        │
                         ▼                            ▼                        ▼
          ┌──────────────────────┐    ┌──────────────────────┐    ┌───────────────────────┐
          │ UserStartedSpeaking  │    │ InterimTranscription │    │   TranscriptionFrame  │
          │       Frame          │    │       Frame          │    │ - text: "Hello"       │
          └──────────────────────┘    │ - text: "Hel..."     │    │ - user: "user"        │
                                      └──────────────────────┘    │ - timestamp           │
                                                                  └───────────────────────┘
                                                                             │
                                                                             ▼
                                                            ┌──────────────────────┐
                                                            │ UserStoppedSpeaking  │
                                                            │       Frame          │
                                                            └──────────────────────┘
```

### 3. LLM Processing

```
┌─────────────────────┐                    ┌──────────────────────┐
│  TranscriptionFrame │ ────────────────▶  │   OpenAILLMService   │
│  - text: "Hello"    │                    │   (FrameProcessor)   │
└─────────────────────┘                    └──────────┬───────────┘
                                                      │
                                                      │ (Streaming Response)
                                                      │
                                                      ▼
                                           ┌─────────────────────┐
                                           │    LLMTextFrame     │
                                           │ - text: "Hi there!" │
                                           │ - (streamed chunks) │
                                           └─────────────────────┘
```

### 4. Text-to-Speech Processing

```
┌─────────────────────┐                    ┌──────────────────────┐
│    LLMTextFrame     │ ────────────────▶  │  CartesiaTTSService  │
│ - text: "Hi there!" │                    │   (FrameProcessor)   │
└─────────────────────┘                    └──────────┬───────────┘
                                                      │
                         ┌────────────────────────────┼────────────────────────┐
                         │                            │                        │
                         ▼                            ▼                        ▼
          ┌──────────────────────┐    ┌──────────────────────┐    ┌───────────────────────┐
          │ BotStartedSpeaking   │    │   TTSAudioRawFrame   │    │  BotStoppedSpeaking   │
          │       Frame          │    │ - audioData: Buffer  │    │        Frame          │
          └──────────────────────┘    │ - sampleRate: 24000  │    └───────────────────────┘
                                      │ - numChannels: 1     │
                                      └──────────────────────┘
```

### 5. Audio Output to User

```
┌─────────────────────┐                    ┌──────────────────────┐
│  TTSAudioRawFrame   │ ────────────────▶  │ WebSocketTransport   │
│  (or OutputAudio    │                    │      Output          │
│    RawFrame)        │                    └──────────┬───────────┘
└─────────────────────┘                               │
                                                      │ WebSocket
                                                      ▼
                                           ┌─────────────────────┐
                                           │        User         │
                                           │     (Speaker)       │
                                           └─────────────────────┘
```

---

## Frame Type Hierarchy

```
                              IFrame (Interface)
                                   │
                                   ▼
                            Frame (Abstract)
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
            ▼                      ▼                      ▼
       DataFrame             SystemFrame            ControlFrame
            │                      │                      │
            │                      │                      │
    ┌───────┴───────┐              │              ┌───────┴───────┐
    │               │              │              │               │
    ▼               ▼              ▼              ▼               ▼
AudioRawFrame   TextFrame    ErrorFrame    StartFrame      EndFrame
    │               │
    │               │
┌───┴───┐     ┌─────┴─────┐
│       │     │           │
▼       ▼     ▼           ▼
Input  Output  Transcription  LLMTextFrame
Audio  Audio      Frame
Frame  Frame
    │
    ▼
TTSAudioRawFrame
```

---

## Complete Conversation Flow

```
                                    TIME ─────────────────────────────▶

USER SPEAKS:
    ┌──────────────────────────────────────────────────────────────────┐
    │ InputAudioRawFrame → InterimTranscription → TranscriptionFrame  │
    └──────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
LLM PROCESSES:
    ┌──────────────────────────────────────────────────────────────────┐
    │              LLMTextFrame (streamed chunks)                      │
    └──────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
BOT RESPONDS:
    ┌──────────────────────────────────────────────────────────────────┐
    │ BotStarted → TTSAudioRawFrame (chunks) → BotStopped             │
    └──────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
OUTPUT:
    ┌──────────────────────────────────────────────────────────────────┐
    │            OutputAudioRawFrame → WebSocket → User               │
    └──────────────────────────────────────────────────────────────────┘
```

---

## Key Files

| Component | File Path |
|-----------|-----------|
| Frame Base | `src/frames/base.ts` |
| Data Frames | `src/frames/data.ts` |
| Pipeline | `src/pipeline/pipeline.ts` |
| FrameProcessor | `src/pipeline/frameProcessor.ts` |
| Deepgram STT | `src/services/stt/deepgram.ts` |
| OpenAI LLM | `src/services/llm/openai.ts` |
| Cartesia TTS | `src/services/tts/cartesia.ts` |
| WebSocket Transport | `examples/websocket-demo/` |

---

## Frame Processing Inside a Processor

```
                    ┌─────────────────────────────────────┐
                    │         FrameProcessor              │
                    │                                     │
  queueFrame() ────▶│  ┌─────────────────────────────┐   │
                    │  │     Frame Queue              │   │
                    │  │  ┌─────┬─────┬─────┬─────┐  │   │
                    │  │  │ Sys │ Sys │Data │Data │  │   │
                    │  │  │Frame│Frame│Frame│Frame│  │   │
                    │  │  └─────┴─────┴─────┴─────┘  │   │
                    │  │   (Priority: System > Data) │   │
                    │  └─────────────┬───────────────┘   │
                    │                │                   │
                    │                ▼                   │
                    │       processFrame()               │
                    │       (Abstract method)            │
                    │                │                   │
                    │                ▼                   │
                    │         pushFrame()  ─────────────▶│──── To Next Processor
                    │                                    │
                    └────────────────────────────────────┘
```

This diagram illustrates the complete frame processing workflow in pipecat-ts during voice agent communication.
