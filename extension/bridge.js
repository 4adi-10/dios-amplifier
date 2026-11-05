// Runs in the extension's isolated world: reads settings and passes them to the page script.
const DEFAULTS = { gain: 100, on: true, mode: 'clear', bass: 0, mid: 3, treble: 2 };
const push = s => window.postMessage({ __mb: true, ...s }, '*');
const load = () => chrome.storage.local.get(DEFAULTS, push);
load();
chrome.storage.onChanged.addListener(load);
window.addEventListener('message', e => {
  if (e.source === window && e.data && e.data.__mbReady) load();
});
