/* DIOS Amplifier: music amplifier for any PC audio.
   Takes the sound of a Chrome tab, of the whole computer, or of your own music files, makes it loud and
   dense, and adds it to the mix Discord hears (board.js shares that mix as window.DIOS.mix).
   source ─ volume ─ duck ─ boost ─ 10-band EQ ─ bass enhancer ─ width ─ 3-band maximizer ─ limiter ─ clip ─ mix
   It runs on the audio thread, so it keeps playing in a background tab. Plain script, no build. */
(() => {
  const $ = id => document.getElementById(id);
  if (!$('muCapture')) return;
  const KEY = 'dios-music-v1';
  const FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const FLAT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const PRESETS = {
    flat:  { name: 'Flat',        note: 'as it is',            boost: 0,  loud: 0,   bass: 0,   wide: 0,  mode: 'clear', eq: FLAT },
    loud:  { name: 'Loud',        note: '10x · tight',         boost: 20, loud: .5,  bass: .2,  wide: .2, mode: 'clear', eq: [2, 2, 1, 0, 0, 0, 1, 2, 2, 1] },
    max:   { name: 'Max loud',    note: '1,000x · dense',      boost: 60, loud: 1,   bass: .35, wide: .3, mode: 'clear', eq: [3, 3, 2, 0, -1, 0, 1, 3, 3, 2] },
    bass:  { name: 'Bass cannon', note: 'sub and kick up',     boost: 30, loud: .7,  bass: 1,   wide: .1, mode: 'clear', eq: [8, 7, 5, 2, 0, -1, 0, 1, 1, 0] },
    vocal: { name: 'Vocal clear', note: 'words in front',      boost: 20, loud: .5,  bass: 0,   wide: 0,  mode: 'clear', eq: [-3, -2, -1, 0, 2, 4, 5, 3, 1, 0] },
    night: { name: 'Night',       note: 'quiet parts lifted',  boost: 12, loud: .8,  bass: 0,   wide: 0,  mode: 'clear', eq: [-2, -1, 0, 0, 1, 1, 1, 0, 0, -1] },
    blast: { name: 'Ear blast',   note: '100,000x · hard clip', boost: 100, loud: 1, bass: .6,  wide: 0,  mode: 'hard',  eq: [6, 5, 3, 0, 0, 0, 2, 3, 2, 0] },
    ultra: { name: 'Ultra',       note: '100,000,000x · Pro', boost: 160, loud: 1,  bass: .4,  wide: .2, mode: 'clear', eq: [3, 3, 2, 0, -1, 0, 1, 3, 3, 2], pro: true }
  };
  const DEF = { vol: 100, boost: 20, loud: .5, bass: .2, wide: .2, mode: 'clear', eq: PRESETS.loud.eq.slice(), preset: 'loud', duck: false, hear: false };
  let S = { ...DEF };
  try { S = { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; if (!Array.isArray(S.eq) || S.eq.length !== 10) S.eq = FLAT.slice(); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  const status = t => { $('muStatus').textContent = t; };
  const err = t => { $('muErr').textContent = t || ''; };
  const xOf = db => Math.pow(10, db / 20);
  const fmtX = db => { const g = xOf(db); return (g >= 100 ? Math.round(g).toLocaleString('en') : g.toFixed(1).replace(/\.0$/, '')) + 'x'; };
  // a normal key stops at +100 dB (100,000x), a Pro key at +160 dB (100,000,000x), the same as the mic
  const T = () => (window.DIOS && window.DIOS.TIER) || { pro: false, maxDb: 100 };
  const LOCK = '<svg class="lock" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 5.5V4a2.5 2.5 0 0 1 5 0v1.5"/><rect x="2.5" y="5.5" width="7" height="5" rx="1.2"/></svg>';

  /* ---------------- build the controls that repeat ---------------- */
  const eqBox = $('muEq');
  FREQS.forEach((f, i) => {
    const d = document.createElement('div'); d.className = 'm-band';
    const lab = f >= 1000 ? f / 1000 + 'k' : String(f);
    d.innerHTML = '<output id="muEqV' + i + '">0</output><input class="m-vr" type="range" id="muEq' + i + '" min="-12" max="12" step="1" value="0" aria-label="' + lab + ' hertz"><span>' + lab + '</span>';
    eqBox.appendChild(d);
    d.querySelector('input').addEventListener('input', e => { const eq = S.eq.slice(); eq[i] = +e.target.value; set({ eq }); });
  });
  const preBox = $('muPresets');
  Object.entries(PRESETS).forEach(([id, p]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'c-preset' + (p.pro ? ' c-preset--pro' : ''); b.dataset.mu = id; b.setAttribute('aria-pressed', 'false');
    if (p.pro) b.setAttribute('data-pro', '');
    b.innerHTML = '<b>' + (p.pro ? LOCK : '') + '</b><span></span>';
    b.firstChild.appendChild(document.createTextNode(p.name)); b.lastChild.textContent = p.note;
    b.addEventListener('click', () => {
      if (p.pro && !T().pro) { window.DIOS.locked(); return; }
      const { name, note, pro, ...v } = p; set({ ...v, eq: p.eq.slice(), preset: id }, true);
    });
    preBox.appendChild(b);
  });

  /* ---------------- engine ---------------- */
  let M = null;                        // the live chain, in the amp's audio context
  let capStream = null, capKind = '';  // shared tab or computer audio
  let capNode = null, fileNode = null, fileStream = null;
  const player = $('muPlayer');        // <audio> for your own files
  let list = [], cur = -1;

  function build(A, mix) {
    const ctx = A.ctx, D = window.DIOS, g = v => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const bq = (type, f, q) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; if (q) n.Q.value = q; return n; };
    const m = { ctx, inp: g(1), duck: g(1), boost: g(1), eq: FREQS.map(f => bq('peaking', f, 1.2)),
      shelf: bq('lowshelf', 90), subLp: bq('lowpass', 110, .7), subDrv: ctx.createWaveShaper(), subMix: g(0), preWide: g(1),
      split: ctx.createChannelSplitter(2), merge: ctx.createChannelMerger(2), mid: g(.5), sideL: g(.5), sideR: g(-.5), sideAmt: g(1), sInv: g(-1),
      lo1: bq('lowpass', 200, .707), lo2: bq('lowpass', 200, .707), mh1: bq('highpass', 200, .707), mh2: bq('highpass', 200, .707),
      ml1: bq('lowpass', 4000, .707), ml2: bq('lowpass', 4000, .707), hi1: bq('highpass', 4000, .707), hi2: bq('highpass', 4000, .707),
      cLo: ctx.createDynamicsCompressor(), cMid: ctx.createDynamicsCompressor(), cHi: ctx.createDynamicsCompressor(),
      sum: g(1), makeup: g(1), lim: ctx.createDynamicsCompressor(), clip: ctx.createWaveShaper(), out: g(1), meter: ctx.createAnalyser(), hear: g(0) };
    const sc = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 1023 * 2 - 1; sc[i] = Math.tanh(4 * x); }
    m.subDrv.curve = sc; m.meter.fftSize = 1024; m.meter.smoothingTimeConstant = .78;
    m.lim.knee.value = 0; m.lim.ratio.value = 20; m.lim.attack.value = .001; m.lim.release.value = .08;
    m.inp.connect(m.duck).connect(m.boost);
    let n = m.boost; m.eq.forEach(f => { n = n.connect(f); });
    // bass enhancer: a shelf for weight, plus harmonics made from the sub so small speakers still carry the bass line
    n.connect(m.shelf).connect(m.preWide);
    n.connect(m.subLp).connect(m.subDrv).connect(m.subMix).connect(m.preWide);
    // width: split into middle and side, turn the side up, put it back together
    m.preWide.channelCountMode = 'explicit'; m.preWide.channelCount = 2;
    m.preWide.connect(m.split);
    m.split.connect(m.mid, 0); m.split.connect(m.mid, 1);
    m.split.connect(m.sideL, 0); m.split.connect(m.sideR, 1);
    m.sideL.connect(m.sideAmt); m.sideR.connect(m.sideAmt);
    m.mid.connect(m.merge, 0, 0); m.mid.connect(m.merge, 0, 1);
    m.sideAmt.connect(m.merge, 0, 0); m.sideAmt.connect(m.sInv).connect(m.merge, 0, 1);
    // maximizer: lows, mids and highs are squeezed on their own, so a kick drum cannot push the vocals down
    m.merge.connect(m.lo1).connect(m.lo2).connect(m.cLo).connect(m.sum);
    m.merge.connect(m.mh1).connect(m.mh2).connect(m.ml1).connect(m.ml2).connect(m.cMid).connect(m.sum);
    m.merge.connect(m.hi1).connect(m.hi2).connect(m.cHi).connect(m.sum);
    m.sum.connect(m.makeup).connect(m.lim).connect(m.clip).connect(m.out);
    m.out.connect(mix); m.out.connect(m.meter); m.out.connect(m.hear).connect(ctx.destination);
    m.safe = D.safeCurve; m.hard = D.hardCurve;
    return m;
  }

  function apply() {
    paint();
    if (!M) return;
    const t = M.ctx.currentTime, k = (p, v, tc = .03) => p.setTargetAtTime(v, t, tc), L = S.loud, hard = S.mode === 'hard';
    k(M.inp.gain, S.vol / 100); k(M.boost.gain, xOf(S.boost));
    M.eq.forEach((f, i) => k(f.gain, S.eq[i]));
    k(M.shelf.gain, S.bass * 9); k(M.subMix.gain, S.bass * .5);
    k(M.sideAmt.gain, 1 + S.wide * 1.5);
    [[M.cLo, -18, 3], [M.cMid, -20, 2.5], [M.cHi, -22, 3]].forEach(([c, thr, ratio]) => {
      c.threshold.value = hard ? 0 : thr - L * 16; c.ratio.value = hard ? 1 : 1 + (ratio - 1) * (.4 + L * 1.6);
      c.knee.value = 8; c.attack.value = .008; c.release.value = .14;
    });
    k(M.makeup.gain, hard ? 1 : 1 + L * 2.4, .05);
    M.lim.threshold.value = hard ? 0 : -2; M.lim.ratio.value = hard ? 1 : 20;
    M.clip.curve = hard ? M.hard : M.safe; M.clip.oversample = hard ? '4x' : 'none';
    // your speakers already play the original, so the boosted copy plays back only when asked,
    // and never while the whole computer is captured (it would feed back into itself)
    k(M.hear.gain, S.hear && capKind !== 'monitor' ? 1 : 0);
  }

  function hook() {
    if (capNode) { try { capNode.disconnect(); } catch (e) {} capNode = null; }
    if (fileNode) { try { fileNode.disconnect(); } catch (e) {} fileNode = null; }
    if (!M) return;
    if (capStream) { capNode = M.ctx.createMediaStreamSource(capStream); capNode.connect(M.inp); }
    if (fileStream && fileStream.getAudioTracks().length) { fileNode = M.ctx.createMediaStreamSource(fileStream); fileNode.connect(M.inp); }
  }

  /* ---------------- source 1: a tab or the whole computer ---------------- */
  async function capture() {
    err();
    if (capStream) { dropCapture(); return; }
    const md = navigator.mediaDevices;
    if (!md || !md.getDisplayMedia) { err('This browser cannot share audio. Use Chrome or Edge on a computer.'); return; }
    try {
      const s = await md.getDisplayMedia({
        video: { frameRate: 1, width: 320, height: 180 },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: false, channelCount: 2 },
        selfBrowserSurface: 'exclude', systemAudio: 'include', surfaceSwitching: 'include', monitorTypeSurfaces: 'include'
      });
      if (!s.getAudioTracks().length) {
        s.getTracks().forEach(t => t.stop());
        err('No sound came through. Pick a Chrome tab or Entire screen and switch on "Also share audio". A single app window carries no sound.');
        return;
      }
      const vt = s.getVideoTracks()[0];
      const kind = vt && vt.getSettings ? (vt.getSettings().displaySurface || '') : '';
      if (kind === 'monitor' && !$('out').value) {
        s.getTracks().forEach(t => t.stop());
        err('Whole-computer audio needs the cable first: set Output above to CABLE Input. On your speakers the boosted sound would be captured again and howl.');
        return;
      }
      s.getVideoTracks().forEach(t => { t.enabled = false; });   // only the sound is used
      capStream = s; capKind = kind;
      s.getAudioTracks()[0].addEventListener('ended', dropCapture);
      hook(); apply();
      status(M ? 'Live. This audio goes to Discord, boosted.' : 'Audio connected. Press Start above to send it to Discord.');
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') err('Could not share audio: ' + e.message);
    }
    paint();
  }
  function dropCapture() {
    if (capStream) capStream.getTracks().forEach(t => t.stop());
    capStream = null; capKind = ''; hook(); paint();
    status('PC audio disconnected.');
  }

  /* ---------------- source 2: your own files ---------------- */
  const isAudio = f => /^(audio|video)\//.test(f.type) || /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i.test(f.name);
  function addFiles(files) {
    err();
    const ok = [...files].filter(isAudio);
    if (!ok.length) { err('Add audio files: mp3, wav, ogg, m4a or flac.'); return; }
    ok.forEach(f => list.push({ name: f.name.replace(/\.[^.]+$/, ''), url: URL.createObjectURL(f) }));
    renderList();
    if (cur < 0) play(0);
  }
  function play(i) {
    if (!list.length) return;
    cur = (i + list.length) % list.length;
    player.src = list[cur].url;
    player.play().catch(e => err('Could not play this file: ' + e.message));
    if (!fileStream) {
      const cs = player.captureStream || player.mozCaptureStream;
      if (!cs) { err('This browser cannot send files to Discord. Use Chrome or Edge.'); return; }
      fileStream = cs.call(player);
      fileStream.addEventListener('addtrack', hook);
    }
    renderList();
  }
  player.addEventListener('playing', () => { hook(); paint(); });
  player.addEventListener('ended', () => play(cur + 1));
  player.addEventListener('pause', paint);
  player.addEventListener('timeupdate', () => {
    if (!player.duration) return;
    $('muSeek').value = player.currentTime / player.duration * 1000; paintRange($('muSeek'));
    $('muTime').textContent = fmtT(player.currentTime) + ' / ' + fmtT(player.duration);
  });
  const fmtT = s => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  function renderList() {
    const box = $('muList'); box.textContent = '';
    list.forEach((it, i) => {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'm-track'; b.textContent = it.name; b.title = it.name;
      if (i === cur) b.setAttribute('aria-current', 'true');
      b.addEventListener('click', () => play(i));
      box.appendChild(b);
    });
    $('muEmpty').hidden = list.length > 0;
  }

  /* ---------------- lower the music while you talk; the meter ---------------- */
  addEventListener('dios:talk', e => { if (M && S.duck && +$('gate').value > -90) M.duck.gain.setTargetAtTime(e.detail ? .25 : 1, M.ctx.currentTime, e.detail ? .04 : .35); });
  let raf = 0, fb = null;
  const cv = $('muScope'), cx = cv.getContext('2d');
  const RGB = (() => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--p-accent').trim() || '#ff3d8b'; const h = c.fillStyle; return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(','); })();
  function draw() {
    const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1), W = Math.max(1, Math.round(r.width * d)), H = Math.max(1, Math.round(r.height * d));
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    cx.clearRect(0, 0, W, H);
    const bars = Math.max(12, Math.min(64, Math.floor(W / 12))), bw = W / bars, t = performance.now() / 1000;
    if (M) { fb = fb && fb.length === M.meter.frequencyBinCount ? fb : new Uint8Array(M.meter.frequencyBinCount); M.meter.getByteFrequencyData(fb); }
    for (let i = 0; i < bars; i++) {
      let v = 0;
      if (M && fb) { const lo = Math.floor(Math.pow(fb.length, i / bars)), hi = Math.max(lo + 1, Math.floor(Math.pow(fb.length, (i + 1) / bars))); for (let j = lo; j < hi && j < fb.length; j++) v = Math.max(v, fb[j]); v /= 255; }
      else v = .06 + .05 * Math.sin(i * .5 + t);
      const h = Math.max(2, v * H * .94);
      cx.fillStyle = 'rgba(' + RGB + ',' + (.25 + v * .75) + ')';
      cx.beginPath(); cx.roundRect ? cx.roundRect(i * bw + bw * .2, H - h, bw * .6, h, Math.min(4, bw * .3)) : cx.rect(i * bw + bw * .2, H - h, bw * .6, h); cx.fill();
    }
    if (M && !document.hidden) raf = requestAnimationFrame(draw);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden && M) { cancelAnimationFrame(raf); draw(); } });

  /* ---------------- amp start / stop ---------------- */
  addEventListener('dios:start', () => {
    const D = window.DIOS, A = D && D.A; if (!A || !D.mix) return;
    M = build(A, D.mix); hook(); apply(); cancelAnimationFrame(raf); draw();
    status(capStream || (fileStream && !player.paused) ? 'Live. Your music goes to Discord, boosted.' : 'Live. Connect PC audio or add music files.');
  });
  addEventListener('dios:stop', () => {
    M = null; capNode = null; fileNode = null; cancelAnimationFrame(raf); draw();
    status('The amplifier is off. Press Start above to send music to Discord.');
  });

  /* ---------------- controls ---------------- */
  const paintRange = r => r.style.setProperty('--fill', ((r.value - r.min) / (r.max - r.min) * 100) + '%');
  function paint() {
    $('muBoost').max = T().maxDb;
    $('muVol').value = S.vol; $('muVolV').textContent = S.vol + '%';
    $('muBoost').value = S.boost; $('muBoostV').textContent = fmtX(S.boost) + ' · +' + Math.round(S.boost) + ' dB';
    $('muLoud').value = S.loud; $('muLoudV').textContent = Math.round(S.loud * 100) + '%';
    $('muBass').value = S.bass; $('muBassV').textContent = Math.round(S.bass * 100) + '%';
    $('muWide').value = S.wide; $('muWideV').textContent = Math.round(S.wide * 100) + '%';
    $('muMode').value = S.mode; $('muDuck').checked = S.duck; $('muHear').checked = S.hear;
    S.eq.forEach((v, i) => { const el = $('muEq' + i); el.value = v; $('muEqV' + i).textContent = (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v); });
    ['muVol', 'muBoost', 'muLoud', 'muBass', 'muWide'].forEach(id => paintRange($(id)));
    preBox.querySelectorAll('[data-mu]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mu === S.preset)));
    const on = !!capStream, playing = !player.paused;
    $('muCapture').textContent = on ? 'Stop PC audio' : 'Connect PC audio';
    $('muCapture').toggleAttribute('data-live', on);
    const chip = $('muChip'); chip.dataset.state = on || playing ? (M ? 'live' : 'muted') : 'off';
    $('muChipText').textContent = on || playing ? (M ? 'To Discord' : 'Only you') : 'No source';
    $('muSrc').textContent = on ? (capKind === 'monitor' ? 'Whole computer' : capKind === 'browser' ? 'Chrome tab' : 'Shared audio') : playing && list[cur] ? list[cur].name : 'Nothing connected';
    $('muPlay').textContent = player.paused ? 'Play' : 'Pause';
  }
  const set = (patch, keepPreset) => { Object.assign(S, patch); S.boost = Math.min(S.boost, T().maxDb); if (!keepPreset) S.preset = ''; save(); apply(); };
  addEventListener('dios:tier', () => { S.boost = Math.min(S.boost, T().maxDb); save(); apply(); });
  $('muVol').addEventListener('input', e => set({ vol: +e.target.value }, true));
  $('muBoost').addEventListener('input', e => set({ boost: +e.target.value }));
  $('muLoud').addEventListener('input', e => set({ loud: +e.target.value }));
  $('muBass').addEventListener('input', e => set({ bass: +e.target.value }));
  $('muWide').addEventListener('input', e => set({ wide: +e.target.value }));
  $('muMode').addEventListener('change', e => set({ mode: e.target.value }));
  document.querySelectorAll('[data-mux]').forEach(b => b.addEventListener('click', () => {
    if (b.hasAttribute('data-pro') && !T().pro) { window.DIOS.locked(); return; }
    set({ boost: Math.round(20 * Math.log10(+b.dataset.mux) * 10) / 10 });
  }));
  $('muDuck').addEventListener('change', e => { set({ duck: e.target.checked }, true); if (S.duck && +$('gate').value <= -90) status('Turn on the noise gate above so the amp can tell when you talk.'); });
  $('muHear').addEventListener('change', e => set({ hear: e.target.checked }, true));
  $('muEqReset').addEventListener('click', () => set({ eq: FLAT.slice() }));
  $('muCapture').addEventListener('click', capture);
  $('muFiles').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
  $('muPlay').addEventListener('click', () => { if (cur < 0) { if (list.length) play(0); else $('muFiles').click(); return; } player.paused ? player.play() : player.pause(); });
  $('muPrev').addEventListener('click', () => play(cur - 1));
  $('muNext').addEventListener('click', () => play(cur + 1));
  $('muSeek').addEventListener('input', e => { if (player.duration) player.currentTime = e.target.value / 1000 * player.duration; });
  const zone = $('musicConsole');
  zone.addEventListener('dragover', e => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  zone.addEventListener('drop', e => { if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); addFiles(e.dataTransfer.files); });
  $('out').addEventListener('change', apply);
  renderList(); paint(); draw();
  addEventListener('resize', () => { if (!M) draw(); });
})();
