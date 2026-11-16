// DIOS key database: Upstash Redis over its REST API (plain fetch, no package), connected through Vercel.
// It lets an admin see every key and turn one off instantly. Without it everything still works as before:
// keys are checked by their signature alone and turned off through REVOKED_KEYS.
//   dios:ids          set of every key id made or used
//   dios:key:<id>     JSON { id, key, pro, exp, by, at } written when the key is made
//   dios:use:<id>     hash { first, last, uses } updated when the key opens the amplifier
//   dios:off          set of turned-off key ids

const env = () => (typeof process !== 'undefined' && process.env) || {};
const url = () => env().KV_REST_API_URL || env().UPSTASH_REDIS_REST_URL || '';
const token = () => env().KV_REST_API_TOKEN || env().UPSTASH_REDIS_REST_TOKEN || '';
export const hasStore = () => !!(url() && token());

// one request, several commands
export async function run(cmds) {
  const r = await fetch(url().replace(/\/$/, '') + '/pipeline', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' }, body: JSON.stringify(cmds)
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !Array.isArray(j)) throw new Error('Key database error ' + r.status);
  return j.map(x => { if (x.error) throw new Error(x.error); return x.result; });
}

export async function isOff(id) {
  if (!hasStore()) return false;
  try { return (await run([['SISMEMBER', 'dios:off', id]]))[0] === 1; }
  catch (e) { return false; }   // the database is down: fall back to the signature check
}

export async function saveMade(keys, by) {
  if (!hasStore()) return;
  const now = Math.floor(Date.now() / 1000), cmds = [];
  for (const k of keys) { cmds.push(['SADD', 'dios:ids', k.id]); cmds.push(['SET', 'dios:key:' + k.id, JSON.stringify({ id: k.id, key: k.key, pro: !!k.pro, exp: k.exp, by, at: now })]); }
  await run(cmds);
}

// a key opened the amplifier: note when (keys made before the database get a record on first use)
export async function noteUse(k) {
  if (!hasStore()) return;
  const now = Math.floor(Date.now() / 1000);
  try {
    await run([['SADD', 'dios:ids', k.id], ['SET', 'dios:key:' + k.id, JSON.stringify({ id: k.id, pro: !!k.pro, exp: k.exp, by: '', at: 0, old: true }), 'NX'],
      ['HSETNX', 'dios:use:' + k.id, 'first', now], ['HSET', 'dios:use:' + k.id, 'last', now], ['HINCRBY', 'dios:use:' + k.id, 'uses', 1]]);
  } catch (e) {}
}

export async function setOff(id, off) { await run([[off ? 'SADD' : 'SREM', 'dios:off', id], ['SADD', 'dios:ids', id]]); }
export async function forget(id) { await run([['SREM', 'dios:ids', id], ['DEL', 'dios:key:' + id], ['DEL', 'dios:use:' + id], ['SADD', 'dios:off', id]]); }

export async function listAll() {
  const [ids, off] = await run([['SMEMBERS', 'dios:ids'], ['SMEMBERS', 'dios:off']]);
  if (!ids.length) return [];
  const res = await run(ids.flatMap(id => [['GET', 'dios:key:' + id], ['HGETALL', 'dios:use:' + id]]));
  const offSet = new Set(off);
  return ids.map((id, i) => {
    let k = {}; try { k = JSON.parse(res[i * 2] || '{}'); } catch (e) {}
    const h = res[i * 2 + 1] || [], u = {}; for (let j = 0; j < h.length; j += 2) u[h[j]] = +h[j + 1];
    return { id, key: k.key || '', pro: !!k.pro, exp: k.exp || 0, by: k.by || '', made: k.at || 0, old: !!k.old, first: u.first || 0, last: u.last || 0, uses: u.uses || 0, off: offSet.has(id) };
  });
}
