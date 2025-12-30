import { Frame } from "../../frames/base";
import {
  InputAudioRawFrame,
  InterimTranscriptionFrame,
  TranscriptionFrame,
  type Language,
} from "../../frames/data";
import { FrameProcessor, type FrameProcessorOptions } from "../../processors/base";

/**
 * Result returned by STT implementations for callback-based results.
 */
export interface STTResult {
  /** Final transcription text */
  text: string;
  /** Detected or specified language */
  language?: Language;
  /** Optional raw provider response */
  result?: unknown;
  /** Whether this is an interim (non-final) result */
  interim?: boolean;
  /** Optional user identifier for the transcription */
  userId?: string;
  /** Optional timestamp (ISO 8601). Defaults to now if omitted. */
  timestamp?: string;
}

export interface STTServiceOptions extends FrameProcessorOptions {
  /** Default user ID to attach to transcription frames */
  userId?: string;
  /** Default language hint for the recognizer */
  language?: Language;
  /** Sample rate for audio input (default: 16000) */
  sampleRate?: number;
}

/**
 * Abstract Speech-to-Text service using streaming architecture.
 *
 * This follows the pipecat workflow where:
 * 1. Connection is established during setup() (called on start)
 * 2. runSTT() is a fire-and-forget method that sends audio to the streaming service
 * 3. Transcription results arrive asynchronously via callbacks and are pushed downstream
 * 4. Connection is closed during cleanup() (called on stop)
 *
 * Subclasses implement:
 * - setup(): Establish streaming connection
 * - runSTT(): Send audio data to the stream (fire-and-forget)
 * - cleanup(): Close the streaming connection
 *
 * Subclasses should call pushTranscriptionResult() from their event handlers
 * to emit transcription frames.
 */
export abstract class STTService extends FrameProcessor {
  protected readonly defaultUserId: string;
  protected readonly defaultLanguage?: Language;
  protected readonly sampleRate: number;

  constructor(options: STTServiceOptions = {}) {
    super({ ...options, name: options.name ?? "STTService" });
    this.defaultUserId = options.userId ?? "unknown";
    this.defaultLanguage = options.language;
    this.sampleRate = options.sampleRate ?? 16000;
  }

  /**
   * Send audio to the streaming STT service.
   * This is a fire-and-forget method - results come via callbacks.
   *
   * @param audio - Audio data to transcribe
   * @param frame - The original audio frame for metadata
   */
  protected abstract runSTT(audio: Uint8Array, frame: InputAudioRawFrame): Promise<void>;

  /**
   * Push a transcription result downstream.
   * Call this from event handlers when transcription results arrive.
   *
   * @param result - The transcription result
   */
  protected async pushTranscriptionResult(result: STTResult): Promise<void> {
    const userId = result.userId ?? this.defaultUserId;
    const timestamp = result.timestamp ?? new Date().toISOString();
    const language = result.language ?? this.defaultLanguage;

    if (result.interim) {
      const interim = new InterimTranscriptionFrame(result.text, userId, timestamp, result.result);
      await this.pushFrame(interim, "downstream");
      return;
    }

    const transcription = new TranscriptionFrame(
      result.text,
      userId,
      timestamp,
      language,
      result.result
    );
    await this.pushFrame(transcription, "downstream");
  }

  protected async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof InputAudioRawFrame) {
      // Fire-and-forget: send audio to the streaming service
      // Results will arrive asynchronously via callbacks
      await this.runSTT(frame.audio, frame);

      // Pass through the audio frame for downstream processors
      await this.pushFrame(frame, "downstream");
      return;
    }

    // Pass through any other frames unchanged
    await this.pushFrame(frame, "downstream");
  }
}
