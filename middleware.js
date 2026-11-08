// Runs on Vercel before every page and file is served: no valid key cookie, no amplifier.
import { next } from '@vercel/functions/middleware';
import { verifyKey, readCookie } from './lib/keys.js';

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
    if (r.ok) return next();
  }
  const to = new URL('/unlock.html', url);
  if (url.pathname !== '/' && url.pathname !== '/index.html') to.searchParams.set('next', url.pathname);
  const res = Response.redirect(to, 307);
  return res;
}
