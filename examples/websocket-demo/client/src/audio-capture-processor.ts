/**
 * AudioWorklet processor for capturing audio chunks
 * Runs on the audio rendering thread for better performance
 */

class AudioCaptureProcessor extends AudioWorkletProcessor {
  private audioBuffer: Float32Array[] = [];
  private totalSamples = 0;
  private chunkSizeSamples: number;
  private isCapturing = true;

  constructor(options: { processorOptions?: { chunkSizeSamples?: number } }) {
    super();
    // chunkSizeSamples passed via processorOptions (default ~100ms at 24kHz)
    this.chunkSizeSamples = options?.processorOptions?.chunkSizeSamples || 2400;

    this.port.onmessage = event => {
      if (event.data.type === "stop") {
        this.isCapturing = false;
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const input = inputs[0];
    if (!input || !input[0] || !this.isCapturing) {
      return this.isCapturing;
    }

    const inputChannel = input[0];

    // Buffer audio data
    this.audioBuffer.push(new Float32Array(inputChannel));
    this.totalSamples += inputChannel.length;

    // Send chunks when we have enough samples
    while (this.totalSamples >= this.chunkSizeSamples) {
      const chunk = new Float32Array(this.chunkSizeSamples);
      let offset = 0;

      while (offset < this.chunkSizeSamples && this.audioBuffer.length > 0) {
        const buffer = this.audioBuffer[0];
        const needed = this.chunkSizeSamples - offset;

        if (buffer.length <= needed) {
          // Use entire buffer
          chunk.set(buffer, offset);
          offset += buffer.length;
          this.totalSamples -= buffer.length;
          this.audioBuffer.shift();
        } else {
          // Use part of buffer
          chunk.set(buffer.subarray(0, needed), offset);
          this.audioBuffer[0] = buffer.subarray(needed);
          offset += needed;
          this.totalSamples -= needed;
        }
      }

      // Send chunk to main thread
      this.port.postMessage({
        type: "audioData",
        audioData: chunk,
      });
    }

    return this.isCapturing;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
