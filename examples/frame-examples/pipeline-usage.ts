/**
 * Example usage of the Pipeline architecture
 *
 * This example demonstrates how to create and use pipelines to orchestrate
 * multiple frame processors together.
 */

import { Pipeline } from "../../src/pipeline/pipeline";
import { PipelineSource } from "../../src/pipeline/source";
import { PipelineSink } from "../../src/pipeline/sink";
import { FrameProcessor } from "../../src/processors/base";
import { Frame } from "../../src/frames/base";
import { TextFrame } from "../../src/frames/data";
import { StartFrame } from "../../src/frames/system";
import { EndFrame } from "../../src/frames/control";

/**
 * Example 1: Simple text processing pipeline
 */

// Processor that converts text to uppercase
class UppercaseProcessor extends FrameProcessor {
  async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof TextFrame) {
      const upperText = frame.text.toUpperCase();
      await this.pushFrame(new TextFrame(upperText), "downstream");
    } else {
      await this.pushFrame(frame, "downstream");
    }
  }
}

// Processor that adds prefix to text
class PrefixProcessor extends FrameProcessor {
  private prefix: string;

  constructor(prefix: string) {
    super({ name: "PrefixProcessor" });
    this.prefix = prefix;
  }

  async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof TextFrame) {
      const prefixedText = `${this.prefix}${frame.text}`;
      await this.pushFrame(new TextFrame(prefixedText), "downstream");
    } else {
      await this.pushFrame(frame, "downstream");
    }
  }
}

// Processor that logs frames
class LoggerProcessor extends FrameProcessor {
  async processFrame(frame: Frame): Promise<void> {
    console.log(`[Logger] ${frame.toString()}`);
    await this.pushFrame(frame, "downstream");
  }
}

async function simpleTextPipeline() {
  console.log("=== Simple Text Processing Pipeline ===\n");

  // Collect output frames
  const outputFrames: Frame[] = [];

  // Create a custom sink to capture output
  const sink = new PipelineSink({
    name: "OutputSink",
    downstreamPushFrame: async frame => {
      outputFrames.push(frame);
      if (frame instanceof TextFrame) {
        console.log(`[Output] ${frame.text}`);
      }
    },
  });

  // Create pipeline with processors
  const pipeline = new Pipeline(
    [
      new LoggerProcessor({ enableLogging: false }),
      new UppercaseProcessor({ enableLogging: false }),
      new PrefixProcessor(">>> "),
    ],
    { sink }
  );

  // Start the pipeline
  await pipeline.start();

  console.log("Pipeline started\n");

  // Send frames through the pipeline
  pipeline.queueFrame(new StartFrame());
  pipeline.queueFrame(new TextFrame("hello world"));
  pipeline.queueFrame(new TextFrame("pipeline processing"));
  pipeline.queueFrame(new TextFrame("is awesome"));
  pipeline.queueFrame(new EndFrame());

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log(`\nProcessed ${outputFrames.length} frames`);

  // Stop the pipeline
  await pipeline.stop();
  console.log("\nPipeline stopped\n");
}

/**
 * Example 2: Pipeline with metrics collection
 */

class CountingProcessor extends FrameProcessor {
  private count = 0;

  constructor() {
    super({
      name: "CountingProcessor",
      enableMetrics: true,
    });
  }

  async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof TextFrame) {
      this.count++;
      console.log(`[Counter] Processed ${this.count} text frames`);
    }
    await this.pushFrame(frame, "downstream");
  }
}

async function pipelineWithMetrics() {
  console.log("=== Pipeline with Metrics ===\n");

  const counter = new CountingProcessor();
  const pipeline = new Pipeline([counter], {
    enableMetrics: true,
  });

  await pipeline.start();

  // Send some text frames
  for (let i = 1; i <= 5; i++) {
    pipeline.queueFrame(new TextFrame(`Message ${i}`));
  }

  await new Promise(resolve => setTimeout(resolve, 100));

  // Get metrics from processors
  const processorsWithMetrics = pipeline.getProcessorsWithMetrics();
  console.log(`\nProcessors with metrics: ${processorsWithMetrics.length}`);

  for (const processor of processorsWithMetrics) {
    console.log(`\n[${processor.name}] Metrics:`);
    console.log(JSON.stringify(processor.getMetrics(), null, 2));
  }

  await pipeline.stop();
  console.log("\nPipeline stopped\n");
}

/**
 * Example 3: Custom source and sink for bidirectional communication
 */

async function bidirectionalPipeline() {
  console.log("=== Bidirectional Pipeline ===\n");

  const upstreamFrames: Frame[] = [];
  const downstreamFrames: Frame[] = [];

  // Custom source that handles upstream frames
  const source = new PipelineSource({
    name: "CustomSource",
    upstreamPushFrame: async frame => {
      upstreamFrames.push(frame);
      if (frame instanceof TextFrame) {
        console.log(`[Source received upstream] ${frame.text}`);
      }
    },
  });

  // Custom sink that handles downstream frames
  const sink = new PipelineSink({
    name: "CustomSink",
    downstreamPushFrame: async frame => {
      downstreamFrames.push(frame);
      if (frame instanceof TextFrame) {
        console.log(`[Sink received downstream] ${frame.text}`);
      }
    },
  });

  // Echo processor that sends frames back upstream
  class EchoProcessor extends FrameProcessor {
    async processFrame(frame: Frame): Promise<void> {
      if (frame instanceof TextFrame) {
        // Send original frame downstream
        await this.pushFrame(frame, "downstream");

        // Send echo back upstream
        await this.pushFrame(new TextFrame(`Echo: ${frame.text}`), "upstream");
      } else {
        await this.pushFrame(frame, "downstream");
      }
    }
  }

  const echo = new EchoProcessor({ enableLogging: false });
  const pipeline = new Pipeline([echo], { source, sink });

  await pipeline.start();

  pipeline.queueFrame(new TextFrame("Hello"));
  pipeline.queueFrame(new TextFrame("World"));

  await new Promise(resolve => setTimeout(resolve, 100));

  console.log(`\nUpstream frames received: ${upstreamFrames.length}`);
  console.log(`Downstream frames received: ${downstreamFrames.length}`);

  await pipeline.stop();
  console.log("\nPipeline stopped\n");
}

/**
 * Example 4: Complex multi-stage pipeline
 */

class FilterProcessor extends FrameProcessor {
  private keywords: string[];

  constructor(keywords: string[]) {
    super({ name: "FilterProcessor" });
    this.keywords = keywords;
  }

  async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof TextFrame) {
      const hasKeyword = this.keywords.some(keyword =>
        frame.text.toLowerCase().includes(keyword.toLowerCase())
      );

      if (hasKeyword) {
        console.log(`[Filter] ✓ Passed: "${frame.text}"`);
        await this.pushFrame(frame, "downstream");
      } else {
        console.log(`[Filter] ✗ Blocked: "${frame.text}"`);
        // Drop frame (don't push it)
      }
    } else {
      await this.pushFrame(frame, "downstream");
    }
  }
}

async function complexPipeline() {
  console.log("=== Complex Multi-Stage Pipeline ===\n");

  const outputFrames: Frame[] = [];

  const sink = new PipelineSink({
    name: "OutputSink",
    downstreamPushFrame: async frame => {
      outputFrames.push(frame);
    },
  });

  // Create a multi-stage pipeline
  const pipeline = new Pipeline(
    [
      new FilterProcessor(["important", "urgent"]), // Stage 1: Filter
      new UppercaseProcessor(), // Stage 2: Transform
      new PrefixProcessor("[ALERT] "), // Stage 3: Add prefix
      new LoggerProcessor({ enableLogging: false }), // Stage 4: Log
    ],
    { sink }
  );

  await pipeline.start();

  console.log("Sending frames through multi-stage pipeline:\n");

  pipeline.queueFrame(new TextFrame("This is important information"));
  pipeline.queueFrame(new TextFrame("Regular message"));
  pipeline.queueFrame(new TextFrame("Urgent update needed"));
  pipeline.queueFrame(new TextFrame("Another regular message"));
  pipeline.queueFrame(new TextFrame("Important and urgent!"));

  await new Promise(resolve => setTimeout(resolve, 100));

  console.log(`\n\nFinal output (${outputFrames.length} frames):`);
  outputFrames.forEach((frame, i) => {
    if (frame instanceof TextFrame) {
      console.log(`  ${i + 1}. ${frame.text}`);
    }
  });

  await pipeline.stop();
  console.log("\nPipeline stopped\n");
}

/**
 * Run all examples
 */
async function main() {
  try {
    await simpleTextPipeline();
    await pipelineWithMetrics();
    await bidirectionalPipeline();
    await complexPipeline();
  } catch (error) {
    console.error("Example failed:", error);
  }
}

// Uncomment to run:
// main();
