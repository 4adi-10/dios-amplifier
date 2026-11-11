// What this browser's key unlocks. The amplifier asks on load: a Pro key opens the levels above 100,000x.
import { verifyKey, readCookie } from '../lib/keys.js';

export async function GET(request) {
  const r = await verifyKey(process.env.KEY_SECRET, readCookie(request.headers.get('cookie'), 'dios_key'), process.env.REVOKED_KEYS);
  return Response.json(r.ok ? { ok: true, pro: !!r.pro, exp: r.exp } : { ok: false, pro: false },
    { status: r.ok ? 200 : 401, headers: { 'Cache-Control': 'no-store' } });
}
