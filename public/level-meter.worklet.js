// AudioWorklet: posts the RMS level roughly every 50 ms. Runs on the audio thread, so it isn't
// throttled while Chrome is in the background. It only measures; it never alters the recording.
class LevelMeter extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sum = 0;
    this.count = 0;
    this.target = Math.round(sampleRate * 0.05);
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) this.sum += ch[i] * ch[i];
      this.count += ch.length;
    } else {
      this.count += 128;
    }
    if (this.count >= this.target) {
      this.port.postMessage(Math.sqrt(this.sum / this.count));
      this.sum = 0;
      this.count = 0;
    }
    return true;
  }
}
registerProcessor("level-meter", LevelMeter);
