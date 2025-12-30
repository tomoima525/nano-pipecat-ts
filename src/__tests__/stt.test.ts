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

// Mock the Deepgram SDK
jest.mock("@deepgram/sdk", () => ({
  createClient: jest.fn(() => ({
    listen: {
      prerecorded: {
        transcribeFile: jest.fn(),
      },
    },
  })),
}));

import { createClient } from "@deepgram/sdk";

describe("DeepgramSTTService", () => {
  const mockTranscribeFile = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockReturnValue({
      listen: {
        prerecorded: {
          transcribeFile: mockTranscribeFile,
        },
      },
    });
  });

  it("sends audio to Deepgram SDK and returns transcription", async () => {
    mockTranscribeFile.mockResolvedValue({
      result: {
        results: {
          channels: [
            {
              alternatives: [{ transcript: "transcribed text", confidence: 0.9 }],
            },
          ],
        },
      },
      error: null,
    });

    const stt = new DeepgramSTTService({
      apiKey: "test-key",
      model: "nova",
      language: "en-US",
    });

    const result = await stt["runSTT"](
      new Uint8Array([0, 0]),
      new InputAudioRawFrame(new Uint8Array([0, 0]), 16000, 1)
    );

    expect(createClient).toHaveBeenCalledWith("test-key");
    expect(mockTranscribeFile).toHaveBeenCalledTimes(1);
    const [audioBuffer, options] = mockTranscribeFile.mock.calls[0];
    expect(Buffer.isBuffer(audioBuffer)).toBe(true);
    expect(options).toMatchObject({
      model: "nova",
      language: "en-US",
      encoding: "linear16",
      sample_rate: 16000,
      channels: 1,
      smart_format: true,
    });
    expect(result.text).toBe("transcribed text");
  });

  it("throws error when Deepgram returns an error", async () => {
    mockTranscribeFile.mockResolvedValue({
      result: null,
      error: { message: "API error" },
    });

    const stt = new DeepgramSTTService({
      apiKey: "test-key",
    });

    await expect(
      stt["runSTT"](
        new Uint8Array([0, 0]),
        new InputAudioRawFrame(new Uint8Array([0, 0]), 16000, 1)
      )
    ).rejects.toThrow("Deepgram transcription failed: API error");
  });
});
