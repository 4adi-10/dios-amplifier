// Runs on Vercel before every page and file is served: no valid key cookie, no amplifier.
import { next } from '@vercel/functions/middleware';
import { verifyKey, readCookie } from './lib/keys.js';
import { isOff } from './lib/store.js';

export const config = {
  // everything except the key screen, the admin page, the key API and the app install files (icons, manifest, service worker)
  matcher: ['/((?!api/|unlock\\.html|admin\\.html|favicon\\.ico|manifest\\.webmanifest|sw\\.js|pwa\\.js|icons/|intro/|intro\\.css|intro\\.js).*)']
};

export default async function middleware(request) {
  const url = new URL(request.url);
  const secret = process.env.KEY_SECRET;
  if (!secret) return new Response('DIOS Amplifier: access keys are not set up yet. Run setup-keys.bat.', { status: 503 });
  const key = readCookie(request.headers.get('cookie'), 'dios_key');
  if (key) {
    const r = await verifyKey(secret, key, process.env.REVOKED_KEYS);
    const page = url.pathname === '/' || /\.html$/.test(url.pathname) || !/\.[a-z0-9]+$/i.test(url.pathname);
    if (r.ok && !(page && await isOff(r.id))) return next();
    if (r.ok) {   // turned off by an admin: forget the key and say so
      const to = new URL('/unlock.html?off=1', url);
      return new Response(null, { status: 307, headers: { Location: to.toString(), 'Set-Cookie': 'dios_key=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax' } });
    }
  }
  const to = new URL('/unlock.html', url);
  if (url.pathname !== '/' && url.pathname !== '/index.html') to.searchParams.set('next', url.pathname);
  const res = Response.redirect(to, 307);
  return res;
}
