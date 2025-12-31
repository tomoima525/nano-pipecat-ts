import { Frame } from "../../frames/base";
import { TextFrame, TranscriptionFrame } from "../../frames/data";
import {
  ChatMessage,
  LLMFullResponseStartFrame,
  LLMFullResponseEndFrame,
  LLMMessagesAppendFrame,
  LLMMessagesUpdateFrame,
  LLMRunFrame,
  LLMSetToolsFrame,
  LLMSetToolChoiceFrame,
  LLMConfigureOutputFrame,
  FunctionCallFrame,
  FunctionCallResultFrame,
  LLMTool,
} from "../../frames/control";
import { FrameProcessor, type FrameProcessorOptions } from "../../processors/base";

/**
 * Result returned by LLM implementations.
 */
export interface LLMResult {
  /** Generated text response */
  text: string;
  /** Whether this is a partial/streaming result */
  partial?: boolean;
  /** Function calls if any */
  functionCalls?: Array<{
    callId: string;
    name: string;
    arguments: Record<string, unknown>;
  }>;
  /** Token usage information */
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Options for configuring LLM services.
 */
export interface LLMServiceOptions extends FrameProcessorOptions {
  /** Model identifier for the LLM service */
  modelId?: string;
  /** System prompt to prepend to conversations */
  systemPrompt?: string;
  /** Maximum tokens to generate */
  maxTokens?: number;
  /** Temperature for response generation (0-2) */
  temperature?: number;
  /** Top-p sampling parameter */
  topP?: number;
  /** Frequency penalty (-2 to 2) */
  frequencyPenalty?: number;
  /** Presence penalty (-2 to 2) */
  presencePenalty?: number;
  /** Whether to skip TTS for LLM output */
  skipTts?: boolean;
  /** Available tools for function calling */
  tools?: LLMTool[];
  /** Tool choice configuration */
  toolChoice?: "auto" | "none" | "required" | { type: "function"; function: { name: string } };
}

/**
 * Abstract LLM (Large Language Model) service.
 *
 * Subclasses implement the provider-specific {@link runLLM} method. This base
 * class handles context management, TranscriptionFrame ingestion, and emits
 * LLMFullResponseStartFrame, TextFrame, and LLMFullResponseEndFrame downstream.
 *
 * @example
 * ```typescript
 * class MyLLMService extends LLMService {
 *   protected async runLLM(messages: ChatMessage[]): Promise<LLMResult> {
 *     // Call LLM API and return response
 *     const response = await myLLMAPI.chat(messages);
 *     return { text: response.content };
 *   }
 * }
 * ```
 */
export abstract class LLMService extends FrameProcessor {
  /** Conversation context (message history) */
  protected context: ChatMessage[] = [];

  /** Model identifier */
  protected readonly modelId?: string;
  /** System prompt */
  protected readonly systemPrompt?: string;
  /** Maximum tokens */
  protected readonly maxTokens?: number;
  /** Temperature */
  protected readonly temperature?: number;
  /** Top-p */
  protected readonly topP?: number;
  /** Frequency penalty */
  protected readonly frequencyPenalty?: number;
  /** Presence penalty */
  protected readonly presencePenalty?: number;

  /** Whether to skip TTS for output */
  protected skipTts: boolean;
  /** Available tools */
  protected tools: LLMTool[] = [];
  /** Tool choice configuration */
  protected toolChoice:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } } = "auto";

  constructor(options: LLMServiceOptions = {}) {
    super({ ...options, name: options.name ?? "LLMService" });
    this.modelId = options.modelId;
    this.systemPrompt = options.systemPrompt;
    this.maxTokens = options.maxTokens;
    this.temperature = options.temperature;
    this.topP = options.topP;
    this.frequencyPenalty = options.frequencyPenalty;
    this.presencePenalty = options.presencePenalty;
    this.skipTts = options.skipTts ?? false;
    this.tools = options.tools ?? [];
    this.toolChoice = options.toolChoice ?? "auto";

    // Initialize context with system prompt if provided
    if (this.systemPrompt) {
      this.context.push({
        role: "system",
        content: this.systemPrompt,
      });
    }
  }

  /**
   * Provider-specific LLM implementation. Should return generated text.
   *
   * @param messages - The conversation context
   * @returns Promise resolving to LLM result with generated text
   */
  protected abstract runLLM(messages: ChatMessage[]): Promise<LLMResult>;

  /**
   * Get the current conversation context.
   */
  public getContext(): ChatMessage[] {
    return [...this.context];
  }

  /**
   * Set the conversation context.
   */
  public setContext(messages: ChatMessage[]): void {
    this.context = [...messages];
  }

  /**
   * Append messages to the context.
   */
  public appendContext(messages: ChatMessage[]): void {
    this.context.push(...messages);
  }

  /**
   * Clear the conversation context.
   */
  public clearContext(): void {
    this.context = [];
    // Re-add system prompt if present
    if (this.systemPrompt) {
      this.context.push({
        role: "system",
        content: this.systemPrompt,
      });
    }
  }

  /**
   * Build messages array for LLM call, including any pending function results.
   */
  protected buildMessages(): ChatMessage[] {
    return [...this.context];
  }

  /**
   * Process incoming frames. TranscriptionFrames trigger LLM generation,
   * control frames manage context and tools.
   *
   * @param frame - The frame to process
   */
  protected async processFrame(frame: Frame): Promise<void> {
    // Handle TranscriptionFrame - add to context and run LLM
    if (frame instanceof TranscriptionFrame) {
      const text = frame.text;

      // Skip empty transcriptions
      if (!text || text.trim().length === 0) {
        return;
      }

      // Push transcription downstream first so output transport can send it to client
      await this.pushFrame(frame, "downstream");

      // Add user message to context
      this.context.push({
        role: "user",
        content: text,
      });

      // Generate response
      await this.generateResponse();
      return;
    }

    // Handle LLMMessagesAppendFrame - append messages to context
    if (frame instanceof LLMMessagesAppendFrame) {
      this.context.push(...frame.messages);

      if (frame.runLlm) {
        await this.generateResponse();
      }
      return;
    }

    // Handle LLMMessagesUpdateFrame - replace context with new messages
    if (frame instanceof LLMMessagesUpdateFrame) {
      this.context = [...frame.messages];

      // Re-add system prompt at the beginning if present and not in new messages
      if (this.systemPrompt && !frame.messages.some(m => m.role === "system")) {
        this.context.unshift({
          role: "system",
          content: this.systemPrompt,
        });
      }

      if (frame.runLlm) {
        await this.generateResponse();
      }
      return;
    }

    // Handle LLMRunFrame - trigger LLM generation
    if (frame instanceof LLMRunFrame) {
      await this.generateResponse();
      return;
    }

    // Handle LLMSetToolsFrame - update available tools
    if (frame instanceof LLMSetToolsFrame) {
      this.tools = [...frame.tools];
      return;
    }

    // Handle LLMSetToolChoiceFrame - update tool choice
    if (frame instanceof LLMSetToolChoiceFrame) {
      this.toolChoice = frame.toolChoice;
      return;
    }

    // Handle LLMConfigureOutputFrame - update output configuration
    if (frame instanceof LLMConfigureOutputFrame) {
      this.skipTts = frame.skipTts;
      return;
    }

    // Handle FunctionCallResultFrame - add function result to context and run LLM
    if (frame instanceof FunctionCallResultFrame) {
      this.context.push({
        role: "function",
        name: frame.functionName,
        content: JSON.stringify(frame.result),
      });

      // Generate response after receiving function result
      await this.generateResponse();
      return;
    }

    // Pass through any other frames unchanged
    await this.pushFrame(frame, "downstream");
  }

  /**
   * Generate an LLM response and emit appropriate frames.
   */
  protected async generateResponse(): Promise<void> {
    // Signal LLM response start
    const startFrame = new LLMFullResponseStartFrame();
    startFrame.skipTts = this.skipTts;
    await this.pushFrame(startFrame, "downstream");

    try {
      // Run LLM generation
      const result = await this.runLLM(this.buildMessages());

      // Handle function calls
      if (result.functionCalls && result.functionCalls.length > 0) {
        for (const call of result.functionCalls) {
          const functionCallFrame = new FunctionCallFrame(
            call.callId,
            call.name,
            call.arguments
          );
          await this.pushFrame(functionCallFrame, "downstream");
        }
      }

      // Push text response if present
      if (result.text && result.text.length > 0) {
        // Add assistant message to context
        this.context.push({
          role: "assistant",
          content: result.text,
        });

        // Push text frame
        const textFrame = new TextFrame(result.text);
        textFrame.skipTts = this.skipTts;
        await this.pushFrame(textFrame, "downstream");
      }
    } finally {
      // Signal LLM response end (even on error)
      const endFrame = new LLMFullResponseEndFrame();
      endFrame.skipTts = this.skipTts;
      await this.pushFrame(endFrame, "downstream");
    }
  }
}
