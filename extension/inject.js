// Runs inside Discord's page: wraps getUserMedia so the mic stream Discord sends is boosted.
(() => {
  const st = { gain: 1, on: true, mode: 'soft' };
  const chains = new Set();
  const curve = mode => {
    const n = 2048, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * 2 - 1;
      c[i] = mode === 'soft' ? Math.tanh(2.5 * x) / Math.tanh(2.5) : x;
    }
    return c;
  };
  const apply = ch => {
    ch.gain.gain.setTargetAtTime(st.on ? st.gain : 1, ch.ctx.currentTime, 0.02);
    ch.shaper.curve = st.on ? curve(st.mode) : null;
  };
  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || !e.data.__mb) return;
    st.gain = e.data.gain; st.on = e.data.on; st.mode = e.data.mode;
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
      const shaper = ctx.createWaveShaper(); shaper.oversample = '4x';
      const dest = ctx.createMediaStreamDestination();
      src.connect(gain).connect(shaper).connect(dest);
      const ch = { ctx, gain, shaper };
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
