/**
 * The transport: node:http, and nothing on top of it.
 *
 * No express, no fastify. This service has three routes, no middleware chain, no
 * body parsing and no sessions — a framework here would be a dependency tree, a
 * plugin surface and a set of default behaviours (error pages that print stacks,
 * `x-powered-by`, permissive CORS helpers) added in exchange for about forty lines.
 * Every one of those defaults points the wrong way for a service whose job is to say
 * as little as possible when it fails.
 *
 * THREE HEADERS ARE SET ON EVERY RESPONSE, INCLUDING ERRORS:
 *
 *   cache-control: no-store — the board is stale within a tick. Worse, a cached 200
 *     from one view id served for another is a wrong board rendered with total
 *     confidence, and the intermediary that did it is not ours to inspect.
 *
 *   vary: origin — the allow-origin header depends on the request's origin, so a
 *     cache that ignored this could hand one origin's allow header to another.
 *     Correctness of the CORS answer, not of the data.
 *
 *   access-control-allow-origin — echoed only for an origin on the configured list,
 *     matched EXACTLY. Never `*`: a wildcard on a read surface invites any page on
 *     the internet to mirror the board, and there is no reason to make that easy.
 *     Never a prefix match either — "http://localhost:5173" as a prefix also matches
 *     "http://localhost:51731.example.com", which someone can register.
 *
 * No `access-control-allow-credentials`: this surface is unauthenticated and sends
 * no cookie, and declaring credentials support would be inviting a future one.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { Logger } from './log.ts';
import { errorText } from './log.ts';
import { handle, type Deps } from './routes.ts';
import type { BoardStream } from './stream.ts';

export interface ServerDeps extends Deps {
  readonly allowedOrigins: readonly string[];
  /**
   * The live channel, if this process has one.
   *
   * Optional because a stream needs a response that never finishes, and `handle` cannot
   * express that: its `Reply` is a status and an already-serialised body, written and ended.
   * That is a good shape for the three polled routes and the wrong shape for a stream, so
   * the stream branches HERE, before `handle` is called, rather than `handle` growing a
   * second return kind that every route would then have to be read against.
   *
   * Absent, every stream URL falls through to `handle` and gets an ordinary 404 — which is
   * what routes.test.ts and server.test.ts exercise, and what a deployment with no listener
   * should say rather than opening a socket nothing will ever write to.
   */
  readonly stream?: BoardStream;
}

/** Preflight lives 10 minutes. Long enough to stop the chatter, short enough to fix. */
const PREFLIGHT_MAX_AGE = '600';

function corsHeaders(req: IncomingMessage, allowed: readonly string[]): Record<string, string> {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !allowed.includes(origin)) return {};
  return { 'access-control-allow-origin': origin };
}

export function createReadServer(deps: ServerDeps): Server {
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    /* Drain whatever the caller sent. This surface reads no body, and a request body
       left unread can hold the socket open until it times out. */
    req.resume();

    /* The three headers every response carries, WITHOUT a content type — the stream's is
       `text/event-stream` and the routes' is JSON. Split so that both paths get the same
       CORS answer, the same `vary`, and the same `no-store` from one place: a stream served
       with a different origin rule from the poll beside it is a CORS bug that only shows up
       on reconnect. */
    const shared = {
      'cache-control': 'no-store',
      vary: 'origin',
      ...corsHeaders(req, deps.allowedOrigins),
    };

    const base = { 'content-type': 'application/json; charset=utf-8', ...shared };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...base,
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'accept, content-type',
        'access-control-max-age': PREFLIGHT_MAX_AGE,
      });
      res.end();
      return;
    }

    /* The live channel, matched before `handle` because a stream is a response that is
       never finished and `handle`'s contract is a finished one. `match` returns null for
       every other URL and for every method but GET, so nothing else changes shape. */
    if (deps.stream !== undefined) {
      const viewId = deps.stream.match(req.method ?? 'GET', req.url ?? '/');
      if (viewId !== null) {
        /* `attach` answers on the socket and never rejects; the catch is here so that a
           future edit which makes it reject cannot become an unhandled rejection, which
           main.ts turns into process exit — one bad request taking the read surface down. */
        deps.stream.attach(res, viewId, shared).catch((e: unknown) => {
          deps.log.error('stream failed to attach', { url: req.url, err: errorText(e) });
          if (!res.headersSent) res.writeHead(500, base);
          res.end('{"error":"server error"}');
        });
        return;
      }
    }

    /* `handle` catches its own failures and answers 500 opaquely. This catch is for
       the ones it cannot see — a header already sent, a socket that went away — and
       it must not be allowed to become an unhandled rejection, because main.ts exits
       the process on those and a single malformed request would take the service
       down. */
    handle(req.method ?? 'GET', req.url ?? '/', deps)
      .then((reply) => {
        res.writeHead(reply.status, base);
        res.end(reply.body);
      })
      .catch((e: unknown) => {
        deps.log.error('response failed', { url: req.url, err: errorText(e) });
        if (!res.headersSent) res.writeHead(500, base);
        res.end('{"error":"server error"}');
      });
  });
}
