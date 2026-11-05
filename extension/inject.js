// Runs inside Discord's page: wraps getUserMedia so the mic stream Discord sends is boosted.
// Chain: mic -> gain (up to 100,000x) -> rumble cut -> bass -> presence -> treble -> compressor -> makeup -> limiter -> safety clip -> Discord
(() => {
  const st = { gain: 100, on: true, mode: 'clear', bass: 0, mid: 3, treble: 2 };
  const chains = new Set();
  const curve = mode => {
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * 2 - 1, a = Math.abs(x);
      c[i] = mode === 'hard' ? x
        : mode === 'safe' ? (a < .8 ? x : Math.sign(x) * (.8 + .17 * Math.tanh((a - .8) / .17)))
        : Math.tanh(2.5 * x) / Math.tanh(2.5);
    }
    return c;
  };
  const apply = ch => {
    const t = ch.ctx.currentTime, on = st.on;
    ch.gain.gain.setTargetAtTime(on ? st.gain : 1, t, 0.02);
    ch.bass.gain.setTargetAtTime(on ? st.bass : 0, t, 0.03);
    ch.mid.gain.setTargetAtTime(on ? st.mid : 0, t, 0.03);
    ch.treble.gain.setTargetAtTime(on ? st.treble : 0, t, 0.03);
    const m = st.mode, clear = on && m === 'clear', comp = on && m === 'comp';
    ch.comp.threshold.value = clear ? -26 : comp ? -30 : 0;
    ch.comp.ratio.value = clear ? 5 : comp ? 12 : 1;
    ch.comp.knee.value = clear ? 12 : comp ? 10 : 0;
    ch.comp.release.value = clear ? 0.2 : 0.15;
    ch.makeup.gain.setTargetAtTime(clear ? 2.4 : 1, t, 0.05);
    ch.lim.ratio.value = clear || comp ? 20 : 1;
    ch.lim.threshold.value = clear || comp ? -3 : 0;
    ch.hp.frequency.value = on && (clear || comp) ? 85 : 30;
    ch.shaper.curve = on ? curve(clear || comp ? 'safe' : m) : null;
    ch.shaper.oversample = clear || comp ? 'none' : '4x';
  };
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || !e.data.__mb) return;
    for (const k of Object.keys(st)) if (k in e.data) st[k] = e.data[k];
    chains.forEach(apply);
  });
  window.postMessage({ __mbReady: true }, '*');

  const md = navigator.mediaDevices;
  if (!md || !md.getUserMedia) return;
  const orig = md.getUserMedia.bind(md);
  md.getUserMedia = async function (constraints) {
    const stream = await orig(constraints);
    if (!constraints || !constraints.audio || !stream.getAudioTracks().length) return stream;
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const src = ctx.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
      const gain = ctx.createGain();
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 0.7;
      const makeup = ctx.createGain();
      const lim = ctx.createDynamicsCompressor(); lim.knee.value = 0; lim.attack.value = 0.001; lim.release.value = 0.06;
      const bass = ctx.createBiquadFilter(); bass.type = 'lowshelf'; bass.frequency.value = 140;
      const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 2800; mid.Q.value = 0.9;
      const treble = ctx.createBiquadFilter(); treble.type = 'highshelf'; treble.frequency.value = 6500;
      const comp = ctx.createDynamicsCompressor(); comp.attack.value = 0.003; comp.release.value = 0.15;
      const shaper = ctx.createWaveShaper(); shaper.oversample = '4x';
      const dest = ctx.createMediaStreamDestination();
      src.connect(gain).connect(hp).connect(bass).connect(mid).connect(treble).connect(comp).connect(makeup).connect(lim).connect(shaper).connect(dest);
      const ch = { ctx, gain, hp, bass, mid, treble, comp, makeup, lim, shaper };
      apply(ch); chains.add(ch);
      const resume = () => ctx.state === 'suspended' && ctx.resume();
      resume(); window.addEventListener('click', resume, { once: true });
      const out = new MediaStream([...dest.stream.getAudioTracks(), ...stream.getVideoTracks()]);
      const track = out.getAudioTracks()[0];
      const realStop = track.stop.bind(track);
      track.stop = () => { realStop(); stream.getTracks().forEach(t => t.stop()); chains.delete(ch); ctx.close(); };
      return out;
    } catch (err) {
      return stream;
    }
  };
})();
