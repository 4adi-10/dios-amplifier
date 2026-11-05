const $ = id => document.getElementById(id);
const toGain = v => Math.pow(10, v / 20);            // slider 0..100 -> 1x..100,000x (+100 dB)
const fromGain = x => 20 * Math.log10(Math.max(1, x));
const DEFAULTS = { gain: 100, on: true, mode: 'clear', bass: 0, mid: 3, treble: 2 };
const fmtDb = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v) + ' dB';

const fill = r => r.style.setProperty('--fill', ((r.value - r.min) / (r.max - r.min) * 100) + '%');
function show() {
  document.querySelectorAll('input[type=range]').forEach(fill);
  const g = toGain(+$('gain').value);
  $('read').textContent = (g >= 100 ? Math.round(g).toLocaleString('en') : g.toFixed(1).replace(/\.0$/, '')) + 'x';
  $('db').textContent = '+' + (20 * Math.log10(g)).toFixed(0) + ' dB';
  for (const k of ['bass', 'mid', 'treble']) $(k + 'V').textContent = fmtDb(+$(k).value);
  const on = $('on').checked;
  $('chip').classList.toggle('on', on); $('chipText').textContent = on ? 'On' : 'Off';
}
const save = () => chrome.storage.local.set({
  gain: toGain(+$('gain').value), on: $('on').checked, mode: $('mode').value,
  bass: +$('bass').value, mid: +$('mid').value, treble: +$('treble').value
});

chrome.storage.local.get(DEFAULTS, s => {
  $('gain').value = fromGain(s.gain); $('on').checked = s.on; $('mode').value = s.mode;
  $('bass').value = s.bass; $('mid').value = s.mid; $('treble').value = s.treble; show();
});
for (const id of ['gain', 'bass', 'mid', 'treble']) $(id).addEventListener('input', () => { show(); save(); });
$('on').addEventListener('change', () => { show(); save(); });
$('mode').addEventListener('change', save);
document.querySelectorAll('button[data-x]').forEach(b => b.addEventListener('click', () => {
  $('gain').value = fromGain(+b.dataset.x); show(); save();
}));
