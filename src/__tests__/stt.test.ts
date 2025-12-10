import { Pipeline } from "../pipeline/pipeline";
import { Frame } from "../frames/base";
import { InputAudioRawFrame, InterimTranscriptionFrame, TranscriptionFrame } from "../frames/data";
import { CollectorProcessor, advanceTime } from "./testUtils";
import { STTResult, STTService } from "../services/stt/base";
import { DeepgramSTTService } from "../services/stt/deepgram";

class MockSTTService extends STTService {
  public calls: InputAudioRawFrame[] = [];
  private readonly response: STTResult;

  constructor(response: STTResult) {
    super({ userId: "user-123", language: "en" });
    this.response = response;
  }

  protected async runSTT(audio: Uint8Array, frame: InputAudioRawFrame): Promise<STTResult> {
    this.calls.push(frame);
    return this.response;
  }
}

describe("STTService", () => {
  it("emits TranscriptionFrame for final results", async () => {
    const stt = new MockSTTService({ text: "hello world" });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([stt, collector]);

    await pipeline.start();
    const audio = new Uint8Array([0, 1, 2, 3]);
    const frame = new InputAudioRawFrame(audio, 16000, 1);
    pipeline.queueFrame(frame);

    await advanceTime(30);
    await pipeline.stop();

    const transcription = collector.collectedFrames.find(
      (f: Frame) => f instanceof TranscriptionFrame
    ) as TranscriptionFrame | undefined;

    expect(transcription).toBeDefined();
    expect(transcription?.text).toBe("hello world");
    expect(transcription?.userId).toBe("user-123");
    expect(transcription?.language).toBe("en");
    expect(stt.calls).toHaveLength(1);
  });

  it("emits InterimTranscriptionFrame for interim results", async () => {
    const stt = new MockSTTService({ text: "partial", interim: true });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([stt, collector]);

    await pipeline.start();
    const frame = new InputAudioRawFrame(new Uint8Array([1, 1]), 16000, 1);
    pipeline.queueFrame(frame);

    await advanceTime(30);
    await pipeline.stop();

    const interim = collector.collectedFrames.find(
      (f: Frame) => f instanceof InterimTranscriptionFrame
    ) as InterimTranscriptionFrame | undefined;

    expect(interim).toBeDefined();
    expect(interim?.text).toBe("partial");
  });
});

describe("DeepgramSTTService", () => {
  const mockResponse = {
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return {
        results: {
          channels: [
            {
              alternatives: [{ transcript: "transcribed text", confidence: 0.9 }],
            },
          ],
        },
      };
    },
    async text() {
      return "";
    },
  };

  it("sends audio to Deepgram and returns transcription", async () => {
    const fetchMock = jest.fn().mockResolvedValue(mockResponse);
    const stt = new DeepgramSTTService({
      apiKey: "test-key",
      model: "nova",
      language: "en-US",
      fetch: fetchMock,
    });

    const result = await stt["runSTT"](
      new Uint8Array([0, 0]),
      new InputAudioRawFrame(new Uint8Array([0, 0]), 16000, 1)
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("model=nova");
    expect(url).toContain("language=en-US");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Token test-key",
    });
    expect(result.text).toBe("transcribed text");
  });
});
