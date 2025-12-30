import { Pipeline } from "../pipeline/pipeline";
import { Frame } from "../frames/base";
import { TextFrame, TTSAudioRawFrame } from "../frames/data";
import { TTSStartedFrame, TTSStoppedFrame } from "../frames/control";
import { CollectorProcessor, advanceTime } from "./testUtils";
import { TTSResult, TTSService } from "../services/tts/base";
import { CartesiaTTSService } from "../services/tts/cartesia";

class MockTTSService extends TTSService {
  public calls: string[] = [];
  private readonly response: TTSResult;

  constructor(response: TTSResult) {
    super({ voiceId: "test-voice", language: "en" });
    this.response = response;
  }

  protected async runTTS(text: string): Promise<TTSResult> {
    this.calls.push(text);
    return this.response;
  }
}

describe("TTSService", () => {
  it("emits TTSStartedFrame, TTSAudioRawFrame, and TTSStoppedFrame for TextFrame", async () => {
    const audioData = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
    const tts = new MockTTSService({
      audio: audioData,
      sampleRate: 24000,
      numChannels: 1,
    });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([tts, collector]);

    await pipeline.start();
    const frame = new TextFrame("Hello world");
    pipeline.queueFrame(frame);

    await advanceTime(30);
    await pipeline.stop();

    const startFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof TTSStartedFrame
    ) as TTSStartedFrame | undefined;

    const audioFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof TTSAudioRawFrame
    ) as TTSAudioRawFrame | undefined;

    const stopFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof TTSStoppedFrame
    ) as TTSStoppedFrame | undefined;

    expect(startFrame).toBeDefined();
    expect(audioFrame).toBeDefined();
    expect(audioFrame?.audio).toEqual(audioData);
    expect(audioFrame?.sampleRate).toBe(24000);
    expect(audioFrame?.numChannels).toBe(1);
    expect(stopFrame).toBeDefined();
    expect(tts.calls).toHaveLength(1);
    expect(tts.calls[0]).toBe("Hello world");
  });

  it("emits frames in correct order: Started -> Audio -> Stopped", async () => {
    const tts = new MockTTSService({
      audio: new Uint8Array([1, 2, 3, 4]),
      sampleRate: 24000,
      numChannels: 1,
    });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([tts, collector]);

    await pipeline.start();
    pipeline.queueFrame(new TextFrame("Test"));

    await advanceTime(30);
    await pipeline.stop();

    const frameTypes = collector.collectedFrames.map(f => f.constructor.name);
    const startIndex = frameTypes.indexOf("TTSStartedFrame");
    const audioIndex = frameTypes.indexOf("TTSAudioRawFrame");
    const stopIndex = frameTypes.indexOf("TTSStoppedFrame");

    expect(startIndex).toBeLessThan(audioIndex);
    expect(audioIndex).toBeLessThan(stopIndex);
  });

  it("skips TTS when TextFrame has skipTts=true", async () => {
    const tts = new MockTTSService({
      audio: new Uint8Array([1, 2, 3, 4]),
      sampleRate: 24000,
      numChannels: 1,
    });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([tts, collector]);

    await pipeline.start();
    const frame = new TextFrame("Skip me");
    frame.skipTts = true;
    pipeline.queueFrame(frame);

    await advanceTime(30);
    await pipeline.stop();

    const audioFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof TTSAudioRawFrame
    );

    expect(audioFrame).toBeUndefined();
    expect(tts.calls).toHaveLength(0);

    // The original frame should be passed through
    const textFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof TextFrame
    ) as TextFrame | undefined;
    expect(textFrame).toBeDefined();
    expect(textFrame?.text).toBe("Skip me");
  });

  it("skips empty text", async () => {
    const tts = new MockTTSService({
      audio: new Uint8Array([1, 2, 3, 4]),
      sampleRate: 24000,
      numChannels: 1,
    });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([tts, collector]);

    await pipeline.start();
    pipeline.queueFrame(new TextFrame(""));
    pipeline.queueFrame(new TextFrame("   "));

    await advanceTime(30);
    await pipeline.stop();

    expect(tts.calls).toHaveLength(0);
  });

  it("passes through non-TextFrame frames unchanged", async () => {
    const tts = new MockTTSService({
      audio: new Uint8Array([1, 2, 3, 4]),
      sampleRate: 24000,
      numChannels: 1,
    });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([tts, collector]);

    await pipeline.start();
    const customFrame = new TTSStartedFrame();
    pipeline.queueFrame(customFrame);

    await advanceTime(30);
    await pipeline.stop();

    const passedFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof TTSStartedFrame
    );
    expect(passedFrame).toBeDefined();
    expect(tts.calls).toHaveLength(0);
  });
});

// Mock the Cartesia SDK
jest.mock("@cartesia/cartesia-js", () => ({
  CartesiaClient: jest.fn(() => ({
    tts: {
      bytes: jest.fn(),
    },
  })),
  Cartesia: {},
}));

import { CartesiaClient } from "@cartesia/cartesia-js";
import { Readable } from "stream";

describe("CartesiaTTSService", () => {
  const mockAudioData = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);
  const mockBytes = jest.fn();

  // Helper to create a mock readable stream from audio data
  const createMockStream = (audioData: Uint8Array): Readable => {
    const stream = new Readable({
      read() {
        this.push(Buffer.from(audioData));
        this.push(null);
      },
    });
    return stream;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (CartesiaClient as jest.Mock).mockReturnValue({
      tts: {
        bytes: mockBytes,
      },
    });
  });

  it("sends text to Cartesia SDK and returns audio", async () => {
    mockBytes.mockResolvedValue(createMockStream(mockAudioData));

    const tts = new CartesiaTTSService({
      apiKey: "test-key",
      voiceId: "test-voice-id",
      model: "sonic-3",
      language: "en",
    });

    const result = await tts["runTTS"]("Hello world");

    expect(CartesiaClient).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(mockBytes).toHaveBeenCalledTimes(1);

    const request = mockBytes.mock.calls[0][0];
    expect(request.modelId).toBe("sonic-3");
    expect(request.transcript).toBe("Hello world");
    expect(request.voice.mode).toBe("id");
    expect(request.voice.id).toBe("test-voice-id");
    expect(request.language).toBe("en");
    expect(request.outputFormat.container).toBe("raw");
    expect(request.outputFormat.encoding).toBe("pcm_s16le");
    expect(request.outputFormat.sampleRate).toBe(24000);

    expect(result.audio).toEqual(mockAudioData);
    expect(result.sampleRate).toBe(24000);
    expect(result.numChannels).toBe(1);
  });

  it("uses custom sample rate", async () => {
    mockBytes.mockResolvedValue(createMockStream(mockAudioData));

    const tts = new CartesiaTTSService({
      apiKey: "test-key",
      voiceId: "test-voice-id",
      sampleRate: 44100,
    });

    const result = await tts["runTTS"]("Test");

    const request = mockBytes.mock.calls[0][0];
    expect(request.outputFormat.sampleRate).toBe(44100);
    expect(result.sampleRate).toBe(44100);
  });

  it("throws error on SDK failure", async () => {
    mockBytes.mockRejectedValue(new Error("API error: Invalid API key"));

    const tts = new CartesiaTTSService({
      apiKey: "invalid-key",
      voiceId: "test-voice-id",
    });

    await expect(tts["runTTS"]("Hello")).rejects.toThrow("API error: Invalid API key");
  });

  it("uses default model when not specified", async () => {
    mockBytes.mockResolvedValue(createMockStream(mockAudioData));

    const tts = new CartesiaTTSService({
      apiKey: "test-key",
      voiceId: "test-voice-id",
    });

    await tts["runTTS"]("Test");

    const request = mockBytes.mock.calls[0][0];
    expect(request.modelId).toBe("sonic-3");
  });

  it("omits language when not specified", async () => {
    mockBytes.mockResolvedValue(createMockStream(mockAudioData));

    const tts = new CartesiaTTSService({
      apiKey: "test-key",
      voiceId: "test-voice-id",
    });

    await tts["runTTS"]("Test");

    const request = mockBytes.mock.calls[0][0];
    expect(request.language).toBeUndefined();
  });
});
