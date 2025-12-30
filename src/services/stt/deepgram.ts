import { createClient, type DeepgramClient } from "@deepgram/sdk";
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
 * Deepgram Speech-to-Text service using the official Deepgram SDK.
 */
export class DeepgramSTTService extends STTService {
  private readonly client: DeepgramClient;
  private readonly model?: string;
  private readonly smartFormat: boolean;

  constructor(options: DeepgramSTTOptions) {
    super({
      ...options,
      name: options.name ?? "DeepgramSTTService",
      language: options.language,
    });

    this.client = createClient(options.apiKey);
    this.model = options.model;
    this.smartFormat = options.smartFormat ?? true;
  }

  protected async runSTT(audio: Uint8Array, frame: InputAudioRawFrame): Promise<STTResult> {
    const language = this.defaultLanguage ?? undefined;

    // Convert Uint8Array to Buffer for the SDK
    const audioBuffer = Buffer.from(audio);

    // Build transcription options
    const options: Record<string, unknown> = {
      encoding: "linear16",
      sample_rate: frame.sampleRate,
      channels: frame.numChannels,
      smart_format: this.smartFormat,
    };

    if (this.model) {
      options.model = this.model;
    }
    if (language) {
      options.language = language;
    }

    const { result, error } = await this.client.listen.prerecorded.transcribeFile(
      audioBuffer,
      options
    );

    if (error) {
      throw new Error(`Deepgram transcription failed: ${error.message}`);
    }

    const json = result as unknown as DeepgramResponse;
    const transcript = json.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";

    return {
      text: transcript,
      language,
      result: json,
    };
  }
}
