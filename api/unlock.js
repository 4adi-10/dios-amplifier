// POST { key } -> sets the HttpOnly key cookie when the key is valid
import { verifyKey, sleep } from '../lib/keys.js';

const MSG = {
  invalid: 'That key is not valid. Check it and try again.',
  expired: 'That key has expired. Ask an admin for a new one.',
  revoked: 'That key was turned off by an admin.',
  'not-set-up': 'Access keys are not set up yet.'
};

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const r = await verifyKey(process.env.KEY_SECRET, body.key, process.env.REVOKED_KEYS);
  if (!r.ok) {
    await sleep(500); // slows down anyone trying keys in a loop
    return Response.json({ ok: false, error: MSG[r.reason] || MSG.invalid }, { status: 401 });
  }
  const now = Math.floor(Date.now() / 1000);
  const maxAge = r.exp ? Math.max(60, r.exp - now) : 400 * 86400;
  return Response.json({ ok: true, exp: r.exp, pro: !!r.pro }, {
    headers: { 'Set-Cookie': `dios_key=${r.norm}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`, 'Cache-Control': 'no-store' }
  });
}

export function GET() {
  return Response.json({ ok: false, error: 'Use POST.' }, { status: 405 });
}
