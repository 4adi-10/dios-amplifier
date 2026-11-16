/* DIOS Amplifier: real-time pitch shifter for the voice changer. Runs on the audio thread.
   Two read heads sweep through a short delay line half a cycle apart; Hann-shaped crossfades
   (sin² + cos² = 1) keep the level steady. ratio > 1 is higher (chipmunk), < 1 is deeper (demon). */
class DiosPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4, automationRate: 'k-rate' }];
  }
  constructor() {
    super();
    this.N = 16384;
    this.buf = new Float32Array(this.N);
    this.w = 0;
    this.ph = 0;
    this.W = Math.round(sampleRate * 0.045);   // 45 ms grains: smooth for speech, little echo
  }
  process(inputs, outputs, params) {
    const out = outputs[0];
    if (!out || !out[0]) return true;
    const inp = inputs[0] && inputs[0][0];
    const o = out[0], buf = this.buf, N = this.N, W = this.W;
    const r = params.ratio[0];
    const step = (1 - r) / W;
    let w = this.w, ph = this.ph;
    for (let i = 0; i < o.length; i++) {
      buf[w] = inp ? inp[i] : 0;
      ph += step; if (ph >= 1) ph -= 1; else if (ph < 0) ph += 1;
      let y = 0;
      for (let k = 0; k < 2; k++) {
        let p = ph + k * 0.5; if (p >= 1) p -= 1;
        const d = 2 + p * W;
        let pos = w - d; if (pos < 0) pos += N;
        const i0 = pos | 0, f = pos - i0, i1 = (i0 + 1) % N;
        const s = buf[i0] + (buf[i1] - buf[i0]) * f;
        const g = Math.sin(Math.PI * p);
        y += s * g * g;
      }
      o[i] = y;
      w = (w + 1) % N;
    }
    for (let c = 1; c < out.length; c++) out[c].set(o);
    this.w = w; this.ph = ph;
    return true;
  }
}
registerProcessor('dios-pitch', DiosPitch);
