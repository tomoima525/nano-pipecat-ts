import { Frame } from "../frames/base";
import {
  InputAudioRawFrame,
  OutputAudioRawFrame,
  UserStartedSpeakingFrame,
  UserStoppedSpeakingFrame,
  BotStartedSpeakingFrame,
  BotStoppedSpeakingFrame,
  InputTransportMessageFrame,
  OutputTransportMessageFrame,
} from "../frames/data";
import { TTSStartedFrame, TTSStoppedFrame } from "../frames/control";
import { Pipeline } from "../pipeline/pipeline";
import { FrameProcessor } from "../processors/base";
import {
  BaseTransport,
  BaseInputTransport,
  BaseOutputTransport,
  DEFAULT_TRANSPORT_PARAMS,
  WebSocketServerTransport,
  EchoTransport,
} from "../transports";
import { CollectorProcessor, advanceTime } from "./testUtils";

/**
 * Mock input transport for testing.
 */
class MockInputTransport extends BaseInputTransport {
  private audioQueue: InputAudioRawFrame[] = [];
  public receivedFrames: Frame[] = [];

  protected async receiveAudioFrame(): Promise<InputAudioRawFrame | null> {
    if (this.audioQueue.length > 0) {
      return this.audioQueue.shift()!;
    }
    return null;
  }

  public queueAudio(audio: Uint8Array): void {
    const frame = new InputAudioRawFrame(
      audio,
      this.audioConfig.sampleRate,
      this.audioConfig.numChannels
    );
    this.audioQueue.push(frame);
  }

  protected override async processFrame(frame: Frame): Promise<void> {
    this.receivedFrames.push(frame);
    await super.processFrame(frame);
  }
}

/**
 * Mock output transport for testing.
 */
class MockOutputTransport extends BaseOutputTransport {
  public sentAudioFrames: OutputAudioRawFrame[] = [];
  public sentMessages: OutputTransportMessageFrame[] = [];

  protected async sendAudioFrame(frame: OutputAudioRawFrame): Promise<void> {
    this.sentAudioFrames.push(frame);
    await this.checkBotStoppedSpeaking();
  }

  protected async sendMessage(frame: OutputTransportMessageFrame): Promise<void> {
    this.sentMessages.push(frame);
  }
}

/**
 * Mock transport for testing.
 */
class MockTransport extends BaseTransport {
  public _input: MockInputTransport;
  public _output: MockOutputTransport;

  constructor() {
    super({ name: "MockTransport" });
    this._input = new MockInputTransport({
      name: "MockInput",
      audioConfig: this.getAudioInputConfig(),
      vadConfig: this.params.vad,
    });
    this._output = new MockOutputTransport({
      name: "MockOutput",
      audioConfig: this.getAudioOutputConfig(),
    });
  }

  public input(): MockInputTransport {
    return this._input;
  }

  public output(): MockOutputTransport {
    return this._output;
  }
}

/**
 * Create audio data with specific volume.
 * Returns 16-bit PCM audio.
 */
function createAudioData(samples: number, amplitude: number = 0.5): Uint8Array {
  const data = new Uint8Array(samples * 2); // 16-bit = 2 bytes per sample
  for (let i = 0; i < samples; i++) {
    // Create a simple sine wave at the specified amplitude
    const value = Math.round(amplitude * 32767 * Math.sin(2 * Math.PI * 440 * i / 16000));
    data[i * 2] = value & 0xff;
    data[i * 2 + 1] = (value >> 8) & 0xff;
  }
  return data;
}

/**
 * Create silent audio data.
 */
function createSilentAudio(samples: number): Uint8Array {
  return new Uint8Array(samples * 2); // All zeros = silence
}

describe("BaseTransport", () => {
  it("has default transport parameters", () => {
    expect(DEFAULT_TRANSPORT_PARAMS.audioIn.sampleRate).toBe(16000);
    expect(DEFAULT_TRANSPORT_PARAMS.audioIn.numChannels).toBe(1);
    expect(DEFAULT_TRANSPORT_PARAMS.audioOut.sampleRate).toBe(24000);
    expect(DEFAULT_TRANSPORT_PARAMS.vad.enabled).toBe(true);
  });

  it("creates input and output processors", () => {
    const transport = new MockTransport();
    expect(transport.input()).toBeInstanceOf(BaseInputTransport);
    expect(transport.output()).toBeInstanceOf(BaseOutputTransport);
  });

  it("returns correct audio configurations", () => {
    const transport = new MockTransport();

    const inputConfig = transport.getAudioInputConfig();
    expect(inputConfig.sampleRate).toBe(16000);
    expect(inputConfig.numChannels).toBe(1);

    const outputConfig = transport.getAudioOutputConfig();
    expect(outputConfig.sampleRate).toBe(24000);
    expect(outputConfig.numChannels).toBe(1);
  });
});

describe("BaseInputTransport", () => {
  it("processes audio frames and passes them downstream", async () => {
    const transport = new MockTransport();
    const input = transport._input;
    const collector = new CollectorProcessor();

    input.link(collector);
    await input.start();
    await collector.start();

    // Queue some audio
    const audioData = createAudioData(320); // 20ms at 16kHz
    input.queueAudio(audioData);

    await advanceTime(50);
    await input.stop();
    await collector.stop();

    const audioFrames = collector.collectedFrames.filter(
      f => f instanceof InputAudioRawFrame
    );
    expect(audioFrames.length).toBeGreaterThan(0);
  });

  it("detects speech using VAD", async () => {
    const transport = new MockTransport();
    const input = transport._input;
    const collector = new CollectorProcessor();

    input.link(collector);
    await input.start();
    await collector.start();

    // Queue audio with speech (high amplitude)
    for (let i = 0; i < 5; i++) {
      const audioData = createAudioData(320, 0.5); // Loud audio
      input.queueAudio(audioData);
    }

    await advanceTime(100);
    await input.stop();
    await collector.stop();

    const speakingFrames = collector.collectedFrames.filter(
      f => f instanceof UserStartedSpeakingFrame
    );
    expect(speakingFrames.length).toBeGreaterThan(0);
  });

  it("detects silence after speech", async () => {
    const transport = new MockTransport();
    const input = transport._input;
    const collector = new CollectorProcessor();

    // Lower VAD thresholds for faster testing
    (input as any).vadConfig = {
      enabled: true,
      threshold: 0.01,
      startFrames: 2,
      stopFrames: 3,
    };

    input.link(collector);
    await input.start();
    await collector.start();

    // First send speech
    for (let i = 0; i < 4; i++) {
      const audioData = createAudioData(320, 0.5);
      input.queueAudio(audioData);
    }
    await advanceTime(50);

    // Then send silence
    for (let i = 0; i < 5; i++) {
      const silentData = createSilentAudio(320);
      input.queueAudio(silentData);
    }

    await advanceTime(100);
    await input.stop();
    await collector.stop();

    const stoppedFrames = collector.collectedFrames.filter(
      f => f instanceof UserStoppedSpeakingFrame
    );
    expect(stoppedFrames.length).toBeGreaterThan(0);
  });

  it("handles input transport messages", async () => {
    const transport = new MockTransport();
    const input = transport._input;
    const collector = new CollectorProcessor();

    input.link(collector);
    await input.start();
    await collector.start();

    // Queue a message frame
    const messageFrame = new InputTransportMessageFrame({ type: "test", data: "hello" });
    input.queueFrame(messageFrame);

    await advanceTime(30);
    await input.stop();
    await collector.stop();

    const messageFrames = collector.collectedFrames.filter(
      f => f instanceof InputTransportMessageFrame
    );
    expect(messageFrames.length).toBe(1);
    expect((messageFrames[0] as InputTransportMessageFrame).message).toEqual({
      type: "test",
      data: "hello",
    });
  });

  it("calculates volume correctly for audio data", async () => {
    const transport = new MockTransport();
    const input = transport._input as MockInputTransport;

    // Test with loud audio
    const loudAudio = createAudioData(320, 0.8);
    const loudVolume = (input as any).calculateVolume(loudAudio);
    expect(loudVolume).toBeGreaterThan(0.1);

    // Test with silent audio
    const silentAudio = createSilentAudio(320);
    const silentVolume = (input as any).calculateVolume(silentAudio);
    expect(silentVolume).toBeLessThan(0.01);
  });
});

describe("BaseOutputTransport", () => {
  it("processes output audio frames", async () => {
    const transport = new MockTransport();
    const output = transport._output;
    const collector = new CollectorProcessor();

    output.link(collector);
    await output.start();
    await collector.start();

    // Queue audio output frame
    const audioFrame = new OutputAudioRawFrame(
      createAudioData(480, 0.5),
      24000,
      1
    );
    output.queueFrame(audioFrame);

    await advanceTime(50);
    await output.stop();
    await collector.stop();

    expect(transport._output.sentAudioFrames.length).toBe(1);
  });

  it("emits BotStartedSpeakingFrame when audio starts", async () => {
    const transport = new MockTransport();
    const output = transport._output;
    const collector = new CollectorProcessor();

    output.link(collector);
    await output.start();
    await collector.start();

    const audioFrame = new OutputAudioRawFrame(createAudioData(480), 24000, 1);
    output.queueFrame(audioFrame);

    await advanceTime(50);
    await output.stop();
    await collector.stop();

    const startedFrames = collector.collectedFrames.filter(
      f => f instanceof BotStartedSpeakingFrame
    );
    expect(startedFrames.length).toBe(1);
  });

  it("handles TTS started and stopped frames", async () => {
    const transport = new MockTransport();
    const output = transport._output;
    const collector = new CollectorProcessor();

    output.link(collector);
    await output.start();
    await collector.start();

    // Send TTS started
    output.queueFrame(new TTSStartedFrame());
    await advanceTime(20);

    // Send some audio
    output.queueFrame(new OutputAudioRawFrame(createAudioData(480), 24000, 1));
    await advanceTime(20);

    // Send TTS stopped
    output.queueFrame(new TTSStoppedFrame());
    await advanceTime(50);

    await output.stop();
    await collector.stop();

    const botStarted = collector.collectedFrames.filter(
      f => f instanceof BotStartedSpeakingFrame
    );
    expect(botStarted.length).toBeGreaterThan(0);
  });

  it("processes audio frames and sends them", async () => {
    const transport = new MockTransport();
    const output = transport._output;
    const collector = new CollectorProcessor();

    output.link(collector);
    await output.start();
    await collector.start();

    // Queue multiple audio frames
    for (let i = 0; i < 3; i++) {
      output.queueFrame(new OutputAudioRawFrame(createAudioData(480), 24000, 1));
    }

    await advanceTime(50);
    await output.stop();
    await collector.stop();

    // Check that audio was sent
    expect(transport._output.sentAudioFrames.length).toBe(3);
  });

  it("sends transport messages", async () => {
    const transport = new MockTransport();
    const output = transport._output;
    const collector = new CollectorProcessor();

    output.link(collector);
    await output.start();
    await collector.start();

    const messageFrame = new OutputTransportMessageFrame({ action: "test", value: 42 });
    output.queueFrame(messageFrame);

    await advanceTime(30);
    await output.stop();
    await collector.stop();

    expect(transport._output.sentMessages.length).toBe(1);
    expect(transport._output.sentMessages[0].message).toEqual({
      action: "test",
      value: 42,
    });
  });

  it("passes through non-audio frames", async () => {
    const transport = new MockTransport();
    const output = transport._output;
    const collector = new CollectorProcessor();

    output.link(collector);
    await output.start();
    await collector.start();

    // Queue a custom data frame
    const messageFrame = new OutputTransportMessageFrame({ type: "custom", data: "test" });
    output.queueFrame(messageFrame);

    await advanceTime(30);
    await output.stop();
    await collector.stop();

    // Check message was sent via the transport
    expect(transport._output.sentMessages.length).toBe(1);
    expect(transport._output.sentMessages[0].message).toEqual({ type: "custom", data: "test" });
  });
});

describe("EchoTransport", () => {
  it("creates input and output processors", () => {
    const transport = new EchoTransport();
    expect(transport.input()).toBeDefined();
    expect(transport.output()).toBeDefined();
  });

  it("echoes audio from output to input", async () => {
    const transport = new EchoTransport();
    const input = transport.input();
    const output = transport.output();
    const collector = new CollectorProcessor();

    input.link(collector);
    await transport.start();
    await input.start();
    await output.start();
    await collector.start();

    // Send audio to output
    const audioData = createAudioData(480);
    const outputFrame = new OutputAudioRawFrame(audioData, 24000, 1);
    output.queueFrame(outputFrame);

    await advanceTime(100);

    await collector.stop();
    await output.stop();
    await input.stop();
    await transport.stop();

    // Check that audio was received at input
    const inputAudioFrames = collector.collectedFrames.filter(
      f => f instanceof InputAudioRawFrame
    );
    expect(inputAudioFrames.length).toBeGreaterThan(0);
  });
});

describe("WebSocketServerTransport", () => {
  // Mock WebSocket-like interface (similar to Hono WSContext or ws)
  class MockWebSocket {
    private sentMessages: unknown[] = [];
    private closed = false;

    send(data: string | ArrayBuffer | Uint8Array): void {
      if (this.closed) {
        throw new Error("WebSocket is closed");
      }
      this.sentMessages.push(data);
    }

    close(code?: number, reason?: string): void {
      this.closed = true;
    }

    getSentMessages(): unknown[] {
      return this.sentMessages;
    }

    isClosed(): boolean {
      return this.closed;
    }
  }

  it("creates input and output processors", () => {
    const ws = new MockWebSocket();
    const transport = new WebSocketServerTransport({ ws });

    expect(transport.input()).toBeDefined();
    expect(transport.output()).toBeDefined();
  });

  it("receives audio data via onAudioData", async () => {
    const ws = new MockWebSocket();
    const transport = new WebSocketServerTransport({ ws });
    const collector = new CollectorProcessor();
    const input = transport.input();

    input.link(collector);
    await transport.start();
    await input.start();
    await collector.start();

    // Send audio via onAudioData
    const audioData = createAudioData(320);
    transport.onAudioData(audioData);

    await advanceTime(50);

    await collector.stop();
    await input.stop();
    await transport.stop();

    const audioFrames = collector.collectedFrames.filter(
      f => f instanceof InputAudioRawFrame
    );
    expect(audioFrames.length).toBeGreaterThan(0);
  });

  it("receives messages via onMessage", async () => {
    const ws = new MockWebSocket();
    const transport = new WebSocketServerTransport({ ws });
    const collector = new CollectorProcessor();
    const input = transport.input();

    input.link(collector);
    await transport.start();
    await input.start();
    await collector.start();

    // Send message via onMessage
    await transport.onMessage({ action: "test", value: 123 });

    await advanceTime(50);

    await collector.stop();
    await input.stop();
    await transport.stop();

    const messageFrames = collector.collectedFrames.filter(
      f => f instanceof InputTransportMessageFrame
    );
    expect(messageFrames.length).toBe(1);
    expect((messageFrames[0] as InputTransportMessageFrame).message).toEqual({
      action: "test",
      value: 123,
    });
  });

  it("sends audio via WebSocket", async () => {
    const ws = new MockWebSocket();
    const transport = new WebSocketServerTransport({ ws });

    const audioData = createAudioData(480);
    await transport.sendAudio(audioData);

    expect(ws.getSentMessages().length).toBe(1);
    expect(ws.getSentMessages()[0]).toBeInstanceOf(Uint8Array);
  });

  it("sends messages via WebSocket as JSON", async () => {
    const ws = new MockWebSocket();
    const transport = new WebSocketServerTransport({ ws });

    await transport.sendMessage({ action: "test", data: "hello" });

    const sentMessages = ws.getSentMessages();
    expect(sentMessages.length).toBe(1);

    const parsed = JSON.parse(sentMessages[0] as string);
    expect(parsed.action).toBe("test");
    expect(parsed.data).toBe("hello");
  });

  it("closes the WebSocket connection", () => {
    const ws = new MockWebSocket();
    const transport = new WebSocketServerTransport({ ws });

    transport.close(1000, "Normal closure");

    expect(ws.isClosed()).toBe(true);
  });

  it("configures custom transport parameters", () => {
    const ws = new MockWebSocket();
    const transport = new WebSocketServerTransport({
      ws,
      params: {
        audioIn: { enabled: true, sampleRate: 48000, numChannels: 2, chunkSizeMs: 10 },
        audioOut: { enabled: true, sampleRate: 44100, numChannels: 2, chunkSizeMs: 10 },
        vad: { enabled: false, threshold: 0.02, startFrames: 5, stopFrames: 15 },
      },
    });

    const inputConfig = transport.getAudioInputConfig();
    expect(inputConfig.sampleRate).toBe(48000);
    expect(inputConfig.numChannels).toBe(2);

    const outputConfig = transport.getAudioOutputConfig();
    expect(outputConfig.sampleRate).toBe(44100);
    expect(outputConfig.numChannels).toBe(2);
  });

  it("works with pipeline", async () => {
    const ws = new MockWebSocket();
    const transport = new WebSocketServerTransport({
      ws,
      params: {
        audioIn: { enabled: true, sampleRate: 16000, numChannels: 1, chunkSizeMs: 20 },
        audioOut: { enabled: true, sampleRate: 24000, numChannels: 1, chunkSizeMs: 20 },
      },
    });

    const collector = new CollectorProcessor();

    // Build pipeline: input -> collector
    const pipeline = new Pipeline([
      transport.input(),
      collector,
    ]);

    await pipeline.start();

    // Send audio via transport
    const audioData = createAudioData(320, 0.5);
    transport.onAudioData(audioData);

    await advanceTime(100);
    await pipeline.stop();

    // Check that audio flowed through
    const audioFrames = collector.collectedFrames.filter(
      f => f instanceof InputAudioRawFrame
    );
    expect(audioFrames.length).toBeGreaterThan(0);
  });

  it("sends output audio frames via WebSocket", async () => {
    const ws = new MockWebSocket();
    const transport = new WebSocketServerTransport({ ws });
    const output = transport.output();

    await transport.start();
    await output.start();

    // Queue an output audio frame
    const audioFrame = new OutputAudioRawFrame(createAudioData(480), 24000, 1);
    output.queueFrame(audioFrame);

    await advanceTime(50);

    await output.stop();
    await transport.stop();

    // Check that audio was sent via WebSocket
    const sentMessages = ws.getSentMessages();
    expect(sentMessages.length).toBeGreaterThan(0);
    expect(sentMessages[0]).toBeInstanceOf(Uint8Array);
  });
});

describe("Transport integration with Pipeline", () => {
  it("works with Pipeline for end-to-end flow", async () => {
    const transport = new MockTransport();
    const collector = new CollectorProcessor();

    // Build pipeline: input -> collector
    const pipeline = new Pipeline([
      transport.input(),
      collector,
    ]);

    await pipeline.start();

    // Queue audio into the transport
    const audioData = createAudioData(320, 0.5);
    transport._input.queueAudio(audioData);

    await advanceTime(100);
    await pipeline.stop();

    // Check that audio flowed through
    const audioFrames = collector.collectedFrames.filter(
      f => f instanceof InputAudioRawFrame
    );
    expect(audioFrames.length).toBeGreaterThan(0);
  });
});
