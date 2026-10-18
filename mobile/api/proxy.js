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
 * ★ A REPEAT READ COSTS NO BODY. `if-none-match` goes to the service and its `etag` comes back, so
 * a phone holding the current reply gets the service's empty 304. The service's own cache-control
 * passes through only when it is `private, no-cache` (kept by the browser alone, revalidated before
 * every use); anything else is sent as `no-store`, as before.
 *
 * ★ THE EDGE MAY KEEP WHAT THE READ SERVICE SAYS IS THE SAME FOR EVERYONE. A read reply carrying
 * `vercel-cdn-cache-control` (services/read/src/edge-cache.ts) passes through with its browser
 * header `public, max-age=0, must-revalidate`, and Vercel's edge in front of this function keeps
 * it for those few seconds. Only for read, only for a GET, and never when the request carried a
 * sign-in token or a cookie: this function does not forward cookies, so the service cannot see one
 * to refuse it, and the check has to be here. Production reaches read through vercel.json's direct
 * rewrite instead; this path is the rollback and the side-by-side comparison (/api/fn/read/…). Compression needs nothing here: this
 * function's fetch asks the service for gzip or brotli and unpacks it, and Vercel packs the reply
 * again for the phone.
 *
 * ★ THE SIGN-IN TOKEN PASSES THROUGH, UNREAD. `authorization` is forwarded as is for social and
 * notify to check; this function never logs, stores or inspects it.
 *
 * A copy lives at app/api/proxy.js for the desktop app; keep the two the same.
 */

const TARGETS = { read: 'READ_SERVICE_URL', trade: 'TRADE_SERVICE_URL', social: 'SOCIAL_SERVICE_URL', notify: 'NOTIFY_SERVICE_URL' };
const PASSED = ['accept', 'content-type', 'authorization', 'last-event-id', 'if-none-match'];
/** The one cache-control a service may send through: the browser keeps it and asks before each use. */
const REVALIDATE = 'private, no-cache';
/** What read says on a reply the edge may keep (services/read/src/edge-cache.ts), and the edge's own header beside it. */
const SHARED = 'public, max-age=0, must-revalidate';
const EDGE = 'vercel-cdn-cache-control';

/** The cache headers to send for a reply: shared at the edge, kept by the browser alone, or not kept. */
export function cacheHeaders(service, request, reply) {
  const etag = reply.headers.get('etag');
  const said = reply.headers.get('cache-control');
  const edge = reply.headers.get(EDGE);
  const personal = request.headers.has('authorization') || request.headers.has('cookie');
  if (service === 'read' && request.method === 'GET' && !personal && said === SHARED && edge !== null && reply.status === 200) {
    return { 'cache-control': SHARED, [EDGE]: edge, ...(etag === null ? {} : { etag }) };
  }
  if ((said === REVALIDATE || said === SHARED) && etag !== null) return { 'cache-control': REVALIDATE, etag };
  return { 'cache-control': 'no-store' };
}

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
  const out = new Headers(cacheHeaders(service, request, reply));
  const type = reply.headers.get('content-type');
  if (type !== null) out.set('content-type', type);
  return new Response(reply.status === 304 ? null : reply.body, { status: reply.status, headers: out });
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
