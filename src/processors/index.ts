/**
 * Processors module - Base classes and utilities for frame processing
 */

export {
  FrameProcessor,
  type FrameProcessorOptions,
  type FrameDirection,
  resetProcessorIdCounter,
} from "./base";

export { SimpleVADProcessor, type SimpleVADProcessorOptions } from "./vad";
