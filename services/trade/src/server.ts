/**
 * The trade service's transport: CORS for the phone app's origins, a bounded JSON body, and the
 * routes' reply written as is. Every rule lives in routes.ts; nothing here decides a trade.
 *
 * What breaks if changed carelessly: the body is capped. A build request is one quote; a body
 * far larger than that is not one, and reading it unbounded is how one request holds memory.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { handle, type TradeDeps } from './routes.ts';

/** A quote with the router's reply inside is a few kilobytes; a signed transaction is under 2 KB. */
const MAX_BODY_BYTES = 64 * 1024;
/**
 * ★ A LAUNCH'S BUILD CARRIES THE COIN'S PICTURE (2026-11-03: "create token on pf not working" — "The
 * launch could not be prepared just now."). `/launch/build` sends the picture as a data URL; a post's
 * picture is usually well over 64 KB, so the body was dropped and every such launch refused. Under
 * the phone app's /api function's own request limit (4.5 MB), for that one route only.
 */
const MAX_LAUNCH_BODY_BYTES = 4 * 1024 * 1024;

/** The most body bytes read for a request to `url`. */
export const bodyLimitFor = (url: string): number => (url.split('?')[0] === '/launch/build' ? MAX_LAUNCH_BODY_BYTES : MAX_BODY_BYTES);

function readBody(req: IncomingMessage): Promise<string | null> {
  const limit = bodyLimitFor(req.url ?? '');
  return new Promise((resolve) => {
    if (req.method !== 'POST') {
      req.resume();
      resolve(null);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

export function createTradeServer(deps: TradeDeps & { readonly allowedOrigins: readonly string[] }): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    const origin = req.headers.origin;
    const cors: Record<string, string> = typeof origin === 'string' && deps.allowedOrigins.includes(origin) ? { 'access-control-allow-origin': origin, vary: 'origin' } : { vary: 'origin' };
    const base = { ...cors, 'cache-control': 'no-store' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { ...base, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'accept, content-type', 'access-control-max-age': '600' });
      res.end();
      return;
    }
    readBody(req)
      .then((body) => handle(req.method ?? 'GET', req.url ?? '/', body, deps))
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
