import {
  createClient,
  LiveTranscriptionEvents,
  type DeepgramClient,
  type ListenLiveClient,
  type LiveSchema,
  type LiveTranscriptionEvent,
} from "@deepgram/sdk";
import { InputAudioRawFrame, type Language } from "../../frames/data";
import { STTService, type STTServiceOptions } from "./base";

export interface DeepgramSTTOptions extends STTServiceOptions {
  /** Deepgram API key */
  apiKey: string;
  /** Deepgram model to use (default: nova-2) */
  model?: string;
  /** Language hint (overrides base defaultLanguage if provided) */
  language?: Language;
  /** Enable smart formatting (punctuation, capitalization) */
  smartFormat?: boolean;
  /** Enable interim (partial) results */
  interimResults?: boolean;
  /** Utterance end silence threshold in ms (default: 1000) */
  utteranceEndMs?: number;
  /** Enable VAD events */
  vadEvents?: boolean;
  /** Audio encoding (default: linear16) */
  encoding?: string;
}

/**
 * Deepgram Speech-to-Text service using WebSocket streaming.
 *
 * This service follows the pipecat workflow:
 * 1. WebSocket connection is established in setup()
 * 2. runSTT() sends audio to the WebSocket (fire-and-forget)
 * 3. Transcription results arrive via WebSocket callbacks
 * 4. WebSocket is closed in cleanup()
 *
 * @example
 * ```typescript
 * const stt = new DeepgramSTTService({
 *   apiKey: process.env.DEEPGRAM_API_KEY!,
 *   model: "nova-2",
 *   language: "en",
 *   interimResults: true,
 * });
 * ```
 */
export class DeepgramSTTService extends STTService {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly smartFormat: boolean;
  private readonly interimResults: boolean;
  private readonly utteranceEndMs: number;
  private readonly vadEvents: boolean;
  private readonly encoding: string;

  private client: DeepgramClient | null = null;
  private connection: ListenLiveClient | null = null;
  private keepAlive: NodeJS.Timeout | null = null;

  constructor(options: DeepgramSTTOptions) {
    super({
      ...options,
      name: options.name ?? "DeepgramSTTService",
      language: options.language,
    });

    this.apiKey = options.apiKey;
    this.model = options.model ?? "nova-2";
    this.smartFormat = options.smartFormat ?? true;
    this.interimResults = options.interimResults ?? true;
    this.utteranceEndMs = options.utteranceEndMs ?? 1000;
    this.vadEvents = options.vadEvents ?? false;
    this.encoding = options.encoding ?? "linear16";
  }

  /**
   * Set up the WebSocket connection to Deepgram.
   * Called when the pipeline starts.
   */
  public override async setup(): Promise<void> {
    await super.setup();

    this.client = createClient(this.apiKey);

    // Build live transcription options
    const liveOptions: LiveSchema = {
      model: this.model,
      smart_format: this.smartFormat,
      interim_results: this.interimResults,
      utterance_end_ms: this.utteranceEndMs,
      vad_events: this.vadEvents,
      encoding: this.encoding,
      sample_rate: this.sampleRate,
      channels: 1,
    };

    if (this.defaultLanguage) {
      liveOptions.language = this.defaultLanguage;
    }

    // Create the live transcription connection
    this.connection = this.client.listen.live(liveOptions);
    if (this.keepAlive) clearInterval(this.keepAlive);
    this.keepAlive = setInterval(() => {
      console.log("KeepAlive sent.");
      this.connection?.keepAlive?.();
    }, 3000);

    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Set up WebSocket event handlers for transcription events.
   */
  private setupEventHandlers(): void {
    if (!this.connection) return;

    // Handle connection open
    this.connection.on(LiveTranscriptionEvents.Open, () => {
      // Connection established, ready to receive audio
      console.log("[Deepgram Debug] Connection opened with config:", {
        model: this.model,
        encoding: this.encoding,
        sampleRate: this.sampleRate,
        language: this.defaultLanguage,
        interimResults: this.interimResults,
      });
    });

    // Handle transcription results
    this.connection.on(LiveTranscriptionEvents.Transcript, (data: LiveTranscriptionEvent) => {
      const transcript = data.channel?.alternatives?.[0]?.transcript ?? "";
      console.log("[Deepgram Debug] Transcription received:", {
        transcript: transcript || "(empty)",
        isFinal: data.is_final,
        speechFinal: data.speech_final,
        confidence: data.channel?.alternatives?.[0]?.confidence,
      });
      this.handleTranscript(data);
    });

    // Handle connection close
    this.connection.on(LiveTranscriptionEvents.Close, () => {
      // Connection closed
      console.log("Deepgram connection closed");
      if (this.keepAlive) clearInterval(this.keepAlive);
      this.keepAlive = null;
    });

    // Handle errors
    this.connection.on(LiveTranscriptionEvents.Error, (error: Error) => {
      this.pushError(`Deepgram WebSocket error: ${error.message}`);
    });

    this.connection.on(LiveTranscriptionEvents.Unhandled, (data: unknown) => {
      console.log("Deepgram unhandled event received");
      console.log(data);
    });
  }

  /**
   * Handle incoming transcription results.
   */
  private handleTranscript(data: LiveTranscriptionEvent): void {
    const transcript = data.channel?.alternatives?.[0]?.transcript ?? "";

    // Skip empty transcripts
    if (!transcript.trim()) {
      return;
    }

    // Determine if this is an interim or final result
    const isFinal = data.is_final ?? false;
    const speechFinal = data.speech_final ?? false;
    console.log("Transcript:", transcript, "Is final:", isFinal, "Speech final:", speechFinal);
    // Push the transcription result
    this.pushTranscriptionResult({
      text: transcript,
      interim: !isFinal && !speechFinal,
      language: this.defaultLanguage,
      result: data,
    });
  }

  // Debug counter for logging
  private audioSendCount = 0;

  /**
   * Send audio data to the Deepgram WebSocket.
   * This is a fire-and-forget operation - results come via callbacks.
   */
  protected async runSTT(audio: Uint8Array, _frame: InputAudioRawFrame): Promise<void> {
    if (!this.connection) {
      console.log("[Deepgram Debug] No connection, skipping audio");
      return;
    }

    // Log first few sends for debugging
    if (this.audioSendCount < 3) {
      console.log(`[Deepgram Debug] Sending audio chunk ${this.audioSendCount}:`, {
        audioBytes: audio.length,
        byteOffset: audio.byteOffset,
        bufferByteLength: audio.buffer.byteLength,
        configuredEncoding: this.encoding,
        configuredSampleRate: this.sampleRate,
        firstFewBytes: Array.from(audio.slice(0, 10)),
      });
      this.audioSendCount++;
    }

    // Convert Uint8Array to ArrayBuffer for Deepgram SDK
    // Handle case where Uint8Array may be a view into a larger buffer
    const arrayBuffer =
      audio.byteOffset === 0 && audio.byteLength === audio.buffer.byteLength
        ? audio.buffer
        : audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength);

    this.connection.send(arrayBuffer);
  }

  /**
   * Clean up the WebSocket connection.
   * Called when the pipeline stops.
   */
  public override async cleanup(): Promise<void> {
    if (this.connection) {
      // Request graceful close
      this.connection.requestClose();
      this.connection = null;
    }

    this.client = null;

    await super.cleanup();
  }
}
