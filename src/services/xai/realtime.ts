/**
 * xAI Realtime LLM Service
 *
 * A standalone speech-to-speech service that connects to xAI's realtime API
 * via WebSocket. Handles audio input/output directly, bypassing the traditional
 * STT+LLM+TTS pipeline.
 */

import WebSocket from "ws";
import { Frame } from "../../frames/base";
import {
  InputAudioRawFrame,
  OutputAudioRawFrame,
  UserStartedSpeakingFrame,
  UserStoppedSpeakingFrame,
  BotStartedSpeakingFrame,
  BotStoppedSpeakingFrame,
} from "../../frames/data";
import { InterruptionFrame } from "../../frames/system";
import { FrameProcessor, type FrameProcessorOptions } from "../../processors/base";
import {
  type SessionProperties,
  type ClientEvent,
  type ServerEvent,
  type ConversationCreatedEvent,
  type SessionUpdatedEvent,
  type ResponseAudioDeltaEvent,
  type ResponseAudioDoneEvent,
  type SpeechStartedEvent,
  type SpeechStoppedEvent,
  type ResponseDoneEvent,
  type ErrorEvent,
  type XAIVoice,
  type SupportedSampleRate,
} from "./events";

/** Default WebSocket URL for xAI realtime API */
const DEFAULT_BASE_URL = "wss://api.x.ai/v1/realtime";

/** Default session properties */
const DEFAULT_SESSION_PROPERTIES: SessionProperties = {
  voice: "Ara",
  turnDetection: { type: "server_vad" },
  audio: {
    input: { format: { type: "audio/pcm", rate: 24000 } },
    output: { format: { type: "audio/pcm", rate: 24000 } },
  },
};

/**
 * Options for configuring the xAI realtime service.
 */
export interface XAIRealtimeOptions extends FrameProcessorOptions {
  /** xAI API key */
  apiKey: string;
  /** WebSocket base URL (default: "wss://api.x.ai/v1/realtime") */
  baseUrl?: string;
  /** Session configuration */
  sessionProperties?: SessionProperties;
  /** Start with audio input paused (default: false) */
  startAudioPaused?: boolean;
}

/**
 * xAI Realtime LLM Service
 *
 * A standalone speech-to-speech service that handles audio input and output
 * directly via WebSocket connection to xAI's realtime API (Grok).
 *
 * This service:
 * - Receives InputAudioRawFrame and streams audio to xAI
 * - Receives audio responses and emits OutputAudioRawFrame
 * - Uses server-side VAD for turn detection
 *
 * @example
 * ```typescript
 * const xai = new XAIRealtimeLLMService({
 *   apiKey: process.env.XAI_API_KEY!,
 *   sessionProperties: {
 *     instructions: "You are a helpful voice assistant.",
 *     voice: "Ara",
 *   }
 * });
 *
 * const pipeline = new Pipeline([
 *   transport.input(),
 *   xai,  // Handles STT+LLM+TTS internally
 *   transport.output()
 * ]);
 * ```
 */
export class XAIRealtimeLLMService extends FrameProcessor {
  // Configuration
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private sessionProperties: SessionProperties;

  // State
  private websocket: WebSocket | null = null;
  private audioInputPaused: boolean;
  private apiSessionReady: boolean = false;
  private disconnecting: boolean = false;
  private eventIdCounter: number = 0;
  private currentResponseId: string | null = null;
  private botIsSpeaking: boolean = false;

  constructor(options: XAIRealtimeOptions) {
    super({ ...options, name: options.name ?? "XAIRealtimeLLMService" });

    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.audioInputPaused = options.startAudioPaused ?? false;

    // Merge provided session properties with defaults
    this.sessionProperties = {
      ...DEFAULT_SESSION_PROPERTIES,
      ...options.sessionProperties,
      audio: {
        ...DEFAULT_SESSION_PROPERTIES.audio,
        ...options.sessionProperties?.audio,
      },
    };
  }

  /**
   * Setup the service - connects to xAI WebSocket.
   */
  public override async setup(): Promise<void> {
    await super.setup();
    await this.connect();
  }

  /**
   * Cleanup the service - disconnects from xAI WebSocket.
   */
  public override async cleanup(): Promise<void> {
    await this.disconnect();
    await super.cleanup();
  }

  /**
   * Set whether audio input is paused.
   */
  public setAudioInputPaused(paused: boolean): void {
    this.audioInputPaused = paused;
  }

  /**
   * Update voice setting.
   */
  public async setVoice(voice: XAIVoice): Promise<void> {
    this.sessionProperties.voice = voice;
    if (this.apiSessionReady) {
      await this.sendSessionUpdate();
    }
  }

  /**
   * Update system instructions.
   */
  public async setInstructions(instructions: string): Promise<void> {
    this.sessionProperties.instructions = instructions;
    if (this.apiSessionReady) {
      await this.sendSessionUpdate();
    }
  }

  /**
   * Process incoming frames.
   */
  protected override async processFrame(frame: Frame): Promise<void> {
    // Handle audio input
    if (frame instanceof InputAudioRawFrame) {
      await this.sendUserAudio(frame);
      return;
    }

    // Handle user started speaking (from external VAD)
    if (frame instanceof UserStartedSpeakingFrame) {
      await this.handleUserStartedSpeaking();
      return;
    }

    // Handle user stopped speaking (from external VAD)
    if (frame instanceof UserStoppedSpeakingFrame) {
      await this.handleUserStoppedSpeaking();
      return;
    }

    // Pass through other frames
    await this.pushFrame(frame, "downstream");
  }

  // ===========================================================================
  // WebSocket Management
  // ===========================================================================

  /**
   * Connect to xAI WebSocket API.
   */
  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log(`Connecting to ${this.baseUrl}`);

      this.websocket = new WebSocket(this.baseUrl, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      });

      this.websocket.on("open", () => {
        this.log("WebSocket connected");
        resolve();
      });

      this.websocket.on("message", (data: WebSocket.Data) => {
        this.handleMessage(data.toString());
      });

      this.websocket.on("error", error => {
        this.log(`WebSocket error: ${error}`);
        if (!this.apiSessionReady) {
          reject(error);
        }
      });

      this.websocket.on("close", (code, reason) => {
        this.log(`WebSocket closed: ${code} ${reason}`);
        this.apiSessionReady = false;
        this.websocket = null;
      });
    });
  }

  /**
   * Disconnect from xAI WebSocket API.
   */
  private async disconnect(): Promise<void> {
    if (!this.websocket) return;

    this.disconnecting = true;
    this.log("Disconnecting WebSocket");

    return new Promise(resolve => {
      if (this.websocket) {
        this.websocket.once("close", () => {
          this.websocket = null;
          this.apiSessionReady = false;
          this.disconnecting = false;
          resolve();
        });
        this.websocket.close();
      } else {
        resolve();
      }
    });
  }

  /**
   * Send an event to xAI.
   */
  private async sendEvent(event: ClientEvent): Promise<void> {
    if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      this.log("Cannot send event: WebSocket not connected");
      return;
    }

    const eventString = JSON.stringify(event);
    this.websocket.send(eventString);
  }

  /**
   * Generate a unique event ID.
   */
  private generateEventId(): string {
    return `event_${++this.eventIdCounter}`;
  }

  /**
   * Send session update to xAI.
   */
  private async sendSessionUpdate(): Promise<void> {
    await this.sendEvent({
      type: "session.update",
      event_id: this.generateEventId(),
      session: this.sessionProperties,
    });
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  /**
   * Handle incoming WebSocket message.
   */
  private async handleMessage(data: string): Promise<void> {
    try {
      const event = JSON.parse(data) as ServerEvent;

      switch (event.type) {
        case "conversation.created":
          await this.handleConversationCreated(event as ConversationCreatedEvent);
          break;
        case "session.updated":
          await this.handleSessionUpdated(event as SessionUpdatedEvent);
          break;
        case "response.output_audio.delta":
          await this.handleAudioDelta(event as ResponseAudioDeltaEvent);
          break;
        case "response.output_audio.done":
          await this.handleAudioDone(event as ResponseAudioDoneEvent);
          break;
        case "input_audio_buffer.speech_started":
          await this.handleSpeechStarted(event as SpeechStartedEvent);
          break;
        case "input_audio_buffer.speech_stopped":
          await this.handleSpeechStopped(event as SpeechStoppedEvent);
          break;
        case "response.done":
          await this.handleResponseDone(event as ResponseDoneEvent);
          break;
        case "error":
          await this.handleError(event as ErrorEvent);
          break;
        default:
          this.log(`Unhandled event type: ${(event as { type: string }).type}`);
      }
    } catch (error) {
      this.log(`Error parsing message: ${error}`);
    }
  }

  /**
   * Handle conversation.created event - first event after connection.
   */
  private async handleConversationCreated(event: ConversationCreatedEvent): Promise<void> {
    this.log(`Conversation created: ${event.conversation.id}`);

    // Send session configuration
    await this.sendSessionUpdate();
  }

  /**
   * Handle session.updated event - session configuration confirmed.
   */
  private async handleSessionUpdated(event: SessionUpdatedEvent): Promise<void> {
    this.log("Session updated", { session: event.session });
    this.apiSessionReady = true;
  }

  /**
   * Handle speech_started event from server VAD.
   */
  private async handleSpeechStarted(event: SpeechStartedEvent): Promise<void> {
    this.log("Speech started (server VAD)", { item_id: event.item_id });

    // Push user started speaking frame upstream
    await this.pushFrame(new UserStartedSpeakingFrame(), "upstream");

    // Handle interruption if bot is speaking
    if (this.botIsSpeaking) {
      await this.handleInterruption();
    }
  }

  /**
   * Handle speech_stopped event from server VAD.
   */
  private async handleSpeechStopped(event: SpeechStoppedEvent): Promise<void> {
    this.log("Speech stopped (server VAD)", { item_id: event.item_id });

    // Push user stopped speaking frame upstream
    await this.pushFrame(new UserStoppedSpeakingFrame(), "upstream");
  }

  /**
   * Handle audio delta - streaming audio from assistant.
   */
  private async handleAudioDelta(event: ResponseAudioDeltaEvent): Promise<void> {
    // Track that bot is speaking
    if (!this.botIsSpeaking) {
      this.botIsSpeaking = true;
      this.currentResponseId = event.response_id;
      await this.pushFrame(new BotStartedSpeakingFrame(), "downstream");
    }

    // Decode base64 audio
    const audioData = Buffer.from(event.delta, "base64");
    const frame = new OutputAudioRawFrame(
      new Uint8Array(audioData),
      this.getOutputSampleRate(),
      1 // mono
    );

    await this.pushFrame(frame, "downstream");
  }

  /**
   * Handle audio done - audio output complete.
   */
  private async handleAudioDone(event: ResponseAudioDoneEvent): Promise<void> {
    this.log("Audio output complete", { response_id: event.response_id, item_id: event.item_id });
  }

  /**
   * Handle response done - response generation complete.
   */
  private async handleResponseDone(event: ResponseDoneEvent): Promise<void> {
    this.log(`Response done: ${event.response.status}`);

    if (this.botIsSpeaking) {
      this.botIsSpeaking = false;
      this.currentResponseId = null;
      await this.pushFrame(new BotStoppedSpeakingFrame(), "downstream");
    }
  }

  /**
   * Handle error event from API.
   */
  private async handleError(event: ErrorEvent): Promise<void> {
    const errorMsg = `xAI API error: ${event.error.message}`;
    this.log(errorMsg);
    await this.pushError(errorMsg);
  }

  // ===========================================================================
  // Audio Handling
  // ===========================================================================

  /**
   * Send user audio to xAI.
   */
  private async sendUserAudio(frame: InputAudioRawFrame): Promise<void> {
    // Skip if paused or session not ready
    if (this.audioInputPaused || !this.apiSessionReady) {
      return;
    }

    // Encode audio to base64
    const base64Audio = Buffer.from(frame.audio).toString("base64");

    // Send to xAI
    await this.sendEvent({
      type: "input_audio_buffer.append",
      event_id: this.generateEventId(),
      audio: base64Audio,
    });
  }

  /**
   * Get the output sample rate from session properties.
   */
  private getOutputSampleRate(): SupportedSampleRate {
    const format = this.sessionProperties.audio?.output?.format;
    if (format && format.type === "audio/pcm") {
      return format.rate;
    }
    // Default for PCMU/PCMA is 8000, but we default to 24000 for PCM
    return 24000;
  }

  // ===========================================================================
  // Interruption Handling
  // ===========================================================================

  /**
   * Handle interruption when user starts speaking during bot response.
   */
  private async handleInterruption(): Promise<void> {
    this.log("Handling interruption");

    // Cancel current response
    await this.sendEvent({
      type: "response.cancel",
      event_id: this.generateEventId(),
    });

    // Clear input buffer (for manual VAD mode)
    await this.sendEvent({
      type: "input_audio_buffer.clear",
      event_id: this.generateEventId(),
    });

    // Push interruption frame downstream
    await this.pushFrame(new InterruptionFrame(), "downstream");

    // Reset bot speaking state
    if (this.botIsSpeaking) {
      this.botIsSpeaking = false;
      this.currentResponseId = null;
      await this.pushFrame(new BotStoppedSpeakingFrame(), "downstream");
    }
  }

  /**
   * Handle user started speaking event from external VAD.
   */
  private async handleUserStartedSpeaking(): Promise<void> {
    // If using manual VAD mode and bot is speaking, handle interruption
    if (this.sessionProperties.turnDetection?.type === null && this.botIsSpeaking) {
      await this.handleInterruption();
    }
  }

  /**
   * Handle user stopped speaking event from external VAD.
   */
  private async handleUserStoppedSpeaking(): Promise<void> {
    // In manual VAD mode, commit buffer and create response
    if (this.sessionProperties.turnDetection?.type === null) {
      await this.sendEvent({
        type: "input_audio_buffer.commit",
        event_id: this.generateEventId(),
      });

      await this.sendEvent({
        type: "response.create",
        event_id: this.generateEventId(),
        response: {
          modalities: ["audio"],
        },
      });
    }
  }
}
