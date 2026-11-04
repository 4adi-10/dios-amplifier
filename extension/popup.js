const $ = id => document.getElementById(id);
const toGain = v => Math.pow(10, v / 25);
const fromGain = x => 25 * Math.log10(x);
const DEFAULTS = { gain: 1, on: true, mode: 'soft' };

function show() {
  const g = toGain(+$('gain').value);
  $('read').textContent = (g >= 100 ? Math.round(g) : g.toFixed(1).replace(/\.0$/, '')) + 'x';
  $('db').textContent = '+' + (20 * Math.log10(g)).toFixed(0) + ' dB';
}
const save = () => chrome.storage.local.set({ gain: toGain(+$('gain').value), on: $('on').checked, mode: $('mode').value });

chrome.storage.local.get(DEFAULTS, s => {
  $('gain').value = fromGain(s.gain); $('on').checked = s.on; $('mode').value = s.mode; show();
});
$('gain').addEventListener('input', () => { show(); save(); });
$('on').addEventListener('change', save);
$('mode').addEventListener('change', save);
document.querySelectorAll('button[data-x]').forEach(b => b.addEventListener('click', () => {
  $('gain').value = fromGain(+b.dataset.x); show(); save();
}));
