// DIOS access keys: signed, so they need no database.
// A key is 22 bytes: 6-byte random id + 4-byte expiry (unix seconds, 0 = never) + 12-byte HMAC-SHA256
// signature made with KEY_SECRET. Written in Crockford base32 as DIOS-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX-XXXXXX.
// Nobody can make a valid key without KEY_SECRET, which only lives in Vercel's environment variables.
// Pro keys look the same but are signed with KEY_SECRET + ":pro", so every key made before stays a normal key.

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const enc = new TextEncoder();

function b32encode(bytes) {
  let out = '', bits = 0, val = 0;
  for (const b of bytes) {
    val = (val << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; val &= (1 << bits) - 1; }
  }
  if (bits > 0) out += B32[(val << (5 - bits)) & 31];
  return out;
}

function b32decode(str) {
  const out = []; let bits = 0, val = 0;
  for (const ch of str) {
    const i = B32.indexOf(ch);
    if (i < 0) return null;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; val &= (1 << bits) - 1; }
  }
  return new Uint8Array(out);
}

const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

// "dios-abc1 23..." -> "ABC123...": drop the prefix, dashes and spaces; read O as 0 and I or L as 1
export function normalize(input) {
  let s = String(input || '').toUpperCase().replace(/^\s*DIOS[-\s]*/, '').replace(/[^0-9A-Z]/g, '');
  return s.replace(/O/g, '0').replace(/[IL]/g, '1').replace(/U/g, 'V');
}

export function format(norm) {
  return 'DIOS-' + norm.match(/.{1,6}/g).join('-');
}

async function sign(secret, payload) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, payload)).slice(0, 12);
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

const proSecret = secret => secret + ':pro';

export async function makeKey(secret, days, pro = false) {
  if (!secret) throw new Error('KEY_SECRET is not set');
  const payload = new Uint8Array(10);
  crypto.getRandomValues(payload.subarray(0, 6));
  const exp = days > 0 ? Math.floor(Date.now() / 1000) + Math.round(days * 86400) : 0;
  new DataView(payload.buffer).setUint32(6, exp);
  const sig = await sign(pro ? proSecret(secret) : secret, payload);
  const bytes = new Uint8Array(22); bytes.set(payload); bytes.set(sig, 10);
  const norm = b32encode(bytes);
  return { key: format(norm), norm, id: hex(payload.subarray(0, 6)), exp, pro: !!pro };
}

// revoked: comma-separated key ids (from the admin page) in the REVOKED_KEYS variable
export async function verifyKey(secret, input, revoked = '') {
  if (!secret) return { ok: false, reason: 'not-set-up' };
  const norm = normalize(input);
  if (norm.length !== 36) return { ok: false, reason: 'invalid' };
  const bytes = b32decode(norm);
  if (!bytes || bytes.length < 22) return { ok: false, reason: 'invalid' };
  if (b32encode(bytes.subarray(0, 22)) !== norm) return { ok: false, reason: 'invalid' };   // one spelling per key
  const payload = bytes.subarray(0, 10), sig = bytes.subarray(10, 22);
  let pro = false;
  if (!sameBytes(sig, await sign(secret, payload))) {
    if (!sameBytes(sig, await sign(proSecret(secret), payload))) return { ok: false, reason: 'invalid' };
    pro = true;
  }
  const id = hex(payload.subarray(0, 6));
  const exp = new DataView(payload.buffer, payload.byteOffset).getUint32(6);
  if (exp && exp < Date.now() / 1000) return { ok: false, reason: 'expired', id, exp };
  const list = String(revoked || '').toLowerCase().split(/[\s,]+/).filter(Boolean);
  if (list.includes(id)) return { ok: false, reason: 'revoked', id, exp };
  return { ok: true, id, exp, norm, pro };
}

export function readCookie(header, name) {
  const m = String(header || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

// ADMINS = "aadi:long-password,friend:other-password"
export function checkAdmin(adminsEnv, user, password) {
  const u = String(user || '').trim().toLowerCase(), p = String(password || '');
  let ok = false;
  for (const pair of String(adminsEnv || '').split(',')) {
    const i = pair.indexOf(':'); if (i < 1) continue;
    const name = pair.slice(0, i).trim().toLowerCase(), pass = pair.slice(i + 1).trim();
    const a = enc.encode(pass), b = enc.encode(p);
    if (name === u && a.length === b.length && sameBytes(a, b)) ok = true;
  }
  return ok;
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
