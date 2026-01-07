/**
 * xAI Realtime API Event Types
 *
 * Type definitions for client and server events used in the xAI realtime
 * voice agent WebSocket API.
 */

// =============================================================================
// Audio Configuration Types
// =============================================================================

/** Supported sample rates for PCM audio */
export type SupportedSampleRate = 8000 | 16000 | 21050 | 24000 | 32000 | 44100 | 48000;

/** PCM audio format configuration */
export interface PCMAudioFormat {
  type: "audio/pcm";
  rate: SupportedSampleRate;
}

/** PCMU (G.711 μ-law) audio format - fixed 8000 Hz */
export interface PCMUAudioFormat {
  type: "audio/pcmu";
}

/** PCMA (G.711 A-law) audio format - fixed 8000 Hz */
export interface PCMAAudioFormat {
  type: "audio/pcma";
}

/** Supported audio formats */
export type AudioFormat = PCMAudioFormat | PCMUAudioFormat | PCMAAudioFormat;

/** Audio input configuration */
export interface AudioInput {
  format?: AudioFormat;
}

/** Audio output configuration */
export interface AudioOutput {
  format?: AudioFormat;
}

/** Audio configuration for input and output */
export interface AudioConfiguration {
  input?: AudioInput;
  output?: AudioOutput;
}

// =============================================================================
// Voice and Turn Detection Types
// =============================================================================

/** Available xAI voice options */
export type XAIVoice = "Ara" | "Rex" | "Sal" | "Eve" | "Leo";

/** Turn detection configuration */
export interface TurnDetection {
  type: "server_vad" | null; // null = manual mode
}

// =============================================================================
// Session Configuration
// =============================================================================

/** Session properties for xAI realtime API */
export interface SessionProperties {
  /** System instructions for the assistant */
  instructions?: string;
  /** Voice for audio responses (default: "Ara") */
  voice?: XAIVoice;
  /** Turn detection mode (default: server_vad) */
  turnDetection?: TurnDetection;
  /** Audio configuration for input/output */
  audio?: AudioConfiguration;
}

// =============================================================================
// Client Events (Sent to xAI)
// =============================================================================

/** Base interface for client events */
interface BaseClientEvent {
  event_id: string;
}

/** Update session configuration */
export interface SessionUpdateEvent extends BaseClientEvent {
  type: "session.update";
  session: SessionProperties;
}

/** Send audio data to the input buffer */
export interface InputAudioBufferAppendEvent extends BaseClientEvent {
  type: "input_audio_buffer.append";
  audio: string; // base64-encoded PCM audio
}

/** Commit the input buffer (manual mode only) */
export interface InputAudioBufferCommitEvent extends BaseClientEvent {
  type: "input_audio_buffer.commit";
}

/** Clear the input buffer */
export interface InputAudioBufferClearEvent extends BaseClientEvent {
  type: "input_audio_buffer.clear";
}

/** Create a new assistant response */
export interface ResponseCreateEvent extends BaseClientEvent {
  type: "response.create";
  response?: {
    modalities?: ("text" | "audio")[];
  };
}

/** Cancel the current response */
export interface ResponseCancelEvent extends BaseClientEvent {
  type: "response.cancel";
}

/** Union type for all client events */
export type ClientEvent =
  | SessionUpdateEvent
  | InputAudioBufferAppendEvent
  | InputAudioBufferCommitEvent
  | InputAudioBufferClearEvent
  | ResponseCreateEvent
  | ResponseCancelEvent;

// =============================================================================
// Server Events (Received from xAI)
// =============================================================================

/** Base interface for server events */
interface BaseServerEvent {
  type: string;
  event_id: string;
}

/** Conversation item in response */
export interface ConversationItem {
  id: string;
  object: string;
  type?: string;
  role?: string;
  content?: Array<{
    type: string;
    text?: string;
    audio?: string;
    transcript?: string;
  }>;
}

/** First event after WebSocket connection */
export interface ConversationCreatedEvent extends BaseServerEvent {
  type: "conversation.created";
  conversation: {
    id: string;
    object: "realtime.conversation";
  };
}

/** Session configuration has been updated */
export interface SessionUpdatedEvent extends BaseServerEvent {
  type: "session.updated";
  session: SessionProperties;
}

/** Streaming audio data from the assistant */
export interface ResponseAudioDeltaEvent extends BaseServerEvent {
  type: "response.output_audio.delta";
  response_id: string;
  item_id: string;
  output_index: number;
  content_index: number;
  delta: string; // base64-encoded PCM audio
}

/** Audio output is complete */
export interface ResponseAudioDoneEvent extends BaseServerEvent {
  type: "response.output_audio.done";
  response_id: string;
  item_id: string;
}

/** User speech detected (server VAD mode) */
export interface SpeechStartedEvent extends BaseServerEvent {
  type: "input_audio_buffer.speech_started";
  item_id: string;
}

/** User speech ended (server VAD mode) */
export interface SpeechStoppedEvent extends BaseServerEvent {
  type: "input_audio_buffer.speech_stopped";
  item_id: string;
}

/** Response generation is complete */
export interface ResponseDoneEvent extends BaseServerEvent {
  type: "response.done";
  response: {
    id: string;
    object: "realtime.response";
    status: "completed" | "cancelled" | "failed";
    output: ConversationItem[];
    usage?: {
      total_tokens?: number;
      input_tokens?: number;
      output_tokens?: number;
    };
  };
}

/** Error from the API */
export interface ErrorEvent extends BaseServerEvent {
  type: "error";
  error: {
    type?: string;
    code?: string;
    message: string;
    param?: string;
  };
}

/** Union type for all server events */
export type ServerEvent =
  | ConversationCreatedEvent
  | SessionUpdatedEvent
  | ResponseAudioDeltaEvent
  | ResponseAudioDoneEvent
  | SpeechStartedEvent
  | SpeechStoppedEvent
  | ResponseDoneEvent
  | ErrorEvent;
