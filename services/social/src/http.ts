/**
 * The transport, shared by the social and alert services' shape: CORS for the phone app's
 * origins, a bounded JSON body (16 KB; the sign-up photo route alone takes up to 600 KB), the bearer token handed to the routes, and per-client pacing.
 * Every rule about people lives in routes.ts.
 *
 * What breaks if changed carelessly: the token is passed through, never logged. It proves who
 * someone is for an hour; a log line holding one is a log line someone can sign in with.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface Reply {
  readonly status: number;
  readonly body: string;
}

export interface Request {
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
  readonly token: string | null;
  readonly client: string;
}

const MAX_BODY_BYTES = 16 * 1024;
/** The one route whose body is a photo (picture.ts): a cropped 512-pixel square as base64, with room. */
const PHOTO_PATH = '/onboarding/picture';
const MAX_PHOTO_BODY_BYTES = 600 * 1024;

/** How big a body this path may carry: the photo route its photo, every other route a small JSON body. */

/* A picture or banner upload (profile-media.ts) carries the image as a data URL: a 2 MB file is
   about 2.7 MB of text. Only those two paths are let past the small bound. */
const MAX_PICTURE_BODY_BYTES = 3 * 1024 * 1024;
const PICTURE_PATH = /^\/me\/(picture|banner)(\?|$)/;

/** How big a body this path may carry: a photo route its photo, every other route a small JSON body. */
export const bodyLimitFor = (url: string): number =>
  url.split('?')[0] === PHOTO_PATH ? MAX_PHOTO_BODY_BYTES : PICTURE_PATH.test(url) ? MAX_PICTURE_BODY_BYTES : MAX_BODY_BYTES;

export const json = (status: number, value: unknown): Reply => ({ status, body: JSON.stringify(value) });

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    if (req.method !== 'POST' && req.method !== 'PUT' && req.method !== 'DELETE') {
      req.resume();
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > bodyLimitFor(req.url ?? '/')) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text === '' ? null : JSON.parse(text));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const clientOf = (req: IncomingMessage): string => {
  const fwd = req.headers['x-forwarded-for'];
  const last = (Array.isArray(fwd) ? fwd.join(',') : (fwd ?? '')).split(',').map((s) => s.trim()).filter((s) => s !== '').at(-1);
  return last ?? req.socket.remoteAddress ?? 'unknown';
};

export function serve(allowedOrigins: readonly string[], handle: (r: Request) => Promise<Reply>): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    const cors: Record<string, string> = typeof origin === 'string' && allowedOrigins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'origin' } : { vary: 'origin' };
    const base = { ...cors, 'cache-control': 'no-store' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...base, 'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS', 'access-control-allow-headers': 'accept, content-type, authorization', 'access-control-max-age': '600' });
      res.end();
      return;
    }
    const auth = req.headers.authorization;
    const token = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice('Bearer '.length).trim() : null;
    readBody(req)
      .then((body) => handle({ method: req.method ?? 'GET', url: req.url ?? '/', body, token, client: clientOf(req) }))
      .then((reply) => {
        res.writeHead(reply.status, { ...base, 'content-type': 'application/json' });
        res.end(reply.body);
      })
      .catch(() => {
        if (!res.headersSent) res.writeHead(500, { ...base, 'content-type': 'application/json' });
        res.end('{"error":"server error"}');
      });
  });
}

/** Calls one client may make per window, Trador's and the read service's way: a sliding window kept in memory. */
export function pacer(perClient: number, windowMs: number): (client: string, now: number) => boolean {
  const calls = new Map<string, number[]>();
  return (client, now) => {
    const recent = (calls.get(client) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= perClient) {
      calls.set(client, recent);
      return false;
    }
    recent.push(now);
    calls.set(client, recent);
    return true;
  };
}
