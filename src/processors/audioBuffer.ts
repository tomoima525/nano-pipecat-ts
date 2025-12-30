/**
 * Audio Buffer Processor
 *
 * Collects audio frames while the user is speaking and emits a single
 * combined audio frame when the user stops speaking. This is useful for
 * batch STT services that process complete utterances.
 */

import { Frame } from "../frames/base";
import {
  InputAudioRawFrame,
  UserStartedSpeakingFrame,
  UserStoppedSpeakingFrame,
} from "../frames/data";
import { FrameProcessor, type FrameProcessorOptions } from "./base";

/**
 * Options for AudioBufferProcessor.
 */
export interface AudioBufferProcessorOptions extends FrameProcessorOptions {
  /** Sample rate for output audio frames (default: 16000) */
  sampleRate?: number;
  /** Number of channels for output audio frames (default: 1) */
  numChannels?: number;
  /**
   * Number of audio frames to keep in a pre-roll buffer before speech is detected.
   * When UserStartedSpeakingFrame is received, these frames are included at the
   * start of the buffered audio. This prevents audio cutoff at the beginning of speech.
   * Default: 5 (approximately 100ms at 20ms per frame)
   */
  preRollFrames?: number;
}

/**
 * Audio buffer processor that collects audio until user stops speaking.
 *
 * This processor:
 * - Listens for UserStartedSpeakingFrame to begin buffering
 * - Buffers all InputAudioRawFrame while user is speaking
 * - On UserStoppedSpeakingFrame, combines buffered audio into a single frame
 * - Passes through all non-audio frames unchanged
 *
 * @example
 * ```typescript
 * const audioBuffer = new AudioBufferProcessor({
 *   sampleRate: 16000,
 *   numChannels: 1,
 * });
 *
 * // Use in pipeline with VAD and STT
 * const pipeline = new Pipeline([
 *   vadProcessor,
 *   audioBuffer,
 *   sttService,
 * ]);
 * ```
 */
export class AudioBufferProcessor extends FrameProcessor {
  private audioBuffer: Uint8Array[] = [];
  private preRollBuffer: Uint8Array[] = [];
  private isUserSpeaking = false;
  private readonly sampleRate: number;
  private readonly numChannels: number;
  private readonly preRollFrames: number;

  constructor(options: AudioBufferProcessorOptions = {}) {
    super({ ...options, name: options.name ?? "AudioBufferProcessor" });
    this.sampleRate = options.sampleRate ?? 16000;
    this.numChannels = options.numChannels ?? 1;
    this.preRollFrames = options.preRollFrames ?? 5;
  }

  /**
   * Get the current buffer size in bytes.
   */
  public getBufferSize(): number {
    return this.audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
  }

  /**
   * Check if currently buffering (user is speaking).
   */
  public isBuffering(): boolean {
    return this.isUserSpeaking;
  }

  /**
   * Clear the audio buffer without emitting.
   */
  public clearBuffer(): void {
    this.audioBuffer = [];
  }

  protected async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof UserStartedSpeakingFrame) {
      this.isUserSpeaking = true;
      // Include pre-roll audio to prevent cutoff at the start of speech
      this.audioBuffer = [...this.preRollBuffer];
      this.preRollBuffer = [];
      await this.pushFrame(frame, "downstream");
      return;
    }

    if (frame instanceof UserStoppedSpeakingFrame) {
      this.isUserSpeaking = false;

      // Combine all buffered audio into a single frame
      if (this.audioBuffer.length > 0) {
        const totalLength = this.audioBuffer.reduce(
          (sum, chunk) => sum + chunk.length,
          0
        );
        const combinedAudio = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of this.audioBuffer) {
          combinedAudio.set(chunk, offset);
          offset += chunk.length;
        }

        const audioFrame = new InputAudioRawFrame(
          combinedAudio,
          this.sampleRate,
          this.numChannels
        );
        await this.pushFrame(audioFrame, "downstream");
      }

      await this.pushFrame(frame, "downstream");
      this.audioBuffer = [];
      return;
    }

    if (frame instanceof InputAudioRawFrame) {
      if (this.isUserSpeaking) {
        // Buffer audio while user is speaking
        this.audioBuffer.push(frame.audio);
      } else {
        // Keep a rolling pre-roll buffer when not speaking
        // This ensures we capture the start of speech
        this.preRollBuffer.push(frame.audio);
        if (this.preRollBuffer.length > this.preRollFrames) {
          this.preRollBuffer.shift();
        }
      }
      // Don't pass individual audio frames downstream - we batch them
      return;
    }

    // Pass through other frames
    await this.pushFrame(frame, "downstream");
  }
}
