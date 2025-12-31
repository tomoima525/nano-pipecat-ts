import { Pipeline } from "../pipeline/pipeline";
import { Frame } from "../frames/base";
import { TextFrame, TranscriptionFrame } from "../frames/data";
import {
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
  ChatMessage,
  LLMTool,
} from "../frames/control";
import { CollectorProcessor, advanceTime } from "./testUtils";
import { LLMResult, LLMService } from "../services/llm/base";
import { OpenAILLMService } from "../services/llm/openai";

class MockLLMService extends LLMService {
  public calls: ChatMessage[][] = [];
  private readonly response: LLMResult;

  constructor(response: LLMResult, systemPrompt?: string) {
    super({ systemPrompt });
    this.response = response;
  }

  protected async runLLM(messages: ChatMessage[]): Promise<LLMResult> {
    this.calls.push([...messages]);
    return this.response;
  }
}

describe("LLMService", () => {
  it("emits LLMFullResponseStartFrame, TextFrame, and LLMFullResponseEndFrame for TranscriptionFrame", async () => {
    const llm = new MockLLMService({ text: "Hello! How can I help you?" });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    await pipeline.start();
    const frame = new TranscriptionFrame(
      "Hello",
      "user-123",
      new Date().toISOString(),
      "en"
    );
    pipeline.queueFrame(frame);

    await advanceTime(30);
    await pipeline.stop();

    const startFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof LLMFullResponseStartFrame
    ) as LLMFullResponseStartFrame | undefined;

    const textFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof TextFrame && !(f instanceof TranscriptionFrame)
    ) as TextFrame | undefined;

    const endFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof LLMFullResponseEndFrame
    ) as LLMFullResponseEndFrame | undefined;

    expect(startFrame).toBeDefined();
    expect(textFrame).toBeDefined();
    expect(textFrame?.text).toBe("Hello! How can I help you?");
    expect(endFrame).toBeDefined();
    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toHaveLength(1);
    expect(llm.calls[0][0].role).toBe("user");
    expect(llm.calls[0][0].content).toBe("Hello");
  });

  it("emits frames in correct order: Started -> Text -> Ended", async () => {
    const llm = new MockLLMService({ text: "Response" });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    await pipeline.start();
    pipeline.queueFrame(new TranscriptionFrame("Test", "user", new Date().toISOString()));

    await advanceTime(30);
    await pipeline.stop();

    const frameTypes = collector.collectedFrames.map(f => f.constructor.name);
    const startIndex = frameTypes.indexOf("LLMFullResponseStartFrame");
    const textIndex = frameTypes.indexOf("TextFrame");
    const endIndex = frameTypes.indexOf("LLMFullResponseEndFrame");

    expect(startIndex).toBeLessThan(textIndex);
    expect(textIndex).toBeLessThan(endIndex);
  });

  it("includes system prompt in context when provided", async () => {
    const llm = new MockLLMService(
      { text: "I'm a helpful assistant." },
      "You are a helpful assistant."
    );
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    await pipeline.start();
    pipeline.queueFrame(new TranscriptionFrame("Hello", "user", new Date().toISOString()));

    await advanceTime(30);
    await pipeline.stop();

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toHaveLength(2);
    expect(llm.calls[0][0].role).toBe("system");
    expect(llm.calls[0][0].content).toBe("You are a helpful assistant.");
    expect(llm.calls[0][1].role).toBe("user");
    expect(llm.calls[0][1].content).toBe("Hello");
  });

  it("maintains conversation context across multiple messages", async () => {
    const llm = new MockLLMService({ text: "Response" });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    await pipeline.start();
    pipeline.queueFrame(new TranscriptionFrame("First", "user", new Date().toISOString()));
    await advanceTime(30);

    pipeline.queueFrame(new TranscriptionFrame("Second", "user", new Date().toISOString()));
    await advanceTime(30);

    await pipeline.stop();

    expect(llm.calls).toHaveLength(2);
    // First call has 1 user message
    expect(llm.calls[0]).toHaveLength(1);
    // Second call has user, assistant, user (context + response + new user message)
    expect(llm.calls[1]).toHaveLength(3);
    expect(llm.calls[1][0].content).toBe("First");
    expect(llm.calls[1][1].role).toBe("assistant");
    expect(llm.calls[1][1].content).toBe("Response");
    expect(llm.calls[1][2].content).toBe("Second");
  });

  it("skips empty transcriptions", async () => {
    const llm = new MockLLMService({ text: "Response" });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    await pipeline.start();
    pipeline.queueFrame(new TranscriptionFrame("", "user", new Date().toISOString()));
    pipeline.queueFrame(new TranscriptionFrame("   ", "user", new Date().toISOString()));

    await advanceTime(30);
    await pipeline.stop();

    expect(llm.calls).toHaveLength(0);
  });

  it("handles LLMMessagesAppendFrame", async () => {
    const llm = new MockLLMService({ text: "Response" });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    await pipeline.start();
    const appendFrame = new LLMMessagesAppendFrame(
      [{ role: "user", content: "Appended message" }],
      true // runLlm
    );
    pipeline.queueFrame(appendFrame);

    await advanceTime(30);
    await pipeline.stop();

    expect(llm.calls).toHaveLength(1);
    expect(llm.calls[0]).toHaveLength(1);
    expect(llm.calls[0][0].content).toBe("Appended message");
  });

  it("handles LLMMessagesUpdateFrame to replace context", async () => {
    const llm = new MockLLMService({ text: "Response" }, "System prompt");
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    await pipeline.start();
    // First add some context
    pipeline.queueFrame(new TranscriptionFrame("First", "user", new Date().toISOString()));
    await advanceTime(30);

    // Then replace it
    const updateFrame = new LLMMessagesUpdateFrame(
      [{ role: "user", content: "New context" }],
      true // runLlm
    );
    pipeline.queueFrame(updateFrame);
    await advanceTime(30);

    await pipeline.stop();

    expect(llm.calls).toHaveLength(2);
    // Second call should have system prompt re-added + new context only
    expect(llm.calls[1]).toHaveLength(2);
    expect(llm.calls[1][0].role).toBe("system");
    expect(llm.calls[1][1].content).toBe("New context");
  });

  it("handles LLMRunFrame to trigger generation", async () => {
    const llm = new MockLLMService({ text: "Response" });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    await pipeline.start();
    // Add context without running
    const appendFrame = new LLMMessagesAppendFrame(
      [{ role: "user", content: "Message" }],
      false // don't run
    );
    pipeline.queueFrame(appendFrame);
    await advanceTime(10);

    // Then trigger generation
    pipeline.queueFrame(new LLMRunFrame());
    await advanceTime(30);

    await pipeline.stop();

    expect(llm.calls).toHaveLength(1);
  });

  it("handles LLMSetToolsFrame", async () => {
    const llm = new MockLLMService({ text: "Response" });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    const tools: LLMTool[] = [
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get weather for a location",
          parameters: { type: "object", properties: { location: { type: "string" } } },
        },
      },
    ];

    await pipeline.start();
    pipeline.queueFrame(new LLMSetToolsFrame(tools));
    await advanceTime(30);
    await pipeline.stop();

    expect((llm as any).tools).toEqual(tools);
  });

  it("handles LLMSetToolChoiceFrame", async () => {
    const llm = new MockLLMService({ text: "Response" });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    await pipeline.start();
    pipeline.queueFrame(new LLMSetToolChoiceFrame("required"));
    await advanceTime(30);
    await pipeline.stop();

    expect((llm as any).toolChoice).toBe("required");
  });

  it("handles LLMConfigureOutputFrame to update skipTts", async () => {
    const llm = new MockLLMService({ text: "Response" });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    await pipeline.start();
    pipeline.queueFrame(new LLMConfigureOutputFrame(true));
    pipeline.queueFrame(new TranscriptionFrame("Test", "user", new Date().toISOString()));
    await advanceTime(30);
    await pipeline.stop();

    const textFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof TextFrame && !(f instanceof TranscriptionFrame)
    ) as TextFrame | undefined;

    expect(textFrame?.skipTts).toBe(true);
  });

  it("emits FunctionCallFrame when LLM returns function calls", async () => {
    const llm = new MockLLMService({
      text: "",
      functionCalls: [
        { callId: "call-1", name: "get_weather", arguments: { location: "NYC" } },
      ],
    });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    await pipeline.start();
    pipeline.queueFrame(new TranscriptionFrame("What's the weather?", "user", new Date().toISOString()));
    await advanceTime(30);
    await pipeline.stop();

    const functionCallFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof FunctionCallFrame
    ) as FunctionCallFrame | undefined;

    expect(functionCallFrame).toBeDefined();
    expect(functionCallFrame?.callId).toBe("call-1");
    expect(functionCallFrame?.functionName).toBe("get_weather");
    expect(functionCallFrame?.arguments).toEqual({ location: "NYC" });
  });

  it("handles FunctionCallResultFrame and continues generation", async () => {
    let callCount = 0;
    class MultipleLLMService extends LLMService {
      public calls: ChatMessage[][] = [];

      protected async runLLM(messages: ChatMessage[]): Promise<LLMResult> {
        this.calls.push([...messages]);
        callCount++;
        if (callCount === 1) {
          return {
            text: "",
            functionCalls: [{ callId: "call-1", name: "get_weather", arguments: { location: "NYC" } }],
          };
        }
        return { text: "The weather in NYC is sunny." };
      }
    }

    const llm = new MultipleLLMService();
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    await pipeline.start();
    pipeline.queueFrame(new TranscriptionFrame("What's the weather?", "user", new Date().toISOString()));
    await advanceTime(30);

    // Simulate function result being pushed back
    pipeline.queueFrame(new FunctionCallResultFrame("call-1", "get_weather", { temp: 72, condition: "sunny" }));
    await advanceTime(30);

    await pipeline.stop();

    expect(llm.calls).toHaveLength(2);
    // Second call should include function result
    const secondCall = llm.calls[1];
    const functionMessage = secondCall.find(m => m.role === "function");
    expect(functionMessage).toBeDefined();
    expect(functionMessage?.name).toBe("get_weather");

    const textFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof TextFrame && f.text === "The weather in NYC is sunny."
    );
    expect(textFrame).toBeDefined();
  });

  it("passes through non-LLM frames unchanged", async () => {
    const llm = new MockLLMService({ text: "Response" });
    const collector = new CollectorProcessor();
    const pipeline = new Pipeline([llm, collector]);

    await pipeline.start();
    const customFrame = new TextFrame("Pass me through");
    pipeline.queueFrame(customFrame);

    await advanceTime(30);
    await pipeline.stop();

    const passedFrame = collector.collectedFrames.find(
      (f: Frame) => f instanceof TextFrame && f.text === "Pass me through"
    );
    expect(passedFrame).toBeDefined();
    expect(llm.calls).toHaveLength(0);
  });
});

describe("OpenAILLMService", () => {
  const createMockResponse = (content: string, toolCalls?: Array<{ id: string; function: { name: string; arguments: string } }>) => ({
    ok: true,
    status: 200,
    statusText: "OK",
    async json() {
      return {
        id: "chatcmpl-123",
        object: "chat.completion",
        created: Date.now(),
        model: "gpt-4.1",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content,
              tool_calls: toolCalls?.map(tc => ({ id: tc.id, type: "function" as const, function: tc.function })),
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };
    },
    async text() {
      return "";
    },
  });

  it("sends messages to OpenAI and returns response", async () => {
    const fetchMock = jest.fn().mockResolvedValue(createMockResponse("Hello from GPT!"));
    const llm = new OpenAILLMService({
      apiKey: "test-key",
      model: "gpt-4.1",
      fetch: fetchMock,
    });

    const result = await llm["runLLM"]([{ role: "user", content: "Hello" }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];

    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test-key",
    });

    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe("gpt-4.1");
    expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);

    expect(result.text).toBe("Hello from GPT!");
    expect(result.usage?.totalTokens).toBe(30);
  });

  it("includes optional parameters when set", async () => {
    const fetchMock = jest.fn().mockResolvedValue(createMockResponse("Response"));
    const llm = new OpenAILLMService({
      apiKey: "test-key",
      model: "gpt-4o",
      maxTokens: 1000,
      temperature: 0.7,
      topP: 0.9,
      frequencyPenalty: 0.5,
      presencePenalty: 0.3,
      fetch: fetchMock,
    });

    await llm["runLLM"]([{ role: "user", content: "Test" }]);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.max_tokens).toBe(1000);
    expect(body.temperature).toBe(0.7);
    expect(body.top_p).toBe(0.9);
    expect(body.frequency_penalty).toBe(0.5);
    expect(body.presence_penalty).toBe(0.3);
  });

  it("includes organization header when provided", async () => {
    const fetchMock = jest.fn().mockResolvedValue(createMockResponse("Response"));
    const llm = new OpenAILLMService({
      apiKey: "test-key",
      organizationId: "org-123",
      fetch: fetchMock,
    });

    await llm["runLLM"]([{ role: "user", content: "Test" }]);

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["OpenAI-Organization"]).toBe("org-123");
  });

  it("includes tools in request when set", async () => {
    const fetchMock = jest.fn().mockResolvedValue(createMockResponse("Response"));
    const llm = new OpenAILLMService({
      apiKey: "test-key",
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object" },
          },
        },
      ],
      toolChoice: "required",
      fetch: fetchMock,
    });

    await llm["runLLM"]([{ role: "user", content: "Test" }]);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe("get_weather");
    expect(body.tool_choice).toBe("required");
  });

  it("parses function calls from response", async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      createMockResponse("", [
        { id: "call-1", function: { name: "get_weather", arguments: '{"location":"NYC"}' } },
      ])
    );
    const llm = new OpenAILLMService({
      apiKey: "test-key",
      fetch: fetchMock,
    });

    const result = await llm["runLLM"]([{ role: "user", content: "What's the weather?" }]);

    expect(result.functionCalls).toHaveLength(1);
    expect(result.functionCalls?.[0].callId).toBe("call-1");
    expect(result.functionCalls?.[0].name).toBe("get_weather");
    expect(result.functionCalls?.[0].arguments).toEqual({ location: "NYC" });
  });

  it("throws error on API failure", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      async json() {
        return { error: { message: "Invalid API key", type: "invalid_request_error", code: "invalid_api_key" } };
      },
    });

    const llm = new OpenAILLMService({
      apiKey: "invalid-key",
      fetch: fetchMock,
    });

    await expect(llm["runLLM"]([{ role: "user", content: "Hello" }])).rejects.toThrow(
      /OpenAI request failed: 401 Unauthorized - Invalid API key/
    );
  });

  it("uses default model when not specified", async () => {
    const fetchMock = jest.fn().mockResolvedValue(createMockResponse("Response"));
    const llm = new OpenAILLMService({
      apiKey: "test-key",
      fetch: fetchMock,
    });

    await llm["runLLM"]([{ role: "user", content: "Test" }]);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.model).toBe("gpt-4.1");
  });

  it("uses custom endpoint when provided", async () => {
    const fetchMock = jest.fn().mockResolvedValue(createMockResponse("Response"));
    const llm = new OpenAILLMService({
      apiKey: "test-key",
      endpoint: "https://custom.api.com/chat",
      fetch: fetchMock,
    });

    await llm["runLLM"]([{ role: "user", content: "Test" }]);

    expect(fetchMock.mock.calls[0][0]).toBe("https://custom.api.com/chat");
  });

  it("converts function messages to tool format", async () => {
    const fetchMock = jest.fn().mockResolvedValue(createMockResponse("Weather is sunny"));
    const llm = new OpenAILLMService({
      apiKey: "test-key",
      fetch: fetchMock,
    });

    await llm["runLLM"]([
      { role: "user", content: "What's the weather?" },
      { role: "function", name: "call-1", content: '{"temp":72}' },
    ]);

    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[1].role).toBe("tool");
    expect(body.messages[1].tool_call_id).toBe("call-1");
    expect(body.messages[1].content).toBe('{"temp":72}');
  });
});
