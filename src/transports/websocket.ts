/**
 * WebSocket Transport Implementation
 *
 * Provides WebSocket-based transport for real-time bidirectional communication.
 * Supports audio streaming, message passing, and connection lifecycle management.
 */

import { Frame } from "../frames/base";
import {
  InputAudioRawFrame,
  OutputAudioRawFrame,
  InputTransportMessageFrame,
  OutputTransportMessageFrame,
} from "../frames/data";
import { FrameProcessor, type FrameProcessorOptions } from "../processors/base";
import {
  BaseTransport,
  BaseInputTransport,
  BaseOutputTransport,
  type BaseTransportOptions,
  type BaseInputTransportOptions,
  type BaseOutputTransportOptions,
  type TransportParams,
  DEFAULT_TRANSPORT_PARAMS,
} from "./base";

/**
 * Sleep utility function for async delays.
 */
function sleepMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * WebSocket message types for the transport protocol.
 */
export enum WebSocketMessageType {
  /** Audio data message */
  AUDIO = "audio",
  /** Text/control message */
  MESSAGE = "message",
  /** Connection control (connect, disconnect) */
  CONTROL = "control",
  /** Error message */
  ERROR = "error",
}

/**
 * WebSocket message structure.
 */
export interface WebSocketMessage {
  /** Message type */
  type: WebSocketMessageType;
  /** Message payload */
  data: unknown;
  /** Optional timestamp */
  timestamp?: number;
}

/**
 * WebSocket connection state.
 */
export enum WebSocketState {
  CONNECTING = "connecting",
  CONNECTED = "connected",
  DISCONNECTING = "disconnecting",
  DISCONNECTED = "disconnected",
  ERROR = "error",
}

/**
 * Options for WebSocket transport.
 */
export interface WebSocketTransportOptions extends BaseTransportOptions {
  /** WebSocket server URL */
  url: string;
  /** Protocols to use for WebSocket connection */
  protocols?: string | string[];
  /** Reconnection options */
  reconnect?: {
    /** Whether to automatically reconnect */
    enabled: boolean;
    /** Maximum number of reconnection attempts */
    maxAttempts: number;
    /** Base delay between reconnection attempts (ms) */
    delayMs: number;
    /** Maximum delay between reconnection attempts (ms) */
    maxDelayMs: number;
  };
  /** Custom WebSocket implementation (for testing/Node.js) */
  webSocketImpl?: typeof WebSocket;
}

/**
 * WebSocket Input Transport.
 *
 * Receives audio and messages from WebSocket connection.
 */
export class WebSocketInputTransport extends BaseInputTransport {
  /** Parent transport reference */
  private transport: WebSocketTransport;
  /** Queue of received audio frames */
  private audioQueue: InputAudioRawFrame[] = [];

  constructor(
    transport: WebSocketTransport,
    options: BaseInputTransportOptions = {}
  ) {
    super({ ...options, name: options.name ?? "WebSocketInputTransport" });
    this.transport = transport;
  }

  /**
   * Get the WebSocket transport.
   */
  public getTransport(): WebSocketTransport {
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
   * Queue an audio frame received from WebSocket.
   * Called by the parent transport when audio is received.
   *
   * @param audio - Raw audio data
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
   * Handle incoming message from WebSocket.
   * Called by the parent transport.
   *
   * @param message - Message payload
   */
  public async handleMessage(message: Record<string, unknown>): Promise<void> {
    const frame = new InputTransportMessageFrame(message);
    await this.pushFrame(frame, "downstream");
  }
}

/**
 * WebSocket Output Transport.
 *
 * Sends audio and messages over WebSocket connection.
 */
export class WebSocketOutputTransport extends BaseOutputTransport {
  /** Parent transport reference */
  private transport: WebSocketTransport;

  constructor(
    transport: WebSocketTransport,
    options: BaseOutputTransportOptions = {}
  ) {
    super({ ...options, name: options.name ?? "WebSocketOutputTransport" });
    this.transport = transport;
  }

  /**
   * Get the WebSocket transport.
   */
  public getTransport(): WebSocketTransport {
    return this.transport;
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
    await this.transport.sendMessageData(frame.message);
  }
}

/**
 * WebSocket Transport.
 *
 * Main transport class that manages WebSocket connection and provides
 * input/output processors for pipeline integration.
 *
 * @example
 * ```typescript
 * const transport = new WebSocketTransport({
 *   url: "wss://api.example.com/audio",
 *   params: {
 *     audioIn: { sampleRate: 16000, numChannels: 1 },
 *     audioOut: { sampleRate: 24000, numChannels: 1 },
 *   },
 * });
 *
 * // Use in pipeline
 * const pipeline = new Pipeline([
 *   transport.input(),
 *   sttService,
 *   llmService,
 *   ttsService,
 *   transport.output(),
 * ]);
 *
 * await transport.connect();
 * await pipeline.start();
 * ```
 */
export class WebSocketTransport extends BaseTransport {
  /** WebSocket URL */
  private readonly url: string;
  /** WebSocket protocols */
  private readonly protocols?: string | string[];
  /** Reconnection options */
  private readonly reconnectOptions: {
    enabled: boolean;
    maxAttempts: number;
    delayMs: number;
    maxDelayMs: number;
  };
  /** Custom WebSocket implementation */
  private readonly WebSocketImpl: typeof WebSocket;

  /** WebSocket instance */
  private ws?: WebSocket;
  /** Current connection state */
  private state: WebSocketState = WebSocketState.DISCONNECTED;
  /** Reconnection attempt count */
  private reconnectAttempts: number = 0;

  /** Input transport processor */
  private _input: WebSocketInputTransport;
  /** Output transport processor */
  private _output: WebSocketOutputTransport;

  /** Event handlers */
  private onConnectHandlers: Array<() => void> = [];
  private onDisconnectHandlers: Array<(code: number, reason: string) => void> = [];
  private onErrorHandlers: Array<(error: Error) => void> = [];

  constructor(options: WebSocketTransportOptions) {
    super({ ...options, name: options.name ?? "WebSocketTransport" });

    this.url = options.url;
    this.protocols = options.protocols;
    this.reconnectOptions = {
      enabled: options.reconnect?.enabled ?? false,
      maxAttempts: options.reconnect?.maxAttempts ?? 3,
      delayMs: options.reconnect?.delayMs ?? 1000,
      maxDelayMs: options.reconnect?.maxDelayMs ?? 30000,
    };

    // Use custom WebSocket implementation or global WebSocket
    this.WebSocketImpl = options.webSocketImpl ?? (typeof WebSocket !== "undefined" ? WebSocket : (undefined as unknown as typeof WebSocket));

    // Create input and output transports
    this._input = new WebSocketInputTransport(this, {
      name: this.inputName,
      audioConfig: this.getAudioInputConfig(),
      vadConfig: this.params.vad,
    });

    this._output = new WebSocketOutputTransport(this, {
      name: this.outputName,
      audioConfig: this.getAudioOutputConfig(),
      chunkSizeMs: this.params.audioOut.chunkSizeMs,
    });
  }

  /**
   * Get the input processor for this transport.
   */
  public input(): FrameProcessor {
    return this._input;
  }

  /**
   * Get the output processor for this transport.
   */
  public output(): FrameProcessor {
    return this._output;
  }

  /**
   * Get the current connection state.
   */
  public getConnectionState(): WebSocketState {
    return this.state;
  }

  /**
   * Check if the transport is connected.
   */
  public isConnected(): boolean {
    return this.state === WebSocketState.CONNECTED;
  }

  /**
   * Connect to the WebSocket server.
   */
  public async connect(): Promise<void> {
    if (this.state === WebSocketState.CONNECTED || this.state === WebSocketState.CONNECTING) {
      return;
    }

    if (!this.WebSocketImpl) {
      throw new Error("WebSocket implementation not available");
    }

    this.state = WebSocketState.CONNECTING;

    return new Promise((resolve, reject) => {
      try {
        this.ws = new this.WebSocketImpl(this.url, this.protocols);
        this.ws.binaryType = "arraybuffer";

        this.ws.onopen = () => {
          this.state = WebSocketState.CONNECTED;
          this.reconnectAttempts = 0;
          this.onConnectHandlers.forEach(handler => handler());
          resolve();
        };

        this.ws.onclose = (event) => {
          const wasConnected = this.state === WebSocketState.CONNECTED;
          this.state = WebSocketState.DISCONNECTED;
          this.onDisconnectHandlers.forEach(handler => handler(event.code, event.reason));

          // Attempt reconnection if enabled and was previously connected
          if (wasConnected && this.reconnectOptions.enabled) {
            this.attemptReconnect();
          }
        };

        this.ws.onerror = (event) => {
          const error = new Error("WebSocket error occurred");
          const wasConnecting = this.state === WebSocketState.CONNECTING;
          this.state = WebSocketState.ERROR;
          this.onErrorHandlers.forEach(handler => handler(error));

          if (wasConnecting) {
            reject(error);
          }
        };

        this.ws.onmessage = (event) => {
          this.handleWebSocketMessage(event);
        };
      } catch (error) {
        this.state = WebSocketState.ERROR;
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server.
   */
  public async disconnect(): Promise<void> {
    if (this.state === WebSocketState.DISCONNECTED || this.state === WebSocketState.DISCONNECTING) {
      return;
    }

    this.state = WebSocketState.DISCONNECTING;

    return new Promise((resolve) => {
      if (this.ws) {
        const originalOnClose = this.ws.onclose;
        this.ws.onclose = (event) => {
          this.state = WebSocketState.DISCONNECTED;
          if (originalOnClose) {
            (originalOnClose as (event: CloseEvent) => void)(event);
          }
          resolve();
        };
        this.ws.close(1000, "Client disconnect");
      } else {
        this.state = WebSocketState.DISCONNECTED;
        resolve();
      }
    });
  }

  /**
   * Attempt to reconnect to the WebSocket server.
   */
  private async attemptReconnect(): Promise<void> {
    if (this.reconnectAttempts >= this.reconnectOptions.maxAttempts) {
      console.error("[WebSocketTransport] Max reconnection attempts reached");
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectOptions.delayMs * Math.pow(2, this.reconnectAttempts - 1),
      this.reconnectOptions.maxDelayMs
    );

    console.log(`[WebSocketTransport] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.reconnectOptions.maxAttempts})`);

    await sleepMs(delay);

    try {
      await this.connect();
    } catch (error) {
      console.error("[WebSocketTransport] Reconnection failed:", error);
      this.attemptReconnect();
    }
  }

  /**
   * Handle incoming WebSocket message.
   */
  private handleWebSocketMessage(event: MessageEvent): void {
    try {
      if (event.data instanceof ArrayBuffer) {
        // Binary data - treat as audio
        const audioData = new Uint8Array(event.data);
        this._input.queueAudioData(audioData);
      } else if (typeof event.data === "string") {
        // Text data - parse as JSON message
        const message = JSON.parse(event.data) as WebSocketMessage;
        this.handleProtocolMessage(message);
      }
    } catch (error) {
      console.error("[WebSocketTransport] Error handling message:", error);
    }
  }

  /**
   * Handle protocol message.
   */
  private handleProtocolMessage(message: WebSocketMessage): void {
    switch (message.type) {
      case WebSocketMessageType.AUDIO:
        if (typeof message.data === "string") {
          // Base64 encoded audio
          const audioData = this.base64ToUint8Array(message.data);
          this._input.queueAudioData(audioData);
        }
        break;

      case WebSocketMessageType.MESSAGE:
        this._input.handleMessage(message.data as Record<string, unknown>);
        break;

      case WebSocketMessageType.CONTROL:
        this.handleControlMessage(message.data as Record<string, unknown>);
        break;

      case WebSocketMessageType.ERROR:
        console.error("[WebSocketTransport] Server error:", message.data);
        break;
    }
  }

  /**
   * Handle control message from server.
   */
  private handleControlMessage(data: Record<string, unknown>): void {
    // Subclasses can override to handle specific control messages
    console.log("[WebSocketTransport] Control message:", data);
  }

  /**
   * Send audio data over WebSocket.
   *
   * @param audio - Raw audio data
   */
  public async sendAudio(audio: Uint8Array): Promise<void> {
    if (!this.ws || this.state !== WebSocketState.CONNECTED) {
      throw new Error("WebSocket not connected");
    }

    // Send as binary
    this.ws.send(audio.buffer);
  }

  /**
   * Send a message over WebSocket.
   *
   * @param data - Message payload
   */
  public async sendMessageData(data: Record<string, unknown>): Promise<void> {
    if (!this.ws || this.state !== WebSocketState.CONNECTED) {
      throw new Error("WebSocket not connected");
    }

    const message: WebSocketMessage = {
      type: WebSocketMessageType.MESSAGE,
      data,
      timestamp: Date.now(),
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Register a handler for connection events.
   */
  public onConnect(handler: () => void): void {
    this.onConnectHandlers.push(handler);
  }

  /**
   * Register a handler for disconnection events.
   */
  public onDisconnect(handler: (code: number, reason: string) => void): void {
    this.onDisconnectHandlers.push(handler);
  }

  /**
   * Register a handler for error events.
   */
  public onError(handler: (error: Error) => void): void {
    this.onErrorHandlers.push(handler);
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
    await this.disconnect();
    await super.stop();
  }

  /**
   * Convert base64 string to Uint8Array.
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
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
