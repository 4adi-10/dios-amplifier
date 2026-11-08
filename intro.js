/* DIOS Studioz intro: plays the logo video once per visit (and every time the installed app opens), Skip, click or Esc ends it. */
(() => {
  const KEY = 'dios-intro-seen';
  let seen = false;
  try { seen = sessionStorage.getItem(KEY) === '1'; } catch (e) {}
  if (seen) { document.documentElement.classList.add('no-intro'); return; }
  const run = () => {
    const el = document.getElementById('intro'), v = document.getElementById('introV');
    if (!el || !v) return;
    let done = false;
    const end = () => {
      if (done) return; done = true;
      try { sessionStorage.setItem(KEY, '1'); } catch (e) {}
      el.dataset.out = '';
      setTimeout(() => { v.pause(); el.remove(); }, 650);
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { v.removeAttribute('autoplay'); v.pause(); setTimeout(end, 1400); }
    else v.play().catch(() => setTimeout(end, 1500));
    v.addEventListener('ended', end);
    v.addEventListener('error', end);
    el.addEventListener('click', end);
    addEventListener('keydown', e => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') end(); }, { once: true });
    setTimeout(end, 9000);   // never hold the page if the video stalls
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', run) : run();
})();
