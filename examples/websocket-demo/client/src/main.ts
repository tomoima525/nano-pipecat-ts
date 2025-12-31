/**
 * WebSocket Demo Client - Voice Agent
 *
 * A client that connects to the pipecat-ts voice agent server.
 * Records audio from the microphone, sends it to the server,
 * and plays back the AI-generated response.
 */
import audioCaptureProcessUrl from "./audio-capture-processor.ts?url";

// Configuration
const WS_URL = "ws://localhost:3000/ws";
// DOM Elements
const connectBtn = document.getElementById("connect-btn") as HTMLButtonElement;
const connectionDot = document.getElementById("connection-dot") as HTMLSpanElement;
const connectionStatus = document.getElementById("connection-status") as HTMLSpanElement;
const sentBytesEl = document.getElementById("sent-bytes") as HTMLSpanElement;
const receivedBytesEl = document.getElementById("received-bytes") as HTMLSpanElement;
const messagesEl = document.getElementById("messages") as HTMLDivElement;

// State
let ws: WebSocket | null = null;
let inputAudioContext: AudioContext | null = null;
let outputAudioContext: AudioContext | null = null;
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
  type: "sent" | "received" | "error" | "info" | "transcription" | "bot" = "info"
): void {
  const now = new Date();
  const time = now.toLocaleTimeString();

  const messageDiv = document.createElement("div");

  // Base classes for all messages (dark mode)
  const baseClasses = "p-3 rounded-lg border-l-4";

  // Type-specific Tailwind classes (dark mode - high visibility)
  const typeClasses: Record<string, string> = {
    info: "bg-gray-700 border-amber-400 text-amber-300",
    sent: "bg-gray-700 border-green-400 text-green-300",
    received: "bg-gray-700 border-blue-400 text-blue-300",
    error: "bg-gray-700 border-red-400 text-red-300",
    transcription: "bg-gray-700 border-green-400 text-green-300",
    bot: "bg-gray-700 border-blue-400 text-blue-300",
  };

  messageDiv.className = `${baseClasses} ${typeClasses[type] || typeClasses.info}`;

  let prefix = "";
  if (type === "transcription") {
    prefix = '<span class="font-bold text-green-400">You:</span> ';
  } else if (type === "bot") {
    prefix = '<span class="font-bold text-blue-400">Bot:</span> ';
  }

  messageDiv.innerHTML = `<span class="text-gray-500 text-xs mr-2">${time}</span>${prefix}${text}`;

  messagesEl.appendChild(messageDiv);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/**
 * Update connection status UI
 */
function updateConnectionStatus(status: "disconnected" | "connecting" | "connected"): void {
  // Update dot color using Tailwind classes
  connectionDot.className = "w-4 h-4 rounded-full shrink-0";
  if (status === "disconnected") {
    connectionDot.classList.add("bg-red-500");
  } else if (status === "connecting") {
    connectionDot.classList.add("bg-yellow-500", "animate-pulse-custom");
  } else {
    connectionDot.classList.add("bg-green-500");
  }

  connectionStatus.textContent = status.charAt(0).toUpperCase() + status.slice(1);

  if (status === "connected") {
    connectBtn.textContent = "Disconnect";
    connectBtn.className =
      "w-full bg-gray-700 text-red-400 font-semibold rounded-lg px-6 py-4 hover:bg-gray-600 transition-all border border-red-400/50";
  } else if (status === "disconnected") {
    connectBtn.textContent = "Connect";
    connectBtn.className =
      "w-full bg-gray-700 text-gray-100 font-semibold rounded-lg px-6 py-4 hover:bg-gray-600 transition-all border border-gray-600";
    stopRecording();
  } else {
    connectBtn.disabled = true;
  }
}

/**
 * Connect to WebSocket server
 */
async function connect(): Promise<void> {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
    return;
  }

  updateConnectionStatus("connecting");
  logMessage("Connecting to server...", "info");

  ws = new WebSocket(WS_URL);
  ws.binaryType = "arraybuffer";

  ws.onopen = async () => {
    updateConnectionStatus("connected");
    connectBtn.disabled = false;
    logMessage("Connected to server", "info");

    // Automatically start recording
    await startRecording();
  };

  ws.onclose = event => {
    updateConnectionStatus("disconnected");
    connectBtn.disabled = false;
    logMessage(`Disconnected: ${event.code} ${event.reason}`, "info");
    ws = null;
  };

  ws.onerror = () => {
    logMessage("WebSocket error occurred", "error");
  };

  ws.onmessage = event => {
    if (event.data instanceof ArrayBuffer) {
      // Binary data - audio from TTS
      const audioData = new Uint8Array(event.data);
      receivedBytes += audioData.length;
      receivedBytesEl.textContent = receivedBytes.toString();

      // Convert to Float32Array for playback (TTS is 24kHz)
      const float32Data = int16ToFloat32(audioData);
      playAudio(float32Data, 24000);
    } else {
      // Text data - JSON message
      try {
        const message = JSON.parse(event.data);

        if (message.type === "message") {
          if (message.data.status === "connected") {
            logMessage(message.data.message, "info");
          } else {
            logMessage(`${JSON.stringify(message.data)}`, "received");
          }
        } else if (message.type === "transcription") {
          // Only show final transcriptions, not interim results
          if (message.data.final) {
            logMessage(message.data.text, "transcription");
          }
        } else if (message.type === "bot_response") {
          logMessage(message.data.text, "bot");
        } else {
          logMessage(`${message.type}: ${JSON.stringify(message.data)}`, "received");
        }
      } catch {
        logMessage(`${event.data}`, "received");
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
 * Resample audio from source sample rate to target sample rate
 * Uses linear interpolation for simplicity
 */
function resampleAudio(
  inputData: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number
): Float32Array {
  if (inputSampleRate === outputSampleRate) {
    return inputData;
  }

  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.floor(inputData.length / ratio);
  const outputData = new Float32Array(outputLength);

  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const srcIndexFloor = Math.floor(srcIndex);
    const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
    const t = srcIndex - srcIndexFloor;

    // Linear interpolation
    outputData[i] = inputData[srcIndexFloor] * (1 - t) + inputData[srcIndexCeil] * t;
  }

  return outputData;
}

/**
 * Play audio data at specified sample rate
 */
function playAudio(audioData: Float32Array, sampleRate: number): void {
  if (!outputAudioContext || outputAudioContext.sampleRate !== sampleRate) {
    outputAudioContext = new AudioContext({ sampleRate });
  }

  audioPlaybackQueue.push(audioData);

  if (!isPlaying) {
    playNextChunk();
  }
}

/**
 * Play the next audio chunk from the queue
 */
function playNextChunk(): void {
  if (audioPlaybackQueue.length === 0) {
    isPlaying = false;
    return;
  }

  isPlaying = true;
  const audioData = audioPlaybackQueue.shift();

  if (!audioData) return;
  if (!outputAudioContext) return;

  const buffer = outputAudioContext.createBuffer(
    1,
    audioData?.length ?? 0,
    outputAudioContext.sampleRate
  );
  buffer.copyToChannel(new Float32Array(audioData), 0);

  const source = outputAudioContext.createBufferSource();
  source.buffer = buffer;
  source.connect(outputAudioContext.destination);
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
        sampleRate: inputAudioContext?.sampleRate ?? 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    // Debug: Check MediaStream tracks
    const audioTrack = mediaStream.getAudioTracks()[0];
    const nativeSampleRate = audioTrack?.getSettings().sampleRate ?? 48000;

    if (audioTrack) {
      const settings = audioTrack.getSettings();
      console.log("[Audio Debug] MediaStream track:", {
        label: audioTrack.label,
        enabled: audioTrack.enabled,
        muted: audioTrack.muted,
        readyState: audioTrack.readyState,
        settings: {
          deviceId: settings.deviceId,
          sampleRate: settings.sampleRate,
          channelCount: settings.channelCount,
        },
      });
    } else {
      console.error("[Audio Debug] No audio track found in MediaStream!");
    }

    // Create audio context at the NATIVE sample rate (important for proper capture)
    // We'll resample to 16kHz before sending to the server
    inputAudioContext = new AudioContext({ sampleRate: nativeSampleRate });

    // Resume AudioContext if suspended (required after user interaction)
    if (inputAudioContext.state === "suspended") {
      console.log("[Audio Debug] AudioContext suspended, resuming...");
      await inputAudioContext.resume();
    }

    console.log("[Audio Debug] Native sample rate:", nativeSampleRate);
    console.log("[Audio Debug] Actual AudioContext sample rate:", inputAudioContext.sampleRate);
    console.log("[Audio Debug] AudioContext state:", inputAudioContext.state);
    console.log("[Audio Debug] Will resample to 16000 Hz before sending");

    // Load audio worklet for processing
    await inputAudioContext.audioWorklet.addModule(audioCaptureProcessUrl);

    // Create source from microphone
    const source = inputAudioContext.createMediaStreamSource(mediaStream);

    // Create worklet node
    audioWorklet = new AudioWorkletNode(inputAudioContext, "audio-capture-processor");
    // Target sample rate for the server (Deepgram expects 16kHz)
    const targetSampleRate = 16000;

    // Log first audio chunk for debugging
    let audioChunkCount = 0;
    audioWorklet.port.onmessage = event => {
      if (ws && ws.readyState === WebSocket.OPEN && event.data?.type === "audioData") {
        const float32Data = event.data.audioData as Float32Array;

        // Calculate max amplitude to check if we're getting real audio
        let maxAmplitude = 0;
        for (let i = 0; i < float32Data.length; i++) {
          const abs = Math.abs(float32Data[i]);
          if (abs > maxAmplitude) maxAmplitude = abs;
        }

        // Resample from native rate to 16kHz
        const resampledData = resampleAudio(
          float32Data,
          inputAudioContext?.sampleRate ?? nativeSampleRate,
          targetSampleRate
        );

        // Convert to Int16 PCM
        const int16Data = float32ToInt16(resampledData);

        // Log first few chunks for debugging
        if (audioChunkCount < 5) {
          console.log(`[Audio Debug] Chunk ${audioChunkCount}:`, {
            inputSamples: float32Data.length,
            inputSampleRate: inputAudioContext?.sampleRate,
            resampledSamples: resampledData.length,
            outputSampleRate: targetSampleRate,
            int16Bytes: int16Data.length,
            maxAmplitude: maxAmplitude.toFixed(6),
            hasAudio: maxAmplitude > 0.001,
          });
          audioChunkCount++;
        }

        ws.send(int16Data);
        sentBytes += int16Data.length;
        sentBytesEl.textContent = sentBytes.toString();
      }
    };

    // Connect: source -> worklet
    source.connect(audioWorklet);

    isRecording = true;
    logMessage("Started recording - speak into your microphone", "info");
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
    mediaStream.getTracks().forEach(track => track.stop());
    mediaStream = null;
  }

  isRecording = false;
  logMessage("Stopped recording", "info");
}

// Event listeners
connectBtn.addEventListener("click", connect);

// Initial log
logMessage("Ready. Click Connect to start.", "info");
