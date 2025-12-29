/**
 * Base Transport Layer
 *
 * The transport layer handles input/output of frames from/to external sources
 * such as WebSocket connections, audio devices, and video streams.
 *
 * Key components:
 * - BaseTransport: Abstract base class defining transport interface
 * - TransportParams: Configuration parameters for transports
 * - BaseInputTransport: Handles input frame processing (audio, video, messages)
 * - BaseOutputTransport: Handles output frame processing (audio, video, messages)
 */

import { Frame } from "../frames/base";
import {
  InputAudioRawFrame,
  OutputAudioRawFrame,
  AudioConfig,
  UserStartedSpeakingFrame,
  UserStoppedSpeakingFrame,
  BotStartedSpeakingFrame,
  BotStoppedSpeakingFrame,
  InputTransportMessageFrame,
  OutputTransportMessageFrame,
  TTSAudioRawFrame,
} from "../frames/data";
import { TTSStartedFrame, TTSStoppedFrame } from "../frames/control";
import { FrameProcessor, type FrameProcessorOptions } from "../processors/base";

/**
 * Sleep utility function for async delays.
 */
function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Configuration parameters for audio input.
 */
export interface AudioInputParams {
  /** Whether audio input is enabled */
  enabled: boolean;
  /** Sample rate in Hz (e.g., 16000, 44100) */
  sampleRate: number;
  /** Number of audio channels (1 for mono, 2 for stereo) */
  numChannels: number;
  /** Size of audio chunks in milliseconds */
  chunkSizeMs: number;
}

/**
 * Configuration parameters for audio output.
 */
export interface AudioOutputParams {
  /** Whether audio output is enabled */
  enabled: boolean;
  /** Sample rate in Hz (e.g., 16000, 24000) */
  sampleRate: number;
  /** Number of audio channels (1 for mono, 2 for stereo) */
  numChannels: number;
  /** Size of audio chunks in milliseconds */
  chunkSizeMs: number;
}

/**
 * Configuration parameters for VAD (Voice Activity Detection).
 */
export interface VADParams {
  /** Whether VAD is enabled */
  enabled: boolean;
  /** Audio level threshold for speech detection (0-1) */
  threshold: number;
  /** Number of consecutive speech frames to start speaking */
  startFrames: number;
  /** Number of consecutive silence frames to stop speaking */
  stopFrames: number;
}

/**
 * Complete transport configuration parameters.
 */
export interface TransportParams {
  /** Audio input configuration */
  audioIn: AudioInputParams;
  /** Audio output configuration */
  audioOut: AudioOutputParams;
  /** VAD configuration */
  vad: VADParams;
  /** Whether to add timestamps to frames */
  addTimestamps: boolean;
}

/**
 * Default transport parameters.
 */
export const DEFAULT_TRANSPORT_PARAMS: TransportParams = {
  audioIn: {
    enabled: true,
    sampleRate: 16000,
    numChannels: 1,
    chunkSizeMs: 20,
  },
  audioOut: {
    enabled: true,
    sampleRate: 24000,
    numChannels: 1,
    chunkSizeMs: 20,
  },
  vad: {
    enabled: true,
    threshold: 0.01,
    startFrames: 3,
    stopFrames: 10,
  },
  addTimestamps: true,
};

/**
 * Options for BaseTransport.
 */
export interface BaseTransportOptions extends FrameProcessorOptions {
  /** Transport configuration parameters */
  params?: Partial<TransportParams>;
  /** Name for input transport */
  inputName?: string;
  /** Name for output transport */
  outputName?: string;
}

/**
 * Abstract base class for transport implementations.
 *
 * Transports handle the connection between the pipeline and external sources/sinks.
 * They provide separate input and output processors that can be used in a pipeline.
 *
 * @example
 * ```typescript
 * class MyTransport extends BaseTransport {
 *   input(): FrameProcessor {
 *     return this._input;
 *   }
 *
 *   output(): FrameProcessor {
 *     return this._output;
 *   }
 * }
 * ```
 */
export abstract class BaseTransport extends FrameProcessor {
  /** Transport configuration */
  protected readonly params: TransportParams;
  /** Name for input transport */
  protected readonly inputName: string;
  /** Name for output transport */
  protected readonly outputName: string;

  constructor(options: BaseTransportOptions = {}) {
    super({ ...options, name: options.name ?? "BaseTransport" });
    this.params = {
      ...DEFAULT_TRANSPORT_PARAMS,
      ...options.params,
      audioIn: { ...DEFAULT_TRANSPORT_PARAMS.audioIn, ...options.params?.audioIn },
      audioOut: { ...DEFAULT_TRANSPORT_PARAMS.audioOut, ...options.params?.audioOut },
      vad: { ...DEFAULT_TRANSPORT_PARAMS.vad, ...options.params?.vad },
    };
    this.inputName = options.inputName ?? "TransportInput";
    this.outputName = options.outputName ?? "TransportOutput";
  }

  /**
   * Get the input frame processor for this transport.
   * This processor handles incoming frames from external sources.
   */
  public abstract input(): FrameProcessor;

  /**
   * Get the output frame processor for this transport.
   * This processor handles outgoing frames to external destinations.
   */
  public abstract output(): FrameProcessor;

  /**
   * Get the audio input configuration.
   */
  public getAudioInputConfig(): AudioConfig {
    return {
      sampleRate: this.params.audioIn.sampleRate,
      numChannels: this.params.audioIn.numChannels,
    };
  }

  /**
   * Get the audio output configuration.
   */
  public getAudioOutputConfig(): AudioConfig {
    return {
      sampleRate: this.params.audioOut.sampleRate,
      numChannels: this.params.audioOut.numChannels,
    };
  }

  /**
   * Process frames - base implementation passes through.
   */
  protected async processFrame(frame: Frame): Promise<void> {
    await this.pushFrame(frame, "downstream");
  }
}

/**
 * Options for BaseInputTransport.
 */
export interface BaseInputTransportOptions extends FrameProcessorOptions {
  /** Audio input configuration */
  audioConfig?: AudioConfig;
  /** VAD configuration */
  vadConfig?: VADParams;
}

/**
 * Base class for transport input processing.
 *
 * Handles incoming audio frames, VAD processing, and user speaking state management.
 * Subclasses implement the actual input source connection.
 *
 * @example
 * ```typescript
 * class WebSocketInputTransport extends BaseInputTransport {
 *   private ws: WebSocket;
 *
 *   protected async receiveAudioFrame(): Promise<InputAudioRawFrame | null> {
 *     // Receive audio from WebSocket
 *   }
 * }
 * ```
 */
export abstract class BaseInputTransport extends FrameProcessor {
  /** Audio configuration for input */
  protected readonly audioConfig: AudioConfig;
  /** VAD configuration */
  protected readonly vadConfig: VADParams;

  /** Current user speaking state */
  protected userSpeaking: boolean = false;
  /** Count of consecutive speech frames */
  protected speechFrameCount: number = 0;
  /** Count of consecutive silence frames */
  protected silenceFrameCount: number = 0;

  /** Audio input task running state */
  private audioInputRunning: boolean = false;
  /** Audio input task promise */
  private audioInputTask?: Promise<void>;

  constructor(options: BaseInputTransportOptions = {}) {
    super({ ...options, name: options.name ?? "BaseInputTransport" });
    this.audioConfig = options.audioConfig ?? {
      sampleRate: 16000,
      numChannels: 1,
    };
    this.vadConfig = options.vadConfig ?? {
      enabled: true,
      threshold: 0.01,
      startFrames: 3,
      stopFrames: 10,
    };
  }

  /**
   * Start the input transport.
   */
  public override async start(): Promise<void> {
    await super.start();
    this.startAudioInputTask();
  }

  /**
   * Stop the input transport.
   */
  public override async stop(): Promise<void> {
    this.audioInputRunning = false;
    if (this.audioInputTask) {
      await this.audioInputTask;
    }
    await super.stop();
  }

  /**
   * Start the audio input processing task.
   */
  protected startAudioInputTask(): void {
    this.audioInputRunning = true;
    this.audioInputTask = this.audioInputLoop();
  }

  /**
   * Main audio input loop.
   * Continuously reads audio frames and processes them.
   */
  protected async audioInputLoop(): Promise<void> {
    while (this.audioInputRunning) {
      try {
        const audioFrame = await this.receiveAudioFrame();
        if (audioFrame) {
          await this.processAudioFrame(audioFrame);
        } else {
          // No audio available, wait briefly
          await sleepMs(1);
        }
      } catch (error) {
        console.error("[BaseInputTransport] Error in audio input loop:", error);
        await sleepMs(10);
      }
    }
  }

  /**
   * Receive an audio frame from the input source.
   * Subclasses must implement this to provide audio data.
   *
   * @returns Audio frame or null if no audio available
   */
  protected abstract receiveAudioFrame(): Promise<InputAudioRawFrame | null>;

  /**
   * Process an incoming audio frame.
   * Handles VAD and pushes the frame downstream.
   *
   * @param frame - The audio frame to process
   */
  protected async processAudioFrame(frame: InputAudioRawFrame): Promise<void> {
    if (this.vadConfig.enabled) {
      await this.processVAD(frame);
    }

    // Push audio frame downstream
    await this.pushFrame(frame, "downstream");
  }

  /**
   * Process VAD for an audio frame.
   * Updates speaking state and emits speaking frames as needed.
   *
   * @param frame - The audio frame to analyze
   */
  protected async processVAD(frame: InputAudioRawFrame): Promise<void> {
    const isSpeech = this.detectSpeech(frame.audio);

    if (isSpeech) {
      this.speechFrameCount++;
      this.silenceFrameCount = 0;

      // Transition to speaking after enough consecutive speech frames
      if (!this.userSpeaking && this.speechFrameCount >= this.vadConfig.startFrames) {
        this.userSpeaking = true;
        await this.pushFrame(new UserStartedSpeakingFrame(), "downstream");
      }
    } else {
      this.silenceFrameCount++;
      this.speechFrameCount = 0;

      // Transition to not speaking after enough consecutive silence frames
      if (this.userSpeaking && this.silenceFrameCount >= this.vadConfig.stopFrames) {
        this.userSpeaking = false;
        await this.pushFrame(new UserStoppedSpeakingFrame(), "downstream");
      }
    }
  }

  /**
   * Detect speech in audio data using simple volume threshold.
   *
   * @param audio - Raw audio data
   * @returns true if speech detected
   */
  protected detectSpeech(audio: Uint8Array): boolean {
    const volume = this.calculateVolume(audio);
    return volume > this.vadConfig.threshold;
  }

  /**
   * Calculate RMS volume from audio data.
   *
   * @param audio - Raw audio data (16-bit PCM)
   * @returns Volume as a normalized value (0-1)
   */
  protected calculateVolume(audio: Uint8Array): number {
    if (audio.length < 2) return 0;

    // Convert to 16-bit samples and calculate RMS
    let sumSquares = 0;
    const numSamples = Math.floor(audio.length / 2);

    for (let i = 0; i < audio.length; i += 2) {
      // Little-endian 16-bit signed integer
      const sample = (audio[i] | (audio[i + 1] << 8)) - (audio[i + 1] & 0x80 ? 0x10000 : 0);
      // Normalize to -1 to 1 range
      const normalized = sample / 32768;
      sumSquares += normalized * normalized;
    }

    return Math.sqrt(sumSquares / numSamples);
  }

  /**
   * Process incoming frames.
   * Handles system frames and passes others through.
   */
  protected async processFrame(frame: Frame): Promise<void> {
    // Handle transport messages
    if (frame instanceof InputTransportMessageFrame) {
      await this.handleInputMessage(frame);
      return;
    }

    // Pass through other frames
    await this.pushFrame(frame, "downstream");
  }

  /**
   * Handle incoming transport message.
   * Subclasses can override to process transport-specific messages.
   *
   * @param frame - The message frame
   */
  protected async handleInputMessage(frame: InputTransportMessageFrame): Promise<void> {
    // Default: pass through
    await this.pushFrame(frame, "downstream");
  }

  /**
   * Push an audio frame received from external source.
   * Called by subclasses when audio is received.
   *
   * @param audio - Raw audio data
   */
  public async pushAudioFrame(audio: Uint8Array): Promise<void> {
    const frame = new InputAudioRawFrame(
      audio,
      this.audioConfig.sampleRate,
      this.audioConfig.numChannels
    );
    await this.processAudioFrame(frame);
  }

}

/**
 * Options for BaseOutputTransport.
 */
export interface BaseOutputTransportOptions extends FrameProcessorOptions {
  /** Audio output configuration */
  audioConfig?: AudioConfig;
  /** Size of audio chunks in milliseconds */
  chunkSizeMs?: number;
}

/**
 * Base class for transport output processing.
 *
 * Handles outgoing audio frames, bot speaking state management, and audio buffering.
 * Subclasses implement the actual output destination connection.
 *
 * @example
 * ```typescript
 * class WebSocketOutputTransport extends BaseOutputTransport {
 *   private ws: WebSocket;
 *
 *   protected async sendAudioFrame(frame: OutputAudioRawFrame): Promise<void> {
 *     // Send audio via WebSocket
 *   }
 * }
 * ```
 */
export abstract class BaseOutputTransport extends FrameProcessor {
  /** Audio configuration for output */
  protected readonly audioConfig: AudioConfig;
  /** Size of audio chunks in milliseconds */
  protected readonly chunkSizeMs: number;

  /** Current bot speaking state */
  protected botSpeaking: boolean = false;
  /** Whether TTS is currently active */
  protected ttsActive: boolean = false;
  /** Audio buffer for output */
  protected audioBuffer: Uint8Array[] = [];

  /** Audio output task running state */
  private audioOutputRunning: boolean = false;
  /** Audio output task promise */
  private audioOutputTask?: Promise<void>;

  constructor(options: BaseOutputTransportOptions = {}) {
    super({ ...options, name: options.name ?? "BaseOutputTransport" });
    this.audioConfig = options.audioConfig ?? {
      sampleRate: 24000,
      numChannels: 1,
    };
    this.chunkSizeMs = options.chunkSizeMs ?? 20;
  }

  /**
   * Start the output transport.
   */
  public override async start(): Promise<void> {
    await super.start();
    this.startAudioOutputTask();
  }

  /**
   * Stop the output transport.
   */
  public override async stop(): Promise<void> {
    this.audioOutputRunning = false;
    if (this.audioOutputTask) {
      await this.audioOutputTask;
    }
    await super.stop();
  }

  /**
   * Start the audio output processing task.
   */
  protected startAudioOutputTask(): void {
    this.audioOutputRunning = true;
    this.audioOutputTask = this.audioOutputLoop();
  }

  /**
   * Main audio output loop.
   * Continuously sends buffered audio frames.
   */
  protected async audioOutputLoop(): Promise<void> {
    while (this.audioOutputRunning) {
      try {
        if (this.audioBuffer.length > 0) {
          const audioData = this.audioBuffer.shift()!;
          const frame = new OutputAudioRawFrame(
            audioData,
            this.audioConfig.sampleRate,
            this.audioConfig.numChannels
          );
          await this.sendAudioFrame(frame);
        } else {
          // No audio to send, wait briefly
          await sleepMs(1);
        }
      } catch (error) {
        console.error("[BaseOutputTransport] Error in audio output loop:", error);
        await sleepMs(10);
      }
    }
  }

  /**
   * Send an audio frame to the output destination.
   * Subclasses must implement this to actually send audio.
   *
   * @param frame - The audio frame to send
   */
  protected abstract sendAudioFrame(frame: OutputAudioRawFrame): Promise<void>;

  /**
   * Process incoming frames.
   * Handles audio output frames, TTS state, and messages.
   */
  protected async processFrame(frame: Frame): Promise<void> {
    // Handle TTS started
    if (frame instanceof TTSStartedFrame) {
      this.ttsActive = true;
      await this.handleTTSStarted();
      return;
    }

    // Handle TTS stopped
    if (frame instanceof TTSStoppedFrame) {
      this.ttsActive = false;
      await this.handleTTSStopped();
      return;
    }

    // Handle audio output frames
    if (frame instanceof OutputAudioRawFrame || frame instanceof TTSAudioRawFrame) {
      await this.handleAudioOutput(frame);
      return;
    }

    // Handle output transport messages
    if (frame instanceof OutputTransportMessageFrame) {
      await this.sendMessage(frame);
      return;
    }

    // Pass through other frames
    await this.pushFrame(frame, "downstream");
  }

  /**
   * Handle TTS started event.
   */
  protected async handleTTSStarted(): Promise<void> {
    if (!this.botSpeaking) {
      this.botSpeaking = true;
      await this.pushFrame(new BotStartedSpeakingFrame(), "downstream");
    }
  }

  /**
   * Handle TTS stopped event.
   */
  protected async handleTTSStopped(): Promise<void> {
    // Wait for buffer to drain before marking bot as stopped speaking
    // This is handled in the audio output loop when buffer empties
  }

  /**
   * Check if bot should stop speaking (buffer empty and TTS not active).
   */
  protected async checkBotStoppedSpeaking(): Promise<void> {
    if (this.botSpeaking && !this.ttsActive && this.audioBuffer.length === 0) {
      this.botSpeaking = false;
      await this.pushFrame(new BotStoppedSpeakingFrame(), "downstream");
    }
  }

  /**
   * Handle audio output frame.
   * Buffers audio for output.
   *
   * @param frame - The audio frame
   */
  protected async handleAudioOutput(frame: OutputAudioRawFrame): Promise<void> {
    // Start speaking if not already
    if (!this.botSpeaking) {
      this.botSpeaking = true;
      await this.pushFrame(new BotStartedSpeakingFrame(), "downstream");
    }

    // Buffer the audio for output
    this.audioBuffer.push(frame.audio);
  }

  /**
   * Send a transport message.
   * Subclasses must implement this to send messages.
   *
   * @param frame - The message frame
   */
  protected abstract sendMessage(frame: OutputTransportMessageFrame): Promise<void>;
}
