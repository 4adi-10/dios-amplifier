// Signs this browser out: clears the key cookie and goes back to the key screen
export function GET(request) {
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL('/unlock.html', request.url).toString(),
      'Set-Cookie': 'dios_key=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax',
      'Cache-Control': 'no-store'
    }
  });
}
