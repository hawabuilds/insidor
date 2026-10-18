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
 *
 * ★ THREE EXCEPTIONS TO THE HEADERS ABOVE, NONE ABOUT WHAT IS SAID (October 2026):
 *
 *   A reply with an ETag says `private, no-cache` instead of `no-store`: a browser may keep it but
 *     must ask again before every use, and gets a bodiless 304 when nothing changed. `private`
 *     keeps every shared cache out, which is the risk `no-store` was guarding against; `no-cache`
 *     means a kept board is never shown without the server confirming it is the current one.
 *
 *   A reply that is the same for everyone who asks (a frame's lists, a sheet, a coin's chart) also
 *     carries `vercel-cdn-cache-control`, and its browser header becomes `public, max-age=0,
 *     must-revalidate`: Vercel's edge near the phone may answer it for a few seconds while the
 *     browser still asks before each use. The list, the lifetimes and why For You's own feed is
 *     not on it are in edge-cache.ts.
 *
 *   A reply over a kilobyte is compressed (brotli, else gzip, as the caller accepts), and `vary`
 *     names `accept-encoding` beside `origin`. The Narratives list was 1.3 MB raw and the platform
 *     in front of this process does not compress. The kept replies (prepared.ts) are compressed
 *     once when built; any other reply is compressed as it is sent.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import type { Logger } from './log.ts';
import { errorText } from './log.ts';
import { encodingFor, prepare, type Encoding, type Prepared } from './compress.ts';
import { edgeHeaders } from './edge-cache.ts';
import type { PreparedAnswers } from './prepared.ts';
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
  /** The replies kept ready in memory (prepared.ts). Absent: every request is built as it arrives. */
  readonly prepared?: PreparedAnswers;
}

/** What a browser is told about a reply it may keep: keep it for yourself, and ask before each use. */
const REVALIDATE = 'private, no-cache';

const header = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v.join(',') : v);

/** Whether the caller already holds exactly this reply (If-None-Match names its ETag, weak comparison). */
function unchanged(req: IncomingMessage, etag: string | null): boolean {
  const asked = header(req.headers['if-none-match']);
  if (etag === null || asked === undefined) return false;
  const bare = (t: string) => t.trim().replace(/^W\//, '');
  return asked.split(',').some((t) => t.trim() === '*' || bare(t) === bare(etag));
}

/** Writes a prepared reply: a 304 when the caller holds it, else the bytes in the encoding it accepts. */
function send(req: IncomingMessage, res: ServerResponse, p: Prepared, encoding: Encoding, base: Record<string, string>): void {
  /* Same for everyone who asks: Vercel's edge may keep it for a few seconds (edge-cache.ts). */
  const edge = edgeHeaders(req.method ?? 'GET', req.url ?? '/', p.status, p.body, {
    authorization: req.headers.authorization !== undefined,
    cookie: req.headers.cookie !== undefined,
  });
  const kept = p.etag === null ? {} : { etag: p.etag, 'cache-control': REVALIDATE, ...edge };
  if (p.status === 200 && unchanged(req, p.etag)) {
    res.writeHead(304, { ...base, ...kept });
    res.end();
    return;
  }
  const coded = encoding === 'br' ? p.br : encoding === 'gzip' ? p.gzip : null;
  const bytes = coded ?? p.body;
  res.writeHead(p.status, {
    ...base,
    ...kept,
    ...(coded === null ? {} : { 'content-encoding': encoding as string }),
    'content-length': String(bytes.length),
  });
  res.end(bytes);
}

/** Preflight lives 10 minutes. Long enough to stop the chatter, short enough to fix. */
const PREFLIGHT_MAX_AGE = '600';

function corsHeaders(req: IncomingMessage, allowed: readonly string[]): Record<string, string> {
  const origin = req.headers.origin;
  if (typeof origin !== 'string' || !allowed.includes(origin)) return {};
  return { 'access-control-allow-origin': origin };
}

/**
 * Who is asking, for the search limit. Behind the platform's proxy the socket is the proxy, so
 * the LAST forwarded address is used — the one the nearest proxy appended, which a caller cannot
 * write. The first one is whatever the caller typed.
 */
function clientOf(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  const list = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',').map((s) => s.trim()).filter((s) => s !== '');
  return list[list.length - 1] ?? req.socket.remoteAddress ?? '';
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
    /* The routes' replies may be compressed, so their `vary` says so; the stream's is not. */
    const routed = { ...base, vary: 'origin, accept-encoding' };

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
    const encoding = encodingFor(header(req.headers['accept-encoding']));
    /* A kept reply is one memory read (prepared.ts); anything else is built now, compressed only
       into the one encoding this caller accepts. */
    const kept = req.method === 'GET' ? (deps.prepared?.serve(req.url ?? '/') ?? null) : null;
    (kept ?? handle(req.method ?? 'GET', req.url ?? '/', deps, clientOf(req)).then((reply) => prepare(reply, encoding === null ? [] : [encoding])))
      .then((p) => send(req, res, p, encoding, routed))
      .catch((e: unknown) => {
        deps.log.error('response failed', { url: req.url, err: errorText(e) });
        if (!res.headersSent) res.writeHead(500, base);
        res.end('{"error":"server error"}');
      });
  });
}
