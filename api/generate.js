// POST { user, password, days } -> a new access key. Only names and passwords listed in ADMINS may call it.
import { makeKey, checkAdmin, sleep } from '../lib/keys.js';

export async function POST(request) {
  let body = {};
  try { body = await request.json(); } catch (e) {}
  if (!process.env.KEY_SECRET || !process.env.ADMINS) {
    return Response.json({ ok: false, error: 'Access keys are not set up yet. Run setup-keys.bat.' }, { status: 503 });
  }
  if (!checkAdmin(process.env.ADMINS, body.user, body.password)) {
    await sleep(800);
    return Response.json({ ok: false, error: 'Wrong admin name or password.' }, { status: 401 });
  }
  const days = Math.max(0, Math.min(3650, Number(body.days) || 0));
  const count = Math.max(1, Math.min(20, Number(body.count) || 1));
  const pro = body.pro === true;
  const keys = [];
  for (let i = 0; i < count; i++) {
    const k = await makeKey(process.env.KEY_SECRET, days, pro);
    keys.push({ key: k.key, id: k.id, exp: k.exp, pro });
  }
  return Response.json({ ok: true, keys, by: String(body.user).trim() }, { headers: { 'Cache-Control': 'no-store' } });
}

export function GET() {
  return Response.json({ ok: false, error: 'Use POST.' }, { status: 405 });
}
