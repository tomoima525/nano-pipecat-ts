/**
 * Pipecat TypeScript - Frame System
 *
 * The frame system is the fundamental data unit that flows through the entire
 * pipeline. All data is encapsulated in frames that carry content, metadata,
 * and processing information through the pipeline.
 *
 * Frame Categories:
 * - SystemFrame: High-priority control frames processed immediately
 * - DataFrame: Content carrier frames processed in order
 * - ControlFrame: Flow control frames processed in order
 *
 * @module frames
 */

// Base frame types and utilities
export {
  Frame,
  DataFrame,
  SystemFrame,
  ControlFrame,
  formatPts,
  resetFrameCounters,
  isDataFrame,
  isSystemFrame,
  isControlFrame,
} from "./base";

export type { IFrame } from "./base";

// System frames - High priority, processed immediately
export {
  StartFrame,
  CancelFrame,
  ErrorFrame,
  InterruptionFrame,
  StopFrame,
  MetricsFrame,
  FrameProcessorPauseFrame,
  FrameProcessorResumeFrame,
  // Type guards
  isStartFrame,
  isCancelFrame,
  isErrorFrame,
  isInterruptionFrame,
  isStopFrame,
  isMetricsFrame,
} from "./system";

// Data frames - Content carriers
export {
  // Audio frames
  AudioRawFrame,
  InputAudioRawFrame,
  OutputAudioRawFrame,
  TTSAudioRawFrame,
  // Text frames
  TextFrame,
  TranscriptionFrame,
  InterimTranscriptionFrame,
  LLMTextFrame,
  // Image frames
  ImageRawFrame,
  // Speaking state frames
  UserStartedSpeakingFrame,
  UserStoppedSpeakingFrame,
  BotStartedSpeakingFrame,
  BotStoppedSpeakingFrame,
  // Transport message frames
  InputTransportMessageFrame,
  OutputTransportMessageFrame,
  OutputTransportMessageUrgentFrame,
  // Type guards
  isInputAudioRawFrame,
  isOutputAudioRawFrame,
  isTTSAudioRawFrame,
  isTextFrame,
  isTranscriptionFrame,
  isInterimTranscriptionFrame,
  isLLMTextFrame,
  isImageRawFrame,
  isUserStartedSpeakingFrame,
  isUserStoppedSpeakingFrame,
  isBotStartedSpeakingFrame,
  isBotStoppedSpeakingFrame,
  isInputTransportMessageFrame,
  isOutputTransportMessageFrame,
} from "./data";

export type { AudioConfig, Language } from "./data";

// Control frames - Flow control
export {
  EndFrame,
  TTSStartedFrame,
  TTSStoppedFrame,
  LLMFullResponseStartFrame,
  LLMFullResponseEndFrame,
  FunctionCallFrame,
  FunctionCallResultFrame,
  LLMConfigureOutputFrame,
  LLMRunFrame,
  LLMMessagesAppendFrame,
  LLMMessagesUpdateFrame,
  LLMSetToolsFrame,
  LLMSetToolChoiceFrame,
  LLMUpdateSettingsFrame,
  STTUpdateSettingsFrame,
  TTSUpdateSettingsFrame,
  // Type guards
  isEndFrame,
  isTTSStartedFrame,
  isTTSStoppedFrame,
  isLLMFullResponseStartFrame,
  isLLMFullResponseEndFrame,
  isFunctionCallFrame,
  isFunctionCallResultFrame,
  isLLMRunFrame,
  isLLMMessagesAppendFrame,
  isLLMMessagesUpdateFrame,
  isLLMSetToolsFrame,
  isLLMConfigureOutputFrame,
} from "./control";

export type { ChatMessage, LLMTool } from "./control";

/**
 * Direction of frame flow in the pipeline
 */
export enum FrameDirection {
  /** Frame flows from input to output */
  DOWNSTREAM = "downstream",
  /** Frame flows from output to input (for interruptions, errors) */
  UPSTREAM = "upstream",
}

