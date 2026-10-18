/**
 * PREPARED ANSWERS: the replies phones ask for most, built ahead of the request and held in memory,
 * so For You, the Narratives tab, a narrative's page and a token page are answered by one memory
 * read instead of two to six database round trips.
 *
 * ★ WHY IN MEMORY AND NOT A TABLE OF READY JSON. This process sits a sea away from the database
 * (Railway in California, the database in Ireland in October 2026: about 140 ms a round trip), so
 * even "one query for a ready row" costs 140 ms before a byte is sent. Only a reply already in this
 * process answers in single milliseconds. The replies are rebuilt through the same `handle` the
 * request would have run, so a prepared reply and a live one cannot disagree about what they say.
 *
 * ★ WHEN A REPLY IS REBUILT.
 *   - A reply tied to a frame (For You, the board, the Narratives lists, a narrative page) carries
 *     the tick of its frame. While anybody has asked for one in the last `HOT_MS`, a watcher reads
 *     every frame's tick in one small statement every `WATCH_MS` (and at once when the projector
 *     announces a board), and rebuilds each reply whose frame moved. The quick For You frame sends
 *     no announcement, which is why the watcher reads ticks rather than waiting for one.
 *   - Every reply is also rebuilt in the background once it is `refreshMs` old, on the next request
 *     for it: a translation, a story tag or a poster picture can land without a new tick, and a
 *     coin's market moves with no frame at all.
 *   - A reply older than `keepMs` is never served: the request waits for a fresh build. So does
 *     a request for a frame's reply the watcher has just seen move (it is a frame behind and the
 *     rebuild is already running). These are the only times a request waits on the database or a
 *     market source.
 * Concurrent requests for one reply share one build, so four parallel reads of one coin's market
 * cost one market read.
 *
 * ★ AN OUTAGE NEVER REPLACES A READING. A market read that came back `unavailable` is served only
 * when there is no earlier good reply still inside `keepMs`; a blip in the market source does not
 * blank a chart that was drawn a few seconds ago. Past `keepMs` the outage is said, as before.
 *
 * ★ EACH REPLY IS COMPRESSED ONCE, when it is built (brotli and gzip), and carries a weak ETag, so
 * a request costs neither CPU nor bandwidth beyond the bytes the encoding chosen needs.
 *
 * What breaks if changed carelessly: a route whose reply depends on who asks (search's per-client
 * limit, a wallet) must never be added to `ruleFor`; a reply is shared by everyone who asks for the
 * same URL. And `keepMs` is the staleness a person can be shown at worst: raising it shows older
 * frames after a quiet spell, it does not make anything faster while the app is in use.
 */

import { prepare, type PlainReply, type Prepared } from './compress.ts';
import { errorText, type Logger } from './log.ts';
import type { Db } from './queries.ts';

export type { PlainReply, Prepared } from './compress.ts';

/** How one URL's reply is kept. */
export interface Rule {
  /** The URL it is kept under: the path and query as asked. */
  readonly key: string;
  /** The frame whose tick the reply follows (`board:<view>`, `rising:<feed>`), or null for none. */
  readonly tick: string | null;
  /** Past this age the next request is still answered from memory and rebuilds the reply behind it. */
  readonly refreshMs: number;
  /** Past this age the reply is not served at all. */
  readonly keepMs: number;
  /** A reply that says the source is down: kept out while an earlier good one is inside `keepMs`. */
  readonly outage?: (body: string) => boolean;
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;

/** A frame's replies: rebuilt when the frame moves; at least every half minute for what lands between frames. */
const FRAME = { refreshMs: 30 * SECOND, keepMs: 10 * MINUTE };
/** A sheet's replies (post, narrative): their own database reads and market caps, refreshed every 20 s. */
const SHEET = { refreshMs: 20 * SECOND, keepMs: 5 * MINUTE };
/** A coin's chart and trades: the phone reads every 4 s (mobile coin-cap.ts LIVE_POLL_MS), the market adapter keeps a read ~12 s. */
const MARKET = { refreshMs: 4 * SECOND, keepMs: 30 * SECOND };
/** A coin's facts and its Info tab: links and holders change slowly. */
const COIN = { refreshMs: 30 * SECOND, keepMs: 10 * MINUTE };

/** The longest URL kept: anything longer is answered, never stored. */
const MAX_KEY_LENGTH = 400;

const unavailable = (body: string): boolean => body.startsWith('{"kind":"unavailable"');

/**
 * Which rule a GET follows, or null for a reply that is never kept (search, wallets, the live
 * stream, anything with a per-client limit, every route not listed here).
 */
export function ruleFor(rawUrl: string): Rule | null {
  if (rawUrl.length > MAX_KEY_LENGTH) return null;
  const path = rawUrl.split('?')[0] ?? '';
  let s: string[];
  try {
    s = path.split('/').filter((x) => x !== '').map(decodeURIComponent);
  } catch {
    return null;
  }
  const [head, id, tail] = s;
  const key = rawUrl;
  if (id === undefined) return null;
  if (s.length === 2 && head === 'rising') return { key, tick: `rising:${id}`, ...FRAME };
  if (s.length === 3 && head === 'rising' && (tail === 'tick' || (id === 'fyp' && tail === 'sorted'))) return { key, tick: `rising:${id}`, ...FRAME };
  if (s.length === 2 && (head === 'board' || head === 'narratives')) return { key, tick: `board:${id}`, ...FRAME };
  if (s.length === 3 && head === 'narratives' && tail === 'all') return { key, tick: `board:${id}`, ...FRAME };
  /* A narrative's page is written with the board's frame (services/project main.ts commits both). */
  if (s.length === 2 && head === 'story') return { key, tick: 'board:default', ...FRAME };
  if (s.length === 3 && (head === 'story' || head === 'post') && tail === 'sheet') return { key, tick: null, ...SHEET };
  if (s.length === 2 && head === 'coin') return { key, tick: null, ...COIN };
  if (s.length === 3 && head === 'coin' && tail === 'about') return { key, tick: null, ...COIN };
  if (s.length === 3 && head === 'coin' && tail === 'market') return { key, tick: null, ...MARKET, outage: unavailable };
  return null;
}

/** Every frame's tick in one statement: the watcher's only read while nothing has moved. */
export const TICKS_SQL = `select 'board:' || view_id as k, tick::text as tick from public.board_view
union all select 'rising:' || feed_id, tick::text from public.rising_view`;

/** How often the watcher reads the ticks while a frame's reply is wanted. */
const WATCH_MS = 2 * SECOND;
/** A reply asked for within this long is kept current by the watcher; after it, only on request. */
const HOT_MS = 10 * MINUTE;
/** The most replies and bytes held; past either, the replies asked for longest ago go first. */
const MAX_ENTRIES = 2_000;
const MAX_BYTES = 128 * 1024 * 1024;

interface Entry {
  readonly rule: Rule;
  readonly reply: Prepared;
  readonly builtAt: number;
  /** The frame's tick read before this reply was built; null for a reply that follows none. */
  readonly version: string | null;
  askedAt: number;
}

export interface PreparedDeps {
  readonly db: Db;
  readonly log: Logger;
  /** Builds a reply exactly as a request would: routes.ts `handle`. */
  readonly build: (rawUrl: string) => Promise<PlainReply>;
  readonly now?: () => number;
}

export interface PreparedAnswers {
  /** The reply for a GET of `rawUrl` when it is one that is kept; null when it is not. */
  serve(rawUrl: string): Promise<Prepared> | null;
  /** A frame was announced: read the ticks now rather than at the next beat. */
  changed(): void;
  /** Build these now and keep them current, as if just asked for (the app's first screens, at boot). */
  warm(urls: readonly string[]): void;
  start(): void;
  close(): void;
  /** For tests and logs: how many replies are held. */
  size(): number;
}

const bytesOf = (p: Prepared): number => p.body.length + (p.br?.length ?? 0) + (p.gzip?.length ?? 0);

export function createPrepared(deps: PreparedDeps): PreparedAnswers {
  const now = deps.now ?? Date.now;
  const entries = new Map<string, Entry>();
  const building = new Map<string, Promise<Prepared>>();
  let bytes = 0;
  let ticks = new Map<string, string>();
  let ticksAt = -Infinity;
  let reading: Promise<Map<string, string>> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  /* Background rebuilds, one at a time: the pool is three connections and a person's own request must
     never queue behind a dozen refreshes. */
  const queue: string[] = [];
  let draining = false;

  function readTicks(): Promise<Map<string, string>> {
    if (reading !== null) return reading;
    reading = deps.db
      .query(TICKS_SQL, [])
      .then((rows) => {
        const out = new Map<string, string>();
        for (const r of rows) if (typeof r['k'] === 'string' && typeof r['tick'] === 'string') out.set(r['k'], r['tick']);
        ticks = out;
        ticksAt = now();
        return out;
      })
      .finally(() => {
        reading = null;
      });
    return reading;
  }

  function store(entry: Entry): void {
    const old = entries.get(entry.rule.key);
    if (old !== undefined) bytes -= bytesOf(old.reply);
    entries.delete(entry.rule.key);
    entries.set(entry.rule.key, entry);
    bytes += bytesOf(entry.reply);
    if (entries.size <= MAX_ENTRIES && bytes <= MAX_BYTES) return;
    const byAsked = [...entries.values()].sort((a, b) => a.askedAt - b.askedAt);
    for (const e of byAsked) {
      if (entries.size <= MAX_ENTRIES && bytes <= MAX_BYTES) break;
      entries.delete(e.rule.key);
      bytes -= bytesOf(e.reply);
    }
  }

  /** Build one reply; a 200 is kept (an outage only when nothing good is still kept). Shared by everyone asking at once. */
  function build(rule: Rule, askedAt: number): Promise<Prepared> {
    const running = building.get(rule.key);
    if (running !== undefined) return running;
    const job = (async () => {
      /* The tick is read BEFORE the reply, so a kept version is never newer than what the reply
         says: at worst the watcher sees a move that is already in it and rebuilds once more. While
         the watcher is running its last reading is used, and a cold build costs no extra trip. */
      const known = now() - ticksAt <= WATCH_MS * 2 ? ticks : await readTicks().catch(() => ticks);
      const version = rule.tick === null ? null : (known.get(rule.tick) ?? null);
      const reply = await deps.build(rule.key);
      const prepared = await prepare(reply);
      if (reply.status !== 200) return prepared;
      const had = entries.get(rule.key);
      if (rule.outage?.(reply.body) === true && had !== undefined && now() - had.builtAt <= rule.keepMs && rule.outage(had.reply.body.toString('utf8')) === false) return had.reply;
      store({ rule, reply: prepared, builtAt: now(), version, askedAt: Math.max(askedAt, had?.askedAt ?? 0) });
      return prepared;
    })().finally(() => building.delete(rule.key));
    building.set(rule.key, job);
    return job;
  }

  function later(key: string): void {
    if (building.has(key) || queue.includes(key)) return;
    queue.push(key);
    if (draining) return;
    draining = true;
    void (async () => {
      while (queue.length > 0) {
        const k = queue.shift() as string;
        const e = entries.get(k);
        if (e === undefined) continue;
        try {
          await build(e.rule, e.askedAt);
        } catch (err) {
          deps.log.error('prepared reply failed to rebuild', { url: k, err: errorText(err) });
        }
      }
      draining = false;
    })();
  }

  /** The watcher's beat: when a frame's reply is wanted, read the ticks and rebuild what moved. */
  async function beat(force = false): Promise<void> {
    const t = now();
    const hot = [...entries.values()].filter((e) => e.rule.tick !== null && t - e.askedAt < HOT_MS);
    for (const e of entries.values()) if (t - e.builtAt > e.rule.keepMs && t - e.askedAt >= HOT_MS) {
      entries.delete(e.rule.key);
      bytes -= bytesOf(e.reply);
    }
    if (hot.length === 0 && !force) return;
    let current: Map<string, string>;
    try {
      current = await readTicks();
    } catch (err) {
      deps.log.error('frame ticks unreadable', { err: errorText(err) });
      return;
    }
    hot.sort((a, b) => b.askedAt - a.askedAt);
    for (const e of hot) if (e.rule.tick !== null && (current.get(e.rule.tick) ?? null) !== e.version) later(e.rule.key);
  }

  return {
    serve(rawUrl) {
      const rule = ruleFor(rawUrl);
      if (rule === null) return null;
      const t = now();
      const e = entries.get(rule.key);
      if (e === undefined || t - e.builtAt > rule.keepMs) return build(rule, t);
      e.askedAt = t;
      /* ★ A reply KNOWN to be behind its frame is not served: the request waits for the build
         (already running, usually: the watcher started it). This is the phone that was just told
         "For You changed" over the live stream and asks at once; handing it the frame it already
         has would leave it a frame behind until its next check. If the build fails, the reply
         that is behind is still better than an error. */
      const moved = rule.tick !== null && t - ticksAt <= WATCH_MS * 2 && (ticks.get(rule.tick) ?? null) !== e.version;
      if (moved) return build(rule, t).then((p) => (p.status === 200 ? p : e.reply), () => e.reply);
      if (t - e.builtAt > rule.refreshMs) later(rule.key);
      /* Asked for after a quiet spell: the watcher was idle, so look at the ticks now, behind this reply. */
      else if (rule.tick !== null && t - ticksAt > WATCH_MS * 2) void beat();
      return Promise.resolve(e.reply);
    },
    changed() {
      ticksAt = -Infinity;
      void beat(true);
    },
    warm(urls) {
      const t = now();
      for (const url of urls) {
        const rule = ruleFor(url);
        if (rule === null) continue;
        build(rule, t).catch((err: unknown) => deps.log.error('prepared reply failed to build', { url, err: errorText(err) }));
      }
    },
    start() {
      if (timer !== null) return;
      timer = setInterval(() => void beat(), WATCH_MS);
      timer.unref?.();
    },
    close() {
      if (timer !== null) clearInterval(timer);
      timer = null;
    },
    size: () => entries.size,
  };
}
