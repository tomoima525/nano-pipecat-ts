/**
 * Example usage of the FrameProcessor architecture
 *
 * This example demonstrates how to create custom processors and chain them together
 * to build a processing pipeline.
 */

import { FrameProcessor } from "../../src/processors/base";
import { Frame } from "../../src/frames/base";
import { StartFrame } from "../../src/frames/system";
import { TextFrame } from "../../src/frames/data";
import { EndFrame } from "../../src/frames/control";

/**
 * Example 1: Simple text processor that converts text to uppercase
 */
class UppercaseProcessor extends FrameProcessor {
  async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof TextFrame) {
      const upperText = frame.text.toUpperCase();
      await this.pushFrame(new TextFrame(upperText), "downstream");
    } else {
      // Pass through other frame types
      await this.pushFrame(frame, "downstream");
    }
  }
}

/**
 * Example 2: Text filter that only passes frames containing specific keywords
 */
class KeywordFilterProcessor extends FrameProcessor {
  private keywords: string[];

  constructor(keywords: string[]) {
    super({ name: "KeywordFilter" });
    this.keywords = keywords;
  }

  async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof TextFrame) {
      const hasKeyword = this.keywords.some(keyword =>
        frame.text.toLowerCase().includes(keyword.toLowerCase())
      );

      if (hasKeyword) {
        await this.pushFrame(frame, "downstream");
      }
      // Drop frames that don't contain keywords
    } else {
      // Pass through non-text frames
      await this.pushFrame(frame, "downstream");
    }
  }
}

/**
 * Example 3: Logger processor that logs all frames
 */
class LoggerProcessor extends FrameProcessor {
  async processFrame(frame: Frame): Promise<void> {
    console.log(`[Logger] Received frame: ${frame.toString()}`);
    await this.pushFrame(frame, "downstream");
  }
}

/**
 * Example 4: Collector processor that accumulates text frames
 */
class CollectorProcessor extends FrameProcessor {
  private collectedText: string[] = [];

  async processFrame(frame: Frame): Promise<void> {
    if (frame instanceof TextFrame) {
      this.collectedText.push(frame.text);
      console.log(`[Collector] Accumulated ${this.collectedText.length} text frames`);
    }

    // Don't push frames downstream - this is a sink
  }

  getCollectedText(): string[] {
    return [...this.collectedText];
  }

  clear(): void {
    this.collectedText = [];
  }
}

/**
 * Example usage: Building and running a pipeline
 */
async function runExample() {
  console.log("=== FrameProcessor Example ===\n");

  // Create processors
  const logger = new LoggerProcessor({ enableLogging: false });
  const filter = new KeywordFilterProcessor(["hello", "world"]);
  const uppercase = new UppercaseProcessor();
  const collector = new CollectorProcessor();

  // Link processors into a pipeline
  logger.link(filter);
  filter.link(uppercase);
  uppercase.link(collector);

  // Start all processors
  await logger.start();
  await filter.start();
  await uppercase.start();
  await collector.start();

  console.log("Pipeline started\n");

  // Send a StartFrame
  logger.queueFrame(new StartFrame());

  // Send some test frames
  logger.queueFrame(new TextFrame("Hello there!"));
  logger.queueFrame(new TextFrame("This should be filtered out"));
  logger.queueFrame(new TextFrame("World peace"));
  logger.queueFrame(new TextFrame("Another filtered message"));
  logger.queueFrame(new TextFrame("Hello world!"));

  // Wait for processing
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log("\n=== Results ===");
  console.log("Collected text:");
  collector.getCollectedText().forEach((text, i) => {
    console.log(`  ${i + 1}. ${text}`);
  });

  // Send EndFrame to gracefully terminate
  logger.queueFrame(new EndFrame());
  await new Promise(resolve => setTimeout(resolve, 50));

  // Stop all processors
  await logger.stop();
  await filter.stop();
  await uppercase.stop();
  await collector.stop();

  console.log("\nPipeline stopped");
}

/**
 * Example: Bidirectional communication
 */
async function runBidirectionalExample() {
  console.log("\n=== Bidirectional Example ===\n");

  class EchoProcessor extends FrameProcessor {
    async processFrame(frame: Frame): Promise<void> {
      if (frame instanceof TextFrame) {
        console.log(`[Echo] Received: ${frame.text}`);
        // Echo back upstream
        await this.pushFrame(new TextFrame(`Echo: ${frame.text}`), "upstream");
      }
    }
  }

  class SourceProcessor extends FrameProcessor {
    async processFrame(frame: Frame): Promise<void> {
      if (frame instanceof TextFrame) {
        console.log(`[Source] Received echo: ${frame.text}`);
      }
    }
  }

  const source = new SourceProcessor();
  const echo = new EchoProcessor();

  source.link(echo);

  await source.start();
  await echo.start();

  source.queueFrame(new TextFrame("Hello"));
  source.queueFrame(new TextFrame("World"));

  await new Promise(resolve => setTimeout(resolve, 100));

  await source.stop();
  await echo.stop();
}

/**
 * Example: Error handling
 */
async function runErrorHandlingExample() {
  console.log("\n=== Error Handling Example ===\n");

  class ErrorProneProcessor extends FrameProcessor {
    async processFrame(frame: Frame): Promise<void> {
      if (frame instanceof TextFrame && frame.text === "ERROR") {
        throw new Error("Simulated processing error");
      }
      await this.pushFrame(frame, "downstream");
    }
  }

  class ErrorHandlerProcessor extends FrameProcessor {
    async processFrame(frame: Frame): Promise<void> {
      console.log(`[ErrorHandler] Received frame: ${frame.toString()}`);
    }
  }

  const errorProne = new ErrorProneProcessor({ enableLogging: true });
  const errorHandler = new ErrorHandlerProcessor();

  errorProne.link(errorHandler);

  await errorProne.start();
  await errorHandler.start();

  errorProne.queueFrame(new TextFrame("Normal message"));
  errorProne.queueFrame(new TextFrame("ERROR")); // This will cause an error
  errorProne.queueFrame(new TextFrame("Another normal message"));

  await new Promise(resolve => setTimeout(resolve, 100));

  await errorProne.stop();
  await errorHandler.stop();
}

// Run all examples
async function main(): Promise<void> {
  try {
    await runExample();
    await runBidirectionalExample();
    await runErrorHandlingExample();
  } catch (error) {
    console.error("Example failed:", error);
  }
}

main().catch(console.error);
