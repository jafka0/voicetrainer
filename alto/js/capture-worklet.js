// Runs on the audio thread and forwards mic samples without any gaps.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.block = new Float32Array(2048);
    this.used = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.block[this.used++] = channel[i];
      if (this.used === this.block.length) {
        this.port.postMessage(this.block);
        this.block = new Float32Array(2048);
        this.used = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture-processor', CaptureProcessor);
