/**
 * WebSocket Demo Client
 *
 * A simple client that demonstrates the pipecat-ts WebSocket transport.
 * Records audio from the microphone, sends it to the server, and plays
 * back the echoed audio.
 */

// Configuration
const WS_URL = "ws://localhost:3000/ws";
const SAMPLE_RATE = 16000;
const CHUNK_SIZE_MS = 20;
const CHUNK_SIZE_SAMPLES = Math.floor((SAMPLE_RATE * CHUNK_SIZE_MS) / 1000);

// DOM Elements
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const startBtn = document.getElementById("start-btn") as HTMLButtonElement;
const stopBtn = document.getElementById("stop-btn") as HTMLButtonElement;
const connectionDot = document.getElementById(
  "connection-dot"
) as HTMLSpanElement;
const connectionStatus = document.getElementById(
  "connection-status"
) as HTMLSpanElement;
const recordingStatus = document.getElementById(
  "recording-status"
) as HTMLSpanElement;
const sentBytesEl = document.getElementById("sent-bytes") as HTMLSpanElement;
const receivedBytesEl = document.getElementById(
  "received-bytes"
) as HTMLSpanElement;
const messagesEl = document.getElementById("messages") as HTMLDivElement;

// State
let ws: WebSocket | null = null;
let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let audioWorklet: AudioWorkletNode | null = null;
let isRecording = false;
let sentBytes = 0;
let receivedBytes = 0;

// Audio playback queue
const audioPlaybackQueue: Float32Array[] = [];
let isPlaying = false;

/**
 * Log a message to the messages panel
 */
function logMessage(
  text: string,
  type: "sent" | "received" | "error" | "info" = "info"
) {
  const now = new Date();
  const time = now.toLocaleTimeString();

  const messageDiv = document.createElement("div");
  messageDiv.className = `message ${type}`;
  messageDiv.innerHTML = `<span class="message-time">${time}</span>${text}`;

  messagesEl.appendChild(messageDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * Update connection status UI
 */
function updateConnectionStatus(
  status: "disconnected" | "connecting" | "connected"
) {
  connectionDot.className = `dot ${status}`;
  connectionStatus.textContent =
    status.charAt(0).toUpperCase() + status.slice(1);

  if (status === "connected") {
    connectBtn.textContent = "Disconnect";
    startBtn.disabled = false;
  } else if (status === "disconnected") {
    connectBtn.textContent = "Connect";
    startBtn.disabled = true;
    stopBtn.disabled = true;
    stopRecording();
  } else {
    connectBtn.disabled = true;
  }
}

/**
 * Connect to WebSocket server
 */
async function connect() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
    return;
  }

  updateConnectionStatus("connecting");
  logMessage("Connecting to server...", "info");

  ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    updateConnectionStatus("connected");
    connectBtn.disabled = false;
    logMessage("Connected to server", "info");
  };

  ws.onclose = (event) => {
    updateConnectionStatus("disconnected");
    connectBtn.disabled = false;
    logMessage(`Disconnected: ${event.code} ${event.reason}`, "info");
    ws = null;
  };

  ws.onerror = (event) => {
    logMessage("WebSocket error occurred", "error");
    console.error("WebSocket error:", event);
  };

  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      // Binary data - audio
      const audioData = new Uint8Array(event.data);
      receivedBytes += audioData.length;
      receivedBytesEl.textContent = receivedBytes.toString();

      // Convert to Float32Array for playback
      const float32Data = int16ToFloat32(audioData);
      playAudio(float32Data);
    } else {
      // Text data - JSON message
      try {
        const message = JSON.parse(event.data);
        logMessage(`Received: ${JSON.stringify(message.data)}`, "received");
      } catch (error) {
        logMessage(`Received: ${event.data}`, "received");
      }
    }
  };
}

/**
 * Convert Int16 PCM to Float32
 */
function int16ToFloat32(int16Data: Uint8Array): Float32Array {
  const numSamples = Math.floor(int16Data.length / 2);
  const float32Data = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    // Little-endian 16-bit signed integer
    const sample =
      (int16Data[i * 2] | (int16Data[i * 2 + 1] << 8)) -
      (int16Data[i * 2 + 1] & 0x80 ? 0x10000 : 0);
    float32Data[i] = sample / 32768;
  }

  return float32Data;
}

/**
 * Convert Float32 to Int16 PCM
 */
function float32ToInt16(float32Data: Float32Array): Uint8Array {
  const int16Data = new Uint8Array(float32Data.length * 2);

  for (let i = 0; i < float32Data.length; i++) {
    const sample = Math.max(-1, Math.min(1, float32Data[i]));
    const int16Value = Math.round(sample * 32767);
    int16Data[i * 2] = int16Value & 0xff;
    int16Data[i * 2 + 1] = (int16Value >> 8) & 0xff;
  }

  return int16Data;
}

/**
 * Play audio data
 */
function playAudio(audioData: Float32Array) {
  if (!audioContext) {
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  }

  audioPlaybackQueue.push(audioData);

  if (!isPlaying) {
    playNextChunk();
  }
}

/**
 * Play the next audio chunk from the queue
 */
function playNextChunk() {
  if (audioPlaybackQueue.length === 0) {
    isPlaying = false;
    return;
  }

  isPlaying = true;
  const audioData = audioPlaybackQueue.shift()!;

  if (!audioContext) return;

  const buffer = audioContext.createBuffer(1, audioData.length, SAMPLE_RATE);
  buffer.copyToChannel(new Float32Array(audioData), 0);

  const source = audioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(audioContext.destination);
  source.onended = playNextChunk;
  source.start();
}

/**
 * Start recording audio
 */
async function startRecording() {
  if (isRecording) return;

  try {
    // Request microphone access
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: SAMPLE_RATE,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // Create audio context
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });

    // Load audio worklet for processing
    await audioContext.audioWorklet.addModule(
      createAudioWorkletURL(CHUNK_SIZE_SAMPLES)
    );

    // Create source from microphone
    const source = audioContext.createMediaStreamSource(mediaStream);

    // Create worklet node
    audioWorklet = new AudioWorkletNode(audioContext, "audio-processor");
    audioWorklet.port.onmessage = (event) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        const float32Data = event.data as Float32Array;
        const int16Data = float32ToInt16(float32Data);

        ws.send(int16Data.buffer);
        sentBytes += int16Data.length;
        sentBytesEl.textContent = sentBytes.toString();
      }
    };

    // Connect: source -> worklet
    source.connect(audioWorklet);

    isRecording = true;
    recordingStatus.textContent = "Yes";
    startBtn.disabled = true;
    stopBtn.disabled = false;
    logMessage("Started recording", "info");
  } catch (error) {
    logMessage(`Error starting recording: ${error}`, "error");
    console.error("Recording error:", error);
  }
}

/**
 * Stop recording audio
 */
function stopRecording() {
  if (!isRecording) return;

  if (audioWorklet) {
    audioWorklet.disconnect();
    audioWorklet = null;
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop());
    mediaStream = null;
  }

  isRecording = false;
  recordingStatus.textContent = "No";
  startBtn.disabled = false;
  stopBtn.disabled = true;
  logMessage("Stopped recording", "info");
}

/**
 * Create a data URL for the audio worklet processor
 */
function createAudioWorkletURL(chunkSize: number): string {
  const processorCode = `
    class AudioProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.buffer = new Float32Array(${chunkSize});
        this.bufferIndex = 0;
      }

      process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) return true;

        const channelData = input[0];

        for (let i = 0; i < channelData.length; i++) {
          this.buffer[this.bufferIndex++] = channelData[i];

          if (this.bufferIndex >= ${chunkSize}) {
            this.port.postMessage(this.buffer.slice());
            this.bufferIndex = 0;
          }
        }

        return true;
      }
    }

    registerProcessor('audio-processor', AudioProcessor);
  `;

  const blob = new Blob([processorCode], { type: "application/javascript" });
  return URL.createObjectURL(blob);
}

// Event listeners
connectBtn.addEventListener("click", connect);
startBtn.addEventListener("click", startRecording);
stopBtn.addEventListener("click", stopRecording);

// Initial log
logMessage("Ready. Click Connect to start.", "info");
