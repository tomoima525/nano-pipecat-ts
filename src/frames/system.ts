/**
 * System Frames - High priority frames that are processed immediately.
 *
 * System frames bypass normal queues and are not affected by user interruptions.
 * They are used for pipeline lifecycle management and critical control operations.
 */

import { SystemFrame } from "./base";

/**
 * Frame indicating pipeline should start processing.
 *
 * Signals the beginning of pipeline processing. This frame is sent at the
 * start of a pipeline run and should be handled by all processors to
 * initialize their state.
 *
 * @example
 * ```typescript
 * const startFrame = new StartFrame();
 * await pipeline.pushFrame(startFrame);
 * ```
 */
export class StartFrame extends SystemFrame {
  /** Whether to allow interruptions during processing */
  readonly allowInterruptions: boolean;
  /** Whether to enable pipeline metrics collection */
  readonly enableMetrics: boolean;
  /** Whether to enable usage tracking */
  readonly enableUsage: boolean;
  /** Report only initial metrics */
  readonly reportOnlyInitialTTFB: boolean;

  constructor(options?: {
    allowInterruptions?: boolean;
    enableMetrics?: boolean;
    enableUsage?: boolean;
    reportOnlyInitialTTFB?: boolean;
  }) {
    super();
    this.allowInterruptions = options?.allowInterruptions ?? true;
    this.enableMetrics = options?.enableMetrics ?? false;
    this.enableUsage = options?.enableUsage ?? false;
    this.reportOnlyInitialTTFB = options?.reportOnlyInitialTTFB ?? false;
  }

  override toString(): string {
    return `${this.name}(allowInterruptions: ${this.allowInterruptions})`;
  }
}

/**
 * Frame indicating pipeline should stop immediately.
 *
 * Indicates that a pipeline needs to stop right away without processing
 * remaining queued frames. This is used for immediate pipeline termination
 * scenarios such as critical errors or forced shutdowns.
 *
 * @example
 * ```typescript
 * const cancelFrame = new CancelFrame("User requested cancellation");
 * await pipeline.pushFrame(cancelFrame);
 * ```
 */
export class CancelFrame extends SystemFrame {
  /** Optional reason for pushing a cancel frame */
  readonly reason?: string;

  constructor(reason?: string) {
    super();
    this.reason = reason;
  }

  override toString(): string {
    return `${this.name}(reason: ${this.reason ?? "N/A"})`;
  }
}

/**
 * Frame containing error information.
 *
 * Used to propagate errors through the pipeline. Can be marked as fatal
 * to indicate that the pipeline should terminate, or non-fatal for
 * recoverable errors.
 *
 * @example
 * ```typescript
 * // Non-fatal error
 * const errorFrame = new ErrorFrame("Connection timeout", false);
 *
 * // Fatal error
 * const fatalError = new ErrorFrame("Critical system failure", true);
 * ```
 */
export class ErrorFrame extends SystemFrame {
  /** Error message or description */
  readonly error: string;
  /** Whether this error is fatal and should stop the pipeline */
  readonly fatal: boolean;

  constructor(error: string, fatal: boolean = false) {
    super();
    this.error = error;
    this.fatal = fatal;
  }

  override toString(): string {
    return `${this.name}(error: ${this.error}, fatal: ${this.fatal})`;
  }
}

/**
 * Frame indicating user interruption occurred.
 *
 * Sent when a user interrupts the current processing, typically by starting
 * to speak while the bot is responding. This triggers cancellation of
 * in-progress data frames and may reset certain processing states.
 *
 * @example
 * ```typescript
 * // When user starts speaking during bot response
 * const interruptionFrame = new InterruptionFrame();
 * await processor.pushFrame(interruptionFrame, 'upstream');
 * ```
 */
export class InterruptionFrame extends SystemFrame {
  constructor() {
    super();
  }
}

/**
 * Frame to stop the pipeline after all frames are processed.
 *
 * Unlike CancelFrame which stops immediately, StopFrame allows the pipeline
 * to finish processing all queued frames before stopping gracefully.
 */
export class StopFrame extends SystemFrame {
  constructor() {
    super();
  }
}

/**
 * Frame indicating metrics should be reported.
 *
 * Used to trigger metrics collection and reporting within the pipeline.
 */
export class MetricsFrame extends SystemFrame {
  /** Processor that generated these metrics */
  readonly processor: string;
  /** Metrics data */
  readonly metrics: Record<string, unknown>;

  constructor(processor: string, metrics: Record<string, unknown>) {
    super();
    this.processor = processor;
    this.metrics = metrics;
  }

  override toString(): string {
    return `${this.name}(processor: ${this.processor})`;
  }
}

/**
 * Frame to pause frame processing for a specific processor.
 *
 * When sent, this frame pauses the target processor. Frames received
 * while paused are queued and will be processed when the processor
 * is resumed with FrameProcessorResumeFrame.
 */
export class FrameProcessorPauseFrame extends SystemFrame {
  /** Identifier of the processor to pause */
  readonly processorId: string;

  constructor(processorId: string) {
    super();
    this.processorId = processorId;
  }

  override toString(): string {
    return `${this.name}(processor: ${this.processorId})`;
  }
}

/**
 * Frame to resume frame processing for a specific processor.
 *
 * When sent, this frame resumes a previously paused processor.
 * All queued frames will be processed in the order received.
 */
export class FrameProcessorResumeFrame extends SystemFrame {
  /** Identifier of the processor to resume */
  readonly processorId: string;

  constructor(processorId: string) {
    super();
    this.processorId = processorId;
  }

  override toString(): string {
    return `${this.name}(processor: ${this.processorId})`;
  }
}

// Type guards for system frames

export function isStartFrame(frame: unknown): frame is StartFrame {
  return frame instanceof StartFrame;
}

export function isCancelFrame(frame: unknown): frame is CancelFrame {
  return frame instanceof CancelFrame;
}

export function isErrorFrame(frame: unknown): frame is ErrorFrame {
  return frame instanceof ErrorFrame;
}

export function isInterruptionFrame(frame: unknown): frame is InterruptionFrame {
  return frame instanceof InterruptionFrame;
}

export function isStopFrame(frame: unknown): frame is StopFrame {
  return frame instanceof StopFrame;
}

export function isMetricsFrame(frame: unknown): frame is MetricsFrame {
  return frame instanceof MetricsFrame;
}

