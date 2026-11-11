/* DIOS Amplifier: noise gate (AudioWorklet).
   It runs on the audio thread, so it keeps working when the tab is in the background, minimised or covered.
   (The old gate ran in the page's drawing loop, which Chrome pauses in a hidden tab: the gate froze, often shut.)
   input 0: the boosted signal to gate. input 1: the raw microphone, used only to measure how loud you are. */
class DiosGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -90, minValue: -100, maxValue: 0, automationRate: 'k-rate' },   // dB; -90 or lower = gate off
      { name: 'hold', defaultValue: 0.18, minValue: 0, maxValue: 30, automationRate: 'k-rate' }          // seconds the gate stays open after you stop
    ];
  }
  constructor() {
    super();
    this.env = 0; this.g = 1; this.openUntil = 0; this.open = true;
    this.cEnv = Math.exp(-1 / (sampleRate * 0.010));   // 10 ms level detector
    this.cUp = Math.exp(-1 / (sampleRate * 0.005));    // opens in 5 ms
    this.cDown = Math.exp(-1 / (sampleRate * 0.050));  // closes in 50 ms
  }
  process(inputs, outputs, params) {
    const sig = inputs[0], det = inputs[1] && inputs[1][0], out = outputs[0];
    if (!out || !out.length) return true;
    const n = out[0].length, thr = params.threshold[0], hold = params.hold[0];
    const off = thr <= -90, lin = Math.pow(10, thr / 10);   // compared with the squared level
    let g = this.g, env = this.env, t = currentTime;
    const dt = 1 / sampleRate;
    for (let i = 0; i < n; i++, t += dt) {
      const x = det ? det[i] : 0;
      env = env * this.cEnv + x * x * (1 - this.cEnv);
      if (off || env > lin) this.openUntil = t + hold;
      const target = t < this.openUntil ? 1 : 0;
      g = target + (g - target) * (target > g ? this.cUp : this.cDown);
      for (let c = 0; c < out.length; c++) out[c][i] = (sig[c] ? sig[c][i] : sig[0] ? sig[0][i] : 0) * g;
    }
    this.g = g; this.env = env < 1e-20 ? 0 : env;
    const open = currentTime < this.openUntil;
    if (open !== this.open) { this.open = open; this.port.postMessage({ open }); }   // tells the soundboard when you talk
    return true;
  }
}
registerProcessor('dios-gate', DiosGate);
