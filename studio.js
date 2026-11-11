/* DIOS Amplifier v2 look: the hero's live core, the page's reaction to your voice, the gain counter.
   Visual only: nothing here touches the sound, so the amp keeps working whether or not this runs.
   Every loop stops when the tab is hidden and rests under reduced motion. Plain script, no build. */
(() => {
  const $ = id => document.getElementById(id);
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const RGB = (() => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = getComputedStyle(root).getPropertyValue('--p-accent').trim() || '#ff3d8b'; const h = c.fillStyle; return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)); })();
  const HOT = a => `rgba(${RGB[0]},${RGB[1]},${RGB[2]},${a})`;
  const live = () => window.DIOS && window.DIOS.A;

  /* ---------------- the page knows when the amp is live ---------------- */
  addEventListener('dios:start', () => { root.dataset.live = ''; });
  addEventListener('dios:stop', () => { delete root.dataset.live; root.style.setProperty('--lvl', '0'); });

  /* ---------------- the hero core: mic in, DIOS ring, boosted voice out ---------------- */
  const cv = $('heroCore');
  if (cv) {
    const g = cv.getContext('2d');
    let paused = reduce, visible = true, raf = 0, t0 = performance.now(), fbuf, tbuf, pbuf, lvl = 0;
    const N = 120;
    const fit = () => {
      const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
      const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    };
    // a speech-like envelope for the resting animation: syllables come and go
    const env = (x, t) => { const s = x * 7 + t * 1.6; return Math.max(0, Math.sin(s) * .6 + Math.sin(s * 2.3 + 1) * .4) ** 1.4; };
    const wave = (x, t) => Math.sin(x * 90 + t * 9) * .55 + Math.sin(x * 211 + t * 13) * .3 + Math.sin(x * 37 - t * 4) * .15;

    function draw(now) {
      fit();
      const W = cv.width, H = cv.height, t = (now - t0) / 1000, d = Math.min(2, devicePixelRatio || 1);
      const A = live(), cx = W / 2, cy = H / 2, R = Math.min(W, H) * .25;
      g.clearRect(0, 0, W, H);
      if (A) {
        fbuf = fbuf && fbuf.length === A.post.frequencyBinCount ? fbuf : new Uint8Array(A.post.frequencyBinCount);
        tbuf = tbuf && tbuf.length === A.post.fftSize ? tbuf : new Float32Array(A.post.fftSize);
        pbuf = pbuf && pbuf.length === A.pre.fftSize ? pbuf : new Float32Array(A.pre.fftSize);
        A.post.getByteFrequencyData(fbuf); A.post.getFloatTimeDomainData(tbuf); A.pre.getFloatTimeDomainData(pbuf);
        let p = 0; for (const v of tbuf) p = Math.max(p, Math.abs(v));
        lvl += (p - lvl) * .25;
      } else lvl += ((.35 + .3 * env(.3, t)) - lvl) * .08;
      root.style.setProperty('--lvl', lvl.toFixed(3));

      // the waves: quiet mic on the left, boosted voice on the right
      const L = cx - R * 1.55, Rx = cx + R * 1.55, M = Math.max(40, Math.floor(W / 6));
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(255,255,255,.38)'; g.lineWidth = Math.max(1, 1.2 * d);
      g.beginPath();
      for (let i = 0; i <= M; i++) {
        const x = i / M, px = x * L;
        const v = A ? (pbuf[Math.floor(x * (pbuf.length - 1))] || 0) * 3 : wave(x, t) * env(x, t) * .5;
        const fade = Math.min(1, x * 4) * Math.min(1, (1 - x) * 6);
        const py = cy - v * H * .08 * fade;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke();
      const grad = g.createLinearGradient(Rx, 0, W, 0);
      grad.addColorStop(0, HOT(.2)); grad.addColorStop(.25, HOT(1)); grad.addColorStop(1, 'rgba(255,170,90,.9)');
      g.strokeStyle = grad; g.lineWidth = Math.max(2, 2.6 * d);
      g.shadowColor = HOT(.7); g.shadowBlur = 18 * d;
      g.beginPath();
      for (let i = 0; i <= M; i++) {
        const x = i / M, px = Rx + x * (W - Rx);
        const v = A ? (tbuf[Math.floor(x * (tbuf.length - 1))] || 0) : Math.tanh(wave(x + .3, t) * env(x + .3, t) * 6) / Math.tanh(2.5);
        const fade = Math.min(1, x * 5) * Math.min(1, (1 - x) * 4);
        const py = cy - v * H * .3 * fade;
        i ? g.lineTo(px, py) : g.moveTo(px, py);
      }
      g.stroke(); g.shadowBlur = 0;

      // the ring: 120 bars around the logo, from the live spectrum or a resting pulse
      const rot = t * .08;
      for (let i = 0; i < N; i++) {
        const a = i / N * Math.PI * 2 + rot;
        let v;
        if (A && fbuf) { const k = Math.floor(Math.pow(fbuf.length * .7, (i % (N / 2)) / (N / 2))); v = (fbuf[k] || 0) / 255; }
        else v = .18 + .5 * env((i % 30) / 30, t + i * .013) * (.6 + .4 * Math.sin(t * 2 + i * .3));
        const r0 = R * 1.06, r1 = r0 + R * (.06 + v * .5);
        const mix = (Math.sin(a * 2 + t) + 1) / 2;
        g.strokeStyle = `rgba(${Math.round(RGB[0] + (255 - RGB[0]) * mix * .2)},${Math.round(RGB[1] + (170 - RGB[1]) * mix)},${Math.round(RGB[2] + (90 - RGB[2]) * mix)},${.35 + v * .65})`;
        g.lineWidth = Math.max(1.5, R * .028);
        g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.stroke();
      }
      // two thin orbits and a glow that breathes with the level
      g.lineWidth = Math.max(1, d);
      g.strokeStyle = 'rgba(255,255,255,.14)'; g.beginPath(); g.arc(cx, cy, R * 1.0, 0, Math.PI * 2); g.stroke();
      g.setLineDash([2 * d, 10 * d]); g.lineDashOffset = -t * 20 * d;
      g.strokeStyle = HOT(.5); g.beginPath(); g.arc(cx, cy, R * 1.72, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
      const glow = g.createRadialGradient(cx, cy, R * .6, cx, cy, R * 1.9);
      glow.addColorStop(0, HOT(.18 + lvl * .25)); glow.addColorStop(1, HOT(0));
      g.fillStyle = glow; g.beginPath(); g.arc(cx, cy, R * 1.9, 0, Math.PI * 2); g.fill();
    }
    const run = now => { draw(now); if (!paused && visible && !document.hidden) raf = requestAnimationFrame(run); };
    const kick = () => { cancelAnimationFrame(raf); if ((!paused || live()) && visible && !document.hidden) raf = requestAnimationFrame(run); else draw(performance.now()); };
    draw(performance.now() + 1500);
    const btn = $('corePause');
    const setBtn = () => {
      btn.setAttribute('aria-pressed', String(paused));
      btn.setAttribute('aria-label', paused ? 'Play the animation' : 'Pause the animation');
      btn.innerHTML = paused
        ? '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2l6 4-6 4z" fill="currentColor"/></svg>'
        : '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 2v8M8.5 2v8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    };
    if (btn) { btn.addEventListener('click', () => { paused = !paused; setBtn(); kick(); }); setBtn(); }
    new IntersectionObserver(es => { visible = es[0].isIntersecting; kick(); }).observe(cv);
    document.addEventListener('visibilitychange', kick);
    addEventListener('dios:start', kick); addEventListener('dios:stop', kick);
    addEventListener('resize', () => draw(performance.now()));
    kick();
  }

  /* ---------------- the page breathes with your voice while live ---------------- */
  // (the hero core sets --lvl while it is on screen; elsewhere this lighter loop does)
  let lraf = 0, lbuf, ll = 0;
  const levelLoop = () => {
    const A = live();
    if (!A || document.hidden) { lraf = 0; return; }
    const core = $('heroCore'), coreOn = core && core.getBoundingClientRect().bottom > 0 && core.getBoundingClientRect().top < innerHeight;
    if (!coreOn) {
      lbuf = lbuf && lbuf.length === A.post.fftSize ? lbuf : new Float32Array(A.post.fftSize);
      A.post.getFloatTimeDomainData(lbuf);
      let p = 0; for (const v of lbuf) p = Math.max(p, Math.abs(v));
      ll += (p - ll) * .2; root.style.setProperty('--lvl', ll.toFixed(3));
    }
    lraf = requestAnimationFrame(levelLoop);
  };
  if (!reduce) {
    addEventListener('dios:start', () => { if (!lraf) lraf = requestAnimationFrame(levelLoop); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden && live() && !lraf) lraf = requestAnimationFrame(levelLoop); });
  }

  /* ---------------- the gain readout in the hero follows the amp ---------------- */
  const big = $('coreRead'), sub = $('coreDb');
  if (big) {
    const fmt = g => (g >= 100 ? Math.round(g).toLocaleString('en') : g.toFixed(1).replace(/\.0$/, '')) + 'x';
    const follow = () => { const r = $('read'), d = $('db'); if (live() && r) { big.textContent = r.textContent; sub.textContent = d.textContent + ' · live'; } };
    // on load it counts once from 1x to 100,000x (the page's one count), then follows the amp when live
    if (!reduce) {
      const t0 = performance.now(), dur = 1800;
      const step = now => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); big.textContent = fmt(Math.pow(10, 5 * e)); if (k < 1 && !live()) requestAnimationFrame(step); else follow(); };
      requestAnimationFrame(step);
    }
    ['gain', 'presets'].forEach(id => { const el = $(id); if (el) { el.addEventListener('input', follow); el.addEventListener('click', () => setTimeout(follow, 0)); } });
    document.querySelectorAll('.c-chips [data-x]').forEach(b => b.addEventListener('click', () => setTimeout(follow, 0)));
    addEventListener('dios:start', follow);
    addEventListener('dios:stop', () => { big.textContent = '100,000x'; sub.textContent = '+100 dB · loud and clear'; });
  }
})();
