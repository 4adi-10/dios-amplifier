/* DIOS Amplifier: motion for the atelier theme (lux.css). Looks only: it never touches the audio code.
   Reads the page's own state (the Start button's data-live, the meter width, the gain readout) to react to sound. */
(() => {
  'use strict';
  window.LX_OK = true;
  const root = document.documentElement;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const hover = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- split headings into words that rise out of a mask ---------- */
  const split = el => {
    let i = 0;
    const walk = node => [...node.childNodes].forEach(n => {
      if (n.nodeType === 3) {
        const parts = n.textContent.split(/(\s+)/), frag = document.createDocumentFragment();
        parts.forEach(p => {
          if (!p) return;
          if (/^\s+$/.test(p)) { frag.appendChild(document.createTextNode(' ')); return; }
          const o = document.createElement('span'), s = document.createElement('span');
          o.className = 'lx-w'; s.textContent = p; o.style.setProperty('--i', i++); o.appendChild(s); frag.appendChild(o);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && !n.classList.contains('lx-w')) walk(n);
    });
    walk(el);
  };
  const heads = $$('.hero h1, .section h2, .closing h2');
  if (!reduce) heads.forEach(split);

  /* ---------- structure the theme adds: section rules, the marquee band, bar indexes ---------- */
  $$('main > .section > .wrap').forEach(w => { const r = document.createElement('i'); r.className = 'lx-rule'; r.setAttribute('aria-hidden', 'true'); w.prepend(r); });
  const hero = $('.hero');
  let marq = null;
  if (hero) {
    marq = document.createElement('div'); marq.className = 'lx-marq'; marq.setAttribute('aria-hidden', 'true');
    const words = ['100,000x gain', 'Noise gate', 'Three-band EQ', 'Limiter', 'Soundboard', 'YouTube on your mic', 'Push to talk', 'Test recorder'];
    const row = words.map(w => '<span>' + w + '</span>').join('');
    marq.innerHTML = '<div>' + row + row + '</div>';
    hero.after(marq);
  }
  $$('.mini__wave').forEach(w => [...w.children].forEach((b, n) => b.style.setProperty('--n', n)));
  $$('.hero-win__row').forEach((r, n) => r.style.setProperty('--i', n));

  /* ---------- reveals ---------- */
  const mark = (sel, kind, stagger) => $$(sel).forEach(el => {
    if (el.hasAttribute('data-lx')) return;
    el.setAttribute('data-lx', kind);
    if (stagger) { const sib = [...el.parentElement.children].filter(x => x.tagName === el.tagName); el.style.setProperty('--i', Math.min(7, sib.indexOf(el))); }
  });
  const heroBits = ['.hero .dios-loop', '.hero__lead', '.hero .btn-row', '.hero .hero__proof'];
  if (!reduce) {
    heroBits.forEach((s, n) => $$(s).forEach(el => { el.setAttribute('data-lx', 'up'); el.style.setProperty('--d', (350 + n * 110) + 'ms'); }));
    $$('.hero__art').forEach(el => { el.setAttribute('data-lx', 'zoom'); el.style.setProperty('--d', '250ms'); });
    mark('.section .grid > p, .section-head > p', 'up');
    mark('.console', 'curtain');
    mark('.feat .card', 'up', true);
    mark('.steps li', 'side', true);
    mark('#setup .panel, .ext-stage', 'zoom');
    mark('.faq__item', 'up', true);
    mark('.closing .t-lead, .closing__cta .btn, .footer__col, .footer__lede', 'up', true);
  }
  const done = el => setTimeout(() => el.removeAttribute('data-lx'), 3200);   // hand the element back to its own hover and parallax styles
  const show = el => { el.classList.add('lx-in'); if (el.hasAttribute('data-lx')) done(el); };
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { show(en.target.__lx || en.target); io.unobserve(en.target); } }), { threshold: 0, rootMargin: '100000px 0px -9% 0px' }) : null;
  const watch = () => {
    const els = [...$$('[data-lx]'), ...$$('.lx-rule'), ...heads].filter(el => !el.closest('.hero'));
    els.forEach(el => {
      if (!io || reduce) return show(el);
      // a curtain starts fully clipped, which an observer cannot see, so a 1px marker above it stands in
      if (el.getAttribute('data-lx') === 'curtain') { const m = document.createElement('i'); m.style.cssText = 'display:block;height:1px;margin-bottom:-1px'; m.setAttribute('aria-hidden', 'true'); m.__lx = el; el.before(m); io.observe(m); }
      else io.observe(el);
    });
  };
  const go = () => {
    root.classList.add('lx-go');
    $$('.hero h1, .hero [data-lx], .hero__art').forEach(show);
    watch();
  };

  /* ---------- curtain ---------- */
  const curtain = $('#lx-curtain');
  let seen = reduce;
  try { seen = seen || sessionStorage.getItem('lx-seen') === '1'; } catch (e) {}
  if (!curtain || seen) { if (curtain) curtain.remove(); go(); }
  else {
    const num = curtain.querySelector('em'), t0 = performance.now(), D = 1500;
    let out = false;
    const leave = () => {
      if (out) return; out = true;
      try { sessionStorage.setItem('lx-seen', '1'); } catch (e) {}
      curtain.classList.add('is-out'); setTimeout(go, 250); setTimeout(() => curtain.remove(), 1300);
    };
    const tick = now => {
      const k = clamp((now - t0) / D, 0, 1), e = 1 - Math.pow(1 - k, 3);
      if (num) num.textContent = String(Math.round(e * 100)).padStart(3, '0');
      k < 1 ? requestAnimationFrame(tick) : leave();
    };
    requestAnimationFrame(tick);
    setTimeout(leave, 3200);   // a hidden tab never holds the page
  }

  /* ---------- live state: follow the Start button, tick the readout ---------- */
  const goBtn = $('#go'), read = $('#read'), bar = $('#bar');
  if (goBtn && 'MutationObserver' in window) {
    const sync = () => root.classList.toggle('lx-live', goBtn.hasAttribute('data-live'));
    new MutationObserver(sync).observe(goBtn, { attributes: true, attributeFilter: ['data-live'] }); sync();
  }
  if (read && 'MutationObserver' in window && !reduce) {
    let last = 0;
    new MutationObserver(() => {
      const now = performance.now(); if (now - last < 450) return; last = now;
      read.classList.remove('lx-tick'); void read.offsetWidth; read.classList.add('lx-tick');
    }).observe(read, { childList: true, characterData: true, subtree: true });
  }
  const level = () => { if (!bar || !root.classList.contains('lx-live')) return 0; const w = parseFloat(bar.style.width); return isFinite(w) ? clamp(w / 100, 0, 1) : 0; };

  /* ---------- scroll: hairline progress, nav, the closing word, marquee speed ---------- */
  const prog = document.createElement('div'); prog.id = 'lx-prog'; prog.setAttribute('aria-hidden', 'true'); document.body.appendChild(prog);
  const word = $('.close__word');
  let lastY = scrollY, vel = 0, scrollK = 0;
  const onScroll = () => {
    const y = scrollY, max = root.scrollHeight - innerHeight;
    prog.style.transform = 'scaleX(' + (max > 0 ? y / max : 0) + ')';
    scrollK = clamp(y / (innerHeight * .9), 0, 1);
    if (!reduce) root.classList.toggle('lx-nav-hide', y > 240 && y > lastY + 2 ? true : y < lastY - 2 ? false : root.classList.contains('lx-nav-hide'));
    vel += ((y - lastY) - vel) * .35; lastY = y;
    if (word) { const r = word.getBoundingClientRect(); word.style.setProperty('--lx-fill', (clamp((innerHeight - r.top) / (innerHeight * .55 + r.height), 0, 1) * 100).toFixed(1) + '%'); }
  };
  addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll); onScroll();
  if ('IntersectionObserver' in window) {
    const links = $$('.nav__link');
    const nio = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) links.forEach(a => a.classList.toggle('lx-here', a.getAttribute('href') === '#' + en.target.id)); }), { rootMargin: '-45% 0px -50% 0px' });
    $$('main section[id]').forEach(s => nio.observe(s));
  }

  /* ---------- silk background ---------- */
  const bg = document.createElement('canvas'); bg.id = 'lx-bg'; bg.setAttribute('aria-hidden', 'true'); document.body.prepend(bg);
  let mx = .5, my = .5;
  (function silk() {
    const gl = bg.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
    if (!gl) return;   // the CSS gradient on the canvas stays as the fallback
    const vs = 'attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}';
    const fs = `precision mediump float;
uniform vec2 r;uniform float t;uniform float a;uniform vec2 m;uniform float s;
float h(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h(i),h(i+vec2(1.,0.)),f.x),mix(h(i+vec2(0.,1.)),h(i+vec2(1.,1.)),f.x),f.y);}
float fbm(vec2 p){float v=0.,q=.5;for(int i=0;i<4;i++){v+=q*n(p);p=p*2.03+vec2(1.7,9.2);q*=.5;}return v;}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*r)/r.y;
  vec2 p=uv*1.1+vec2(0.,s*.45);float tt=t*.04;
  vec2 q=vec2(fbm(p+tt),fbm(p+vec2(5.2,1.3)-tt));
  vec2 w=vec2(fbm(p+2.6*q+vec2(1.7,9.2)+tt*1.3),fbm(p+2.6*q+vec2(8.3,2.8)-tt));
  float f=fbm(p+3.*w+(m-.5)*.3);
  float fold=abs(sin((f*3.+w.x*1.7)*3.14159));fold=fold*fold*fold;
  vec3 col=vec3(.036,.012,.028);
  col+=vec3(.52,.06,.24)*smoothstep(.35,.95,f)*(.42+.3*a);
  col+=vec3(1.,.28,.55)*fold*smoothstep(.38,.9,f)*(.16+.3*a);
  col+=vec3(.96,.9,.88)*fold*fold*fold*.05;
  float vig=smoothstep(1.35,.1,length(uv*vec2(.7,1.)));
  col*=vig*mix(1.,.5,s);
  col+=(h(gl_FragCoord.xy+fract(t))-.5)*.022;
  gl_FragColor=vec4(col,1.);
}`;
    const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null; };
    const v = mk(gl.VERTEX_SHADER, vs), f = mk(gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return;
    const pr = gl.createProgram(); gl.attachShader(pr, v); gl.attachShader(pr, f); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
    gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const U = n => gl.getUniformLocation(pr, n), ur = U('r'), ut = U('t'), ua = U('a'), um = U('m'), us = U('s');
    const fit = () => { const sc = .5, w = Math.max(2, Math.round(innerWidth * sc)), hh = Math.max(2, Math.round(innerHeight * sc)); if (bg.width !== w || bg.height !== hh) { bg.width = w; bg.height = hh; gl.viewport(0, 0, w, hh); } };
    let a = 0, sm = [.5, .5], last = 0;
    const frame = now => {
      if (!document.hidden && now - last > 32) {
        last = now; fit();
        a += (level() - a) * .07; sm[0] += (mx - sm[0]) * .04; sm[1] += (my - sm[1]) * .04;
        gl.uniform2f(ur, bg.width, bg.height); gl.uniform1f(ut, (now / 1000) % 900); gl.uniform1f(ua, a);
        gl.uniform2f(um, sm[0], 1 - sm[1]); gl.uniform1f(us, scrollK);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      if (!reduce) requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    if (reduce) addEventListener('resize', () => requestAnimationFrame(frame));
  })();

  if (reduce) return;

  /* ---------- pointer: ring cursor, hero depth, magnetic buttons ---------- */
  let cur = null, tx = innerWidth / 2, ty = innerHeight / 2, cx = tx, cy = ty, on = false;
  if (hover) {
    cur = document.createElement('div'); cur.id = 'lx-cur'; cur.setAttribute('aria-hidden', 'true'); document.body.appendChild(cur);
    addEventListener('pointermove', e => {
      tx = e.clientX; ty = e.clientY; mx = tx / innerWidth; my = ty / innerHeight;
      if (!on) { on = true; cx = tx; cy = ty; cur.style.opacity = 1; }
      const t = e.target.closest ? e.target : null;
      cur.classList.toggle('is-drag', !!(t && t.closest('input[type="range"]')));
      cur.classList.toggle('is-on', !!(t && t.closest('a, button, summary, select, label, .b-pad, .b-add')));
    }, { passive: true });
    document.addEventListener('pointerleave', () => { on = false; cur.style.opacity = 0; });
    const art = $('.hero__art'), note = $('.amp-note');
    if (hero && art) hero.addEventListener('pointermove', e => {
      const dx = e.clientX / innerWidth - .5, dy = e.clientY / innerHeight - .5;
      art.style.setProperty('--lx-px', (dx * -18).toFixed(1) + 'px'); art.style.setProperty('--lx-py', (dy * -12).toFixed(1) + 'px');
      if (note) { note.style.setProperty('--lx-nx', (dx * 30).toFixed(1) + 'px'); note.style.setProperty('--lx-ny', (dy * 20).toFixed(1) + 'px'); }
    }, { passive: true });
    $$('.btn--primary, .c-go').forEach(el => {
      el.addEventListener('pointermove', e => { const r = el.getBoundingClientRect(); el.style.translate = ((e.clientX - r.left - r.width / 2) * .22).toFixed(1) + 'px ' + ((e.clientY - r.top - r.height / 2) * .3).toFixed(1) + 'px'; });
      el.addEventListener('pointerleave', () => { el.style.translate = ''; });
    });
  }

  /* ---------- one loop: cursor follow, level, marquee speed ---------- */
  const anim = () => marq && marq.firstElementChild.getAnimations ? marq.firstElementChild.getAnimations()[0] : null;
  let lvl = 0, lvlSet = -1;
  const loop = () => {
    if (!document.hidden) {
      if (cur && on) { cx += (tx - cx) * .2; cy += (ty - cy) * .2; cur.style.transform = 'translate(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px)'; }
      lvl += (level() - lvl) * .25;
      if (Math.abs(lvl - lvlSet) > .01) { lvlSet = lvl; root.style.setProperty('--lvl', lvl.toFixed(2)); }
      vel *= .9;
      const an = anim(); if (an) an.playbackRate = clamp(1 + vel * .09, -6, 7);
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
})();
