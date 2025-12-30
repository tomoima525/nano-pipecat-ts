import { CartesiaClient, Cartesia } from "@cartesia/cartesia-js";
import { TTSService, TTSResult, type TTSServiceOptions } from "./base";
import { type Language } from "../../frames/data";

/**
 * Supported Cartesia voice models.
 */
export type CartesiaModel = "sonic-3" | "sonic-2" | "sonic-english" | "sonic-multilingual" | string;

/**
 * Cartesia audio encoding formats.
 */
export type CartesiaEncoding = "pcm_s16le" | "pcm_f32le" | "pcm_mulaw" | "pcm_alaw";

/**
 * Cartesia supported languages.
 */
export type CartesiaLanguage =
  | "en"
  | "de"
  | "es"
  | "fr"
  | "ja"
  | "pt"
  | "zh"
  | "hi"
  | "it"
  | "ko"
  | "nl"
  | "pl"
  | "ru"
  | "sv"
  | "tr"
  | Language;

/**
 * Voice configuration for Cartesia TTS.
 */
export interface CartesiaVoiceConfig {
  /** Voice mode - 'id' for using voice_id, 'embedding' for custom embedding */
  mode: "id" | "embedding";
  /** Voice ID when mode is 'id' */
  id?: string;
  /** Voice embedding when mode is 'embedding' */
  embedding?: number[];
}

/**
 * Output format configuration for Cartesia TTS.
 */
export interface CartesiaOutputFormat {
  /** Container format */
  container: "raw";
  /** Audio encoding */
  encoding: CartesiaEncoding;
  /** Sample rate in Hz */
  sampleRate: number;
}

/**
 * Options for configuring Cartesia TTS service.
 */
export interface CartesiaTTSOptions extends Omit<TTSServiceOptions, "voiceId" | "modelId"> {
  /** Cartesia API key */
  apiKey: string;
  /** Voice ID for synthesis */
  voiceId: string;
  /** Model to use for synthesis */
  model?: CartesiaModel;
  /** Language for synthesis */
  language?: CartesiaLanguage;
  /** Sample rate for output audio (default: 24000) */
  sampleRate?: number;
  /** Audio encoding format (default: pcm_s16le) */
  encoding?: CartesiaEncoding;
}

/**
 * Cartesia Text-to-Speech service using the official Cartesia SDK.
 *
 * @example
 * ```typescript
 * const tts = new CartesiaTTSService({
 *   apiKey: process.env.CARTESIA_API_KEY,
 *   voiceId: "a0e99841-438c-4a64-b679-ae501e7d6091",
 *   model: "sonic-3",
 *   language: "en",
 * });
 * ```
 */
export class CartesiaTTSService extends TTSService {
  private readonly client: CartesiaClient;
  private readonly model: CartesiaModel;
  private readonly cartesiaLanguage?: Cartesia.SupportedLanguage;
  private readonly sampleRate: number;
  private readonly encoding: CartesiaEncoding;

  constructor(options: CartesiaTTSOptions) {
    const sampleRate = options.sampleRate ?? 24000;

    super({
      ...options,
      name: options.name ?? "CartesiaTTSService",
      voiceId: options.voiceId,
      modelId: options.model ?? "sonic-3",
      language: options.language,
      audioFormat: { sampleRate, numChannels: 1 },
    });

    this.client = new CartesiaClient({ apiKey: options.apiKey });
    this.model = options.model ?? "sonic-3";
    this.cartesiaLanguage = options.language as Cartesia.SupportedLanguage | undefined;
    this.sampleRate = sampleRate;
    this.encoding = options.encoding ?? "pcm_s16le";
  }

  /**
   * Synthesize text to speech using Cartesia SDK.
   *
   * @param text - The text to synthesize
   * @returns Promise resolving to TTS result with audio data
   */
  protected async runTTS(text: string): Promise<TTSResult> {
    const request: Cartesia.TtsRequest = {
      modelId: this.model,
      transcript: text,
      voice: {
        mode: "id",
        id: this.voiceId!,
      },
      outputFormat: {
        container: "raw",
        encoding: this.encoding,
        sampleRate: this.sampleRate,
      },
      ...(this.cartesiaLanguage && { language: this.cartesiaLanguage }),
    };

    const stream = await this.client.tts.bytes(request);

    // Collect all chunks from the stream into a single buffer
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    const audio = new Uint8Array(Buffer.concat(chunks));

    return {
      audio,
      sampleRate: this.sampleRate,
      numChannels: 1,
    };
  }
}
