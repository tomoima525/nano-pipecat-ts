import { Frame } from "../../frames/base";
import {
  InputAudioRawFrame,
  InterimTranscriptionFrame,
  TranscriptionFrame,
  type Language,
} from "../../frames/data";
import { FrameProcessor, type FrameProcessorOptions } from "../../processors/base";

/**
 * Result returned by STT implementations.
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
}

/**
 * Abstract Speech-to-Text service.
 *
 * Subclasses implement the provider-specific {@link runSTT} method. This base
 * class handles InputAudioRawFrame ingestion and emits TranscriptionFrame or
 * InterimTranscriptionFrame downstream.
 */
export abstract class STTService extends FrameProcessor {
  protected readonly defaultUserId: string;
  protected readonly defaultLanguage?: Language;

  constructor(options: STTServiceOptions = {}) {
    super({ ...options, name: options.name ?? "STTService" });
    this.defaultUserId = options.userId ?? "unknown";
    this.defaultLanguage = options.language;
  }

  /**
   * Provider-specific STT implementation. Should return a transcription result.
   */
  protected abstract runSTT(audio: Uint8Array, frame: InputAudioRawFrame): Promise<STTResult>;

  protected async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof InputAudioRawFrame) {
      const result = await this.runSTT(frame.audio, frame);
      const userId = result.userId ?? this.defaultUserId;
      const timestamp = result.timestamp ?? new Date().toISOString();
      const language = result.language ?? this.defaultLanguage;

      if (result.interim) {
        const interim = new InterimTranscriptionFrame(
          result.text,
          userId,
          timestamp,
          result.result
        );
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
      return;
    }

    // Pass through any other frames unchanged
    await this.pushFrame(frame, "downstream");
  }
}
