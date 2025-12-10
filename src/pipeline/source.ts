/**
 * Pipeline Source
 *
 * The PipelineSource is the entry point for frames coming into the pipeline.
 * It receives frames from external sources and routes them into the pipeline.
 *
 * Key Features:
 * - Entry point for downstream frames
 * - Routes upstream frames back to external callback
 * - Enables bidirectional communication
 */

import { FrameProcessor, type FrameProcessorOptions, type FrameDirection } from "../processors/base";
import { Frame } from "../frames/base";

/**
 * Callback function type for pushing frames upstream from the source
 */
export type UpstreamPushFrameCallback = (frame: Frame, direction: FrameDirection) => Promise<void>;

/**
 * Configuration options for PipelineSource
 */
export interface PipelineSourceOptions extends FrameProcessorOptions {
  /** Callback function to handle frames going upstream from the pipeline */
  upstreamPushFrame: UpstreamPushFrameCallback;
}

/**
 * PipelineSource serves as the entry point for frames entering the pipeline.
 *
 * This processor:
 * - Receives frames from external sources (e.g., user input, network)
 * - Routes downstream frames to the first processor in the pipeline
 * - Routes upstream frames back to the external source via callback
 *
 * @example
 * ```typescript
 * const source = new PipelineSource({
 *   upstreamPushFrame: async (frame, direction) => {
 *     // Handle frames coming back from the pipeline
 *     console.log("Received upstream frame:", frame);
 *   }
 * });
 *
 * // Send a frame into the pipeline
 * source.queueFrame(new TextFrame("Hello"));
 * ```
 */
export class PipelineSource extends FrameProcessor {
  private upstreamPushFrame: UpstreamPushFrameCallback;
  private frameDirections = new WeakMap<Frame, FrameDirection>();

  constructor(options: PipelineSourceOptions) {
    super({
      ...options,
      name: options.name ?? "PipelineSource",
    });
    this.upstreamPushFrame = options.upstreamPushFrame;
  }

  /**
   * Override queueFrame to track frame direction using a WeakMap
   */
  public queueFrame(frame: Frame, direction?: FrameDirection): void {
    // Store direction for this frame (default to downstream if not specified)
    this.frameDirections.set(frame, direction || "downstream");
    super.queueFrame(frame);
  }

  /**
   * Process frames and route them based on tracked direction:
   * - Downstream frames: Pass to next processor in pipeline
   * - Upstream frames: Send to external callback
   *
   * @param frame - The frame to process
   */
  protected async processFrame(frame: Frame): Promise<void> {
    // Get direction from WeakMap (default to downstream if not found)
    const direction = this.frameDirections.get(frame) || "downstream";

    // Clean up WeakMap entry
    this.frameDirections.delete(frame);

    if (direction === "upstream") {
      // Frame came from downstream processor, route to external callback
      await this.upstreamPushFrame(frame, "upstream");
    } else {
      // Frame came from pipeline, route downstream to next processor
      await super.pushFrame(frame, "downstream");
    }
  }
}
