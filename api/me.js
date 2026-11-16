// What this browser's key unlocks, and whether it still works. The amplifier asks on load and every minute:
// a key an admin turned off ends the session within a minute.
import { verifyKey, readCookie } from '../lib/keys.js';
import { isOff, noteUse } from '../lib/store.js';

export async function GET(request) {
  const r = await verifyKey(process.env.KEY_SECRET, readCookie(request.headers.get('cookie'), 'dios_key'), process.env.REVOKED_KEYS);
  const h = { 'Cache-Control': 'no-store' };
  if (r.ok && await isOff(r.id)) { r.ok = false; r.reason = 'revoked'; }
  if (!r.ok) {
    if (r.reason === 'revoked' || r.reason === 'expired') h['Set-Cookie'] = 'dios_key=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax';
    return Response.json({ ok: false, pro: false, reason: r.reason || 'none' }, { status: 401, headers: h });
  }
  if (new URL(request.url).searchParams.get('load') === '1') await noteUse(r);   // count page loads, not the minute checks
  return Response.json({ ok: true, pro: !!r.pro, exp: r.exp, id: r.id }, { headers: h });
}
