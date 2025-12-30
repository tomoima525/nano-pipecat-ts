import { LLMService, LLMResult, type LLMServiceOptions } from "./base";
import { ChatMessage, LLMTool } from "../../frames/control";

/**
 * Supported OpenAI models.
 */
export type OpenAIModel =
  | "gpt-4.1"
  | "gpt-4.1-mini"
  | "gpt-4"
  | "gpt-4-turbo"
  | "gpt-4o"
  | "gpt-4o-mini"
  | "gpt-3.5-turbo"
  | "o1"
  | "o1-mini"
  | "o1-preview"
  | string;

/**
 * OpenAI API message format.
 */
interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "function" | "tool";
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/**
 * OpenAI API tool format.
 */
interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * OpenAI API response format.
 */
interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  error?: {
    message: string;
    type: string;
    code: string;
  };
}

/**
 * Options for configuring OpenAI LLM service.
 */
export interface OpenAILLMOptions extends Omit<LLMServiceOptions, "modelId"> {
  /** OpenAI API key */
  apiKey: string;
  /** Model to use for generation */
  model?: OpenAIModel;
  /** Organization ID (optional) */
  organizationId?: string;
  /** Override API endpoint (for testing or Azure OpenAI) */
  endpoint?: string;
  /** Custom fetch implementation (for testing) */
  fetch?: typeof fetch;
  /** API version for Azure OpenAI */
  apiVersion?: string;
}

/**
 * OpenAI LLM Service.
 *
 * Uses OpenAI's Chat Completions API for text generation.
 *
 * @example
 * ```typescript
 * const llm = new OpenAILLMService({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: "gpt-4o",
 *   systemPrompt: "You are a helpful assistant.",
 * });
 * ```
 */
export class OpenAILLMService extends LLMService {
  private readonly apiKey: string;
  private readonly model: OpenAIModel;
  private readonly organizationId?: string;
  private readonly endpoint: string;
  private readonly fetchImpl?: typeof fetch;
  private readonly apiVersion?: string;

  constructor(options: OpenAILLMOptions) {
    super({
      ...options,
      name: options.name ?? "OpenAILLMService",
      modelId: options.model ?? "gpt-4.1",
      enableLogging: true,
    });

    this.apiKey = options.apiKey;
    this.model = options.model ?? "gpt-4.1";
    this.organizationId = options.organizationId;
    this.endpoint = options.endpoint ?? "https://api.openai.com/v1/chat/completions";
    this.fetchImpl = options.fetch;
    this.apiVersion = options.apiVersion;
  }

  /**
   * Convert internal ChatMessage format to OpenAI API format.
   */
  private toOpenAIMessages(messages: ChatMessage[]): OpenAIMessage[] {
    return messages.map(msg => {
      if (msg.role === "function") {
        return {
          role: "tool" as const,
          content: msg.content,
          tool_call_id: msg.name ?? "unknown",
        };
      }
      return {
        role: msg.role,
        content: msg.content,
      };
    });
  }

  /**
   * Convert internal LLMTool format to OpenAI API format.
   */
  private toOpenAITools(tools: LLMTool[]): OpenAITool[] {
    return tools.map(tool => ({
      type: "function" as const,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    }));
  }

  /**
   * Generate text using OpenAI Chat Completions API.
   *
   * @param messages - The conversation context
   * @returns Promise resolving to LLM result with generated text
   */
  protected async runLLM(messages: ChatMessage[]): Promise<LLMResult> {
    const fetchFn = this.fetchImpl ?? globalThis.fetch;
    if (!fetchFn) {
      throw new Error("Fetch implementation is not available for OpenAILLMService.");
    }
    console.log("Running LLM with messages:", JSON.stringify(messages, null, 2));
    const openAIMessages = this.toOpenAIMessages(messages);

    const requestBody: Record<string, unknown> = {
      model: this.model,
      messages: openAIMessages,
    };

    // Add optional parameters if set
    if (this.maxTokens !== undefined) {
      requestBody.max_tokens = this.maxTokens;
    }
    if (this.temperature !== undefined) {
      requestBody.temperature = this.temperature;
    }
    if (this.topP !== undefined) {
      requestBody.top_p = this.topP;
    }
    if (this.frequencyPenalty !== undefined) {
      requestBody.frequency_penalty = this.frequencyPenalty;
    }
    if (this.presencePenalty !== undefined) {
      requestBody.presence_penalty = this.presencePenalty;
    }

    // Add tools if available
    if (this.tools.length > 0) {
      requestBody.tools = this.toOpenAITools(this.tools);

      // Add tool_choice if not auto (auto is the default)
      if (this.toolChoice !== "auto") {
        requestBody.tool_choice = this.toolChoice;
      }
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
    };

    if (this.organizationId) {
      headers["OpenAI-Organization"] = this.organizationId;
    }

    // Add API version header for Azure OpenAI
    if (this.apiVersion) {
      headers["api-version"] = this.apiVersion;
    }

    const response = await fetchFn(this.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      let errorMessage = `OpenAI request failed: ${response.status} ${response.statusText}`;
      try {
        const errorData = (await response.json()) as OpenAIResponse;
        if (errorData.error) {
          errorMessage += ` - ${errorData.error.message}`;
        }
      } catch {
        // Ignore JSON parse errors for error response
      }
      throw new Error(errorMessage);
    }

    const data = (await response.json()) as OpenAIResponse;

    if (!data.choices || data.choices.length === 0) {
      throw new Error("OpenAI response contained no choices");
    }

    const choice = data.choices[0];
    const message = choice.message;

    // Parse function calls if present
    let functionCalls: LLMResult["functionCalls"];
    if (message.tool_calls && message.tool_calls.length > 0) {
      functionCalls = message.tool_calls.map(tc => ({
        callId: tc.id,
        name: tc.function.name,
        arguments: JSON.parse(tc.function.arguments),
      }));
    }

    return {
      text: message.content ?? "",
      functionCalls,
      usage: data.usage
        ? {
            promptTokens: data.usage.prompt_tokens,
            completionTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
    };
  }
}
