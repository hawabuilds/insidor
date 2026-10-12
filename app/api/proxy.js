/**
 * THE APP'S /api/* ON VERCEL — one function that forwards each request to the Railway service
 * it names, so the phone sees one https origin: no CORS, and push works from the Home Screen on
 * the same address the app was added from.
 *
 *   /api/read/…    → READ_SERVICE_URL       /api/social/…  → SOCIAL_SERVICE_URL
 *   /api/trade/…   → TRADE_SERVICE_URL      /api/notify/…  → NOTIFY_SERVICE_URL
 *
 * (vercel.json rewrites /api/<service>/<path> to this function with ?service=&path=.)
 *
 * ★ ONLY FOUR SERVICES, ONLY THEIR OWN ADDRESSES. The target is chosen from a fixed list and read
 * from the environment the owner set in Vercel; nothing in the request can point it anywhere
 * else. A service with no address answers 503 saying which setting is missing.
 *
 * ★ THE SIGN-IN TOKEN PASSES THROUGH, UNREAD. `authorization` is forwarded as is for social and
 * notify to check; this function never logs, stores or inspects it.
 *
 * A copy of mobile/api/proxy.js, for the desktop app; keep the two the same.
 */

const TARGETS = { read: 'READ_SERVICE_URL', trade: 'TRADE_SERVICE_URL', social: 'SOCIAL_SERVICE_URL', notify: 'NOTIFY_SERVICE_URL' };
const PASSED = ['accept', 'content-type', 'authorization', 'last-event-id'];

async function forward(request) {
  const url = new URL(request.url);
  const service = url.searchParams.get('service') ?? '';
  const setting = TARGETS[service];
  if (setting === undefined) return Response.json({ error: 'not found' }, { status: 404 });
  const base = (process.env[setting] ?? '').replace(/\/+$/, '');
  if (base === '') return Response.json({ error: `${setting} is not set on this deploy.` }, { status: 503 });

  const path = (url.searchParams.get('path') ?? '').split('/').filter((s) => s !== '' && s !== '..').map(encodeURIComponent).join('/');
  const query = new URLSearchParams(url.searchParams);
  query.delete('service');
  query.delete('path');
  const target = `${base}/${path}${query.size > 0 ? `?${query}` : ''}`;

  const headers = new Headers();
  for (const name of PASSED) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor !== null) headers.set('x-forwarded-for', forwardedFor);

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let reply;
  try {
    reply = await fetch(target, { method: request.method, headers, body: hasBody ? await request.arrayBuffer() : undefined, redirect: 'manual' });
  } catch {
    return Response.json({ error: `The ${service} service did not answer.` }, { status: 502 });
  }
  const out = new Headers({ 'cache-control': 'no-store' });
  const type = reply.headers.get('content-type');
  if (type !== null) out.set('content-type', type);
  return new Response(reply.body, { status: reply.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
