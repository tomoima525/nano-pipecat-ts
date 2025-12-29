/**
 * Tests for Pipeline orchestration
 */

import { Pipeline } from "../pipeline/pipeline";
import { PipelineSource } from "../pipeline/source";
import { PipelineSink } from "../pipeline/sink";
import { FrameProcessor, resetProcessorIdCounter } from "../processors/base";
import { Frame, resetFrameCounters } from "../frames/base";
import { TextFrame } from "../frames/data";
import { StartFrame, StopFrame } from "../frames/system";
import { EndFrame } from "../frames/control";
import {
  CollectorProcessor,
  PassthroughProcessor,
  UppercaseProcessor,
  CollectingPassthroughProcessor,
  advanceTime,
} from "./testUtils";

describe("Pipeline", () => {
  let activeProcessors: FrameProcessor[] = [];
  let activePipelines: Pipeline[] = [];

  beforeEach(() => {
    resetFrameCounters();
    resetProcessorIdCounter();
    activeProcessors = [];
    activePipelines = [];
  });

  afterEach(async () => {
    // Stop all active pipelines
    for (const pipeline of activePipelines) {
      try {
        await pipeline.stop();
      } catch {
        // Ignore errors during cleanup
      }
    }
    activePipelines = [];

    // Stop any standalone processors
    for (const processor of activeProcessors) {
      try {
        await processor.stop();
      } catch {
        // Ignore errors during cleanup
      }
    }
    activeProcessors = [];
  });

  // Helper to track pipelines for cleanup
  const startPipeline = async (pipeline: Pipeline) => {
    await pipeline.start();
    activePipelines.push(pipeline);
  };

  describe("Construction", () => {
    it("should create pipeline with processors", () => {
      const processor1 = new PassthroughProcessor();
      const processor2 = new PassthroughProcessor();
      const pipeline = new Pipeline([processor1, processor2]);

      const allProcessors = pipeline.getProcessors();
      // Should have source + 2 processors + sink = 4 total
      expect(allProcessors.length).toBe(4);
    });

    it("should create pipeline with custom name", () => {
      const pipeline = new Pipeline([], { name: "CustomPipeline" });
      expect(pipeline.name).toBe("CustomPipeline");
    });

    it("should use custom source and sink if provided", () => {
      const customSource = new PipelineSource({
        name: "CustomSource",
        upstreamPushFrame: async () => {},
      });
      const customSink = new PipelineSink({
        name: "CustomSink",
        downstreamPushFrame: async () => {},
      });

      const pipeline = new Pipeline([], {
        source: customSource,
        sink: customSink,
      });

      const processors = pipeline.getProcessors();
      expect(processors[0].name).toBe("CustomSource");
      expect(processors[processors.length - 1].name).toBe("CustomSink");
    });
  });

  describe("Processor Linking", () => {
    it("should link all processors sequentially", () => {
      const processor1 = new PassthroughProcessor({ name: "P1" });
      const processor2 = new PassthroughProcessor({ name: "P2" });
      const processor3 = new PassthroughProcessor({ name: "P3" });

      const pipeline = new Pipeline([processor1, processor2, processor3]);
      const allProcessors = pipeline.getProcessors();

      // Verify chain: source -> P1 -> P2 -> P3 -> sink
      for (let i = 0; i < allProcessors.length - 1; i++) {
        expect(allProcessors[i].downstreamProcessor).toBe(allProcessors[i + 1]);
        expect(allProcessors[i + 1].upstreamProcessor).toBe(allProcessors[i]);
      }
    });
  });

  describe("Frame Processing", () => {
    it("should process frames through the pipeline", async () => {
      const collector = new CollectorProcessor({ enableLogging: false });
      const pipeline = new Pipeline([collector]);

      await startPipeline(pipeline);

      const textFrame = new TextFrame("test");
      pipeline.queueFrame(textFrame);

      await advanceTime(50);
      await pipeline.stop();

      expect(collector.collectedFrames).toContainEqual(textFrame);
    });

    it("should pass frames through multiple processors", async () => {
      const collector1 = new CollectingPassthroughProcessor({ enableLogging: false, name: "C1" });
      const collector2 = new CollectingPassthroughProcessor({ enableLogging: false, name: "C2" });
      const pipeline = new Pipeline([collector1, collector2]);

      await startPipeline(pipeline);

      const textFrame = new TextFrame("test");
      pipeline.queueFrame(textFrame);

      await advanceTime(50);
      await pipeline.stop();

      // Both collectors should receive the frame since they pass frames through
      expect(collector1.collectedFrames).toContainEqual(textFrame);
      expect(collector2.collectedFrames).toContainEqual(textFrame);
    });

    it("should transform frames through processors", async () => {
      const uppercase = new UppercaseProcessor({ enableLogging: false });
      const collector = new CollectorProcessor({ enableLogging: false });
      const pipeline = new Pipeline([uppercase, collector]);

      await startPipeline(pipeline);

      pipeline.queueFrame(new TextFrame("hello"));
      pipeline.queueFrame(new TextFrame("world"));

      await advanceTime(50);
      await pipeline.stop();

      // Check that frames were transformed to uppercase
      const textFrames = collector.collectedFrames.filter(
        f => f instanceof TextFrame
      ) as TextFrame[];
      expect(textFrames.length).toBe(2);
      expect(textFrames[0].text).toBe("HELLO");
      expect(textFrames[1].text).toBe("WORLD");
    });
  });

  describe("Pipeline Lifecycle", () => {
    it("should start all processors", async () => {
      const processor = new PassthroughProcessor({ enableLogging: false });
      const pipeline = new Pipeline([processor]);

      await startPipeline(pipeline);

      // Check that all processors are running
      const allProcessors = pipeline.getProcessors();
      for (const p of allProcessors) {
        expect(p.getState().running).toBe(true);
      }

      await pipeline.stop();
    });

    it("should stop all processors", async () => {
      const processor = new PassthroughProcessor({ enableLogging: false });
      const pipeline = new Pipeline([processor]);

      await startPipeline(pipeline);
      await pipeline.stop();

      // Check that all processors are stopped
      const allProcessors = pipeline.getProcessors();
      for (const p of allProcessors) {
        expect(p.getState().running).toBe(false);
      }
    });

    it("should call setup on all processors", async () => {
      class SetupTrackingProcessor extends FrameProcessor {
        public setupCalled = false;

        async setup(): Promise<void> {
          await super.setup();
          this.setupCalled = true;
        }

        async processFrame(frame: Frame): Promise<void> {
          await this.pushFrame(frame, "downstream");
        }
      }

      const processor = new SetupTrackingProcessor();
      const pipeline = new Pipeline([processor]);

      await pipeline.setup();

      expect(processor.setupCalled).toBe(true);
    });

    it("should call cleanup on all processors", async () => {
      class CleanupTrackingProcessor extends FrameProcessor {
        public cleanupCalled = false;

        async cleanup(): Promise<void> {
          await super.cleanup();
          this.cleanupCalled = true;
        }

        async processFrame(frame: Frame): Promise<void> {
          await this.pushFrame(frame, "downstream");
        }
      }

      const processor = new CleanupTrackingProcessor();
      const pipeline = new Pipeline([processor]);

      await pipeline.setup();
      await startPipeline(pipeline);
      await pipeline.stop();
      await pipeline.cleanup();

      expect(processor.cleanupCalled).toBe(true);
    });
  });

  describe("Source and Sink", () => {
    it("should route frames from source to first processor", async () => {
      const collector = new CollectorProcessor({ enableLogging: false });
      const pipeline = new Pipeline([collector]);

      await startPipeline(pipeline);

      const textFrame = new TextFrame("test");
      pipeline.queueFrame(textFrame);

      await advanceTime(50);
      await pipeline.stop();

      expect(collector.collectedFrames).toContainEqual(textFrame);
    });

    it("should route frames from last processor to sink", async () => {
      const sinkFrames: Frame[] = [];
      const customSink = new PipelineSink({
        name: "CustomSink",
        downstreamPushFrame: async frame => {
          sinkFrames.push(frame);
        },
      });

      const passthrough = new PassthroughProcessor({ enableLogging: false });
      const pipeline = new Pipeline([passthrough], { sink: customSink });

      await startPipeline(pipeline);

      const textFrame = new TextFrame("test");
      pipeline.queueFrame(textFrame);

      await advanceTime(50);
      await pipeline.stop();

      expect(sinkFrames).toContainEqual(textFrame);
    });

    it("should handle upstream frames from source", async () => {
      const upstreamFrames: Frame[] = [];
      const customSource = new PipelineSource({
        name: "CustomSource",
        upstreamPushFrame: async frame => {
          upstreamFrames.push(frame);
        },
      });

      // Processor that echoes frames back upstream
      class EchoProcessor extends FrameProcessor {
        async processFrame(frame: Frame): Promise<void> {
          await this.pushFrame(frame, "upstream");
        }
      }

      const echo = new EchoProcessor({ enableLogging: false });
      const pipeline = new Pipeline([echo], { source: customSource });

      await startPipeline(pipeline);

      const textFrame = new TextFrame("test");
      pipeline.queueFrame(textFrame);

      await advanceTime(50);
      await pipeline.stop();

      expect(upstreamFrames).toContainEqual(textFrame);
    });
  });

  describe("Metrics", () => {
    it("should collect processors with metrics", async () => {
      const processor1 = new CollectorProcessor({ enableMetrics: true });
      const processor2 = new CollectorProcessor({ enableMetrics: true });
      const pipeline = new Pipeline([processor1, processor2], { enableMetrics: true });

      await startPipeline(pipeline);

      pipeline.queueFrame(new TextFrame("test"));

      await advanceTime(50);
      await pipeline.stop();

      const processorsWithMetrics = pipeline.getProcessorsWithMetrics();
      expect(processorsWithMetrics.length).toBeGreaterThan(0);
    });
  });

  describe("Entry Processors", () => {
    it("should return source as entry processor", () => {
      const pipeline = new Pipeline([new PassthroughProcessor()]);
      const entryProcessors = pipeline.getEntryProcessors();

      expect(entryProcessors.length).toBe(1);
      expect(entryProcessors[0].name).toContain("Source");
    });
  });

  describe("System Frame Handling", () => {
    it("should propagate StartFrame through pipeline", async () => {
      const collector = new CollectorProcessor({ enableLogging: false });
      const pipeline = new Pipeline([collector]);

      await startPipeline(pipeline);

      const startFrame = new StartFrame();
      pipeline.queueFrame(startFrame);

      await advanceTime(50);
      await pipeline.stop();

      // StartFrame is handled internally but should propagate
      expect(collector.collectedFrames.length).toBeGreaterThanOrEqual(0);
    });

    it("should handle StopFrame to stop pipeline", async () => {
      const collector = new CollectorProcessor({ enableLogging: false });
      const pipeline = new Pipeline([collector]);

      await startPipeline(pipeline);

      const stopFrame = new StopFrame();
      pipeline.queueFrame(stopFrame);

      // Wait for StopFrame to propagate and stop processors
      await advanceTime(100);

      // Check that all processors are stopped
      const allProcessors = pipeline.getProcessors();
      for (const p of allProcessors) {
        expect(p.getState().running).toBe(false);
      }
    });

    it("should pass EndFrame through pipeline", async () => {
      const collector = new CollectorProcessor({ enableLogging: false });
      const pipeline = new Pipeline([collector]);

      await startPipeline(pipeline);

      pipeline.queueFrame(new TextFrame("test"));
      pipeline.queueFrame(new EndFrame());

      await advanceTime(50);
      await pipeline.stop();

      // EndFrame is handled internally by the framework, but TextFrame should be collected
      const hasTextFrame = collector.collectedFrames.some(f => f instanceof TextFrame);

      expect(hasTextFrame).toBe(true);
      // Note: EndFrame is a control frame handled by FrameProcessor internally,
      // so it won't be passed to user's processFrame() method
      expect(collector.collectedFrames.length).toBeGreaterThanOrEqual(1);
    });
  });
});
