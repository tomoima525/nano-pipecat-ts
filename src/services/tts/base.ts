import { Frame } from "../../frames/base";
import {
  TextFrame,
  TTSAudioRawFrame,
  TranscriptionFrame,
  InterimTranscriptionFrame,
  type Language,
} from "../../frames/data";
import { TTSStartedFrame, TTSStoppedFrame } from "../../frames/control";
import { FrameProcessor, type FrameProcessorOptions } from "../../processors/base";

/**
 * Audio output format configuration for TTS services.
 */
export interface TTSAudioFormat {
  /** Sample rate in Hz (e.g., 16000, 22050, 24000, 44100) */
  sampleRate: number;
  /** Number of audio channels (typically 1 for mono) */
  numChannels: number;
}

/**
 * Result returned by TTS implementations.
 */
export interface TTSResult {
  /** Raw PCM audio data */
  audio: Uint8Array;
  /** Sample rate of the audio */
  sampleRate: number;
  /** Number of channels */
  numChannels: number;
}

/**
 * Options for configuring TTS services.
 */
export interface TTSServiceOptions extends FrameProcessorOptions {
  /** Voice identifier for the TTS service */
  voiceId?: string;
  /** Model identifier for the TTS service */
  modelId?: string;
  /** Language for synthesis */
  language?: Language;
  /** Audio output format configuration */
  audioFormat?: TTSAudioFormat;
}

/**
 * Abstract Text-to-Speech service.
 *
 * Subclasses implement the provider-specific {@link runTTS} method. This base
 * class handles TextFrame ingestion and emits TTSStartedFrame, TTSAudioRawFrame,
 * and TTSStoppedFrame downstream.
 *
 * @example
 * ```typescript
 * class MyTTSService extends TTSService {
 *   protected async runTTS(text: string): Promise<TTSResult> {
 *     // Call TTS API and return audio
 *     const audio = await myTTSAPI.synthesize(text);
 *     return {
 *       audio,
 *       sampleRate: 24000,
 *       numChannels: 1
 *     };
 *   }
 * }
 * ```
 */
export abstract class TTSService extends FrameProcessor {
  protected readonly voiceId?: string;
  protected readonly modelId?: string;
  protected readonly language?: Language;
  protected readonly audioFormat: TTSAudioFormat;

  constructor(options: TTSServiceOptions = {}) {
    super({ ...options, name: options.name ?? "TTSService" });
    this.voiceId = options.voiceId;
    this.modelId = options.modelId;
    this.language = options.language;
    this.audioFormat = options.audioFormat ?? { sampleRate: 24000, numChannels: 1 };
  }

  /**
   * Provider-specific TTS implementation. Should return synthesized audio.
   *
   * @param text - The text to synthesize
   * @returns Promise resolving to TTS result with audio data
   */
  protected abstract runTTS(text: string): Promise<TTSResult>;

  /**
   * Process incoming frames. TextFrames are converted to audio via runTTS.
   * Other frames are passed through unchanged.
   *
   * @param frame - The frame to process
   */
  protected async processFrame(frame: Frame): Promise<void> {
    // Skip transcription frames - they extend TextFrame but should not be spoken
    // TranscriptionFrame contains user speech, not bot responses
    if (frame instanceof TranscriptionFrame || frame instanceof InterimTranscriptionFrame) {
      await this.pushFrame(frame, "downstream");
      return;
    }

    if (frame instanceof TextFrame) {
      // Skip TTS if the frame is marked to skip
      if (frame.skipTts) {
        await this.pushFrame(frame, "downstream");
        return;
      }

      const text = frame.text;

      // Skip empty text
      if (!text || text.trim().length === 0) {
        return;
      }

      // Signal TTS start
      await this.pushFrame(new TTSStartedFrame(), "downstream");

      try {
        // Run TTS synthesis
        const result = await this.runTTS(text);

        // Push audio frame
        const audioFrame = new TTSAudioRawFrame(
          result.audio,
          result.sampleRate,
          result.numChannels
        );
        await this.pushFrame(audioFrame, "downstream");
      } finally {
        // Signal TTS stop (even on error)
        await this.pushFrame(new TTSStoppedFrame(), "downstream");
      }

      return;
    }

    // Pass through any other frames unchanged
    await this.pushFrame(frame, "downstream");
  }
}
