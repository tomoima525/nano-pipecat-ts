/**
 * Simple Voice Activity Detection (VAD) Processor
 *
 * Detects speech based on audio volume threshold and emits
 * UserStartedSpeakingFrame and UserStoppedSpeakingFrame events.
 */

import { Frame } from "../frames/base";
import {
  InputAudioRawFrame,
  UserStartedSpeakingFrame,
  UserStoppedSpeakingFrame,
} from "../frames/data";
import { FrameProcessor, type FrameProcessorOptions } from "./base";

/**
 * Options for SimpleVADProcessor.
 */
export interface SimpleVADProcessorOptions extends FrameProcessorOptions {
  /**
   * Volume threshold for speech detection (0.0 to 1.0).
   * Audio with RMS volume above this threshold is considered speech.
   * Default: 0.01
   */
  threshold?: number;

  /**
   * Number of consecutive speech frames required to trigger UserStartedSpeakingFrame.
   * Helps avoid false positives from brief noise spikes.
   * Default: 3
   */
  startFrames?: number;

  /**
   * Number of consecutive silence frames required to trigger UserStoppedSpeakingFrame.
   * Helps avoid premature cutoff during natural speech pauses.
   * Default: 15
   */
  stopFrames?: number;
}

/**
 * Simple VAD (Voice Activity Detection) processor.
 *
 * Analyzes audio frames and detects speech based on volume threshold.
 * Emits UserStartedSpeakingFrame when speech begins and
 * UserStoppedSpeakingFrame when speech ends.
 *
 * @example
 * ```typescript
 * const vad = new SimpleVADProcessor({
 *   threshold: 0.01,
 *   startFrames: 3,
 *   stopFrames: 15,
 * });
 *
 * // Use in pipeline
 * const pipeline = new Pipeline([
 *   transport.input(),
 *   vad,
 *   audioBuffer,
 *   sttService,
 * ]);
 * ```
 */
export class SimpleVADProcessor extends FrameProcessor {
  private userSpeaking = false;
  private speechFrameCount = 0;
  private silenceFrameCount = 0;
  private readonly threshold: number;
  private readonly startFrames: number;
  private readonly stopFrames: number;

  constructor(options: SimpleVADProcessorOptions = {}) {
    super({ ...options, name: options.name ?? "SimpleVADProcessor" });
    this.threshold = options.threshold ?? 0.01;
    this.startFrames = options.startFrames ?? 3;
    this.stopFrames = options.stopFrames ?? 15;
  }

  /**
   * Check if user is currently speaking.
   */
  public isSpeaking(): boolean {
    return this.userSpeaking;
  }

  /**
   * Get current speech frame count.
   */
  public getSpeechFrameCount(): number {
    return this.speechFrameCount;
  }

  /**
   * Get current silence frame count.
   */
  public getSilenceFrameCount(): number {
    return this.silenceFrameCount;
  }

  /**
   * Reset VAD state.
   */
  public reset(): void {
    this.userSpeaking = false;
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
  }

  protected async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof InputAudioRawFrame) {
      const isSpeech = this.detectSpeech(frame.audio);

      if (isSpeech) {
        this.speechFrameCount++;
        this.silenceFrameCount = 0;

        if (!this.userSpeaking && this.speechFrameCount >= this.startFrames) {
          this.userSpeaking = true;
          await this.pushFrame(new UserStartedSpeakingFrame(), "downstream");
        }
      } else {
        this.silenceFrameCount++;
        this.speechFrameCount = 0;

        if (this.userSpeaking && this.silenceFrameCount >= this.stopFrames) {
          this.userSpeaking = false;
          await this.pushFrame(new UserStoppedSpeakingFrame(), "downstream");
        }
      }

      // Always pass audio downstream
      await this.pushFrame(frame, "downstream");
      return;
    }

    // Pass through other frames
    await this.pushFrame(frame, "downstream");
  }

  /**
   * Detect if audio contains speech based on volume threshold.
   */
  private detectSpeech(audio: Uint8Array): boolean {
    const volume = this.calculateVolume(audio);
    return volume > this.threshold;
  }

  /**
   * Calculate RMS volume of 16-bit PCM audio data.
   *
   * @param audio - 16-bit PCM audio data (little-endian)
   * @returns RMS volume normalized to 0.0-1.0 range
   */
  private calculateVolume(audio: Uint8Array): number {
    if (audio.length < 2) return 0;

    let sumSquares = 0;
    const numSamples = Math.floor(audio.length / 2);

    for (let i = 0; i < audio.length; i += 2) {
      // Read 16-bit signed sample (little-endian)
      const sample =
        (audio[i] | (audio[i + 1] << 8)) -
        (audio[i + 1] & 0x80 ? 0x10000 : 0);
      // Normalize to -1.0 to 1.0 range
      const normalized = sample / 32768;
      sumSquares += normalized * normalized;
    }

    // Return RMS (root mean square)
    return Math.sqrt(sumSquares / numSamples);
  }
}
