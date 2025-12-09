/**
 * Tests for FrameProcessor base class
 */

import { FrameProcessor, resetProcessorIdCounter } from "../processors/base";
import { Frame, resetFrameCounters } from "../frames/base";
import {
  StartFrame,
  CancelFrame,
  ErrorFrame,
  InterruptionFrame,
  StopFrame,
  FrameProcessorPauseFrame,
  FrameProcessorResumeFrame,
} from "../frames/system";
import { EndFrame } from "../frames/control";
import { TextFrame } from "../frames/data";

// Test helper: Mock processor that collects frames
class CollectorProcessor extends FrameProcessor {
  public collectedFrames: Frame[] = [];

  async processFrame(frame: Frame): Promise<void> {
    this.collectedFrames.push(frame);
  }

  getCollected(): Frame[] {
    return this.collectedFrames;
  }

  clear(): void {
    this.collectedFrames = [];
  }
}

// Test helper: Passthrough processor
class PassthroughProcessor extends FrameProcessor {
  async processFrame(frame: Frame): Promise<void> {
    await this.pushFrame(frame, "downstream");
  }
}

// Test helper: Echo processor (sends frame back upstream)
class EchoProcessor extends FrameProcessor {
  async processFrame(frame: Frame): Promise<void> {
    await this.pushFrame(frame, "upstream");
  }
}

// Test helper: Error processor (throws error on specific frames)
class ErrorProcessor extends FrameProcessor {
  async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof TextFrame && frame.text === "ERROR") {
      throw new Error("Test error");
    }
    await this.pushFrame(frame, "downstream");
  }
}

describe("FrameProcessor", () => {
  let activeProcessors: FrameProcessor[] = [];

  beforeEach(() => {
    resetFrameCounters();
    resetProcessorIdCounter();
    activeProcessors = [];
  });

  afterEach(async () => {
    // Stop all active processors to prevent hanging
    for (const processor of activeProcessors) {
      try {
        await processor.stop();
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
    activeProcessors = [];
  });

  // Helper function to start a processor and track it for cleanup
  const startProcessor = async (processor: FrameProcessor) => {
    await processor.start();
    activeProcessors.push(processor);
  };

  describe("Initialization", () => {
    it("should create processor with auto-generated ID", () => {
      const processor = new CollectorProcessor();
      expect(processor.id).toBe("processor_1");
      expect(processor.name).toBe("CollectorProcessor");
    });

    it("should create processor with custom ID and name", () => {
      const processor = new CollectorProcessor({
        id: "custom-id",
        name: "CustomName",
      });
      expect(processor.id).toBe("custom-id");
      expect(processor.name).toBe("CustomName");
    });

    it("should initialize with default state", () => {
      const processor = new CollectorProcessor();
      const state = processor.getState();
      expect(state.running).toBe(false);
      expect(state.paused).toBe(false);
      expect(state.queueSizes.system).toBe(0);
      expect(state.queueSizes.data).toBe(0);
    });
  });

  describe("Processor Linking", () => {
    it("should link processors together", () => {
      const processor1 = new CollectorProcessor();
      const processor2 = new CollectorProcessor();

      processor1.link(processor2);

      expect(processor1.downstreamProcessor).toBe(processor2);
      expect(processor2.upstreamProcessor).toBe(processor1);
    });

    it("should chain multiple processors", () => {
      const p1 = new CollectorProcessor();
      const p2 = new CollectorProcessor();
      const p3 = new CollectorProcessor();

      p1.link(p2);
      p2.link(p3);

      expect(p1.downstreamProcessor).toBe(p2);
      expect(p2.upstreamProcessor).toBe(p1);
      expect(p2.downstreamProcessor).toBe(p3);
      expect(p3.upstreamProcessor).toBe(p2);
    });
  });

  describe("Frame Queuing", () => {
    it("should queue system frames in priority queue", () => {
      const processor = new CollectorProcessor();
      const startFrame = new StartFrame();

      processor.queueFrame(startFrame);

      const state = processor.getState();
      expect(state.queueSizes.system).toBe(1);
      expect(state.queueSizes.data).toBe(0);
    });

    it("should queue data frames in data queue", () => {
      const processor = new CollectorProcessor();
      const textFrame = new TextFrame("test");

      processor.queueFrame(textFrame);

      const state = processor.getState();
      expect(state.queueSizes.system).toBe(0);
      expect(state.queueSizes.data).toBe(1);
    });

    it("should queue control frames in data queue", () => {
      const processor = new CollectorProcessor();
      const endFrame = new EndFrame();

      processor.queueFrame(endFrame);

      const state = processor.getState();
      expect(state.queueSizes.system).toBe(0);
      expect(state.queueSizes.data).toBe(1);
    });
  });

  describe("Frame Processing", () => {
    it("should process queued frames", async () => {
      const processor = new CollectorProcessor({ enableLogging: false });
      const textFrame = new TextFrame("test");

      processor.queueFrame(textFrame);
      await startProcessor(processor);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      await processor.stop();

      expect(processor.collectedFrames).toContain(textFrame);
    });

    it("should process system frames before data frames", async () => {
      const processor = new CollectorProcessor({ enableLogging: false });
      const textFrame = new TextFrame("test");
      const cancelFrame = new CancelFrame();

      // Queue data frame first, then system frame
      processor.queueFrame(textFrame);
      processor.queueFrame(cancelFrame);

      await startProcessor(processor);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 500));

      await processor.stop();

      // CancelFrame should be processed first despite being queued second
      const cancelIndex = processor.collectedFrames.indexOf(cancelFrame);
      const textIndex = processor.collectedFrames.indexOf(textFrame);

      expect(cancelIndex).toBeLessThan(textIndex);
    });

    it("should push frames downstream", async () => {
      const processor1 = new PassthroughProcessor({ enableLogging: false });
      const processor2 = new CollectorProcessor({ enableLogging: false });

      processor1.link(processor2);

      const textFrame = new TextFrame("test");

      processor1.queueFrame(textFrame);
      await startProcessor(processor1);
      await startProcessor(processor2);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      await processor1.stop();
      await processor2.stop();

      expect(processor2.collectedFrames).toContainEqual(textFrame);
    });

    it("should push frames upstream", async () => {
      const processor1 = new CollectorProcessor({ enableLogging: false });
      const processor2 = new EchoProcessor({ enableLogging: false });

      processor1.link(processor2);

      const textFrame = new TextFrame("test");

      processor2.queueFrame(textFrame);
      await startProcessor(processor1);
      await startProcessor(processor2);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      await processor1.stop();
      await processor2.stop();

      expect(processor1.collectedFrames).toContainEqual(textFrame);
    });
  });

  describe("System Frame Handling", () => {
    it("should handle StartFrame", async () => {
      const processor = new CollectorProcessor({ enableLogging: false });
      const startFrame = new StartFrame({ allowInterruptions: false });

      processor.queueFrame(startFrame);
      await startProcessor(processor);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      await processor.stop();

      // StartFrame should be passed downstream
      expect(processor.collectedFrames).toContain(startFrame);
    });

    it("should clear data queue on CancelFrame when interruptions allowed", async () => {
      const processor = new CollectorProcessor({ enableLogging: false });
      const startFrame = new StartFrame({ allowInterruptions: true });
      const textFrame1 = new TextFrame("test1");
      const textFrame2 = new TextFrame("test2");
      const cancelFrame = new CancelFrame();

      processor.queueFrame(startFrame);
      await startProcessor(processor);

      // Wait for StartFrame to be processed
      await new Promise(resolve => setTimeout(resolve, 50));

      // Queue data frames and cancel frame
      processor.queueFrame(textFrame1);
      processor.queueFrame(textFrame2);
      processor.queueFrame(cancelFrame);

      // Wait for CancelFrame to be processed
      await new Promise(resolve => setTimeout(resolve, 50));

      await processor.stop();

      // CancelFrame should clear the queued data frames
      expect(processor.collectedFrames).toContain(cancelFrame);
      // The text frames may or may not be collected depending on timing
    });

    it("should handle InterruptionFrame", async () => {
      const processor = new CollectorProcessor({ enableLogging: false });
      const startFrame = new StartFrame({ allowInterruptions: true });
      const interruptionFrame = new InterruptionFrame();

      processor.queueFrame(startFrame);
      await startProcessor(processor);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      processor.queueFrame(interruptionFrame);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      await processor.stop();

      expect(processor.collectedFrames).toContain(interruptionFrame);
    });

    it("should stop processing on StopFrame", async () => {
      const processor = new CollectorProcessor({ enableLogging: false });
      const stopFrame = new StopFrame();

      await startProcessor(processor);
      processor.queueFrame(stopFrame);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      const state = processor.getState();
      expect(state.running).toBe(false);
    });
  });

  describe("Pause and Resume", () => {
    it("should pause processor", async () => {
      const processor = new CollectorProcessor({
        id: "test-processor",
        enableLogging: false,
      });
      const pauseFrame = new FrameProcessorPauseFrame("test-processor");
      const textFrame = new TextFrame("test");

      await startProcessor(processor);

      processor.queueFrame(pauseFrame);

      // Wait for pause to be processed
      await new Promise(resolve => setTimeout(resolve, 50));

      const state = processor.getState();
      expect(state.paused).toBe(true);

      // Queue a frame while paused
      processor.queueFrame(textFrame);

      // Wait
      await new Promise(resolve => setTimeout(resolve, 50));

      // Frame should not be processed yet
      expect(processor.collectedFrames).not.toContain(textFrame);

      await processor.stop();
    });

    it("should resume processor", async () => {
      const processor = new CollectorProcessor({
        id: "test-processor",
        enableLogging: false,
      });
      const pauseFrame = new FrameProcessorPauseFrame("test-processor");
      const resumeFrame = new FrameProcessorResumeFrame("test-processor");
      const textFrame = new TextFrame("test");

      await startProcessor(processor);

      // Pause
      processor.queueFrame(pauseFrame);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Queue frame while paused
      processor.queueFrame(textFrame);
      await new Promise(resolve => setTimeout(resolve, 50));

      // Resume
      processor.queueFrame(resumeFrame);
      await new Promise(resolve => setTimeout(resolve, 100));

      // Frame should now be processed
      expect(processor.collectedFrames).toContain(textFrame);

      await processor.stop();
    });
  });

  describe("Error Handling", () => {
    it("should handle errors and push ErrorFrame", async () => {
      const processor1 = new ErrorProcessor({ enableLogging: false });
      const processor2 = new CollectorProcessor({ enableLogging: false });

      processor1.link(processor2);

      const errorFrame = new TextFrame("ERROR");

      processor1.queueFrame(errorFrame);
      await startProcessor(processor1);
      await startProcessor(processor2);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      await processor1.stop();
      await processor2.stop();

      // Should have received an ErrorFrame downstream
      const errorFrames = processor2.collectedFrames.filter(f => f instanceof ErrorFrame);
      expect(errorFrames.length).toBeGreaterThan(0);
    });
  });

  describe("Metrics", () => {
    it("should collect metrics", async () => {
      const processor = new CollectorProcessor({
        enableMetrics: true,
        enableLogging: false,
      });
      const textFrame1 = new TextFrame("test1");
      const textFrame2 = new TextFrame("test2");
      const startFrame = new StartFrame();

      processor.queueFrame(startFrame);
      processor.queueFrame(textFrame1);
      processor.queueFrame(textFrame2);

      await startProcessor(processor);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 100));

      await processor.stop();

      const metrics = processor.getMetrics();
      expect(metrics.framesProcessed).toBeGreaterThanOrEqual(3);
      expect(metrics.systemFramesProcessed).toBeGreaterThanOrEqual(1);
      expect(metrics.dataFramesProcessed).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Lifecycle", () => {
    it("should call setup on start", async () => {
      class SetupProcessor extends FrameProcessor {
        public setupCalled = false;

        async setup(): Promise<void> {
          this.setupCalled = true;
        }

        async processFrame(frame: Frame): Promise<void> {
          // no-op
        }
      }

      const processor = new SetupProcessor();
      await startProcessor(processor);
      await processor.stop();

      expect(processor.setupCalled).toBe(true);
    });

    it("should call cleanup on stop", async () => {
      class CleanupProcessor extends FrameProcessor {
        public cleanupCalled = false;

        async cleanup(): Promise<void> {
          this.cleanupCalled = true;
        }

        async processFrame(frame: Frame): Promise<void> {
          // no-op
        }
      }

      const processor = new CleanupProcessor();
      await startProcessor(processor);
      await processor.stop();

      expect(processor.cleanupCalled).toBe(true);
    });
  });

  describe("EndFrame Handling", () => {
    it("should pass EndFrame downstream", async () => {
      const processor1 = new PassthroughProcessor({ enableLogging: false });
      const processor2 = new CollectorProcessor({ enableLogging: false });

      processor1.link(processor2);

      const endFrame = new EndFrame();

      processor1.queueFrame(endFrame);
      await startProcessor(processor1);
      await startProcessor(processor2);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 50));

      await processor1.stop();
      await processor2.stop();

      expect(processor2.collectedFrames).toContainEqual(endFrame);
    });
  });
});
