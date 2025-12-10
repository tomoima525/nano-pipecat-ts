import { InputAudioRawFrame, type Language } from "../../frames/data";
import { STTResult, STTService, type STTServiceOptions } from "./base";

export interface DeepgramSTTOptions extends STTServiceOptions {
  /** Deepgram API key */
  apiKey: string;
  /** Deepgram model to use */
  model?: string;
  /** Language hint (overrides base defaultLanguage if provided) */
  language?: Language;
  /** Enable smart formatting (punctuation, capitalization) */
  smartFormat?: boolean;
  /** Override API endpoint (for testing) */
  endpoint?: string;
  /** Custom fetch implementation (for testing) */
  fetch?: typeof fetch;
}

interface DeepgramAlternative {
  transcript?: string;
  confidence?: number;
}

interface DeepgramResponse {
  results?: {
    channels?: Array<{
      alternatives?: DeepgramAlternative[];
    }>;
  };
  [key: string]: unknown;
}

/**
 * Deepgram Speech-to-Text service.
 */
export class DeepgramSTTService extends STTService {
  private readonly apiKey: string;
  private readonly model?: string;
  private readonly smartFormat: boolean;
  private readonly endpoint: string;
  private readonly fetchImpl?: typeof fetch;

  constructor(options: DeepgramSTTOptions) {
    super({
      ...options,
      name: options.name ?? "DeepgramSTTService",
      language: options.language,
    });

    this.apiKey = options.apiKey;
    this.model = options.model;
    this.smartFormat = options.smartFormat ?? true;
    this.endpoint = options.endpoint ?? "https://api.deepgram.com/v1/listen";
    this.fetchImpl = options.fetch;
  }

  protected async runSTT(audio: Uint8Array, frame: InputAudioRawFrame): Promise<STTResult> {
    const fetchFn = this.fetchImpl ?? globalThis.fetch;
    if (!fetchFn) {
      throw new Error("Fetch implementation is not available for DeepgramSTTService.");
    }

    const url = new URL(this.endpoint);
    if (this.model) {
      url.searchParams.set("model", this.model);
    }
    const language = this.defaultLanguage ?? undefined;
    if (language) {
      url.searchParams.set("language", language);
    }
    if (this.smartFormat) {
      url.searchParams.set("smart_format", "true");
    }

    const contentType = `audio/pcm;encoding=linear16;sample_rate=${frame.sampleRate};channels=${frame.numChannels}`;

    const audioCopy = new Uint8Array(audio);
    const audioBuffer = audioCopy.buffer;

    const response = await fetchFn(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Token ${this.apiKey}`,
        "Content-Type": contentType,
      },
      body: audioBuffer,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Deepgram request failed: ${response.status} ${response.statusText} - ${text}`
      );
    }

    const json = (await response.json()) as DeepgramResponse;
    const transcript = json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

    return {
      text: transcript,
      language,
      result: json,
    };
  }
}
