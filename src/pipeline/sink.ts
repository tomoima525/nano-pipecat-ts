/**
 * Pipeline Sink
 *
 * The PipelineSink is the exit point for frames leaving the pipeline.
 * It receives processed frames from the pipeline and routes them to external consumers.
 *
 * Key Features:
 * - Exit point for downstream frames
 * - Routes upstream frames back into the pipeline
 * - Enables bidirectional communication
 */

import { FrameProcessor, type FrameProcessorOptions, type FrameDirection } from "../processors/base";
import { Frame } from "../frames/base";

/**
 * Callback function type for pushing frames downstream from the sink
 */
export type DownstreamPushFrameCallback = (frame: Frame, direction: FrameDirection) => Promise<void>;

/**
 * Configuration options for PipelineSink
 */
export interface PipelineSinkOptions extends FrameProcessorOptions {
  /** Callback function to handle frames going downstream from the pipeline */
  downstreamPushFrame: DownstreamPushFrameCallback;
}

/**
 * PipelineSink serves as the exit point for frames leaving the pipeline.
 *
 * This processor:
 * - Receives processed frames from the last processor in the pipeline
 * - Routes downstream frames to external consumers via callback
 * - Routes upstream frames back into the pipeline
 *
 * @example
 * ```typescript
 * const sink = new PipelineSink({
 *   downstreamPushFrame: async (frame, direction) => {
 *     // Handle frames leaving the pipeline
 *     console.log("Pipeline output:", frame);
 *     // Send to external consumer (speaker, network, etc.)
 *   }
 * });
 * ```
 */
export class PipelineSink extends FrameProcessor {
  private downstreamPushFrame: DownstreamPushFrameCallback;

  constructor(options: PipelineSinkOptions) {
    super({
      ...options,
      name: options.name ?? "PipelineSink",
    });
    this.downstreamPushFrame = options.downstreamPushFrame;
  }

  /**
   * Process frames and route them based on direction:
   * - Downstream frames: Send to external callback
   * - Upstream frames: Pass back to previous processor in pipeline
   *
   * @param frame - The frame to process
   */
  protected async processFrame(frame: Frame): Promise<void> {
    // For sink, downstream frames go to external callback
    // This will be handled in pushFrame override
    await this.pushFrame(frame, "downstream");
  }

  /**
   * Override pushFrame to handle downstream routing to external callback
   *
   * @param frame - The frame to push
   * @param direction - Direction to push the frame
   */
  public async pushFrame(frame: Frame, direction: FrameDirection = "downstream"): Promise<void> {
    if (direction === "downstream") {
      // Frames exiting the pipeline are sent to the external callback
      await this.downstreamPushFrame(frame, direction);
    } else {
      // Frames going upstream are passed back to the previous processor
      await super.pushFrame(frame, direction);
    }
  }
}
