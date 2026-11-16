/* DIOS Amplifier: the live console and the hero waveform. Plain script, no build. */
(() => {
  const $ = id => document.getElementById(id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KEY = 'dios-amp-v3';

  /* ---------------- settings ---------------- */
  // "clear" is the loud-and-clear chain: rumble cut, compressor, brick-wall limiter, no distortion
  const PRESETS = {
    clean: { gain: 10,     gate: -60, bass: 0,  mid: 3,  treble: 2,  mode: 'clear' },
    loud:  { gain: 1000,   gate: -55, bass: 2,  mid: 4,  treble: 2,  mode: 'clear' },
    max:   { gain: 100000, gate: -50, bass: 2,  mid: 5,  treble: 3,  mode: 'clear' },
    bass:  { gain: 300,    gate: -55, bass: 12, mid: 1,  treble: 0,  mode: 'clear' },
    radio: { gain: 300,    gate: -52, bass: -8, mid: 8,  treble: -4, mode: 'comp' },
    dist:  { gain: 100000, gate: -45, bass: 6,  mid: 0,  treble: 0,  mode: 'hard' },
    harsh: { gain: 100000, gate: -45, bass: 8,  mid: 8,  treble: 4,  mode: 'harsh' },
    ultra: { gain: 1000000000, gate: -45, bass: 2,  mid: 5,  treble: 3,  mode: 'clear' }   // Pro keys only
  };
  const DEF = { gain: 100, gate: -60, bass: 0, mid: 3, treble: 2, mode: 'clear', ns: true, inp: '', out: '', monitor: false, ptt: false, preset: '', voice: 'off', ttsLang: 'en' };
  let S = { ...DEF };
  try { S = { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };

  const toGain = v => Math.pow(10, v / 20);           // slider 0..160 dB -> 1x..100,000,000x
  /* ---------------- Pro levels ---------------- */
  // A normal key goes up to 100,000x (+100 dB); a Pro key up to 100,000,000x (+160 dB). /api/me says which.
  const TIER = { pro: false, maxDb: 100 };
  const capGain = g => Math.min(g, Math.pow(10, TIER.maxDb / 20));
  const locked = () => { const e = $('err'); e.textContent = 'Levels above 100,000x need a Pro key. Ask an admin for one, then sign out and enter it.'; clearTimeout(locked.t); locked.t = setTimeout(() => { if (e.textContent.startsWith('Levels above')) e.textContent = ''; }, 5000); };
  const fromGain = x => 20 * Math.log10(Math.max(1, x));
  const fmtX = g => (g >= 100 ? Math.round(g).toLocaleString('en') : g.toFixed(1).replace(/\.0$/, '')) + 'x';
  const fmtDb = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + ' dB';

  // hard: flat clip at full scale; soft: rounded drive; safe: untouched below 0.85, then a gentle knee
  // so the limiter's rare overshoot never clicks (tested: 100,000x, 0% clipped, peak −0.5 dBFS) (the clear chain's last stage)
  const curve = mode => {
    const n = 4096, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1) * 2 - 1, a = Math.abs(x);
      c[i] = mode === 'hard' ? x
        : mode === 'harsh' ? Math.sign(x) * Math.min(1, Math.pow(Math.abs(x) * 4, .35))   // square-wave slam at full scale
        : mode === 'safe' ? (a < .8 ? x : Math.sign(x) * (.8 + .17 * Math.tanh((a - .8) / .17)))
        : Math.tanh(2.5 * x) / Math.tanh(2.5);
    }
    return c;
  };
  const curves = {};
  const curveFor = m => (curves[m] = curves[m] || curve(m));

  /* ---------------- audio graph ---------------- */
  // mic -> pre analyser (gate detector)
  //     -> gain -> gate -> bass -> mid -> treble -> comp -> shaper -> master (mute/ptt) -> analyser
  //                                                                   -> dest (cable / recorder) + monitor
  let A = null, starting = false;
  window.DIOS = { get A() { return A; }, TIER, locked: () => locked(), micMode: () => S.mode };   // the soundboard (board.js) mixes into this graph
  let stream = null, src = null, raf = 0, muted = false, talking = false;
  let ttsLive = 0;
  let peakHold = 0, peakAt = 0, clips = 0, clipLatch = false, rec = null, recUrl = '';
  const outEl = new Audio(); const monEl = new Audio();
  outEl.autoplay = true; monEl.autoplay = true;

  function build() {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    const n = {
      ctx,
      pre: ctx.createAnalyser(),
      gain: ctx.createGain(),
      hp: ctx.createBiquadFilter(),
      gate: ctx.createGain(),
      bass: ctx.createBiquadFilter(),
      mid: ctx.createBiquadFilter(),
      treble: ctx.createBiquadFilter(),
      comp: ctx.createDynamicsCompressor(),
      makeup: ctx.createGain(),
      lim: ctx.createDynamicsCompressor(),
      shaper: ctx.createWaveShaper(),
      master: ctx.createGain(),
      post: ctx.createAnalyser(),
      dest: ctx.createMediaStreamDestination(),
      // voice changer: in -> [pitch] -> [ring mod] -> [band] -> [drive] -> out, with echo / cave sends
      vin: ctx.createGain(), vout: ctx.createGain(), tts: ctx.createGain(),
      ring: ctx.createGain(), ringOsc: ctx.createOscillator(), bhp: ctx.createBiquadFilter(), blp: ctx.createBiquadFilter(),
      vdrive: ctx.createWaveShaper(), delay: ctx.createDelay(1), fb: ctx.createGain(), wet: ctx.createGain(),
      conv: ctx.createConvolver(), cwet: ctx.createGain(), pitch: null
    };
    n.pre.fftSize = 1024;
    n.post.fftSize = 2048; n.post.smoothingTimeConstant = 0.72;
    n.hp.type = 'highpass'; n.hp.frequency.value = 85; n.hp.Q.value = 0.7;   // rumble and desk thumps eat headroom
    n.lim.threshold.value = -1; n.lim.knee.value = 0; n.lim.ratio.value = 20; n.lim.attack.value = 0.001; n.lim.release.value = 0.06;
    n.bass.type = 'lowshelf'; n.bass.frequency.value = 140;
    n.mid.type = 'peaking'; n.mid.frequency.value = 2800; n.mid.Q.value = 0.9;
    n.treble.type = 'highshelf'; n.treble.frequency.value = 6500;
    n.shaper.oversample = '4x';
    n.ringOsc.connect(n.ring.gain); n.ringOsc.start();
    n.bhp.type = 'highpass'; n.blp.type = 'lowpass';
    n.vdrive.curve = (() => { const c = new Float32Array(2048); for (let i = 0; i < 2048; i++) { const x = i / 1023.5 - 1; c[i] = Math.tanh(3 * x); } return c; })();
    n.conv.buffer = (() => {   // a dark 2.6 s cave: decaying noise, slightly different per ear
      const len = Math.round(ctx.sampleRate * 2.6), b = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2); }
      return b;
    })();
    n.tts.connect(n.vin);   // Type to talk enters here: it gets the voice changer, EQ and limiter, not the mic boost
    n.gain.connect(n.hp).connect(n.gate).connect(n.vin);
    n.vin.connect(n.vout);
    n.vout.connect(n.bass).connect(n.mid).connect(n.treble).connect(n.comp).connect(n.makeup).connect(n.lim).connect(n.shaper).connect(n.master);
    n.master.connect(n.post); n.master.connect(n.dest);
    return n;
  }

  let applyAll = function () {
    S.gain = capGain(S.gain);
    const g = S.gain;
    $('gain').max = TIER.maxDb;
    $('gain').value = fromGain(g);
    $('read').textContent = fmtX(g);
    $('db').textContent = '+' + Math.round(20 * Math.log10(g)) + ' dB';
    $('gate').value = S.gate; $('gateV').textContent = S.gate <= -90 ? 'Off' : fmtDb(S.gate);
    for (const k of ['bass', 'mid', 'treble']) { $(k).value = S[k]; $(k + 'V').textContent = fmtDb(S[k]); }
    $('mode').value = S.mode;
    $('monitor').checked = S.monitor; $('ptt').checked = S.ptt;
    document.querySelectorAll('[data-preset]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preset === S.preset)));
    if (!A) return;
    const t = A.ctx.currentTime;
    A.gain.gain.setTargetAtTime(g, t, 0.02);
    A.bass.gain.setTargetAtTime(S.bass, t, 0.03);
    A.mid.gain.setTargetAtTime(S.mid, t, 0.03);
    A.treble.gain.setTargetAtTime(S.treble, t, 0.03);
    if (A.gw) A.gw.parameters.get('threshold').value = S.gate;
    const m = S.mode, clear = m === 'clear', comp = m === 'comp', harsh = m === 'harsh';
    // clear: a voice compressor evens out loud and quiet words, makeup brings it up, the limiter holds the peaks
    A.comp.threshold.value = clear ? -26 : comp ? -30 : 0;
    A.comp.ratio.value = clear ? 5 : comp ? 12 : 1;
    A.comp.knee.value = clear ? 12 : comp ? 10 : 0;
    A.comp.attack.value = clear ? 0.004 : 0.003; A.comp.release.value = clear ? 0.2 : 0.15;
    A.makeup.gain.setTargetAtTime(harsh ? 40 : clear ? 3.2 : 1, t, 0.05);   // harsh: drive into the clipper; clear: louder makeup, the limiter still holds the peaks
    A.lim.ratio.value = clear || comp ? 20 : 1;
    A.lim.threshold.value = clear || comp ? -1 : 0;
    A.hp.frequency.value = m === 'hard' || m === 'soft' ? 30 : 85;
    A.shaper.curve = curveFor(clear || comp ? 'safe' : m);
    A.shaper.oversample = clear || comp || harsh ? 'none' : '4x';   // oversampling rings past full scale; the safe curve does not need it
    $('ns').checked = S.ns;
    setMaster();
    monEl.muted = !S.monitor;
    dispatchEvent(new Event('dios:micmode'));   // the soundboard opens the final stage when the mic is on Harsh max
  }

  /* ---------------- voice changer ---------------- */
  // pitch: <1 deeper, >1 higher; ring: robot / alien tone (Hz); band: phone or radio; drive: grit; echo / cave: space
  const VOICES = {
    off:      {},
    chipmunk: { pitch: 1.85 },
    high:     { pitch: 1.35, band: [180, 9000] },
    deep:     { pitch: 0.72 },
    demon:    { pitch: 0.55, drive: true, cave: .35 },
    robot:    { ring: 55, band: [250, 6000] },
    alien:    { pitch: 1.25, ring: 380 },
    radio:    { band: [500, 3000], drive: true },
    echo:     { echo: [.3, .45] },
    cave:     { cave: .7 },
    ghost:    { pitch: 0.9, echo: [.42, .35], cave: .5 }
  };
  function applyVoice() {
    if (!A) return;
    const a = A, v = VOICES[S.voice] || VOICES.off;
    [a.vin, a.ring, a.bhp, a.blp, a.vdrive, a.delay, a.fb, a.wet, a.conv, a.cwet].forEach(x => { try { x.disconnect(); } catch (e) {} });
    if (a.pitch) try { a.pitch.disconnect(); } catch (e) {}
    let node = a.vin;
    const to = x => { node.connect(x); node = x; };
    if (v.pitch && a.pitch) { a.pitch.parameters.get('ratio').value = v.pitch; to(a.pitch); }
    if (v.ring) { a.ring.gain.value = 0; a.ringOsc.frequency.value = v.ring; to(a.ring); }
    if (v.band) { a.bhp.frequency.value = v.band[0]; a.blp.frequency.value = v.band[1]; to(a.bhp); to(a.blp); }
    if (v.drive) to(a.vdrive);
    node.connect(a.vout);
    if (v.echo) {
      a.delay.delayTime.value = v.echo[0]; a.fb.gain.value = v.echo[1]; a.wet.gain.value = .6;
      node.connect(a.delay); a.delay.connect(a.fb).connect(a.delay); a.delay.connect(a.wet).connect(a.vout);
    }
    if (v.cave) { a.cwet.gain.value = v.cave; node.connect(a.conv); a.conv.connect(a.cwet).connect(a.vout); }
    $('voice').value = S.voice;
    if (v.pitch && !a.pitch) $('err').textContent = 'This browser cannot change pitch, so only part of this voice works. Use Chrome or Edge.';
  }
  async function addPitch(a) {
    try {
      await a.ctx.audioWorklet.addModule('voice-worklet.js');
      if (A !== a) return;
      a.pitch = new AudioWorkletNode(a.ctx, 'dios-pitch', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    } catch (e) { a.pitch = null; }
  }

  function setMaster() {
    const open = !muted && (!S.ptt || talking || ttsLive > 0);
    if (A) A.master.gain.setTargetAtTime(open ? 1 : 0, A.ctx.currentTime, 0.01);
    const chip = $('chip');
    if (!A) { chip.dataset.state = 'off'; $('chipText').textContent = 'Off'; return; }
    chip.dataset.state = open ? 'live' : 'muted';
    $('chipText').textContent = open ? 'Live' : (muted ? 'Muted' : 'Hold Space');
  }

  async function listDevices() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    const devs = await navigator.mediaDevices.enumerateDevices();
    const inp = $('inp'), out = $('out');
    inp.innerHTML = '<option value="">Default microphone</option>';
    out.innerHTML = '<option value="">Default output</option>';
    devs.forEach(d => {
      if (d.deviceId === 'default' || d.deviceId === 'communications' || !d.deviceId) return;
      const o = new Option(d.label || (d.kind === 'audioinput' ? 'Microphone' : 'Speaker'), d.deviceId);
      if (d.kind === 'audioinput') inp.add(o);
      if (d.kind === 'audiooutput') out.add(o);
    });
    if ([...inp.options].some(o => o.value === S.inp)) inp.value = S.inp;
    if ([...out.options].some(o => o.value === S.out)) out.value = S.out;
    if (!('setSinkId' in HTMLMediaElement.prototype)) { out.disabled = true; out.options[0].text = 'Default output (this browser cannot switch)'; }
  }

  // The noise gate runs in an AudioWorklet (gate-worklet.js) on the audio thread, so it keeps working in a
  // hidden or minimised tab. Chrome pauses the page's drawing loop there, which is where the gate used to run.
  async function addGate(a) {
    try {
      await a.ctx.audioWorklet.addModule('gate-worklet.js');
      if (A !== a) return;   // stopped while the worklet was loading
      const gw = new AudioWorkletNode(a.ctx, 'dios-gate', { numberOfInputs: 2, numberOfOutputs: 1, outputChannelCount: [1] });
      gw.port.onmessage = e => { if (!A) return; A._openUntil = e.data.open ? Infinity : 0; dispatchEvent(new CustomEvent('dios:talk', { detail: !!e.data.open })); };
      a.hp.disconnect(a.gate); a.hp.connect(gw, 0, 0); gw.connect(a.gate);
      a.gw = gw; a._openUntil = Infinity;
    } catch (e) { a.gw = null; }   // an old browser: the drawing loop gates instead, while the tab is visible
  }

  const getMic = id => navigator.mediaDevices.getUserMedia({ audio: {
    deviceId: id ? { exact: id } : undefined,
    echoCancellation: false, noiseSuppression: !!S.ns, autoGainControl: false } });

  async function openMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('this page needs HTTPS (or localhost) and a modern browser to use the microphone.');
    let s;
    try { s = await getMic(S.inp); }
    catch (e) {
      // the saved mic was unplugged or renamed: Chrome throws OverconstrainedError (with an empty message). Fall back to the default mic.
      if (!S.inp || !/Overconstrained|NotFound/.test(e.name)) throw e;
      S.inp = ''; save();
      const inp = $('inp'); if (inp) inp.value = '';
      s = await getMic('');
    }
    if (!A) { s.getTracks().forEach(t => t.stop()); throw new Error('stopped'); }
    if (src) src.disconnect();
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = s;
    src = A.ctx.createMediaStreamSource(stream);
    src.connect(A.pre); src.connect(A.gain);
    if (A.gw) src.connect(A.gw, 0, 1);
  }

  async function routeOut() {
    try {
      if (outEl.setSinkId) await outEl.setSinkId(S.out || '');
    } catch (e) { $('err').textContent = 'Could not switch output: ' + e.message; }
  }

  async function start() {
    if (starting) return;
    starting = true;
    $('err').textContent = '';
    let me = null;
    try {
      me = A = build();
      await addGate(me);
      if (A !== me) return;
      await addPitch(me);
      if (A !== me) return;
      await openMic();
      if (A !== me) return;
      await listDevices();
      outEl.srcObject = A.dest.stream; await routeOut();
      await outEl.play().catch(() => {});   // a blocked autoplay must not kill the amp; the 2 s watchdog retries play()
      monEl.srcObject = A.dest.stream; monEl.muted = !S.monitor;
      // the monitor only makes sense when the main output is not already your speakers
      if (S.out) await monEl.play().catch(() => {});
      if (A.ctx.state === 'suspended') await A.ctx.resume().catch(() => {});
      applyAll(); applyVoice();
      $('go').textContent = 'Stop'; $('go').dataset.live = '';
      $('rec').disabled = false;
      $('status').textContent = S.out ? 'Live. Sending to the selected output.' : 'Live on your default output. Pick CABLE Input to send it to Discord.';
      loop();
      dispatchEvent(new Event('dios:start'));
    } catch (e) {
      const why = e && e.name === 'NotAllowedError' ? 'microphone access was blocked. Allow it in the address bar.'
        : e && e.name === 'NotReadableError' ? 'the microphone is busy in another app (close it, or pick another mic) and try again.'
        : e && e.name === 'NotFoundError' ? 'no microphone was found. Plug one in and try again.'
        : (e && (e.message || e.name)) || String(e) || 'unknown error';
      console.error('[DIOS] start failed', e);
      $('err').textContent = 'Could not start: ' + why;
      if (!me || A === me) stop();
    } finally { starting = false; }
  }

  function stop() {
    if (A) dispatchEvent(new Event('dios:stop'));
    cancelAnimationFrame(raf); raf = 0;
    if (rec && rec.state === 'recording') rec.stop();
    if (stream) stream.getTracks().forEach(t => t.stop());
    outEl.pause(); monEl.pause(); outEl.srcObject = null; monEl.srcObject = null;
    if (A) A.ctx.close();
    A = null; stream = null; src = null; ttsLive = 0; ttsSrc = null;
    $('go').textContent = 'Start'; delete $('go').dataset.live;
    $('rec').disabled = true;
    $('bar').style.width = '0'; $('peak').style.left = '0';
    $('status').textContent = 'Press Start to boost your mic.';
    setMaster();
    idle();
  }

  /* ---------------- meter, gate, scope ---------------- */
  const scope = $('scope'), sc = scope.getContext('2d');
  let fbuf, tbuf, pbuf;
  function fitCanvas(c) {
    const r = c.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  function drawScope(freq, time) {
    fitCanvas(scope);
    const W = scope.width, H = scope.height;
    sc.clearRect(0, 0, W, H);
    // grid
    sc.strokeStyle = 'rgba(255,255,255,.05)'; sc.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = Math.round(H * i / 4) + .5; sc.beginPath(); sc.moveTo(0, y); sc.lineTo(W, y); sc.stroke(); }
    // spectrum bars, log spaced
    const bars = Math.min(96, Math.floor(W / 10)), bw = W / bars;
    const grad = sc.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, 'rgba(255,72,139,.15)'); grad.addColorStop(.6, 'rgba(255,72,139,.75)'); grad.addColorStop(1, '#ffd1e2');
    sc.fillStyle = grad;
    for (let i = 0; i < bars; i++) {
      let v;
      if (freq) {
        const lo = Math.floor(Math.pow(freq.length, i / bars)), hi = Math.max(lo + 1, Math.floor(Math.pow(freq.length, (i + 1) / bars)));
        let m = 0; for (let k = lo; k < hi && k < freq.length; k++) m = Math.max(m, freq[k]);
        v = m / 255;
      } else v = 0;
      const h = Math.max(2, v * H * .92);
      const x = i * bw + bw * .18, w = bw * .64;
      sc.beginPath(); sc.roundRect ? sc.roundRect(x, H - h, w, h, Math.min(4, w / 2)) : sc.rect(x, H - h, w, h); sc.fill();
    }
    // waveform
    if (time) {
      sc.strokeStyle = 'rgba(255,255,255,.9)'; sc.lineWidth = Math.max(1.5, W / 800);
      sc.beginPath();
      const step = Math.max(1, Math.floor(time.length / W * 2));
      for (let i = 0, x = 0; i < time.length; i += step, x++) {
        const px = i / time.length * W, py = H / 2 - time[i] * H * .42;
        i === 0 ? sc.moveTo(px, py) : sc.lineTo(px, py);
      }
      sc.stroke();
    }
  }

  function loop() {
    if (!A) return;
    fbuf = fbuf && fbuf.length === A.post.frequencyBinCount ? fbuf : new Uint8Array(A.post.frequencyBinCount);
    tbuf = tbuf && tbuf.length === A.post.fftSize ? tbuf : new Float32Array(A.post.fftSize);
    pbuf = pbuf && pbuf.length === A.pre.fftSize ? pbuf : new Float32Array(A.pre.fftSize);
    A.post.getByteFrequencyData(fbuf);
    A.post.getFloatTimeDomainData(tbuf);
    A.pre.getFloatTimeDomainData(pbuf);

    // noise gate on the raw mic level (before the boost), with a short hold so words are not chopped
    let rms = 0; for (const v of pbuf) rms += v * v; rms = Math.sqrt(rms / pbuf.length);
    const db = 20 * Math.log10(rms + 1e-9);
    const now = performance.now();
    if (!A.gw) {   // fallback only: the worklet gate normally does this on the audio thread
      if (S.gate <= -90 || db > S.gate) A._openUntil = now + 180;
      const gateOpen = now < (A._openUntil || 0);
      A.gate.gain.setTargetAtTime(gateOpen ? 1 : 0, A.ctx.currentTime, gateOpen ? 0.005 : 0.05);
    }

    // output peak meter, peak hold and clip count
    let p = 0; for (const v of tbuf) p = Math.max(p, Math.abs(v));
    $('bar').style.width = Math.min(100, p * 100) + '%';
    if (p > peakHold || now - peakAt > 1200) { peakHold = p; peakAt = now; }
    $('peak').style.left = 'calc(' + Math.min(100, peakHold * 100) + '% - 2px)';
    if (p >= 0.985 && !clipLatch) { clips++; clipLatch = true; $('clipText').textContent = clips + (clips === 1 ? ' clip' : ' clips'); $('clip').dataset.state = 'clip'; }
    if (p < 0.9) clipLatch = false;
    if (now - peakAt > 600 && p < 0.9) $('clip').dataset.state = 'off';

    drawScope(fbuf, tbuf);
    raf = requestAnimationFrame(loop);
  }

  // resting picture of the scope: a calm line, drawn once (no loop when the mic is off)
  function idle() {
    const t = new Float32Array(512);
    for (let i = 0; i < t.length; i++) t[i] = Math.sin(i / t.length * Math.PI * 6) * .04 * Math.sin(i / t.length * Math.PI);
    drawScope(null, t);
  }

  /* ---------------- recorder ---------------- */
  function record() {
    if (!A || (rec && rec.state === 'recording')) return;
    if (!window.MediaRecorder) { $('err').textContent = 'This browser cannot record.'; return; }
    const chunks = [];
    rec = new MediaRecorder(A.dest.stream);
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      if (recUrl) URL.revokeObjectURL(recUrl);
      recUrl = URL.createObjectURL(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }));
      $('play').disabled = false; $('rec').textContent = 'Record 5 s'; delete $('rec').dataset.rec;
      $('status').textContent = 'Test ready. Press Play test to hear what Discord gets.';
    };
    rec.start();
    $('rec').dataset.rec = ''; $('play').disabled = true;
    let left = 5; $('rec').textContent = 'Recording ' + left;
    const tick = setInterval(() => {
      left--; if (left > 0 && rec.state === 'recording') $('rec').textContent = 'Recording ' + left;
      else { clearInterval(tick); if (rec.state === 'recording') rec.stop(); }
    }, 1000);
  }
  const player = new Audio();
  function playTest() {
    if (!recUrl) return;
    player.src = recUrl;
    // play on the default output, so you hear it even when the amp goes to the cable
    player.play().catch(e => { $('err').textContent = 'Could not play: ' + e.message; });
  }

  /* ---------------- controls ---------------- */
  const set = (patch, keepPreset) => { Object.assign(S, patch); if (!keepPreset) S.preset = ''; save(); applyAll(); };
  $('gain').addEventListener('input', e => set({ gain: toGain(+e.target.value) }));
  document.querySelectorAll('.c-chips [data-x]').forEach(b => b.addEventListener('click', () => { if (b.hasAttribute('data-pro') && !TIER.pro) { locked(); return; } set({ gain: +b.dataset.x }); }));
  $('gate').addEventListener('input', e => set({ gate: +e.target.value }));
  for (const k of ['bass', 'mid', 'treble']) $(k).addEventListener('input', e => set({ [k]: +e.target.value }));
  $('mode').addEventListener('change', e => set({ mode: e.target.value }));
  document.querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => { if (b.hasAttribute('data-pro') && !TIER.pro) { locked(); return; } set({ ...PRESETS[b.dataset.preset], preset: b.dataset.preset }, true); }));
  $('monitor').addEventListener('change', e => { set({ monitor: e.target.checked }, true); if (A && S.monitor) monEl.play().catch(() => {}); });
  $('ptt').addEventListener('change', e => set({ ptt: e.target.checked }, true));
  $('ns').addEventListener('change', async e => {
    set({ ns: e.target.checked }, true);
    if (A) { try { await openMic(); } catch (err) { $('err').textContent = 'Could not restart the microphone: ' + err.message; } }
  });
  $('inp').addEventListener('change', async e => {
    S.inp = e.target.value; save();
    if (A) { try { await openMic(); } catch (err) { $('err').textContent = 'Could not switch microphone: ' + err.message; } }
  });
  $('out').addEventListener('change', async e => {
    S.out = e.target.value; save();
    if (A) { await routeOut(); if (S.out) monEl.play().catch(() => {}); }
  });
  $('voice').addEventListener('change', e => { S.voice = e.target.value; save(); applyVoice(); });
  document.querySelectorAll('[data-voice]').forEach(b => b.addEventListener('click', () => { S.voice = b.dataset.voice; save(); $('voice').value = S.voice; applyVoice(); }));
  $('voice').value = S.voice;

  /* ---------------- type to talk ---------------- */
  // the text is spoken by a voice service (through /api/tts), then played into the amp after the mic boost,
  // so it gets the voice changer, EQ and limiter and Discord hears it like your mic
  $('ttsLang').value = S.ttsLang;
  $('ttsLang').addEventListener('change', e => { S.ttsLang = e.target.value; save(); });
  const ttsCache = new Map();
  let ttsSrc = null;
  async function speak() {
    const text = $('ttsText').value.trim();
    if (!text) { $('err').textContent = 'Type something to say.'; return; }
    $('err').textContent = '';
    const btn = $('ttsGo'); btn.disabled = true; btn.textContent = 'Loading…';
    try {
      const k = S.ttsLang + '|' + text;
      let bytes = ttsCache.get(k);
      if (!bytes) {
        const r = await fetch('/api/tts?' + new URLSearchParams({ text, lang: S.ttsLang }), { credentials: 'same-origin' });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'The voice service did not answer.'); }
        bytes = await r.arrayBuffer(); ttsCache.set(k, bytes);
        if (ttsCache.size > 30) ttsCache.delete(ttsCache.keys().next().value);
      }
      if (!A) {   // the amp is off: just let you hear it
        const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
        const au = new Audio(url); au.onended = () => URL.revokeObjectURL(url); await au.play();
        $('status').textContent = 'Played only for you. Press Start to say it in Discord.';
        return;
      }
      const buf = await A.ctx.decodeAudioData(bytes.slice(0));
      if (ttsSrc) try { ttsSrc.stop(); } catch (e) {}
      const s = A.ctx.createBufferSource(); s.buffer = buf; s.connect(A.tts);
      ttsLive++; setMaster();
      s.onended = () => { ttsLive = Math.max(0, ttsLive - 1); if (ttsSrc === s) ttsSrc = null; setMaster(); };
      ttsSrc = s; s.start();
      $('status').textContent = 'Saying it in Discord.';
    } catch (e) {
      $('err').textContent = 'Could not speak: ' + (e.message || e.name);
    } finally { btn.disabled = false; btn.textContent = 'Say it'; }
  }
  $('ttsGo').addEventListener('click', speak);
  $('ttsText').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); speak(); } });
  $('ttsStop').addEventListener('click', () => { if (ttsSrc) try { ttsSrc.stop(); } catch (e) {} });

  $('go').addEventListener('click', () => { if (starting) return; A ? stop() : start(); });
  $('rec').addEventListener('click', record);
  $('play').addEventListener('click', playTest);

  const typing = t => t && (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  document.addEventListener('keydown', e => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === 'KeyM' && !e.repeat) { muted = !muted; setMaster(); }
    else if (e.code === 'KeyR' && !e.repeat && A) record();
    else if (e.code === 'Space' && S.ptt && A) { e.preventDefault(); if (!talking) { talking = true; setMaster(); } }
  });
  document.addEventListener('keyup', e => { if (e.code === 'Space' && talking) { talking = false; setMaster(); } });
  window.addEventListener('blur', () => { if (talking) { talking = false; setMaster(); } });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) navigator.mediaDevices.addEventListener('devicechange', () => listDevices().catch(() => {}));

  /* ---------------- liquid glass details ---------------- */
  // slider fill (the glass track shows the accent up to the bead)
  const paintRange = r => r.style.setProperty('--fill', ((r.value - r.min) / (r.max - r.min) * 100) + '%');
  const ranges = [...document.querySelectorAll('.c-range')];
  ranges.forEach(r => { paintRange(r); r.addEventListener('input', () => paintRange(r)); });
  const _apply = applyAll; applyAll = function () { _apply(); ranges.forEach(paintRange); };
  // the specular sheen follows the pointer across each glass sheet
  if (!reduce && matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('#amp .console, .hero-win, .feat .card, .ext-pop, .setup-glass, #setup .panel, .faq').forEach(el => {
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect();
        el.style.setProperty('--mx', (e.clientX - r.left) + 'px');
        el.style.setProperty('--my', (e.clientY - r.top) + 'px');
      });
    });
  }

  /* ---------------- keep working in the background ---------------- */
  // The sound never depends on this page being visible. If Chrome suspends the audio engine anyway
  // (after a device change or the PC waking from sleep), start it again; the drawing loop restarts on return.
  document.addEventListener('visibilitychange', () => {
    if (!A) return;
    if (A.ctx.state === 'suspended') A.ctx.resume().catch(() => {});
    if (document.hidden && !A.gw) A.gate.gain.setTargetAtTime(1, A.ctx.currentTime, 0.01);   // fallback gate: never freeze shut
    if (!document.hidden) { cancelAnimationFrame(raf); loop(); }
  });
  setInterval(() => {
    if (!A) return;
    if (A.ctx.state === 'suspended') A.ctx.resume().catch(() => {});
    if (outEl.paused && outEl.srcObject) outEl.play().catch(() => {});
  }, 2000);
  // the screen stays awake while live, where the browser allows it
  let wake = null;
  const keepAwake = async on => {
    try {
      if (on && !wake && navigator.wakeLock && !document.hidden) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
      else if (!on && wake) { await wake.release(); wake = null; }
    } catch (e) {}
  };
  addEventListener('dios:start', () => keepAwake(true)); addEventListener('dios:stop', () => keepAwake(false));
  document.addEventListener('visibilitychange', () => { if (A && !document.hidden) keepAwake(true); });

  // type a Pro key right here: it replaces this browser's key and unlocks the levels without signing out
  const proForm = $('proForm');
  if (proForm) proForm.addEventListener('submit', async e => {
    e.preventDefault();
    const inp = $('proKey'), msg = $('proMsg'), go = $('proGo');
    msg.textContent = ''; msg.dataset.state = '';
    if (!inp.value.trim()) { msg.textContent = 'Paste your Pro key first.'; inp.focus(); return; }
    go.disabled = true; go.textContent = 'Checking…';
    try {
      const r = await fetch('/api/unlock', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: inp.value }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { msg.textContent = j.error || 'That key did not work.'; msg.dataset.state = 'bad'; }
      else if (!j.pro) { msg.textContent = 'That is a normal key, so the levels stay at 100,000x. Ask an admin for a Pro key.'; msg.dataset.state = 'bad'; }
      else {
        inp.value = ''; msg.textContent = 'Pro unlocked. You can now go up to 1,000,000,000x.'; msg.dataset.state = 'ok';
        TIER.pro = true; TIER.maxDb = 180; document.documentElement.dataset.tier = 'pro';
        keyExp = j.exp || 0; paintTier();
        applyAll(); dispatchEvent(new Event('dios:tier'));
        setTimeout(() => { proForm.hidden = true; }, 2500);
      }
    } catch (err) { msg.textContent = 'Could not reach the server. Check your connection.'; msg.dataset.state = 'bad'; }
    go.disabled = false; go.textContent = 'Unlock Pro';
  });

  // ask the server what this key unlocks and when it ends; until it answers, the page acts as a normal key.
  // It asks again every minute: a key an admin turned off stops the amp and goes back to the key screen.
  document.documentElement.dataset.tier = 'normal';
  const life = exp => {
    if (!exp) return 'never expires';
    const s = exp - Date.now() / 1000;
    if (s <= 0) return 'expired';
    const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.ceil(s % 3600 / 60);
    return 'ends in ' + (d >= 2 ? Math.ceil(s / 86400) + ' days' : d === 1 ? '1 day ' + h + ' h' : h >= 1 ? h + ' h ' + m + ' min' : m + ' min');
  };
  let keyExp = 0;
  const paintTier = () => {
    const n = $('proNote'); if (!n) return;
    n.firstElementChild.textContent = (TIER.pro ? 'Pro key' : 'Normal key') + ' · ' + life(keyExp);
    n.lastElementChild.textContent = TIER.pro ? 'All levels unlocked, up to 1,000,000,000x (+180 dB).' : 'Up to 100,000x. A Pro key unlocks up to 1,000,000,000x.';
    if ($('proForm')) $('proForm').hidden = TIER.pro;
  };
  const kicked = reason => {
    if (A) stop();
    const e = $('err'); e.textContent = reason === 'expired' ? 'Your key has expired.' : 'Your key was turned off by an admin.';
    setTimeout(() => location.replace('/unlock.html?' + (reason === 'expired' ? 'expired=1' : 'off=1')), 1800);
  };
  const checkKey = first => fetch('/api/me' + (first ? '?load=1' : ''), { credentials: 'same-origin', cache: 'no-store' }).then(r => r.json()).then(j => {
    if (!j || !j.ok) { if (j && (j.reason === 'revoked' || j.reason === 'expired')) kicked(j.reason); return; }
    const was = TIER.pro;
    TIER.pro = !!j.pro; TIER.maxDb = TIER.pro ? 180 : 100; keyExp = j.exp || 0;
    document.documentElement.dataset.tier = TIER.pro ? 'pro' : 'normal';
    paintTier();
    if (first || was !== TIER.pro) { applyAll(); dispatchEvent(new Event('dios:tier')); }
  }).catch(() => {});
  checkKey(true);
  setInterval(() => checkKey(false), 60000);
  setInterval(paintTier, 30000);

  applyAll();
  listDevices().catch(() => {});
  idle();
  addEventListener('resize', () => { if (!A) idle(); });

  /* ---------------- hero waveform (the page's one timed loop) ---------------- */
  const hc = $('heroWave');
  if (hc) {
    const g = hc.getContext('2d');
    let t0 = performance.now(), paused = reduce, hraf = 0, visible = true;
    const draw = now => {
      fitCanvas(hc);
      const W = hc.width, H = hc.height, t = (now - t0) / 1000;
      g.clearRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,.05)'; g.lineWidth = 1;
      for (let i = 1; i < 4; i++) { const y = Math.round(H * i / 4) + .5; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
      // a speech-like envelope: syllables come and go
      const env = x => { const s = x * 7 + t * 1.6; return Math.max(0, Math.sin(s) * .6 + Math.sin(s * 2.3 + 1) * .4) ** 1.4; };
      const wave = x => Math.sin(x * 90 + t * 9) * .55 + Math.sin(x * 211 + t * 13) * .3 + Math.sin(x * 37 - t * 4) * .15;
      const N = Math.min(700, Math.floor(W / 1.6));
      // input: small and grey
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = Math.max(1, W / 900);
      g.beginPath();
      for (let i = 0; i <= N; i++) { const x = i / N, y = H / 2 - wave(x) * env(x) * H * .06; i ? g.lineTo(x * W, y) : g.moveTo(0, y); }
      g.stroke();
      // output: boosted 1000x into a soft clip
      g.strokeStyle = '#ff488b'; g.lineWidth = Math.max(2, W / 420);
      g.shadowColor = 'rgba(255,72,139,.6)'; g.shadowBlur = W / 60;
      g.beginPath();
      for (let i = 0; i <= N; i++) { const x = i / N, v = Math.tanh(wave(x) * env(x) * 6) / Math.tanh(2.5), y = H / 2 - v * H * .4; i ? g.lineTo(x * W, y) : g.moveTo(0, y); }
      g.stroke(); g.shadowBlur = 0;
    };
    const run = now => { draw(now); if (!paused && visible) hraf = requestAnimationFrame(run); };
    draw(performance.now() + 1200);
    if (!reduce) hraf = requestAnimationFrame(run);
    const btn = $('heroPause');
    const setBtn = () => {
      btn.setAttribute('aria-pressed', String(paused));
      btn.setAttribute('aria-label', paused ? 'Play the waveform' : 'Pause the waveform');
      btn.innerHTML = paused
        ? '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2l6 4-6 4z" fill="currentColor"/></svg>'
        : '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2v8M8.5 2v8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    };
    btn.addEventListener('click', () => { paused = !paused; setBtn(); cancelAnimationFrame(hraf); if (!paused) hraf = requestAnimationFrame(run); });
    setBtn();
    new IntersectionObserver(es => { visible = es[0].isIntersecting; cancelAnimationFrame(hraf); if (visible && !paused) hraf = requestAnimationFrame(run); }).observe(hc);
    addEventListener('resize', () => { if (paused) draw(performance.now()); });
  }
})();
