/* DIOS Amplifier: soundboard and YouTube.
   Both mix into the same output the boosted mic goes to (CABLE Input, the test recorder, the monitor),
   so Discord hears your voice, your sounds and your music together. Plain script, no build.
   Needs the hooks at the end of amp.js's start() and stop(): window.DIOS.A and the dios:start / dios:stop events. */
(() => {
  const $ = id => document.getElementById(id);
  if (!$('pads')) return;
  const KEY = 'dios-board-v1';
  const DEF = { vol: 100, boost: 0, mode: 'clear', ytVol: 100, ytBoost: 0, bass: 0, mid: 0, treble: 0, fx: '', duck: false, hear: true, ytUrl: '' };
  let S = { ...DEF };
  try { S = { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  const status = t => { $('bdStatus').textContent = t; };
  const err = t => { $('bdErr').textContent = t || ''; };
  // boosts are stored in dB, 0..100 (1x..100,000x), the same scale as the mic gain
  const xOf = db => Math.pow(10, db / 20);
  const fmtX = db => { const g = xOf(db); return (g >= 100 ? Math.round(g).toLocaleString('en') : g.toFixed(1).replace(/\.0$/, '')) + 'x'; };
  const fmtT = s => Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');

  /* ---------------- built-in sounds (synthesised, so nothing to download) ---------------- */
  const SR = 48000;
  const render = (sec, fn) => { const c = new OfflineAudioContext(2, Math.ceil(sec * SR), SR); fn(c, c.destination); return c.startRendering(); };
  const noise = (c, sec) => {
    const b = c.createBuffer(1, Math.ceil(sec * c.sampleRate), c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  };
  // one oscillator note: sustained (default) or a falling drum-like decay
  const tone = (c, out, { type = 'sine', f, f2, t = 0, dur, peak = .3, decay = false }) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + .008);
    if (decay) g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    else { g.gain.setValueAtTime(peak, t + Math.max(.01, dur - .07)); g.gain.exponentialRampToValueAtTime(.0001, t + dur); }
    o.connect(g).connect(out); o.start(t); o.stop(t + dur + .05);
    return o;
  };
  const hiss = (c, out, { t = 0, dur, peak = .4, hp = 0, lp = 0, bp = 0, q = 1 }) => {
    const n = c.createBufferSource(), g = c.createGain(); n.buffer = noise(c, dur + .05);
    let node = n;
    for (const [type, f] of [['highpass', hp], ['lowpass', lp], ['bandpass', bp]]) if (f) {
      const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; node.connect(b); node = b;
    }
    g.gain.setValueAtTime(peak, t); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    node.connect(g).connect(out); n.start(t);
  };
  const SYNTH = {
    airhorn: () => render(2.5, (c, out) => {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400; lp.connect(out);
      [[0, .2], [.27, .2], [.54, 1.7]].forEach(([t, dur]) => [466, 471, 587, 932].forEach(f => tone(c, lp, { type: 'sawtooth', f, t, dur, peak: .11 })));
    }),
    boom: () => render(2.2, (c, out) => {
      const o = c.createOscillator(), g = c.createGain(), sh = c.createWaveShaper();
      sh.curve = Float32Array.from({ length: 1024 }, (_, i) => Math.tanh(4 * (i / 511.5 - 1)));
      o.frequency.setValueAtTime(150, 0); o.frequency.exponentialRampToValueAtTime(36, 1.7);
      g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(.95, .01); g.gain.exponentialRampToValueAtTime(.0001, 2.1);
      o.connect(sh).connect(g).connect(out); o.start(0); o.stop(2.2);
      hiss(c, out, { dur: .06, peak: .5, lp: 1800 });
    }),
    badum: () => render(1.9, (c, out) => {
      tone(c, out, { f: 210, f2: 95, t: 0, dur: .22, peak: .8, decay: true });
      tone(c, out, { f: 160, f2: 72, t: .2, dur: .3, peak: .8, decay: true });
      hiss(c, out, { t: .46, dur: 1.35, peak: .35, hp: 6500 });
    }),
    trombone: () => render(2.9, (c, out) => {
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.connect(out);
      [[0, 392], [.42, 370], [.84, 349]].forEach(([t, f]) => tone(c, lp, { type: 'sawtooth', f, t, dur: .4, peak: .28 }));
      const o = tone(c, lp, { type: 'sawtooth', f: 330, t: 1.26, dur: 1.5, peak: .28 });
      const lfo = c.createOscillator(), d = c.createGain(); lfo.frequency.value = 6; d.gain.value = 9;
      lfo.connect(d).connect(o.frequency); lfo.start(1.4); lfo.stop(2.8);
    }),
    beep: () => render(1, (c, out) => { tone(c, out, { f: 1000, t: 0, dur: .9, peak: .45 }); }),
    laser: () => render(.8, (c, out) => {
      tone(c, out, { type: 'square', f: 1900, f2: 160, t: 0, dur: .28, peak: .18, decay: true });
      tone(c, out, { type: 'square', f: 1900, f2: 160, t: .34, dur: .28, peak: .18, decay: true });
    }),
    siren: () => render(3.2, (c, out) => {
      const o = tone(c, out, { type: 'triangle', f: 900, t: 0, dur: 3.1, peak: .38 });
      const lfo = c.createOscillator(), d = c.createGain(); lfo.frequency.value = 1.4; d.gain.value = 320;
      lfo.connect(d).connect(o.frequency); lfo.start(0); lfo.stop(3.2);
    }),
    applause: () => render(3, (c, out) => {
      const bus = c.createGain(); bus.gain.setValueAtTime(1, 0); bus.gain.setValueAtTime(1, 2); bus.gain.linearRampToValueAtTime(0, 2.9); bus.connect(out);
      for (let i = 0; i < 520; i++) hiss(c, bus, { t: Math.random() * 2.8, dur: .03 + Math.random() * .03, peak: .12 + Math.random() * .2, bp: 900 + Math.random() * 2600, q: 1.4 });
    })
  };

  const BUILTIN = [
    { id: 'venix', name: 'Venix Theri Vili', url: 'sounds/venix-theri-vili.mp3', feat: true },
    { id: 'airhorn', name: 'Air horn', synth: 'airhorn' },
    { id: 'boom', name: 'Boom', synth: 'boom' },
    { id: 'badum', name: 'Ba dum tss', synth: 'badum' },
    { id: 'trombone', name: 'Sad trombone', synth: 'trombone' },
    { id: 'beep', name: 'Censor beep', synth: 'beep' },
    { id: 'laser', name: 'Laser', synth: 'laser' },
    { id: 'siren', name: 'Siren', synth: 'siren' },
    { id: 'applause', name: 'Applause', synth: 'applause' }
  ];
  let pads = [...BUILTIN];
  const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

  // decoded buffers are context-free, so one copy serves the preview and the live engine
  const bufs = new Map();
  const decode = arr => new OfflineAudioContext(2, SR, SR).decodeAudioData(arr);
  function bufferFor(p) {
    if (!bufs.has(p.id)) {
      const job = (p.synth ? SYNTH[p.synth]()
        : p.url ? fetch(p.url).then(r => { if (!r.ok) throw new Error('file missing (' + r.status + ')'); return r.arrayBuffer(); }).then(decode)
        : p.blob.arrayBuffer().then(decode))
        .then(b => { p.dur = b.duration; paintMeta(p); return b; });
      job.catch(() => bufs.delete(p.id));
      bufs.set(p.id, job);
    }
    return bufs.get(p.id);
  }

  /* ---------------- your own sounds, kept in this browser ---------------- */
  let dbp = null;
  const db = () => dbp || (dbp = new Promise((res, rej) => {
    const r = indexedDB.open('dios-board', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('sounds', { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  }));
  const tx = async (mode, fn) => {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction('sounds', mode), r = fn(t.objectStore('sounds'));
      t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error);
    });
  };
  async function loadCustom() {
    try {
      const rows = (await tx('readonly', s => s.getAll())) || [];
      rows.sort((a, b) => a.at - b.at).forEach(r => pads.push({ id: r.id, name: r.name, blob: r.blob, custom: true }));
      renderPads();
    } catch (e) {}
  }
  const isAudio = f => /^(audio|video)\//.test(f.type) || /\.(mp3|wav|ogg|oga|m4a|aac|flac|webm|opus)$/i.test(f.name);
  async function addFiles(list) {
    err();
    const files = [...list].filter(isAudio);
    if (!files.length) { err('Drop audio files: mp3, wav, ogg, m4a and so on.'); return; }
    let added = 0;
    for (const f of files) {
      const p = { id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: f.name.replace(/\.[^.]+$/, '').slice(0, 40), blob: f, custom: true };
      try { await bufferFor(p); } catch (e) { err('Could not read ' + f.name + '. Try mp3 or wav.'); continue; }
      pads.push(p); added++;
      try { await tx('readwrite', s => s.put({ id: p.id, name: p.name, blob: f, at: Date.now() })); }
      catch (e) { err('Added for this visit only: this browser would not save it.'); }
    }
    renderPads();
    if (added) status(added === 1 ? 'Sound added.' : added + ' sounds added.');
  }
  async function removePad(p) {
    stopPad(p.id);
    pads = pads.filter(x => x !== p); bufs.delete(p.id);
    try { await tx('readwrite', s => s.delete(p.id)); } catch (e) {}
    renderPads();
  }

  /* ---------------- engine ---------------- */
  // pads ─ boost ─────┐
  //                   ├─ rumble ─ bass ─ presence ─ treble ─ comp ─ makeup ─ limiter ─ shaper ─ out ─┬─ amp output + scope
  // yt ─ duck ─ ytBoost ┘                                                                            └─ hear (your speakers)
  // the same tools as the mic: 3-band EQ and four limiter modes, from clean to harsh hard clip
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
  const SAFE = curve('safe'), HARD = curve('hard'), SOFT = curve('soft');
  const FX_PRESETS = {
    clean: { boost: 0,   ytBoost: 0,   bass: 0,  mid: 0, treble: 0,  mode: 'clear' },
    loud:  { boost: 20,  ytBoost: 20,  bass: 3,  mid: 2, treble: 2,  mode: 'clear' },
    max:   { boost: 60,  ytBoost: 60,  bass: 4,  mid: 3, treble: 3,  mode: 'clear' },
    bass:  { boost: 30,  ytBoost: 30,  bass: 15, mid: 0, treble: -2, mode: 'clear' },
    radio: { boost: 30,  ytBoost: 30,  bass: -8, mid: 8, treble: -4, mode: 'comp' },
    dist:  { boost: 100, ytBoost: 100, bass: 6,  mid: 0, treble: 0,  mode: 'hard' }
  };
  let A = null, bus = null, prev = null;

  function makeBus(ctx, outs) {
    const b = { ctx, pads: ctx.createGain(), yt: ctx.createGain(), duck: ctx.createGain(), boost: ctx.createGain(), ytBoost: ctx.createGain(),
      hp: ctx.createBiquadFilter(), bass: ctx.createBiquadFilter(), mid: ctx.createBiquadFilter(), treble: ctx.createBiquadFilter(),
      comp: ctx.createDynamicsCompressor(), makeup: ctx.createGain(),
      lim: ctx.createDynamicsCompressor(), shaper: ctx.createWaveShaper(), out: ctx.createGain(), hear: ctx.createGain() };
    b.hp.type = 'highpass'; b.hp.frequency.value = 25; b.hp.Q.value = .7;            // only sub-rumble; music keeps its bass
    b.bass.type = 'lowshelf'; b.bass.frequency.value = 120;
    b.mid.type = 'peaking'; b.mid.frequency.value = 2500; b.mid.Q.value = .9;
    b.treble.type = 'highshelf'; b.treble.frequency.value = 7000;
    b.lim.knee.value = 0; b.lim.attack.value = .001; b.lim.release.value = .06;
    b.pads.connect(b.boost).connect(b.hp);
    b.yt.connect(b.duck).connect(b.ytBoost).connect(b.hp);
    b.hp.connect(b.bass).connect(b.mid).connect(b.treble).connect(b.comp).connect(b.makeup).connect(b.lim).connect(b.shaper).connect(b.out);
    outs.forEach(o => b.out.connect(o));
    b.out.connect(b.hear).connect(ctx.destination);
    applyBus(b);
    return b;
  }
  function previewBus() {
    if (!prev) prev = makeBus(new AudioContext({ latencyHint: 'interactive' }), []);
    if (prev.ctx.state === 'suspended') prev.ctx.resume();
    return prev;
  }
  // with the amp on your default speakers (or the monitor on) you already hear the mix; hearing it twice would echo
  const hearOn = b => b === prev || (S.hear && !!$('out').value && !$('monitor').checked);
  function applyBus(b) {
    if (!b) return;
    const t = b.ctx.currentTime, m = S.mode, clear = m === 'clear', comp = m === 'comp';
    b.pads.gain.setTargetAtTime(S.vol / 100, t, .02);
    b.yt.gain.setTargetAtTime(S.ytVol / 100, t, .02);
    b.boost.gain.setTargetAtTime(xOf(S.boost), t, .02);
    b.ytBoost.gain.setTargetAtTime(xOf(S.ytBoost), t, .02);
    b.bass.gain.setTargetAtTime(S.bass, t, .03);
    b.mid.gain.setTargetAtTime(S.mid, t, .03);
    b.treble.gain.setTargetAtTime(S.treble, t, .03);
    // clear: compressor, makeup, brick-wall limiter, soft knee (100,000x never cracks); radio: heavy squash;
    // soft: warm tanh drive; hard: flat clip at full scale (harsh)
    b.comp.threshold.value = clear ? -26 : comp ? -30 : 0;
    b.comp.ratio.value = clear ? 5 : comp ? 12 : 1;
    b.comp.knee.value = clear ? 12 : comp ? 10 : 0;
    b.comp.attack.value = clear ? .004 : .003; b.comp.release.value = clear ? .2 : .15;
    b.makeup.gain.setTargetAtTime(clear ? 2.4 : 1, t, .05);
    b.lim.ratio.value = clear || comp ? 20 : 1;
    b.lim.threshold.value = clear || comp ? -3 : 0;
    b.shaper.curve = clear || comp ? SAFE : m === 'soft' ? SOFT : HARD;
    b.shaper.oversample = clear || comp ? 'none' : '4x';
    b.hear.gain.setTargetAtTime(hearOn(b) ? 1 : 0, t, .02);
  }
  const applyAllBuses = () => { applyBus(bus); applyBus(prev); };

  /* ---------------- playing ---------------- */
  const playing = new Map();   // pad id -> Set of { src, ctx, start, dur }
  let raf = 0;
  async function playPad(p) {
    err();
    let buf;
    try { buf = await bufferFor(p); } catch (e) { err('Could not load ' + p.name + ': ' + e.message); return; }
    const b = bus || previewBus();
    if (b.ctx.state === 'suspended') await b.ctx.resume();
    const src = b.ctx.createBufferSource(); src.buffer = buf; src.connect(b.pads);
    const it = { src, ctx: b.ctx, start: b.ctx.currentTime, dur: buf.duration };
    if (!playing.has(p.id)) playing.set(p.id, new Set());
    playing.get(p.id).add(it);
    src.onended = () => { const s = playing.get(p.id); if (s) { s.delete(it); if (!s.size) playing.delete(p.id); } paintPlaying(); };
    src.start();
    paintPlaying();
    status(bus ? 'Playing ' + p.name + ' to Discord.' : 'Playing ' + p.name + ' only for you. Press Start above to send sounds to Discord.');
  }
  function stopPad(id) {
    const s = playing.get(id); if (!s) return;
    s.forEach(it => { try { it.src.stop(); } catch (e) {} });
    playing.delete(id); paintPlaying();
  }
  function stopAll() { [...playing.keys()].forEach(stopPad); }
  // click: play from the start; click again while it plays: stop. Shift-click layers another copy.
  const hit = (p, layer) => (playing.has(p.id) && !layer ? stopPad(p.id) : playPad(p));

  /* ---------------- pads ---------------- */
  const padEl = id => $('pads').querySelector('[data-id="' + id + '"]');
  function paintMeta(p) {
    const el = padEl(p.id); if (!el) return;
    el.querySelector('.b-pad__len').textContent = p.dur ? fmtT(p.dur) : '';
  }
  function renderPads() {
    const box = $('pads'); box.textContent = '';
    pads.forEach((p, i) => {
      const el = document.createElement('div');
      el.className = 'b-pad' + (p.feat ? ' b-pad--feat' : ''); el.dataset.id = p.id;
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'b-pad__hit';
      const name = document.createElement('b'); name.textContent = p.name;
      const meta = document.createElement('span'); meta.className = 'b-pad__meta';
      const key = document.createElement('kbd'); key.textContent = KEYS[i] || '·'; if (!KEYS[i]) key.hidden = true;
      const len = document.createElement('span'); len.className = 'b-pad__len'; len.textContent = p.dur ? fmtT(p.dur) : '';
      meta.append(key, len); btn.append(name, meta);
      btn.setAttribute('aria-label', p.name + (KEYS[i] ? ', key ' + KEYS[i] : ''));
      btn.addEventListener('click', e => hit(p, e.shiftKey));
      const prog = document.createElement('i'); prog.className = 'b-pad__prog';
      el.append(btn, prog);
      if (p.custom) {
        const del = document.createElement('button');
        del.type = 'button'; del.className = 'b-pad__del'; del.textContent = '×';
        del.setAttribute('aria-label', 'Remove ' + p.name);
        del.addEventListener('click', () => removePad(p));
        el.append(del);
      }
      box.append(el);
    });
    const add = document.createElement('label');
    add.className = 'b-add';
    add.innerHTML = '<b>+</b><span>Add sounds<br>or drop files here</span>';
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus,.webm'; inp.multiple = true; inp.hidden = true;
    inp.addEventListener('change', () => { addFiles(inp.files); inp.value = ''; });
    add.append(inp); box.append(add);
    paintPlaying();
  }
  function paintPlaying() {
    $('pads').querySelectorAll('.b-pad').forEach(el => {
      const on = playing.has(el.dataset.id);
      el.toggleAttribute('data-playing', on);
      if (!on) el.style.setProperty('--p', '0%');
    });
    $('bdStop').disabled = !playing.size;
    if (playing.size && !raf) raf = requestAnimationFrame(tick);
  }
  function tick() {
    raf = 0;
    playing.forEach((set, id) => {
      let last = null; set.forEach(it => { if (!last || it.start > last.start) last = it; });
      const el = padEl(id);
      if (el && last) el.style.setProperty('--p', Math.min(100, (last.ctx.currentTime - last.start) / last.dur * 100) + '%');
    });
    if (playing.size) raf = requestAnimationFrame(tick);
  }

  /* ---------------- YouTube: the video plays here, the DIOS helper carries its sound ---------------- */
  // Chrome will not let a page read the sound of an embedded YouTube video, and sharing this tab would feed
  // Discord's sound back into itself. So the video plays in the site (muted while the helper is open), and a tiny
  // helper window plays the same video in sync; the browser's tab share hands the helper's sound to the mix.
  let ytStream = null, ytSrc = null, ytWin = null, helperSeen = -Infinity, helperStuck = false;
  let player = null, apiP = null, cur = null, syncT = 0;
  const chan = 'BroadcastChannel' in window ? new BroadcastChannel('dios-yt') : null;
  const helperAlive = () => performance.now() - helperSeen < 2500;
  if (chan) chan.onmessage = e => {
    const d = e.data || {}; if (d.from !== 'yt') return;
    if (d.closed) { helperSeen = -Infinity; helperStuck = false; applyMute(); paintYT(); return; }
    const was = helperAlive();
    helperSeen = performance.now();
    if ('stuck' in d) helperStuck = !!d.stuck;
    if (d.ready || !was) pushSync();
    if (d.error) err('YouTube will not play this video in the helper. Try another video.');
    paintYT();
  };
  function parseYT(u) {
    u = (u || '').trim(); if (!u) return null;
    if (/^[\w-]{11}$/.test(u)) return { v: u };
    try {
      const x = new URL(/^https?:/i.test(u) ? u : 'https://' + u);
      if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$|(^|\.)youtube-nocookie\.com$/i.test(x.hostname)) return null;
      let v = x.searchParams.get('v') || '';
      const list = x.searchParams.get('list') || '';
      if (!v && /youtu\.be$/i.test(x.hostname)) v = x.pathname.slice(1, 12);
      if (!v) { const m = x.pathname.match(/\/(shorts|embed|live|v)\/([\w-]{11})/); if (m) v = m[2]; }
      if (!v && !list) return null;
      const out = {}; if (v) out.v = v.slice(0, 11); if (list) out.list = list;
      return out;
    } catch (e) { return null; }
  }
  const api = () => apiP || (apiP = new Promise(res => {
    if (window.YT && window.YT.Player) return res();
    const prevReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prevReady) prevReady(); res(); };
    const s = document.createElement('script'); s.src = 'https://www.youtube.com/iframe_api'; document.head.appendChild(s);
  }));
  const ready = () => player && player.getPlayerState;
  const vidNow = () => (ready() && player.getVideoData && player.getVideoData().video_id) || (cur && cur.v) || '';

  function openHelper() {
    const q = new URLSearchParams({ helper: '1' }); const v = vidNow(); if (v) q.set('v', v);
    ytWin = window.open('yt.html?' + q, 'dios-yt', 'popup,width=440,height=330');
    if (!ytWin) { err('The browser blocked the helper window. Allow pop-ups for this site, then try again.'); return false; }
    try { window.focus(); } catch (e) {}
    return true;
  }
  function loadYT() {
    const id = parseYT($('ytUrl').value);
    if (!id) { err('That does not look like a YouTube link.'); return; }
    err(); S.ytUrl = $('ytUrl').value.trim(); save(); cur = id;
    // the helper must open inside this click, or the pop-up blocker stops it
    if (!helperAlive() && !(ytWin && !ytWin.closed)) openHelper();
    $('ytFrame').hidden = false;
    api().then(() => {
      if (!player) {
        const vars = { autoplay: 1, playsinline: 1, rel: 0, origin: location.origin };
        if (id.list) { vars.listType = 'playlist'; vars.list = id.list; }
        player = new YT.Player('ytPlayer', {
          videoId: id.v || undefined, playerVars: vars,
          events: {
            onReady: () => { applyMute(); player.playVideo(); pushSync(); paintYT(); },
            onStateChange: () => { applyMute(); pushSync(); paintYT(); },
            onError: e => err(e.data === 101 || e.data === 150 ? 'The owner of this video does not allow it outside YouTube. Try another one.' : 'YouTube could not play this video.')
          }
        });
      } else if (id.list) player.loadPlaylist({ listType: 'playlist', list: id.list, index: 0 });
      else player.loadVideoById(id.v);
    });
    status(ytStream ? 'Loading the new video.' : 'Video loading. Press "Send YouTube to Discord" and pick the DIOS helper tab.');
  }
  // only one of the two players is ever heard: the helper when it is open, this one when it is not
  function applyMute() {
    if (!ready()) return;
    const quiet = helperAlive() || ytStream;
    if (quiet && !player.isMuted()) player.mute();
    else if (!quiet && player.isMuted()) player.unMute();
  }
  function pushSync() {
    if (!chan || !ready()) return;
    const st = player.getPlayerState();
    chan.postMessage({ cmd: 'sync', v: vidNow(), t: player.getCurrentTime() || 0, playing: st === 1 || st === 3, at: Date.now() });
  }
  function syncLoop() { pushSync(); applyMute(); paintYT(); syncT = setTimeout(syncLoop, 700); }

  function hookYT() {
    if (ytSrc) { try { ytSrc.disconnect(); } catch (e) {} ytSrc = null; }
    if (!ytStream) return;
    const b = bus || previewBus();
    ytSrc = b.ctx.createMediaStreamSource(ytStream);
    ytSrc.connect(b.yt);
  }
  async function connectYT() {
    err();
    if (ytStream) { dropYT(); return; }
    if (!cur) { err('Paste a YouTube link and press Play first.'); return; }
    if (!helperAlive() && !(ytWin && !ytWin.closed)) {
      if (openHelper()) status('Helper opened. Press "Send YouTube to Discord" again and pick the DIOS helper tab.');
      return;
    }
    const md = navigator.mediaDevices;
    if (!md || !md.getDisplayMedia) { err('This browser cannot share tab audio. Use Chrome or Edge on a computer.'); return; }
    try {
      const s = await md.getDisplayMedia({
        video: { frameRate: 1, width: 320, height: 180 },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, suppressLocalAudioPlayback: true },
        preferCurrentTab: false, selfBrowserSurface: 'exclude', systemAudio: 'exclude', surfaceSwitching: 'include', monitorTypeSurfaces: 'exclude'
      });
      if (!s.getAudioTracks().length) {
        s.getTracks().forEach(t => t.stop());
        err('No sound came through. Pick the DIOS helper tab (not a window or screen) and keep "Also share tab audio" on.');
        return;
      }
      s.getVideoTracks().forEach(t => { t.enabled = false; });   // only the sound is used
      ytStream = s;
      s.getAudioTracks()[0].addEventListener('ended', dropYT);
      hookYT(); applyMute(); pushSync();
      status(bus ? 'Live. The video plays here and its sound goes to Discord with your mic.' : 'YouTube is connected. Press Start above to send it to Discord.');
    } catch (e) {
      if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') err('Could not share the helper tab: ' + e.message);
    }
    paintYT();
  }
  function dropYT() {
    if (ytSrc) { try { ytSrc.disconnect(); } catch (e) {} ytSrc = null; }
    if (ytStream) ytStream.getTracks().forEach(t => t.stop());
    ytStream = null; applyMute(); paintYT();
  }
  const ytToggle = () => { if (!ready()) return; const st = player.getPlayerState(); st === 1 || st === 3 ? player.pauseVideo() : player.playVideo(); };
  const ytSeek = by => { if (!ready()) return; player.seekTo(Math.max(0, player.getCurrentTime() + by), true); setTimeout(pushSync, 50); };
  function paintYT() {
    const chip = $('ytChip'), on = !!ytStream;
    chip.dataset.state = on ? (bus ? 'live' : 'muted') : 'off';
    $('ytChipText').textContent = on ? (bus ? 'To Discord' : 'Only you') : 'Not sent';
    $('ytConnect').textContent = on ? 'Stop sending YouTube' : 'Send YouTube to Discord';
    $('ytConnect').toggleAttribute('data-live', on);
    const d = ready() && player.getVideoData ? player.getVideoData() : null, st = ready() ? player.getPlayerState() : -1;
    const title = d && d.title;
    $('ytNow').textContent = !title ? 'Nothing loaded yet.'
      : (st === 1 ? 'Playing: ' : st === 2 ? 'Paused: ' : '') + title;
    const h = $('ytHelper');
    h.textContent = helperStuck ? 'Click the DIOS helper window once so its sound can start.'
      : helperAlive() ? (on ? 'Helper sending sound. You can minimize it.' : 'Helper open. Now send it to Discord.')
      : cur ? 'Helper closed. Send to Discord opens it again.' : '';
    h.dataset.warn = helperStuck ? '' : null; if (!helperStuck) delete h.dataset.warn;
  }

  // lower the music while the noise gate hears you talk
  let duckT = 0;
  function duckLoop() {
    duckT = 0;
    if (!bus || !S.duck) { if (bus) bus.duck.gain.setTargetAtTime(1, bus.ctx.currentTime, .2); return; }
    const gateOn = +$('gate').value > -90;
    const talking = gateOn && A && performance.now() < (A._openUntil || 0);
    bus.duck.gain.setTargetAtTime(talking ? .25 : 1, bus.ctx.currentTime, talking ? .04 : .35);
    duckT = setTimeout(duckLoop, 60);
  }
  const startDuck = () => { clearTimeout(duckT); duckLoop(); };

  /* ---------------- amp start / stop ---------------- */
  addEventListener('dios:start', () => {
    A = window.DIOS && window.DIOS.A; if (!A) return;
    // a final limiter on the whole mix: mic and sounds are each limited, but their sum could still pass full scale
    const mix = A.ctx.createGain(), mlim = A.ctx.createDynamicsCompressor(), mclip = A.ctx.createWaveShaper();
    mlim.threshold.value = -1.5; mlim.knee.value = 0; mlim.ratio.value = 20; mlim.attack.value = .001; mlim.release.value = .05;
    mclip.curve = SAFE;
    try { A.master.disconnect(A.dest); A.master.disconnect(A.post); } catch (e) {}
    A.master.connect(mix); mix.connect(mlim).connect(mclip);
    mclip.connect(A.dest); mclip.connect(A.post);
    bus = makeBus(A.ctx, [mix]);
    hookYT(); paintYT(); startDuck();
    status('Live. Sounds and YouTube go to Discord with your mic.');
  });
  addEventListener('dios:stop', () => {
    playing.forEach((set, id) => { set.forEach(it => { if (bus && it.ctx === bus.ctx) { try { it.src.stop(); } catch (e) {} set.delete(it); } }); if (!set.size) playing.delete(id); });
    bus = null; A = null; clearTimeout(duckT);
    hookYT(); paintYT(); paintPlaying();
    status('The amplifier is off. Sounds play only for you until you press Start.');
  });

  /* ---------------- controls ---------------- */
  const paintRange = r => r.style.setProperty('--fill', ((r.value - r.min) / (r.max - r.min) * 100) + '%');
  function paintControls() {
    $('bdVol').value = S.vol; $('bdVolV').textContent = S.vol + '%';
    $('bdBoost').value = S.boost; $('bdBoostV').textContent = fmtX(S.boost) + ' · +' + Math.round(S.boost) + ' dB';
    $('ytBoost').value = S.ytBoost; $('ytBoostV').textContent = fmtX(S.ytBoost) + ' · +' + Math.round(S.ytBoost) + ' dB';
    $('ytVol').value = S.ytVol; $('ytVolV').textContent = S.ytVol + '%';
    $('bdMode').value = S.mode; $('duck').checked = S.duck; $('hear').checked = S.hear;
    for (const k of ['bass', 'mid', 'treble']) { $('fx' + k).value = S[k]; $('fx' + k + 'V').textContent = (S[k] > 0 ? '+' : S[k] < 0 ? '−' : '') + Math.abs(S[k]) + ' dB'; }
    document.querySelectorAll('[data-fx]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fx === S.fx)));
    if (!$('ytUrl').value) $('ytUrl').value = S.ytUrl;
    ['bdVol', 'bdBoost', 'ytVol', 'ytBoost', 'fxbass', 'fxmid', 'fxtreble'].forEach(id => paintRange($(id)));
  }
  // any hand change clears the highlighted preset, like on the mic
  const set = (patch, keepFx) => { Object.assign(S, patch); if (!keepFx) S.fx = ''; save(); paintControls(); applyAllBuses(); };
  $('bdVol').addEventListener('input', e => set({ vol: +e.target.value }, true));
  $('bdBoost').addEventListener('input', e => set({ boost: +e.target.value }));
  $('ytVol').addEventListener('input', e => set({ ytVol: +e.target.value }, true));
  $('ytBoost').addEventListener('input', e => set({ ytBoost: +e.target.value }));
  // quick boost buttons: 10x .. 100,000x
  document.querySelectorAll('[data-bx]').forEach(btn => btn.addEventListener('click', () =>
    set({ [btn.dataset.bx]: Math.round(20 * Math.log10(+btn.dataset.x) * 10) / 10 })));
  $('bdMode').addEventListener('change', e => set({ mode: e.target.value }));
  for (const k of ['bass', 'mid', 'treble']) $('fx' + k).addEventListener('input', e => set({ [k]: +e.target.value }));
  document.querySelectorAll('[data-fx]').forEach(b => b.addEventListener('click', () => set({ ...FX_PRESETS[b.dataset.fx], fx: b.dataset.fx }, true)));
  $('hear').addEventListener('change', e => set({ hear: e.target.checked }, true));
  $('duck').addEventListener('change', e => {
    set({ duck: e.target.checked }, true); startDuck();
    if (S.duck && +$('gate').value <= -90) status('Turn on the noise gate above so the amp can tell when you talk.');
  });
  // the amp's own output and monitor settings decide whether you need to hear the mix separately
  $('out').addEventListener('change', applyAllBuses);
  $('monitor').addEventListener('change', applyAllBuses);
  $('bdStop').addEventListener('click', stopAll);
  $('ytOpen').addEventListener('click', loadYT);
  $('ytUrl').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); loadYT(); } });
  $('ytConnect').addEventListener('click', connectYT);
  $('ytPlay').addEventListener('click', ytToggle);
  $('ytBack').addEventListener('click', () => ytSeek(-10));
  $('ytFwd').addEventListener('click', () => ytSeek(10));

  // drop audio files anywhere on the board
  const con = $('boardConsole');
  let dragN = 0;
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  con.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); dragN++; con.dataset.drop = ''; });
  con.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
  con.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; delete con.dataset.drop; } });
  con.addEventListener('drop', e => { if (!hasFiles(e)) return; e.preventDefault(); dragN = 0; delete con.dataset.drop; addFiles(e.dataTransfer.files); });

  // keys 1 to 0 play the first ten pads, Esc stops everything (the amp keeps M, R and Space)
  const typing = t => t && (t.tagName === 'INPUT' && t.type !== 'range' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  document.addEventListener('keydown', e => {
    if (typing(e.target) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const k = e.code.replace(/^(Digit|Numpad)/, '');
    const i = /^\d$/.test(k) ? KEYS.indexOf(k) : -1;
    if (i >= 0 && pads[i]) { e.preventDefault(); hit(pads[i], e.shiftKey); }
    else if (e.key === 'Escape' && playing.size) stopAll();
  });

  // the same pointer-following sheen as the amp console
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches && matchMedia('(hover: hover)').matches) {
    con.addEventListener('pointermove', e => {
      const r = con.getBoundingClientRect();
      con.style.setProperty('--mx', (e.clientX - r.left) + 'px');
      con.style.setProperty('--my', (e.clientY - r.top) + 'px');
    });
  }

  paintControls(); renderPads(); paintYT(); loadCustom(); syncLoop();
  if (window.DIOS && window.DIOS.A) dispatchEvent(new Event('dios:start'));
  // decode the built-ins in the background so the first press is instant and lengths show
  const warm = () => pads.forEach(p => bufferFor(p).catch(() => {}));
  'requestIdleCallback' in window ? requestIdleCallback(warm, { timeout: 3000 }) : setTimeout(warm, 1500);
})();
