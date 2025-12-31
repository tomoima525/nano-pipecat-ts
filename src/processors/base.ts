/**
 * Frame Processor Base Class
 *
 * The FrameProcessor is the fundamental building block for creating processing
 * pipelines. It handles frame queuing, processing, and routing between processors.
 *
 * Key Features:
 * - Bidirectional frame flow (upstream/downstream)
 * - Priority queuing (system frames bypass normal queues)
 * - Async processing with concurrency control
 * - Processor chaining via link() method
 * - Lifecycle management (setup/cleanup)
 */

import {
  Frame,
  isSystemFrame,
  isDataFrame,
  isControlFrame,
  SystemFrame,
  DataFrame,
} from "../frames/base";
import {
  StartFrame,
  CancelFrame,
  ErrorFrame,
  InterruptionFrame,
  StopFrame,
  isStartFrame,
  isCancelFrame,
  isStopFrame,
  isInterruptionFrame,
  FrameProcessorPauseFrame,
  FrameProcessorResumeFrame,
} from "../frames/system";
import { isEndFrame } from "../frames/control";

/**
 * Direction for frame flow in the pipeline
 */
export type FrameDirection = "upstream" | "downstream";

/**
 * Configuration options for FrameProcessor
 */
export interface FrameProcessorOptions {
  /** Unique identifier for this processor */
  id?: string;
  /** Human-readable name for this processor */
  name?: string;
  /** Whether to enable metrics collection */
  enableMetrics?: boolean;
  /** Whether to log frame processing events */
  enableLogging?: boolean;
}

/**
 * Global counter for generating unique processor IDs
 */
let processorIdCounter = 0;

/**
 * Generate a unique processor ID
 */
function generateProcessorId(): string {
  return `processor_${++processorIdCounter}`;
}

/**
 * Abstract base class for all frame processors in the pipeline.
 *
 * Processors are chained together to form a pipeline. Each processor can:
 * - Receive frames from upstream or downstream
 * - Process frames asynchronously
 * - Push frames upstream or downstream
 * - Maintain internal state
 *
 * @example
 * ```typescript
 * class MyProcessor extends FrameProcessor {
 *   async processFrame(frame: Frame): Promise<void> {
 *     if (frame instanceof TextFrame) {
 *       // Process text frame
 *       await this.pushFrame(new TextFrame(processedText), "downstream");
 *     }
 *   }
 * }
 * ```
 */
export abstract class FrameProcessor {
  /** Unique identifier for this processor */
  public readonly id: string;
  /** Human-readable name for this processor */
  public readonly name: string;

  /** Priority queue for system frames (processed immediately) */
  private systemQueue: SystemFrame[] = [];
  /** Queue for data and control frames (processed in order) */
  private dataQueue: DataFrame[] = [];

  /** Reference to the processor upstream in the pipeline */
  public upstreamProcessor?: FrameProcessor;
  /** Reference to the processor downstream in the pipeline */
  public downstreamProcessor?: FrameProcessor;

  /** Whether the processor is currently running */
  private running: boolean = false;
  /** Whether the processor is paused. Only system frames are processed while paused. */
  private paused: boolean = false;
  /** Whether interruptions are allowed */
  private allowInterruptions: boolean = true;

  /** Processing task promise */
  private processingTask?: Promise<void>;
  /** Flag to stop processing loop */
  private shouldStop: boolean = false;

  /** Metrics collection flag */
  private enableMetrics: boolean;
  /** Logging flag */
  private enableLogging: boolean;

  /** Metrics data */
  private metrics: {
    framesProcessed: number;
    systemFramesProcessed: number;
    dataFramesProcessed: number;
    controlFramesProcessed: number;
    errorsEncountered: number;
  } = {
    framesProcessed: 0,
    systemFramesProcessed: 0,
    dataFramesProcessed: 0,
    controlFramesProcessed: 0,
    errorsEncountered: 0,
  };

  constructor(options: FrameProcessorOptions = {}) {
    this.id = options.id ?? generateProcessorId();
    this.name = options.name ?? this.constructor.name;
    this.enableMetrics = options.enableMetrics ?? false;
    this.enableLogging = options.enableLogging ?? false;
  }

  /**
   * Abstract method to process a single frame.
   * Must be implemented by subclasses.
   *
   * @param frame - The frame to process
   */
  protected abstract processFrame(frame: Frame): Promise<void>;

  /**
   * Queue a frame for processing.
   * System frames are added to the priority queue, other frames to the data queue.
   *
   * @param frame - The frame to queue
   * @param direction - Optional direction hint for bidirectional processors(TODO: implement)
   */
  public queueFrame(frame: Frame, direction?: FrameDirection): void {
    this.log(`Queueing frame: ${frame.toString()} in direction: ${direction}`);
    if (isSystemFrame(frame)) {
      this.systemQueue.push(frame as SystemFrame);
      this.log(`Queued system frame: ${frame.toString()}`);
    } else {
      this.dataQueue.push(frame as DataFrame);
      this.log(`Queued data/control frame: ${(frame as Frame).toString()}`);
    }
  }

  /**
   * Push a frame to the next processor (upstream or downstream).
   * This bypasses the queue and sends the frame directly.
   *
   * @param frame - The frame to push
   * @param direction - Direction to push the frame ('upstream' or 'downstream')
   */
  public async pushFrame(frame: Frame, direction: FrameDirection = "downstream"): Promise<void> {
    const target = direction === "downstream" ? this.downstreamProcessor : this.upstreamProcessor;

    if (target) {
      this.log(`Pushing ${frame.name} ${direction}`);
      target.queueFrame(frame, direction);
    } else {
      this.log(`No ${direction} processor, dropping frame: ${frame.name}`);
    }
  }

  /**
   * Link this processor to another processor downstream.
   * This creates a chain: this -> processor
   *
   * @param processor - The processor to link downstream
   */
  public link(processor: FrameProcessor): void {
    this.downstreamProcessor = processor;
    processor.upstreamProcessor = this;
    this.log(`Linked to downstream processor: ${processor.name}`);
  }

  /**
   * Setup method called before processing starts.
   * Override this to initialize resources.
   */
  public async setup(): Promise<void> {
    this.log("Setup called");
  }

  /**
   * Cleanup method called after processing stops.
   * Override this to release resources.
   */
  public async cleanup(): Promise<void> {
    this.log("Cleanup called");
  }

  /**
   * Start the frame processing loop.
   * This begins consuming frames from the queues.
   * Note: setup() must be called before start() - Pipeline handles this coordination.
   */
  public async start(): Promise<void> {
    if (this.running) {
      this.log("Already running");
      return;
    }

    this.running = true;
    this.shouldStop = false;

    this.processingTask = this.processLoop();
    this.log("Started");
  }

  /**
   * Stop the frame processing loop.
   * Waits for current frame to finish processing.
   */
  public async stop(): Promise<void> {
    if (!this.running) {
      this.log("Not running");
      return;
    }

    this.shouldStop = true;

    if (this.processingTask) {
      await this.processingTask;
    }

    this.running = false;

    await this.cleanup();
    this.log("Stopped");
  }

  /**
   * Main processing loop that continuously processes frames from queues.
   * System frames are processed with priority over data/control frames.
   */
  private async processLoop(): Promise<void> {
    while (!this.shouldStop) {
      try {
        // Process system frames first (priority queue)
        if (this.systemQueue.length > 0) {
          const frame = this.systemQueue.shift()!;
          await this.processFrameInternal(frame);
          continue;
        }

        // Process data/control frames
        if (!this.paused && this.dataQueue.length > 0) {
          const frame = this.dataQueue.shift()!;
          await this.processFrameInternal(frame);
          continue;
        }

        // No frames to process, wait briefly before checking again
        await this.sleep(1);
      } catch (error) {
        this.metrics.errorsEncountered++;
        this.log(`Error in processing loop: ${error}`);
        await this.pushError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  /**
   * Internal frame processing with built-in handlers for system frames.
   *
   * @param frame - The frame to process
   */
  private async processFrameInternal(frame: Frame): Promise<void> {
    this.log(`Processing frame: ${frame.toString()}`);

    // Update metrics
    this.metrics.framesProcessed++;

    // Handle built-in system frames
    if (isStartFrame(frame)) {
      this.metrics.systemFramesProcessed++;
      await this.handleStartFrame(frame);
      return;
    }

    if (isCancelFrame(frame)) {
      this.metrics.systemFramesProcessed++;
      await this.handleCancelFrame(frame);
      return;
    }

    if (isStopFrame(frame)) {
      this.metrics.systemFramesProcessed++;
      await this.handleStopFrame(frame);
      return;
    }

    if (isInterruptionFrame(frame)) {
      this.metrics.systemFramesProcessed++;
      await this.handleInterruptionFrame(frame);
      return;
    }

    // Need to check system frame type before narrowing further
    const frameAsAny = frame as any;
    if (frameAsAny instanceof FrameProcessorPauseFrame) {
      this.metrics.systemFramesProcessed++;
      await this.handlePauseFrame(frameAsAny);
      return;
    }

    if (frameAsAny instanceof FrameProcessorResumeFrame) {
      this.metrics.systemFramesProcessed++;
      await this.handleResumeFrame(frameAsAny);
      return;
    }

    // Handle end frame (graceful termination)
    if (isEndFrame(frame)) {
      this.metrics.controlFramesProcessed++;
      this.log("Received EndFrame, passing downstream");
      await this.pushFrame(frame, "downstream");
      return;
    }

    // Update metrics for remaining frames
    if (isSystemFrame(frame)) {
      this.metrics.systemFramesProcessed++;
    } else if (isDataFrame(frame)) {
      this.metrics.dataFramesProcessed++;
    } else if (isControlFrame(frame)) {
      this.metrics.controlFramesProcessed++;
    }

    // Call the abstract processFrame method
    try {
      await this.processFrame(frame);
    } catch (error) {
      this.metrics.errorsEncountered++;
      this.log(`Error processing frame ${frame as Frame}.toString()}: ${error}`);
      await this.pushError(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Handle StartFrame - initialize processing state
   */
  private async handleStartFrame(frame: StartFrame): Promise<void> {
    this.log("Received StartFrame");
    this.allowInterruptions = frame.allowInterruptions;

    // Pass StartFrame downstream so all processors receive it
    await this.pushFrame(frame, "downstream");
  }

  /**
   * Handle CancelFrame - stop immediately without processing remaining frames
   */
  private async handleCancelFrame(frame: CancelFrame): Promise<void> {
    this.log(`Received CancelFrame: ${frame.reason ?? "No reason provided"}`);

    // Clear all queues
    if (this.allowInterruptions) {
      this.clearDataQueues();
    }

    // Pass CancelFrame downstream
    await this.pushFrame(frame, "downstream");
  }

  /**
   * Handle StopFrame - stop gracefully after processing remaining frames
   */
  private async handleStopFrame(frame: StopFrame): Promise<void> {
    this.log("Received StopFrame");

    // Pass StopFrame downstream first
    await this.pushFrame(frame, "downstream");

    // Then stop this processor
    this.shouldStop = true;

    // Schedule stop() to be called after processing loop exits
    setImmediate(async () => {
      if (this.running) {
        await this.stop();
      }
    });
  }

  /**
   * Handle InterruptionFrame - cancel in-progress data/control frames
   */
  private async handleInterruptionFrame(frame: InterruptionFrame): Promise<void> {
    this.log("Received InterruptionFrame");

    if (this.allowInterruptions) {
      this.clearDataQueues();
    }

    // Pass InterruptionFrame downstream
    await this.pushFrame(frame, "downstream");
  }

  /**
   * Handle FrameProcessorPauseFrame - pause this processor if it matches
   */
  private async handlePauseFrame(frame: FrameProcessorPauseFrame): Promise<void> {
    if (frame.processorId === this.id || frame.processorId === this.name) {
      this.log("Pausing processor");
      this.paused = true;
    }

    // Pass to downstream processors
    await this.pushFrame(frame, "downstream");
  }

  /**
   * Handle FrameProcessorResumeFrame - resume this processor if it matches
   */
  private async handleResumeFrame(frame: FrameProcessorResumeFrame): Promise<void> {
    this.log(`Received FrameProcessorResumeFrame: ${frame.processorId}`);
    this.log(`Processor ID: ${this.id}`);
    this.log(`Processor Name: ${this.name}`);
    if (frame.processorId === this.id || frame.processorId === this.name) {
      this.log("Resuming processor");
      this.paused = false;
    }

    // Pass to downstream processors
    await this.pushFrame(frame, "downstream");
  }

  /**
   * Clear data and control frame queues (used for interruptions/cancellations)
   */
  private clearDataQueues(): void {
    const clearedCount = this.dataQueue.length;
    this.dataQueue = [];
    this.log(`Cleared ${clearedCount} frames from data queue`);
  }

  /**
   * Create and push an error frame downstream
   *
   * @param error - Error message
   * @param fatal - Whether this error is fatal
   */
  public async pushError(error: string, fatal: boolean = false): Promise<void> {
    this.log(`Pushing error: ${error} (fatal: ${fatal})`);
    const errorFrame = new ErrorFrame(error, fatal);
    await this.pushFrame(errorFrame, "downstream");
  }

  /**
   * Get current metrics for this processor
   */
  public getMetrics(): Record<string, unknown> {
    return {
      ...this.metrics,
      queueSizes: {
        system: this.systemQueue.length,
        data: this.dataQueue.length,
      },
    };
  }

  /**
   * Log a message if logging is enabled
   */
  protected log(message: string, data?: Record<string, unknown>): void {
    if (this.enableLogging) {
      console.log(`[${this.name}] ${message}`, data);
    }
  }

  /**
   * Sleep for a specified number of milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the current state of this processor
   */
  public getState(): {
    id: string;
    name: string;
    running: boolean;
    paused: boolean;
    queueSizes: { system: number; data: number };
  } {
    return {
      id: this.id,
      name: this.name,
      running: this.running,
      paused: this.paused,
      queueSizes: {
        system: this.systemQueue.length,
        data: this.dataQueue.length,
      },
    };
  }
}

/**
 * Reset the processor ID counter - useful for testing
 */
export function resetProcessorIdCounter(): void {
  processorIdCounter = 0;
}
