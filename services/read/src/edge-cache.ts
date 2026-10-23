/**
 * WHICH READS VERCEL'S EDGE MAY KEEP, AND FOR HOW LONG.
 *
 * The phone reaches this process through insidor.app/api/read, and every call used to cross the
 * Vercel edge near the phone, a Vercel function in another country and then Railway: 170-240 ms
 * from London for a reply this process holds ready in memory (prepared.ts). Most of what the phone
 * reads is the same for everyone who asks for the same URL: a frame's lists, a narrative's page, a
 * sheet, a coin's chart. Those may be kept by Vercel's edge for a second or two and answered there,
 * in tens of milliseconds. Everything else keeps `private, no-cache` (server.ts).
 *
 * ★ THE EDGE IS TOLD, THE BROWSER IS NOT. The lifetime goes in `Vercel-CDN-Cache-Control`, which
 * Vercel's edge reads and removes; no browser and no other cache ever sees it. The browser gets
 * `public, max-age=0, must-revalidate`: it may keep the reply but asks before every use, as with
 * `private, no-cache` before. `private` and `no-cache` cannot stay, because Vercel refuses to keep a
 * reply that says either.
 *
 * ★ A REPLY IS EDGE-KEPT ONLY WHEN NOTHING ABOUT THE CALLER CAN BE IN IT. This process reads no
 * cookie and no sign-in token on any route, so no reply depends on who asks; the routes that do
 * depend on the caller (search, ticker and the post's coin and name lookups carry a per-client
 * limit; a wallet is one person's) are simply not listed. A request that carries `authorization`
 * or a cookie is still answered privately: if a route ever starts reading either, it cannot leak
 * through a reply kept for someone else. (Vercel also never keeps a request with `authorization`.)
 *
 * ★ FOR YOU'S OWN FEED IS NOT EDGE-KEPT. The phone reloads `/rising/fyp` the moment the live line
 * says the frame moved, and keeps that answer until the next move or a 30-second check
 * (mobile useLiveFeed.ts). An edge copy from one second earlier is the previous frame, so the
 * phone would show it for up to 30 seconds: the exact wait 85ac866 removed. It can be edge-kept
 * once the phone names the frame it was told about in the URL, so a new frame is a new address.
 *
 * ★ AN OUTAGE IS NOT KEPT. A market reply that says its source is unavailable is answered
 * privately, so the edge does not repeat "unavailable" after the source is back.
 *
 * What breaks if changed carelessly: a route added to `edgeLifeFor` whose reply depends on the
 * caller is served to everyone who asks for the same URL. And the lifetimes add to the read's own
 * staleness: prepared.ts already lets a frame's reply trail its frame by up to its 2-second watch.
 */

/** How long Vercel's edge may answer a URL by itself, and how long after that it may still answer while it fetches again. */
export interface EdgeLife {
  /** Seconds the edge answers alone. */
  readonly fresh: number;
  /** Seconds after `fresh` the edge may answer with the copy it has while it reads a new one behind it. */
  readonly stale: number;
}

/*
 * The stale window is short on purpose: the owner's rule is "never more than a couple of seconds
 * old". After a quiet spell the first caller is answered with the old copy once; the next poll,
 * seconds later, gets the new one. The phone's reads send `pragma: no-cache` (fetch's `no-store`
 * mode), and Vercel then fetches a stale copy before answering instead of behind it.
 */
/** A frame's lists and pages: the board, the Narratives lists, a narrative's page. */
const FRAME: EdgeLife = { fresh: 2, stale: 8 };
/** A sheet (post, narrative): prepared.ts rebuilds it every 20 s; the edge adds a few seconds at most. */
const SHEET: EdgeLife = { fresh: 5, stale: 15 };
/** A coin's chart and trades: the phone polls every 4 s, so each poll reads at most one edge copy. */
const MARKET: EdgeLife = { fresh: 4, stale: 10 };
/** A coin's facts (price line, name): prepared.ts keeps them 30 s; the edge adds ten at most. */
const FACTS: EdgeLife = { fresh: 10, stale: 30 };
/** A coin's Info tab: links, holders, creator. Changes over minutes. */
const ABOUT: EdgeLife = { fresh: 30, stale: 60 };

/** The browser's word for an edge-kept reply: keep it, but ask before every use. */
export const BROWSER_REVALIDATE = 'public, max-age=0, must-revalidate';

/** The header Vercel's edge reads and strips before the browser. */
export const EDGE_HEADER = 'vercel-cdn-cache-control';

/** Longer URLs are never edge-kept: the same bound prepared.ts keeps in memory. */
const MAX_URL_LENGTH = 400;

/** The edge lifetime of a GET for `rawUrl` (path and query as asked), or null for a reply the edge must not keep. */
export function edgeLifeFor(rawUrl: string): EdgeLife | null {
  if (rawUrl.length > MAX_URL_LENGTH) return null;
  const path = rawUrl.split('?')[0] ?? '';
  let s: string[];
  try {
    s = path.split('/').filter((x) => x !== '').map(decodeURIComponent);
  } catch {
    return null;
  }
  const [head, id, tail] = s;
  if (id === undefined || id === '') return null;
  if (s.length === 2) {
    if (head === 'board' || head === 'narratives' || head === 'story' || head === 'launches' || head === 'pairs' || head === 'sources') return FRAME;
    if (head === 'coin') return FACTS;
    /* The running coins strip: the same list for everyone, rebuilt every half minute (prepared.ts). */
    if (head === 'running' && id === 'coins') return FACTS;
    /* `/rising/:feed` is left out: see the header. `/wallet/:address`, `/ticker/:t` and anything else too. */
    return null;
  }
  if (s.length === 3) {
    if (head === 'rising' && (tail === 'tick' || tail === 'older' || (id === 'fyp' && tail === 'sorted'))) return FRAME;
    if (head === 'narratives' && tail === 'all') return FRAME;
    if ((head === 'post' || head === 'story') && tail === 'sheet') return SHEET;
    if (head === 'coin' && tail === 'market') return MARKET;
    if (head === 'coin' && tail === 'about') return ABOUT;
  }
  return null;
}

/** What the request carries that could make a reply personal, if a route ever read it. */
export interface Caller {
  readonly authorization: boolean;
  readonly cookie: boolean;
}

const UNAVAILABLE = Buffer.from('{"kind":"unavailable"');

/**
 * The cache headers for a 200 to a GET, or null to keep server.ts's own (`private, no-cache`).
 * `body` is the uncompressed reply, read only for its first bytes.
 */
export function edgeHeaders(method: string, rawUrl: string, status: number, body: Buffer, caller: Caller): Record<string, string> | null {
  if (method !== 'GET' && method !== 'HEAD') return null;
  if (status !== 200 || caller.authorization || caller.cookie) return null;
  const life = edgeLifeFor(rawUrl);
  if (life === null) return null;
  if (body.subarray(0, UNAVAILABLE.length).equals(UNAVAILABLE)) return null;
  return {
    'cache-control': BROWSER_REVALIDATE,
    [EDGE_HEADER]: `max-age=${life.fresh}, stale-while-revalidate=${life.stale}`,
  };
}
