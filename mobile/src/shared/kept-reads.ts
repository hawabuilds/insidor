/**
 * THE LAST ANSWER EACH SCREEN GOT, KEPT ON THE PHONE, so a screen opens on what it showed last
 * time and the fresh read replaces it in place (the owner, 2026-10-18: "every screen keeps its last
 * data on the phone and shows it at once"). Never a blank screen or a spinner when something can be
 * shown.
 *
 * Two places, both bounded:
 *   memory   every kept read of this visit, by its key, newest 120. Instant, and lost on reload.
 *   phone    the public first screens only (`phone: true`: For You, a narrative list, a story, a
 *            post sheet, a coin's facts), in localStorage under `insidor.kept.<key>`, together
 *            at most KEEP_CHARS. localStorage, not IndexedDB, because it can be read in the same
 *            frame as the first render: an asynchronous store would show the empty screen first.
 * Every touch of the browser's store is in try/catch: a private window, a full disk or a blocked
 * store simply keeps nothing, and the screen reads from the network as it always did.
 *
 * ★ WHAT IS SHOWN FROM HERE IS MARKED `stale` (shared/hooks.ts useLoad) and is always followed by a
 * fresh read; it is a moment's stand-in for the answer, never the answer. A kept answer older than
 * KEPT_FOR_MS is not shown at all, so a phone that comes back after a day starts from the network
 * rather than from yesterday. A failed fresh read still says it failed (useLoad keeps a failure a
 * failure); an outage never hides behind an old list.
 *
 * ★ ONE READ PER KEY AT A TIME. `fresh` shares an answer already on its way for the same key, so a
 * prefetch and the screen that wanted it never read twice, and two screens asking at once read once.
 *
 * Values are stored as JSON with Maps, Sets and non-finite numbers tagged (a decoded read carries
 * Maps, and NaN would otherwise come back as null). Bump VERSION when a decoded shape changes, so a
 * phone never feeds yesterday's shape to today's screen. What breaks if changed carelessly: a key
 * that two different loaders share hands one screen the other's shape — keys name their read.
 */

const VERSION = 1;
/** The phone's store's own key prefix, for tests and for clearing. */
export const KEPT_PREFIX = `insidor.kept.v${VERSION}.`;
const PREFIX = KEPT_PREFIX;
/** Memory: the newest this many reads of this visit. */
const MEMORY_ROWS = 120;
/** The phone: all kept reads together stay under this many characters (localStorage holds ~5M). */
const KEEP_CHARS = 2_500_000;
/** One read bigger than this is kept in memory only. */
const ONE_READ_CHARS = 600_000;
/** Older than this, a kept read is not shown: the screen waits for the network instead. */
const KEPT_FOR_MS = 24 * 60 * 60_000;

interface Kept {
  readonly value: unknown;
  /** When it was read, on this phone's clock. */
  readonly at: number;
}

const memory = new Map<string, Kept>();
interface OnTheWay {
  readonly promise: Promise<unknown>;
  readonly ac: AbortController;
  /** Callers still waiting on it; a read ahead counts for ever. */
  waiting: number;
}
const onTheWay = new Map<string, OnTheWay>();

function store(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

const TAG = '\u0000k';
function replacer(this: unknown, _key: string, v: unknown): unknown {
  if (v instanceof Map) return { [TAG]: 'm', v: [...v.entries()] };
  if (v instanceof Set) return { [TAG]: 's', v: [...v.values()] };
  if (typeof v === 'number' && !Number.isFinite(v)) return { [TAG]: 'n', v: String(v) };
  return v;
}
function reviver(_key: string, v: unknown): unknown {
  if (typeof v !== 'object' || v === null || !(TAG in v)) return v;
  const o = v as Record<string, unknown>;
  if (o[TAG] === 'm' && Array.isArray(o['v'])) return new Map(o['v'] as [unknown, unknown][]);
  if (o[TAG] === 's' && Array.isArray(o['v'])) return new Set(o['v'] as unknown[]);
  if (o[TAG] === 'n') return Number(o['v']);
  return v;
}

function remember(key: string, kept: Kept): void {
  memory.delete(key);
  memory.set(key, kept);
  while (memory.size > MEMORY_ROWS) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/** The kept answer for `key`, if one is young enough to show; `undefined` when there is none. */
export function kept<T>(key: string): { readonly value: T; readonly at: number } | undefined {
  const now = Date.now();
  const m = memory.get(key);
  if (m !== undefined) return now - m.at <= KEPT_FOR_MS ? (m as { value: T; at: number }) : undefined;
  const s = store();
  if (s === null) return undefined;
  try {
    const raw = s.getItem(PREFIX + key);
    if (raw === null) return undefined;
    const k = JSON.parse(raw, reviver) as Kept;
    if (typeof k !== 'object' || k === null || typeof k.at !== 'number' || now - k.at > KEPT_FOR_MS) return undefined;
    remember(key, k);
    return k as { value: T; at: number };
  } catch {
    return undefined;
  }
}

/* Writes to the phone wait for a quiet moment, so keeping a read never costs a frame. */
const toWrite = new Map<string, Kept>();
let writeAsked = false;
const whenIdle = (f: () => void): void => {
  const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(f, { timeout: 2_000 });
  else setTimeout(f, 200);
};

function writeNow(): void {
  writeAsked = false;
  const s = store();
  if (s === null) {
    toWrite.clear();
    return;
  }
  for (const [key, k] of toWrite) {
    toWrite.delete(key);
    let text: string;
    try {
      text = JSON.stringify(k, replacer);
    } catch {
      continue;
    }
    if (text.length > ONE_READ_CHARS) continue;
    makeRoom(s, text.length, PREFIX + key);
    try {
      s.setItem(PREFIX + key, text);
    } catch {
      /* Full even after making room: this one stays in memory only. */
    }
  }
}

/** Drops the oldest kept reads until `need` more characters fit under KEEP_CHARS. */
function makeRoom(s: Storage, need: number, replacing: string): void {
  const rows: { key: string; chars: number; at: number }[] = [];
  try {
    for (let i = 0; i < s.length; i += 1) {
      const key = s.key(i);
      if (key === null || !key.startsWith('insidor.kept.') || key === replacing) continue;
      const raw = s.getItem(key) ?? '';
      /* An old version's rows are dropped outright. */
      if (!key.startsWith(PREFIX)) {
        rows.push({ key, chars: raw.length, at: 0 });
        continue;
      }
      const at = Number(/"at":(\d+)/.exec(raw.slice(-40))?.[1] ?? 0);
      rows.push({ key, chars: raw.length, at });
    }
    let used = rows.reduce((a, r) => a + r.chars, 0);
    rows.sort((a, b) => a.at - b.at);
    for (const r of rows) {
      if (used + need <= KEEP_CHARS && r.at !== 0) break;
      s.removeItem(r.key);
      used -= r.chars;
    }
  } catch {
    /* Nothing to free: the write below may fail, and is caught there. */
  }
}

/** Keep `value` as `key`'s latest answer: in memory, and on the phone when `phone`. */
export function keep(key: string, value: unknown, phone: boolean): void {
  const k: Kept = { value, at: Date.now() };
  remember(key, k);
  if (!phone) return;
  toWrite.set(key, k);
  if (!writeAsked) {
    writeAsked = true;
    whenIdle(writeNow);
  }
}

/**
 * A fresh answer for `key`: the one already on its way when there is one, else `load`'s, kept when
 * it lands. The signal stops only this caller's wait; the read itself finishes for whoever else is
 * waiting on it, and is kept.
 */
export function fresh<T>(key: string, load: (signal: AbortSignal) => Promise<T>, phone: boolean, signal?: AbortSignal): Promise<T> {
  let way = onTheWay.get(key);
  if (way === undefined) {
    const ac = new AbortController();
    const promise = load(ac.signal).then((v) => {
      keep(key, v, phone);
      return v;
    });
    const mine: OnTheWay = { promise, ac, waiting: 0 };
    way = mine;
    onTheWay.set(key, mine);
    const done = () => {
      if (onTheWay.get(key) === mine) onTheWay.delete(key);
    };
    promise.then(done, done);
  }
  const w = way;
  const p = w.promise as Promise<T>;
  if (signal === undefined) {
    /* A read nobody can call off (a read ahead): it is never stopped for the others. */
    w.waiting = Number.POSITIVE_INFINITY;
    return p;
  }
  w.waiting += 1;
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    /* The last caller to stop waiting stops the read itself, as a plain fetch would have. */
    const stop = () => {
      w.waiting -= 1;
      /* Stopped after this turn, so a caller asking again at once (a reload) joins it instead. */
      setTimeout(() => {
        if (w.waiting > 0) return;
        w.ac.abort();
        if (onTheWay.get(key) === w) onTheWay.delete(key);
      }, 0);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', stop, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', stop);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', stop);
        reject(e);
      },
    );
  });
}

/**
 * Read `key` ahead of the screen that will want it (shared/prefetch.ts), unless a young enough
 * answer is already kept. Failures are dropped: the screen reads for itself and says so.
 */
export function readAhead<T>(key: string, load: (signal: AbortSignal) => Promise<T>, phone: boolean, youngerThanMs: number): Promise<void> {
  const k = memory.get(key) ?? kept(key);
  if (k !== undefined && Date.now() - k.at < youngerThanMs) return Promise.resolve();
  return fresh(key, load, phone).then(
    () => undefined,
    () => undefined,
  );
}
