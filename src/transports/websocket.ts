/**
 * WebSocket Server Transport Implementation
 *
 * Provides server-side WebSocket transport for real-time bidirectional communication.
 * Accepts an existing WebSocket connection and provides input/output processors
 * for pipeline integration.
 */

import { Frame } from "../frames/base";
import {
  InputAudioRawFrame,
  OutputAudioRawFrame,
  TTSAudioRawFrame,
  InputTransportMessageFrame,
  OutputTransportMessageFrame,
  TranscriptionFrame,
  InterimTranscriptionFrame,
  TextFrame,
} from "../frames/data";
import { FrameProcessor } from "../processors/base";
import {
  BaseTransport,
  BaseInputTransport,
  BaseOutputTransport,
  type BaseTransportOptions,
  type BaseInputTransportOptions,
  type BaseOutputTransportOptions,
} from "./base";

/**
 * WebSocket-like interface that the transport can work with.
 * Compatible with ws, Hono WSContext, and other WebSocket implementations.
 */
export interface WebSocketLike {
  /** Send data over the WebSocket */
  send(data: string | ArrayBuffer | Uint8Array): void;
  /** Close the WebSocket connection (optional) */
  close?(code?: number, reason?: string): void;
}

/**
 * Options for WebSocket server transport.
 */
export interface WebSocketServerTransportOptions extends BaseTransportOptions {
  /** The WebSocket connection to use */
  ws: WebSocketLike;
  /**
   * Whether to send transcriptions as JSON messages.
   * When true, TranscriptionFrame will be sent as JSON instead of passed through.
   * Default: true
   */
  sendTranscriptions?: boolean;
}

/**
 * WebSocket Server Input Transport.
 *
 * Receives audio and messages from an existing WebSocket connection.
 * Call `onAudioData()` and `onMessage()` from your WebSocket event handlers.
 */
export class WebSocketServerInputTransport extends BaseInputTransport {
  private transport: WebSocketServerTransport;
  private audioQueue: InputAudioRawFrame[] = [];

  constructor(
    transport: WebSocketServerTransport,
    options: BaseInputTransportOptions = {}
  ) {
    super({ ...options, name: options.name ?? "WebSocketServerInputTransport" });
    this.transport = transport;
  }

  /**
   * Get the parent transport.
   */
  public getTransport(): WebSocketServerTransport {
    return this.transport;
  }

  /**
   * Receive an audio frame from the queue.
   */
  protected async receiveAudioFrame(): Promise<InputAudioRawFrame | null> {
    if (this.audioQueue.length > 0) {
      return this.audioQueue.shift()!;
    }
    return null;
  }

  /**
   * Queue audio data received from WebSocket.
   * Call this from your WebSocket's onMessage handler for binary data.
   *
   * @param audio - Raw audio data as Uint8Array
   */
  public queueAudioData(audio: Uint8Array): void {
    const frame = new InputAudioRawFrame(
      audio,
      this.audioConfig.sampleRate,
      this.audioConfig.numChannels
    );
    this.audioQueue.push(frame);
  }

  /**
   * Handle a message received from WebSocket.
   * Call this from your WebSocket's onMessage handler for text/JSON data.
   *
   * @param message - Message payload as object
   */
  public async handleMessage(message: Record<string, unknown>): Promise<void> {
    const frame = new InputTransportMessageFrame(message);
    await this.pushFrame(frame, "downstream");
  }
}

/**
 * WebSocket Server Output Transport.
 *
 * Sends audio and messages over an existing WebSocket connection.
 */
export class WebSocketServerOutputTransport extends BaseOutputTransport {
  private transport: WebSocketServerTransport;
  private readonly sendTranscriptions: boolean;

  constructor(
    transport: WebSocketServerTransport,
    options: BaseOutputTransportOptions & { sendTranscriptions?: boolean } = {}
  ) {
    super({ ...options, name: options.name ?? "WebSocketServerOutputTransport" });
    this.transport = transport;
    this.sendTranscriptions = options.sendTranscriptions ?? true;
  }

  /**
   * Get the parent transport.
   */
  public getTransport(): WebSocketServerTransport {
    return this.transport;
  }

  /**
   * Process a frame and send appropriate data over WebSocket.
   */
  protected async processFrame(frame: Frame): Promise<void> {
    // Handle TTS audio frames
    if (frame instanceof TTSAudioRawFrame) {
      await this.transport.sendAudio(frame.audio);
      return;
    }

    // Handle output audio frames
    if (frame instanceof OutputAudioRawFrame) {
      await this.transport.sendAudio(frame.audio);
      await this.checkBotStoppedSpeaking();
      return;
    }

    // Handle transcription frames
    if (this.sendTranscriptions && frame instanceof TranscriptionFrame) {
      await this.transport.sendMessage({
        type: "transcription",
        data: {
          text: frame.text,
          userId: frame.userId,
          timestamp: frame.timestamp,
          final: true,
        },
      });
      return;
    }

    // Handle interim transcription frames
    if (this.sendTranscriptions && frame instanceof InterimTranscriptionFrame) {
      await this.transport.sendMessage({
        type: "transcription",
        data: {
          text: frame.text,
          userId: frame.userId,
          timestamp: frame.timestamp,
          final: false,
        },
      });
      return;
    }

    // Handle text frames (bot responses) - send as bot_response message
    // Note: TextFrame is also the parent of TranscriptionFrame, so check this after transcription handling
    if (this.sendTranscriptions && frame instanceof TextFrame) {
      await this.transport.sendMessage({
        type: "bot_response",
        data: {
          text: frame.text,
        },
      });
      // Don't return - let the frame continue downstream to TTS
    }

    // Handle output message frames
    if (frame instanceof OutputTransportMessageFrame) {
      await this.sendMessage(frame);
      return;
    }

    // Pass through other frames
    await this.pushFrame(frame, "downstream");
  }

  /**
   * Send an audio frame via WebSocket.
   */
  protected async sendAudioFrame(frame: OutputAudioRawFrame): Promise<void> {
    await this.transport.sendAudio(frame.audio);
    await this.checkBotStoppedSpeaking();
  }

  /**
   * Send a message via WebSocket.
   */
  protected async sendMessage(frame: OutputTransportMessageFrame): Promise<void> {
    await this.transport.sendMessage(frame.message);
  }
}

/**
 * WebSocket Server Transport.
 *
 * Server-side transport that wraps an existing WebSocket connection and provides
 * input/output processors for pipeline integration.
 *
 * @example
 * ```typescript
 * // With Hono WebSocket
 * app.get("/ws", upgradeWebSocket((c) => ({
 *   onOpen(event, ws) {
 *     const transport = new WebSocketServerTransport({
 *       ws,
 *       params: {
 *         audioIn: { sampleRate: 16000, numChannels: 1 },
 *         audioOut: { sampleRate: 24000, numChannels: 1 },
 *       },
 *     });
 *
 *     const pipeline = new Pipeline([
 *       transport.input(),
 *       sttService,
 *       llmService,
 *       ttsService,
 *       transport.output(),
 *     ]);
 *
 *     pipeline.start();
 *   },
 *
 *   onMessage(event, ws) {
 *     const transport = getTransport(ws); // your lookup
 *     if (event.data instanceof ArrayBuffer) {
 *       transport.onAudioData(new Uint8Array(event.data));
 *     } else {
 *       transport.onMessage(JSON.parse(event.data));
 *     }
 *   },
 * })));
 * ```
 */
export class WebSocketServerTransport extends BaseTransport {
  /** The WebSocket connection */
  private readonly ws: WebSocketLike;
  /** Whether to send transcriptions */
  private readonly sendTranscriptions: boolean;

  /** Input transport processor */
  private _input: WebSocketServerInputTransport;
  /** Output transport processor */
  private _output: WebSocketServerOutputTransport;

  constructor(options: WebSocketServerTransportOptions) {
    super({ ...options, name: options.name ?? "WebSocketServerTransport" });

    this.ws = options.ws;
    this.sendTranscriptions = options.sendTranscriptions ?? true;

    // Create input and output transports
    this._input = new WebSocketServerInputTransport(this, {
      name: this.inputName,
      audioConfig: this.getAudioInputConfig(),
      vadConfig: this.params.vad,
    });

    this._output = new WebSocketServerOutputTransport(this, {
      name: this.outputName,
      audioConfig: this.getAudioOutputConfig(),
      chunkSizeMs: this.params.audioOut.chunkSizeMs,
      sendTranscriptions: this.sendTranscriptions,
    });
  }

  /**
   * Get the input processor for this transport.
   * Add this to the beginning of your pipeline.
   */
  public input(): FrameProcessor {
    return this._input;
  }

  /**
   * Get the output processor for this transport.
   * Add this to the end of your pipeline.
   */
  public output(): FrameProcessor {
    return this._output;
  }

  /**
   * Handle incoming audio data from WebSocket.
   * Call this from your WebSocket's onMessage handler for binary data.
   *
   * @param audio - Raw audio data
   */
  public onAudioData(audio: Uint8Array): void {
    this._input.queueAudioData(audio);
  }

  /**
   * Handle incoming message from WebSocket.
   * Call this from your WebSocket's onMessage handler for JSON data.
   *
   * @param message - Parsed message object
   */
  public async onMessage(message: Record<string, unknown>): Promise<void> {
    await this._input.handleMessage(message);
  }

  /**
   * Send audio data over WebSocket as binary.
   *
   * @param audio - Raw audio data
   */
  public async sendAudio(audio: Uint8Array): Promise<void> {
    this.ws.send(new Uint8Array(audio));
  }

  /**
   * Send a message over WebSocket as JSON.
   *
   * @param data - Message payload
   */
  public async sendMessage(data: Record<string, unknown>): Promise<void> {
    this.ws.send(JSON.stringify(data));
  }

  /**
   * Close the WebSocket connection.
   *
   * @param code - Close code (default: 1000)
   * @param reason - Close reason
   */
  public close(code: number = 1000, reason?: string): void {
    if (this.ws.close) {
      this.ws.close(code, reason);
    }
  }

  /**
   * Start the transport and input/output processors.
   */
  public override async start(): Promise<void> {
    await super.start();
    await this._input.start();
    await this._output.start();
  }

  /**
   * Stop the transport and input/output processors.
   */
  public override async stop(): Promise<void> {
    await this._input.stop();
    await this._output.stop();
    await super.stop();
  }
}

/**
 * Create a simple echo transport for testing.
 * Audio sent to output is echoed back to input.
 */
export class EchoTransport extends BaseTransport {
  private _input: EchoInputTransport;
  private _output: EchoOutputTransport;

  constructor(options: BaseTransportOptions = {}) {
    super({ ...options, name: options.name ?? "EchoTransport" });

    this._output = new EchoOutputTransport(this, {
      name: this.outputName,
      audioConfig: this.getAudioOutputConfig(),
    });

    this._input = new EchoInputTransport(this._output, {
      name: this.inputName,
      audioConfig: this.getAudioInputConfig(),
      vadConfig: this.params.vad,
    });
  }

  public input(): FrameProcessor {
    return this._input;
  }

  public output(): FrameProcessor {
    return this._output;
  }
}

/**
 * Echo input transport - receives echoed audio from output.
 */
class EchoInputTransport extends BaseInputTransport {
  private outputTransport: EchoOutputTransport;
  private audioQueue: InputAudioRawFrame[] = [];

  constructor(outputTransport: EchoOutputTransport, options: BaseInputTransportOptions = {}) {
    super(options);
    this.outputTransport = outputTransport;
    this.outputTransport.setEchoTarget(this);
  }

  protected async receiveAudioFrame(): Promise<InputAudioRawFrame | null> {
    if (this.audioQueue.length > 0) {
      return this.audioQueue.shift()!;
    }
    return null;
  }

  public echoAudio(audio: Uint8Array): void {
    const frame = new InputAudioRawFrame(
      audio,
      this.audioConfig.sampleRate,
      this.audioConfig.numChannels
    );
    this.audioQueue.push(frame);
  }
}

/**
 * Echo output transport - echoes audio back to input.
 */
class EchoOutputTransport extends BaseOutputTransport {
  private transport: BaseTransport;
  private echoTarget?: EchoInputTransport;

  constructor(transport: BaseTransport, options: BaseOutputTransportOptions = {}) {
    super(options);
    this.transport = transport;
  }

  public setEchoTarget(target: EchoInputTransport): void {
    this.echoTarget = target;
  }

  protected async sendAudioFrame(frame: OutputAudioRawFrame): Promise<void> {
    // Echo audio back to input
    if (this.echoTarget) {
      this.echoTarget.echoAudio(frame.audio);
    }
    await this.checkBotStoppedSpeaking();
  }

  protected async sendMessage(frame: OutputTransportMessageFrame): Promise<void> {
    // Echo messages are not supported in this simple implementation
    console.log("[EchoOutputTransport] Message:", frame.message);
  }
}
