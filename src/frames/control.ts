/**
 * Control Frames - Flow control frames processed in order.
 *
 * Control frames manage the flow of data through the pipeline, signaling
 * events like the end of processing, TTS state changes, and LLM response
 * boundaries. Unlike system frames, control frames are cancelled by user
 * interruptions.
 */

import { ControlFrame, Frame } from "./base";

/**
 * Frame indicating processing completion.
 *
 * Signals that all processing is complete and the pipeline should finish
 * gracefully. Unlike CancelFrame, EndFrame allows all queued frames to
 * be processed before shutdown.
 *
 * @example
 * ```typescript
 * // End the pipeline gracefully after processing completes
 * const endFrame = new EndFrame();
 * await pipeline.pushFrame(endFrame);
 * ```
 */
export class EndFrame extends ControlFrame {
  constructor() {
    super();
  }
}

/**
 * Frame indicating TTS processing has started.
 *
 * Sent when a TTS service begins generating audio. This frame is used
 * to track TTS state and manage audio output coordination.
 *
 * @example
 * ```typescript
 * // Signal start of TTS audio generation
 * await this.pushFrame(new TTSStartedFrame());
 * const audio = await this.runTTS(text);
 * ```
 */
export class TTSStartedFrame extends ControlFrame {
  constructor() {
    super();
  }
}

/**
 * Frame indicating TTS processing has stopped.
 *
 * Sent when a TTS service completes audio generation. This frame is used
 * to track TTS state and trigger downstream processing.
 *
 * @example
 * ```typescript
 * // Signal end of TTS audio generation
 * await this.pushFrame(new OutputAudioRawFrame(audio));
 * await this.pushFrame(new TTSStoppedFrame());
 * ```
 */
export class TTSStoppedFrame extends ControlFrame {
  constructor() {
    super();
  }
}

/**
 * Frame indicating the beginning of an LLM response.
 *
 * Used to signal the start of an LLM response. This is followed by one or
 * more TextFrames containing the response content, and concluded with an
 * LLMFullResponseEndFrame.
 *
 * @example
 * ```typescript
 * await this.pushFrame(new LLMFullResponseStartFrame());
 * for await (const chunk of llmStream) {
 *   await this.pushFrame(new TextFrame(chunk));
 * }
 * await this.pushFrame(new LLMFullResponseEndFrame());
 * ```
 */
export class LLMFullResponseStartFrame extends ControlFrame {
  /** Whether this response should skip TTS processing */
  skipTts: boolean;

  constructor() {
    super();
    this.skipTts = false;
  }
}

/**
 * Frame indicating the end of an LLM response.
 *
 * Used to signal the completion of an LLM response that was started
 * with LLMFullResponseStartFrame.
 */
export class LLMFullResponseEndFrame extends ControlFrame {
  /** Whether this response should skip TTS processing */
  skipTts: boolean;

  constructor() {
    super();
    this.skipTts = false;
  }
}

/**
 * Frame containing function call information from LLM.
 *
 * Sent when an LLM returns a function call that should be executed.
 */
export class FunctionCallFrame extends ControlFrame {
  /** Unique identifier for this function call */
  readonly callId: string;
  /** Name of the function to call */
  readonly functionName: string;
  /** Arguments to pass to the function */
  readonly arguments: Record<string, unknown>;

  constructor(callId: string, functionName: string, args: Record<string, unknown>) {
    super();
    this.callId = callId;
    this.functionName = functionName;
    this.arguments = args;
  }

  override toString(): string {
    return `${this.name}(callId: ${this.callId}, function: ${this.functionName})`;
  }
}

/**
 * Frame containing function call result.
 *
 * Sent after executing a function call, containing the result to be
 * sent back to the LLM.
 */
export class FunctionCallResultFrame extends ControlFrame {
  /** ID of the function call this result belongs to */
  readonly callId: string;
  /** Name of the function that was called */
  readonly functionName: string;
  /** Result of the function call */
  readonly result: unknown;

  constructor(callId: string, functionName: string, result: unknown) {
    super();
    this.callId = callId;
    this.functionName = functionName;
    this.result = result;
  }

  override toString(): string {
    return `${this.name}(callId: ${this.callId}, function: ${this.functionName})`;
  }
}

/**
 * Frame to configure LLM output behavior.
 *
 * Used to dynamically configure whether LLM output should skip TTS processing.
 */
export class LLMConfigureOutputFrame extends ControlFrame {
  /** Whether LLM output should skip TTS */
  readonly skipTts: boolean;

  constructor(skipTts: boolean) {
    super();
    this.skipTts = skipTts;
  }

  override toString(): string {
    return `${this.name}(skipTts: ${this.skipTts})`;
  }
}

/**
 * Frame to trigger LLM processing.
 *
 * Sent to instruct an LLM service to generate a response based on
 * the current context.
 */
export class LLMRunFrame extends ControlFrame {
  constructor() {
    super();
  }
}

/**
 * Chat message structure for LLM context
 */
export interface ChatMessage {
  /** Role of the message author (system, user, assistant) */
  role: "system" | "user" | "assistant" | "function";
  /** Content of the message */
  content: string;
  /** Optional name for function messages */
  name?: string;
}

/**
 * Frame to append messages to LLM context.
 *
 * Used to add new messages to the LLM conversation context.
 */
export class LLMMessagesAppendFrame extends ControlFrame {
  /** Messages to append */
  readonly messages: ChatMessage[];
  /** Whether to run LLM after appending */
  readonly runLlm: boolean;

  constructor(messages: ChatMessage[], runLlm: boolean = false) {
    super();
    this.messages = messages;
    this.runLlm = runLlm;
  }

  override toString(): string {
    return `${this.name}(messages: ${this.messages.length}, runLlm: ${this.runLlm})`;
  }
}

/**
 * Frame to update/replace LLM context messages.
 *
 * Used to replace the entire LLM conversation context.
 */
export class LLMMessagesUpdateFrame extends ControlFrame {
  /** New messages to set */
  readonly messages: ChatMessage[];
  /** Whether to run LLM after updating */
  readonly runLlm: boolean;

  constructor(messages: ChatMessage[], runLlm: boolean = false) {
    super();
    this.messages = messages;
    this.runLlm = runLlm;
  }

  override toString(): string {
    return `${this.name}(messages: ${this.messages.length}, runLlm: ${this.runLlm})`;
  }
}

/**
 * Tool/function definition for LLM
 */
export interface LLMTool {
  /** Type of tool (usually 'function') */
  type: "function";
  /** Function definition */
  function: {
    /** Function name */
    name: string;
    /** Function description */
    description: string;
    /** Parameter schema */
    parameters: Record<string, unknown>;
  };
}

/**
 * Frame to set available tools for LLM.
 *
 * Used to configure which functions the LLM can call.
 */
export class LLMSetToolsFrame extends ControlFrame {
  /** Tools to make available */
  readonly tools: LLMTool[];

  constructor(tools: LLMTool[]) {
    super();
    this.tools = tools;
  }

  override toString(): string {
    return `${this.name}(tools: ${this.tools.length})`;
  }
}

/**
 * Frame to set tool choice for LLM.
 *
 * Used to control how the LLM selects tools.
 */
export class LLMSetToolChoiceFrame extends ControlFrame {
  /** Tool choice configuration */
  readonly toolChoice:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };

  constructor(
    toolChoice: "auto" | "none" | "required" | { type: "function"; function: { name: string } }
  ) {
    super();
    this.toolChoice = toolChoice;
  }

  override toString(): string {
    const choice =
      typeof this.toolChoice === "string" ? this.toolChoice : this.toolChoice.function.name;
    return `${this.name}(toolChoice: ${choice})`;
  }
}

/**
 * Frame containing LLM settings update.
 */
export class LLMUpdateSettingsFrame extends ControlFrame {
  /** Settings to update */
  readonly settings: Record<string, unknown>;

  constructor(settings: Record<string, unknown>) {
    super();
    this.settings = settings;
  }
}

/**
 * Frame for STT settings update.
 */
export class STTUpdateSettingsFrame extends ControlFrame {
  /** Settings to update */
  readonly settings: Record<string, unknown>;

  constructor(settings: Record<string, unknown>) {
    super();
    this.settings = settings;
  }
}

/**
 * Frame for TTS settings update.
 */
export class TTSUpdateSettingsFrame extends ControlFrame {
  /** Settings to update */
  readonly settings: Record<string, unknown>;

  constructor(settings: Record<string, unknown>) {
    super();
    this.settings = settings;
  }
}

// Type guards for control frames

export function isEndFrame(frame: Frame): frame is EndFrame {
  return frame instanceof EndFrame;
}

export function isTTSStartedFrame(frame: Frame): frame is TTSStartedFrame {
  return frame instanceof TTSStartedFrame;
}

export function isTTSStoppedFrame(frame: Frame): frame is TTSStoppedFrame {
  return frame instanceof TTSStoppedFrame;
}

export function isLLMFullResponseStartFrame(frame: Frame): frame is LLMFullResponseStartFrame {
  return frame instanceof LLMFullResponseStartFrame;
}

export function isLLMFullResponseEndFrame(frame: Frame): frame is LLMFullResponseEndFrame {
  return frame instanceof LLMFullResponseEndFrame;
}

export function isFunctionCallFrame(frame: Frame): frame is FunctionCallFrame {
  return frame instanceof FunctionCallFrame;
}

export function isFunctionCallResultFrame(frame: Frame): frame is FunctionCallResultFrame {
  return frame instanceof FunctionCallResultFrame;
}

export function isLLMRunFrame(frame: Frame): frame is LLMRunFrame {
  return frame instanceof LLMRunFrame;
}

export function isLLMMessagesAppendFrame(frame: Frame): frame is LLMMessagesAppendFrame {
  return frame instanceof LLMMessagesAppendFrame;
}

export function isLLMMessagesUpdateFrame(frame: Frame): frame is LLMMessagesUpdateFrame {
  return frame instanceof LLMMessagesUpdateFrame;
}

export function isLLMSetToolsFrame(frame: Frame): frame is LLMSetToolsFrame {
  return frame instanceof LLMSetToolsFrame;
}

export function isLLMConfigureOutputFrame(frame: Frame): frame is LLMConfigureOutputFrame {
  return frame instanceof LLMConfigureOutputFrame;
}
