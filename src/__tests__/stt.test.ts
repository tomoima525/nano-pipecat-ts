import { Pipeline } from "../pipeline/pipeline";
import { Frame } from "../frames/base";
import {
  InputAudioRawFrame,
  InterimTranscriptionFrame,
  TranscriptionFrame,
} from "../frames/data";
import { CollectorProcessor, advanceTime } from "./testUtils";
import { STTService, STTServiceOptions } from "../services/stt/base";
import { DeepgramSTTService } from "../services/stt/deepgram";

/**
 * Mock STT Service that simulates the streaming workflow.
 * In the new architecture:
 * - runSTT() is fire-and-forget (just tracks calls)
 * - Results are pushed via pushTranscriptionResult() from "event handlers"
 */
class MockSTTService extends STTService {
  public calls: InputAudioRawFrame[] = [];
  private pendingResult: {
    text: string;
    interim?: boolean;
  } | null = null;

  constructor(options: STTServiceOptions = {}) {
    super({ userId: "user-123", language: "en", ...options });
  }

  /**
   * Simulate receiving a transcription result (as if from a WebSocket callback)
   */
  public simulateTranscriptionResult(text: string, interim: boolean = false): void {
    this.pendingResult = { text, interim };
  }

  protected async runSTT(audio: Uint8Array, frame: InputAudioRawFrame): Promise<void> {
    this.calls.push(frame);

    // Simulate async callback behavior - push any pending result
    if (this.pendingResult) {
      await this.pushTranscriptionResult({
        text: this.pendingResult.text,
        interim: this.pendingResult.interim,
      });
      this.pendingResult = null;
    }
  }
}

describe("STTService", () => {
  it("emits TranscriptionFrame for final results", async () => {
    const stt = new MockSTTService();
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([stt, collector]);

    await pipeline.start();

    // Simulate a transcription result arriving
    stt.simulateTranscriptionResult("hello world", false);

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
    const stt = new MockSTTService();
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([stt, collector]);

    await pipeline.start();

    // Simulate an interim transcription result
    stt.simulateTranscriptionResult("partial", true);

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

  it("passes through audio frames to downstream processors", async () => {
    const stt = new MockSTTService();
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([stt, collector]);

    await pipeline.start();

    const frame = new InputAudioRawFrame(new Uint8Array([1, 2, 3]), 16000, 1);
    pipeline.queueFrame(frame);

    await advanceTime(30);
    await pipeline.stop();

    // The audio frame should be passed through
    const audioFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof InputAudioRawFrame
    ) as InputAudioRawFrame | undefined;

    expect(audioFrame).toBeDefined();
    expect(audioFrame?.audio).toEqual(new Uint8Array([1, 2, 3]));
  });
});

// Mock the Deepgram SDK for live streaming
const mockSend = jest.fn();
const mockOn = jest.fn();
const mockRequestClose = jest.fn();

jest.mock("@deepgram/sdk", () => ({
  createClient: jest.fn(() => ({
    listen: {
      live: jest.fn(() => ({
        send: mockSend,
        on: mockOn,
        requestClose: mockRequestClose,
      })),
    },
  })),
  LiveTranscriptionEvents: {
    Open: "open",
    Close: "close",
    Error: "error",
    Transcript: "Results",
  },
}));

import { createClient } from "@deepgram/sdk";

describe("DeepgramSTTService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOn.mockClear();
    mockSend.mockClear();
    mockRequestClose.mockClear();
  });

  it("creates client and sets up live connection on setup", async () => {
    const stt = new DeepgramSTTService({
      apiKey: "test-key",
      model: "nova-2",
      language: "en-US",
    });

    await stt.setup();

    expect(createClient).toHaveBeenCalledWith("test-key");

    // Check that live() was called with correct options
    const mockClient = (createClient as jest.Mock).mock.results[0].value;
    expect(mockClient.listen.live).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "nova-2",
        language: "en-US",
        smart_format: true,
        interim_results: true,
        encoding: "linear16",
        sample_rate: 16000,
        channels: 1,
      })
    );

    // Check that event handlers were registered
    expect(mockOn).toHaveBeenCalledWith("open", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("Results", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("close", expect.any(Function));
    expect(mockOn).toHaveBeenCalledWith("error", expect.any(Function));

    await stt.cleanup();
  });

  it("sends audio to WebSocket via runSTT", async () => {
    const stt = new DeepgramSTTService({
      apiKey: "test-key",
    });

    await stt.setup();

    const audio = new Uint8Array([1, 2, 3, 4]);
    const frame = new InputAudioRawFrame(audio, 16000, 1);

    await stt["runSTT"](audio, frame);

    expect(mockSend).toHaveBeenCalledTimes(1);
    // The audio should be converted to ArrayBuffer
    expect(mockSend).toHaveBeenCalledWith(expect.any(ArrayBuffer));

    await stt.cleanup();
  });

  it("does not send audio if connection is not established", async () => {
    const stt = new DeepgramSTTService({
      apiKey: "test-key",
    });

    // Don't call setup() - no connection

    const audio = new Uint8Array([1, 2, 3, 4]);
    const frame = new InputAudioRawFrame(audio, 16000, 1);

    await stt["runSTT"](audio, frame);

    expect(mockSend).not.toHaveBeenCalled();
  });

  it("closes connection on cleanup", async () => {
    const stt = new DeepgramSTTService({
      apiKey: "test-key",
    });

    await stt.setup();
    await stt.cleanup();

    expect(mockRequestClose).toHaveBeenCalledTimes(1);
  });

  it("handles transcription events and pushes frames", async () => {
    const stt = new DeepgramSTTService({
      apiKey: "test-key",
      language: "en",
    });

    // Capture the transcript event handler
    let transcriptHandler: ((data: unknown) => void) | undefined;
    mockOn.mockImplementation((event: string, handler: (data: unknown) => void) => {
      if (event === "Results") {
        transcriptHandler = handler;
      }
    });

    await stt.setup();

    // Spy on pushFrame to capture emitted frames
    const pushFrameSpy = jest.spyOn(stt, "pushFrame");

    // Simulate a transcription event
    const mockTranscriptData = {
      channel: {
        alternatives: [{ transcript: "hello world", confidence: 0.95 }],
      },
      is_final: true,
      speech_final: false,
    };

    expect(transcriptHandler).toBeDefined();
    transcriptHandler!(mockTranscriptData);

    // Wait for async processing
    await advanceTime(10);

    // Check that a TranscriptionFrame was pushed
    expect(pushFrameSpy).toHaveBeenCalledWith(
      expect.any(TranscriptionFrame),
      "downstream"
    );

    const pushedFrame = pushFrameSpy.mock.calls.find(
      call => call[0] instanceof TranscriptionFrame
    )?.[0] as TranscriptionFrame;

    expect(pushedFrame?.text).toBe("hello world");

    await stt.cleanup();
  });

  it("emits interim frames for non-final results", async () => {
    const stt = new DeepgramSTTService({
      apiKey: "test-key",
    });

    let transcriptHandler: ((data: unknown) => void) | undefined;
    mockOn.mockImplementation((event: string, handler: (data: unknown) => void) => {
      if (event === "Results") {
        transcriptHandler = handler;
      }
    });

    await stt.setup();

    const pushFrameSpy = jest.spyOn(stt, "pushFrame");

    // Simulate an interim transcription event
    const mockTranscriptData = {
      channel: {
        alternatives: [{ transcript: "partial text", confidence: 0.8 }],
      },
      is_final: false,
      speech_final: false,
    };

    transcriptHandler!(mockTranscriptData);
    await advanceTime(10);

    expect(pushFrameSpy).toHaveBeenCalledWith(
      expect.any(InterimTranscriptionFrame),
      "downstream"
    );

    await stt.cleanup();
  });

  it("skips empty transcripts", async () => {
    const stt = new DeepgramSTTService({
      apiKey: "test-key",
    });

    let transcriptHandler: ((data: unknown) => void) | undefined;
    mockOn.mockImplementation((event: string, handler: (data: unknown) => void) => {
      if (event === "Results") {
        transcriptHandler = handler;
      }
    });

    await stt.setup();

    const pushFrameSpy = jest.spyOn(stt, "pushFrame");

    // Simulate an empty transcription event
    const mockTranscriptData = {
      channel: {
        alternatives: [{ transcript: "", confidence: 0.0 }],
      },
      is_final: true,
    };

    transcriptHandler!(mockTranscriptData);
    await advanceTime(10);

    // Should not have pushed a transcription frame
    const transcriptionCalls = pushFrameSpy.mock.calls.filter(
      call =>
        call[0] instanceof TranscriptionFrame ||
        call[0] instanceof InterimTranscriptionFrame
    );

    expect(transcriptionCalls).toHaveLength(0);

    await stt.cleanup();
  });
});
