// POST { user, password, action, id } for admins.
//   list         every key with its type, expiry, who made it, first and last use, and whether it is off
//   off / on     turn a key off (its user is sent back to the key screen within a minute) or back on
//   delete       remove a key from the list for good (it stays off)
import { checkAdmin, sleep } from '../lib/keys.js';
import { hasStore, listAll, setOff, forget } from '../lib/store.js';

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch (e) {}
  const h = { 'Cache-Control': 'no-store' };
  if (!process.env.ADMINS) return Response.json({ ok: false, error: 'Access keys are not set up yet.' }, { status: 503, headers: h });
  if (!checkAdmin(process.env.ADMINS, body.user, body.password)) { await sleep(800); return Response.json({ ok: false, error: 'Wrong admin name or password.' }, { status: 401, headers: h }); }
  if (!hasStore()) return Response.json({ ok: true, store: false, keys: [] }, { headers: h });
  const id = String(body.id || '').toLowerCase();
  try {
    if (body.action === 'off' || body.action === 'on' || body.action === 'delete') {
      if (!/^[0-9a-f]{12}$/.test(id)) return Response.json({ ok: false, error: 'That is not a key id.' }, { status: 400, headers: h });
      if (body.action === 'delete') await forget(id); else await setOff(id, body.action === 'off');
      return Response.json({ ok: true }, { headers: h });
    }
    return Response.json({ ok: true, store: true, keys: await listAll(), now: Math.floor(Date.now() / 1000) }, { headers: h });
  } catch (e) { return Response.json({ ok: false, error: 'The key database did not answer. Try again.' }, { status: 502, headers: h }); }
}
export function GET() { return Response.json({ ok: false, error: 'Use POST.' }, { status: 405 }); }
