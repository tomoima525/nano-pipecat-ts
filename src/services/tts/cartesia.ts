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
  /** API version string */
  apiVersion?: string;
  /** Override API endpoint (for testing) */
  endpoint?: string;
  /** Custom fetch implementation (for testing) */
  fetch?: typeof fetch;
}

/**
 * Cartesia API response structure.
 */
interface CartesiaResponse {
  audio?: string;
  error?: string;
  message?: string;
}

/**
 * Cartesia Text-to-Speech service.
 *
 * Uses Cartesia's HTTP API for text-to-speech synthesis.
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
  private readonly apiKey: string;
  private readonly model: CartesiaModel;
  private readonly cartesiaLanguage?: CartesiaLanguage;
  private readonly sampleRate: number;
  private readonly encoding: CartesiaEncoding;
  private readonly apiVersion: string;
  private readonly endpoint: string;
  private readonly fetchImpl?: typeof fetch;

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

    this.apiKey = options.apiKey;
    this.model = options.model ?? "sonic-3";
    this.cartesiaLanguage = options.language;
    this.sampleRate = sampleRate;
    this.encoding = options.encoding ?? "pcm_s16le";
    this.apiVersion = options.apiVersion ?? "2024-06-10";
    this.endpoint = options.endpoint ?? "https://api.cartesia.ai/tts/bytes";
    this.fetchImpl = options.fetch;
  }

  /**
   * Synthesize text to speech using Cartesia API.
   *
   * @param text - The text to synthesize
   * @returns Promise resolving to TTS result with audio data
   */
  protected async runTTS(text: string): Promise<TTSResult> {
    const fetchFn = this.fetchImpl ?? globalThis.fetch;
    if (!fetchFn) {
      throw new Error("Fetch implementation is not available for CartesiaTTSService.");
    }

    const requestBody = {
      model_id: this.model,
      transcript: text,
      voice: {
        mode: "id" as const,
        id: this.voiceId,
      },
      output_format: {
        container: "raw" as const,
        encoding: this.encoding,
        sample_rate: this.sampleRate,
      },
      ...(this.cartesiaLanguage && { language: this.cartesiaLanguage }),
    };

    const response = await fetchFn(this.endpoint, {
      method: "POST",
      headers: {
        "X-API-Key": this.apiKey,
        "Cartesia-Version": this.apiVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      let errorMessage = `Cartesia request failed: ${response.status} ${response.statusText}`;
      try {
        const errorData = (await response.json()) as CartesiaResponse;
        if (errorData.error || errorData.message) {
          errorMessage += ` - ${errorData.error || errorData.message}`;
        }
      } catch {
        // Ignore JSON parse errors for error response
      }
      throw new Error(errorMessage);
    }

    // Response is raw audio bytes
    const arrayBuffer = await response.arrayBuffer();
    const audio = new Uint8Array(arrayBuffer);

    return {
      audio,
      sampleRate: this.sampleRate,
      numChannels: 1,
    };
  }
}
