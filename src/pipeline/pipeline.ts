/**
 * Pipeline Orchestration
 *
 * The Pipeline class orchestrates a sequence of frame processors, managing
 * their lifecycle and frame routing between them.
 *
 * Key Features:
 * - Sequential processor linking
 * - Automatic source/sink management
 * - Lifecycle coordination (setup/start/stop/cleanup)
 * - Bidirectional frame routing
 * - Metrics collection across processors
 */

import {
  FrameProcessor,
  type FrameProcessorOptions,
  type FrameDirection,
} from "../processors/base";
import { Frame } from "../frames/base";
import { PipelineSource } from "./source";
import { PipelineSink } from "./sink";

/**
 * Configuration options for Pipeline
 */
export interface PipelineOptions extends FrameProcessorOptions {
  /** Optional custom source processor (default: PipelineSource) */
  source?: PipelineSource;
  /** Optional custom sink processor (default: PipelineSink) */
  sink?: PipelineSink;
}

/**
 * Pipeline orchestrates a sequence of frame processors.
 *
 * The Pipeline:
 * - Wraps processors with source and sink endpoints
 * - Links all processors sequentially
 * - Manages lifecycle for all processors
 * - Routes frames to appropriate entry/exit points
 * - Collects metrics from all processors
 *
 * @example
 * ```typescript
 * const pipeline = new Pipeline([
 *   new TranscriptionProcessor(),
 *   new LLMProcessor(),
 *   new TTSProcessor(),
 * ]);
 *
 * await pipeline.start();
 * pipeline.queueFrame(new InputAudioRawFrame(audioData));
 * ```
 */
export class Pipeline extends FrameProcessor {
  private source: PipelineSource;
  private sink: PipelineSink;
  private processors: FrameProcessor[];

  /**
   * Create a new Pipeline with a sequence of processors.
   *
   * @param processors - Array of processors to chain together
   * @param options - Optional configuration including custom source/sink
   */
  constructor(processors: FrameProcessor[], options: PipelineOptions = {}) {
    super({
      ...options,
      name: options.name ?? "Pipeline",
    });

    // Create default source if not provided
    this.source =
      options.source ??
      new PipelineSource({
        name: `${this.name}::Source`,
        upstreamPushFrame: this.handleUpstreamFromSource.bind(this),
      });

    // Create default sink if not provided
    this.sink =
      options.sink ??
      new PipelineSink({
        name: `${this.name}::Sink`,
        downstreamPushFrame: this.handleDownstreamFromSink.bind(this),
      });

    // Build complete processor chain: source -> processors -> sink
    this.processors = [this.source, ...processors, this.sink];

    // Link all processors sequentially
    this.linkProcessors();
  }

  /**
   * Get all processors in the pipeline (including source and sink)
   */
  public getProcessors(): FrameProcessor[] {
    return [...this.processors];
  }

  /**
   * Get the entry processors for the pipeline (source)
   */
  public getEntryProcessors(): FrameProcessor[] {
    return [this.source];
  }

  /**
   * Get all processors that have metrics enabled
   */
  public getProcessorsWithMetrics(): FrameProcessor[] {
    const processorsWithMetrics: FrameProcessor[] = [];

    for (const processor of this.processors) {
      // Check if this processor has metrics
      const metrics = processor.getMetrics();
      if (metrics && Object.keys(metrics).length > 0) {
        processorsWithMetrics.push(processor);
      }
    }

    return processorsWithMetrics;
  }

  /**
   * Setup all processors in the pipeline.
   * Called before start().
   */
  public async setup(): Promise<void> {
    await super.setup();

    // Setup all processors in order
    for (const processor of this.processors) {
      await processor.setup();
    }
  }

  /**
   * Cleanup all processors in the pipeline.
   * Called after stop().
   */
  public async cleanup(): Promise<void> {
    // Cleanup all processors in reverse order
    for (let i = this.processors.length - 1; i >= 0; i--) {
      await this.processors[i].cleanup();
    }

    await super.cleanup();
  }

  /**
   * Start all processors in the pipeline.
   * This begins the frame processing loop for each processor.
   */
  public async start(): Promise<void> {
    // Setup all processors first (establishes connections, etc.)
    await this.setup();

    // Start the pipeline's own processing loop
    await super.start();

    // Start all processors
    for (const processor of this.processors) {
      await processor.start();
    }
  }

  /**
   * Stop all processors in the pipeline.
   * This gracefully shuts down all processors.
   */
  public async stop(): Promise<void> {
    // Stop all processors in reverse order
    for (let i = this.processors.length - 1; i >= 0; i--) {
      await this.processors[i].stop();
    }

    await super.stop();
  }

  /**
   * Process frames coming into the pipeline.
   * Routes frames to the appropriate entry point based on direction.
   *
   * @param frame - The frame to process
   */
  protected async processFrame(frame: Frame): Promise<void> {
    // Frames queued on the pipeline itself are routed to source (downstream entry)
    // This allows external code to push frames into the pipeline
    this.source.queueFrame(frame);
  }

  /**
   * Override pushFrame to route frames based on direction:
   * - Downstream: Queue to source (entry point)
   * - Upstream: Queue to sink (for reverse flow)
   *
   * @param frame - The frame to push
   * @param direction - Direction to push the frame
   */
  public async pushFrame(frame: Frame, direction: FrameDirection = "downstream"): Promise<void> {
    if (direction === "downstream") {
      // Downstream frames enter through the source
      this.source.queueFrame(frame);
    } else {
      // Upstream frames enter through the sink
      this.sink.queueFrame(frame);
    }
  }

  /**
   * Handle frames coming upstream from the source.
   * These are frames that have been sent back from within the pipeline.
   *
   * @param frame - The frame coming upstream
   * @param direction - The direction (should be "upstream")
   */
  private async handleUpstreamFromSource(frame: Frame, direction: FrameDirection): Promise<void> {
    console.log("handleUpstreamFromSource", frame, direction);
    // Frames coming upstream from the source exit the pipeline
    // In a typical setup, this would be handled by an external consumer
    // For now, we just queue it on the pipeline itself
    await super.pushFrame(frame, "upstream");
  }

  /**
   * Handle frames going downstream from the sink.
   * These are frames that have completed processing through the pipeline.
   *
   * @param frame - The frame going downstream
   * @param direction - The direction (should be "downstream")
   */
  private async handleDownstreamFromSink(frame: Frame, _direction: FrameDirection): Promise<void> {
    // Frames exiting the pipeline through the sink
    // In a typical setup, this would be sent to external consumers (speaker, network, etc.)
    // For now, we just queue it on the pipeline itself
    await super.pushFrame(frame, "downstream");
  }

  /**
   * Link all processors in the pipeline sequentially.
   * This creates the chain: source -> processor1 -> processor2 -> ... -> sink
   */
  private linkProcessors(): void {
    for (let i = 0; i < this.processors.length - 1; i++) {
      const current = this.processors[i];
      const next = this.processors[i + 1];
      current.link(next);
    }
  }
}
