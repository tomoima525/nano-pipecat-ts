/**
 * Base frame types for the Pipecat TypeScript implementation.
 *
 * All data flows through the pipeline as Frame objects with unique IDs,
 * timestamps, and metadata support.
 */

/**
 * Global counter for generating unique frame IDs
 */
let frameIdCounter = 0;

/**
 * Per-class instance counters for human-readable naming
 */
const instanceCounters = new Map<string, number>();

/**
 * Generate a unique frame ID
 */
function generateFrameId(): number {
  return ++frameIdCounter;
}

/**
 * Get the instance count for a specific class name
 */
function getInstanceCount(className: string): number {
  const count = (instanceCounters.get(className) ?? 0) + 1;
  instanceCounters.set(className, count);
  return count;
}

/**
 * Format presentation timestamp for display
 */
export function formatPts(pts?: number): string {
  if (pts === undefined || pts === null) {
    return "N/A";
  }
  // Convert nanoseconds to seconds with millisecond precision
  return `${(pts / 1_000_000_000).toFixed(3)}s`;
}

/**
 * Base Frame interface - the fundamental data unit that flows through the entire pipeline.
 *
 * All frames inherit from this base class and automatically receive
 * unique identifiers, names, and metadata support.
 */
export interface IFrame {
  /** Unique identifier for the frame instance */
  readonly id: number;
  /** Human-readable name combining class name and instance count */
  readonly name: string;
  /** Presentation timestamp in nanoseconds */
  pts?: number;
  /** Dictionary for arbitrary frame metadata */
  metadata: Record<string, unknown>;
  /** Name of the transport source that created this frame */
  transportSource?: string;
  /** Name of the transport destination for this frame */
  transportDestination?: string;
}

/**
 * Abstract base class for all frames in the Pipecat pipeline.
 */
export abstract class Frame implements IFrame {
  readonly id: number;
  readonly name: string;
  pts?: number;
  metadata: Record<string, unknown>;
  transportSource?: string;
  transportDestination?: string;

  constructor() {
    this.id = generateFrameId();
    this.name = `${this.constructor.name}#${getInstanceCount(this.constructor.name)}`;
    this.metadata = {};
  }

  toString(): string {
    return this.name;
  }
}

/**
 * Data frame class for processing data in order.
 *
 * A frame that is processed in order and usually contains data such as LLM
 * context, text, audio, or images. Data frames are cancelled by user
 * interruptions.
 */
export abstract class DataFrame extends Frame {
  constructor() {
    super();
  }
}

/**
 * System frame class for immediate processing.
 *
 * A frame that takes higher priority than other frames. System frames are
 * handled in order and are not affected by user interruptions. These frames
 * bypass normal queues and are processed immediately.
 */
export abstract class SystemFrame extends Frame {
  constructor() {
    super();
  }
}

/**
 * Control frame class for processing control information in order.
 *
 * A frame that, similar to data frames, is processed in order and usually
 * contains control information such as update settings or to end the pipeline
 * after everything is flushed. Control frames are cancelled by user
 * interruptions.
 */
export abstract class ControlFrame extends Frame {
  constructor() {
    super();
  }
}

/**
 * Type guard to check if a frame is a DataFrame
 */
export function isDataFrame(frame: Frame): frame is DataFrame {
  return frame instanceof DataFrame;
}

/**
 * Type guard to check if a frame is a SystemFrame
 */
export function isSystemFrame(frame: Frame): frame is SystemFrame {
  return frame instanceof SystemFrame;
}

/**
 * Type guard to check if a frame is a ControlFrame
 */
export function isControlFrame(frame: Frame): frame is ControlFrame {
  return frame instanceof ControlFrame;
}

/**
 * Reset frame counters - useful for testing
 */
export function resetFrameCounters(): void {
  frameIdCounter = 0;
  instanceCounters.clear();
}

