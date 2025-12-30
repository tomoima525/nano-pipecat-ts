/**
 * Transport Layer exports
 *
 * Provides transport implementations for real-time communication.
 */

// Base transport classes
export {
  BaseTransport,
  BaseInputTransport,
  BaseOutputTransport,
  DEFAULT_TRANSPORT_PARAMS,
} from "./base";

export type {
  TransportParams,
  AudioInputParams,
  AudioOutputParams,
  VADParams,
  BaseTransportOptions,
  BaseInputTransportOptions,
  BaseOutputTransportOptions,
} from "./base";

// WebSocket server transport
export {
  WebSocketServerTransport,
  WebSocketServerInputTransport,
  WebSocketServerOutputTransport,
  EchoTransport,
} from "./websocket";

export type {
  WebSocketLike,
  WebSocketServerTransportOptions,
} from "./websocket";
