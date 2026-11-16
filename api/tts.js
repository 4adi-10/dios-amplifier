// GET /api/tts?text=...&lang=en -> one mp3 of the text spoken aloud, for "Type to talk".
// Only people with a working access key can use it (the key cookie is checked here, since /api skips the middleware).
import { verifyKey, readCookie } from '../lib/keys.js';

const LANGS = new Set(['en', 'en-GB', 'en-AU', 'en-IN', 'ml', 'hi', 'ta', 'te', 'kn', 'bn', 'mr', 'ar', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'ja', 'ko', 'zh-CN', 'tr', 'id']);

// split into pieces of at most 180 characters, on sentence ends or spaces where possible
function chunks(text) {
  const out = [];
  let rest = text;
  while (rest.length > 180) {
    let cut = Math.max(rest.lastIndexOf('. ', 180), rest.lastIndexOf('! ', 180), rest.lastIndexOf('? ', 180), rest.lastIndexOf(', ', 180));
    if (cut < 60) cut = rest.lastIndexOf(' ', 180);
    if (cut < 20) cut = 180; else cut += 1;
    out.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export async function GET(request) {
  const secret = process.env.KEY_SECRET;
  const key = readCookie(request.headers.get('cookie'), 'dios_key');
  const ok = secret && key && (await verifyKey(secret, key, process.env.REVOKED_KEYS)).ok;
  if (!ok) return Response.json({ ok: false, error: 'Unlock the amplifier with your key first.' }, { status: 401 });

  const url = new URL(request.url);
  const text = (url.searchParams.get('text') || '').replace(/\s+/g, ' ').trim().slice(0, 600);
  const lang = LANGS.has(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'en';
  if (!text) return Response.json({ ok: false, error: 'Type something to say.' }, { status: 400 });

  // en-GB / en-AU / en-IN pick the accent through the Google domain's tld; the voice language stays en
  const tld = { 'en-GB': 'co.uk', 'en-AU': 'com.au', 'en-IN': 'co.in' }[lang] || 'com';
  const tl = lang.startsWith('en-') ? 'en' : lang;
  try {
    const parts = chunks(text);
    const bufs = [];
    for (let i = 0; i < parts.length; i++) {
      const q = new URLSearchParams({ ie: 'UTF-8', client: 'tw-ob', tl, q: parts[i], total: String(parts.length), idx: String(i), textlen: String(parts[i].length) });
      const r = await fetch(`https://translate.google.${tld}/translate_tts?` + q, { headers: { 'User-Agent': 'Mozilla/5.0', Referer: `https://translate.google.${tld}/` } });
      if (!r.ok) throw new Error('voice service answered ' + r.status);
      bufs.push(new Uint8Array(await r.arrayBuffer()));
    }
    // mp3 frames join end to end, so the pieces play as one file
    const total = bufs.reduce((n, b) => n + b.length, 0), all = new Uint8Array(total);
    let o = 0; for (const b of bufs) { all.set(b, o); o += b.length; }
    return new Response(all, { headers: { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'private, max-age=3600' } });
  } catch (e) {
    return Response.json({ ok: false, error: 'The voice service did not answer. Try again in a moment.' }, { status: 502 });
  }
}
