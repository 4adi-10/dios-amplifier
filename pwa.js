/* DIOS Amplifier: install as an app (PWA). Shows an Install button when the browser offers it. */
(() => {
  if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const btns = [...document.querySelectorAll('[data-install]')];
  const hint = document.getElementById('installHint');
  if (standalone) { document.documentElement.dataset.app = ''; return; }
  let ev = null;
  const show = on => btns.forEach(b => { b.hidden = !on; });
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); ev = e; show(true); });
  addEventListener('appinstalled', () => { ev = null; show(false); if (hint) hint.textContent = 'Installed. Open DIOS Amplifier from your desktop or Start menu.'; });
  // iPhone and iPad have no install prompt: point at Share, Add to Home Screen
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios) { show(true); }
  btns.forEach(b => b.addEventListener('click', async () => {
    if (ev) { ev.prompt(); const r = await ev.userChoice; if (r.outcome === 'accepted') show(false); ev = null; return; }
    if (hint) hint.textContent = ios ? 'On iPhone: tap Share, then Add to Home Screen.' : 'Use the install icon in the address bar, or the browser menu, then Install DIOS Amplifier.';
  }));
})();
