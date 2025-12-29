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

describe("CartesiaTTSService", () => {
  const mockAudioData = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]);

  const createMockResponse = (audioData: Uint8Array) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    async arrayBuffer() {
      return audioData.buffer;
    },
    async json() {
      return {};
    },
    async text() {
      return "";
    },
  });

  it("sends text to Cartesia and returns audio", async () => {
    const fetchMock = jest.fn().mockResolvedValue(createMockResponse(mockAudioData));
    const tts = new CartesiaTTSService({
      apiKey: "test-key",
      voiceId: "test-voice-id",
      model: "sonic-3",
      language: "en",
      fetch: fetchMock,
    });

    const result = await tts["runTTS"]("Hello world");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe("https://api.cartesia.ai/tts/bytes");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      "X-API-Key": "test-key",
      "Cartesia-Version": "2024-06-10",
      "Content-Type": "application/json",
    });

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model_id).toBe("sonic-3");
    expect(body.transcript).toBe("Hello world");
    expect(body.voice.mode).toBe("id");
    expect(body.voice.id).toBe("test-voice-id");
    expect(body.language).toBe("en");
    expect(body.output_format.container).toBe("raw");
    expect(body.output_format.encoding).toBe("pcm_s16le");
    expect(body.output_format.sample_rate).toBe(24000);

    expect(result.audio).toEqual(mockAudioData);
    expect(result.sampleRate).toBe(24000);
    expect(result.numChannels).toBe(1);
  });

  it("uses custom sample rate", async () => {
    const fetchMock = jest.fn().mockResolvedValue(createMockResponse(mockAudioData));
    const tts = new CartesiaTTSService({
      apiKey: "test-key",
      voiceId: "test-voice-id",
      sampleRate: 44100,
      fetch: fetchMock,
    });

    const result = await tts["runTTS"]("Test");

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.output_format.sample_rate).toBe(44100);
    expect(result.sampleRate).toBe(44100);
  });

  it("throws error on API failure", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      async json() {
        return { error: "Invalid API key" };
      },
    });

    const tts = new CartesiaTTSService({
      apiKey: "invalid-key",
      voiceId: "test-voice-id",
      fetch: fetchMock,
    });

    await expect(tts["runTTS"]("Hello")).rejects.toThrow(
      /Cartesia request failed: 401 Unauthorized - Invalid API key/
    );
  });

  it("uses default model when not specified", async () => {
    const fetchMock = jest.fn().mockResolvedValue(createMockResponse(mockAudioData));
    const tts = new CartesiaTTSService({
      apiKey: "test-key",
      voiceId: "test-voice-id",
      fetch: fetchMock,
    });

    await tts["runTTS"]("Test");

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model_id).toBe("sonic-3");
  });

  it("omits language when not specified", async () => {
    const fetchMock = jest.fn().mockResolvedValue(createMockResponse(mockAudioData));
    const tts = new CartesiaTTSService({
      apiKey: "test-key",
      voiceId: "test-voice-id",
      fetch: fetchMock,
    });

    await tts["runTTS"]("Test");

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.language).toBeUndefined();
  });
});
