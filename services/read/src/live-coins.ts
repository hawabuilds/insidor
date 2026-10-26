/**
 * GET /live/coins?c=<address>,<address> — EVERY TRADE OF THE COINS ON A PHONE'S SCREEN, AS IT LANDS
 * (the owner, 2026-10-26: "every price, mc, trade should be instant using the fastest on chain
 * data"). Server-Sent Events, the same transport as the board's stream (stream.ts) and for the same
 * reasons: one-way, ordinary HTTP, the origin allowlist applies, EventSource reconnects by itself.
 *
 * Where the trades come from: the coin watcher (services/chainwatch live.ts), which holds the one
 * connection the trade relay allows and turns each trade of a wanted coin into a tick with its
 * market cap in dollars. That process is private; this one is the only thing that talks to it —
 * ONE upstream connection, naming every coin any phone has open, re-opened (debounced) when that
 * set changes. Each phone gets only the ticks of the coins it asked for.
 *
 * ★ NO REPLAY, AS THE BOARD'S STREAM. A tick missed is missed: the phone's own reads (the chart, the
 * card) are the record, and these only move them forward. On attach, and whenever the upstream comes
 * back, a `ready` is sent so the phone knows the line is live; while it is not, the phone shows the
 * age of the last number it had.
 *
 * ★ A SLOW PHONE IS DROPPED, NEVER QUEUED. A socket holding more than `MAX_BUFFER` unsent bytes is
 * destroyed; EventSource reconnects and the screen re-reads. A busy coin's ticks for a phone that has
 * stopped reading are not worth this process's memory.
 *
 * What breaks if changed carelessly: the coin limits. `MAX_COINS_PER_PHONE` bounds what one request
 * can make the coin watcher parse, and the address pattern keeps anything but a coin out of the URL
 * this process builds.
 */

import type { ServerResponse } from 'node:http';

import type { Logger } from './log.ts';

/** The most coins one phone may follow at once: a screen of cards, a sheet, a token page and the tape. */
const MAX_COINS_PER_PHONE = 60;
/** Unsent bytes past which a phone is dropped. */
const MAX_BUFFER = 1_000_000;
/** How long a change in the coins is gathered before the upstream is re-opened. */
const REOPEN_AFTER_MS = 400;
/** The wait before the upstream is tried again after a failure, growing to the cap. */
const RETRY_MS = 1_000;
const RETRY_CAP_MS = 15_000;
/** A comment to each phone this often, so a quiet line is not taken for a dead one. */
const HEARTBEAT_MS = 15_000;
const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,48}$/;

interface Phone {
  readonly coins: ReadonlySet<string>;
  readonly res: ServerResponse;
}

export interface LiveCoins {
  /** The coins asked for when this is the live route, else null. */
  match(method: string, url: string): readonly string[] | null;
  attach(res: ServerResponse, coins: readonly string[], shared: Readonly<Record<string, string>>): void;
  size(): number;
  close(): void;
}

export function createLiveCoins(upstreamUrl: string | null, log: Logger): LiveCoins {
  const phones = new Set<Phone>();
  let upstream: AbortController | null = null;
  let reopenTimer: ReturnType<typeof setTimeout> | null = null;
  let openCoins = '';
  let live = false;
  let failures = 0;
  let closed = false;

  const union = (): string[] => [...new Set([...phones].flatMap((p) => [...p.coins]))].sort();
  const send = (p: Phone, chunk: string): void => {
    if (p.res.writableLength > MAX_BUFFER) {
      p.res.destroy();
      phones.delete(p);
      return;
    }
    p.res.write(chunk);
  };
  const ready = (p: Phone): void => send(p, `event: ready\ndata: ${JSON.stringify({ live })}\n\n`);

  const fanOut = (data: string): void => {
    let msg: { ticks?: { a: string }[]; solUsd?: number | null };
    try {
      msg = JSON.parse(data) as typeof msg;
    } catch {
      return;
    }
    if (!Array.isArray(msg.ticks)) return;
    for (const p of phones) {
      const mine = msg.ticks.filter((t) => p.coins.has(t.a));
      if (mine.length > 0) send(p, `data: ${JSON.stringify({ ticks: mine, solUsd: msg.solUsd ?? null })}\n\n`);
    }
  };

  async function open(coins: string): Promise<void> {
    upstream?.abort();
    openCoins = coins;
    if (upstreamUrl === null || coins === '' || closed) {
      upstream = null;
      return;
    }
    const ac = new AbortController();
    upstream = ac;
    try {
      const res = await fetch(`${upstreamUrl}?coins=${coins}`, { signal: ac.signal, headers: { accept: 'text/event-stream' } });
      if (!res.ok || res.body === null) throw new Error(`upstream answered ${res.status}`);
      live = true;
      failures = 0;
      for (const p of phones) ready(p);
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let cut = buf.indexOf('\n\n');
        while (cut >= 0) {
          const event = buf.slice(0, cut);
          buf = buf.slice(cut + 2);
          const data = event.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
          if (data !== '') fanOut(data);
          cut = buf.indexOf('\n\n');
        }
      }
      throw new Error('upstream ended');
    } catch (e) {
      if (ac.signal.aborted || closed) return;
      live = false;
      failures += 1;
      const wait = Math.min(RETRY_CAP_MS, RETRY_MS * 2 ** Math.min(failures, 4));
      log.info('live coins: the coin watcher is not answering; tried again soon', { err: e instanceof Error ? e.message : String(e), waitMs: wait });
      setTimeout(() => {
        if (upstream === ac) void open(union().join(','));
      }, wait).unref();
    }
  }

  const reopenSoon = (): void => {
    if (reopenTimer !== null) return;
    reopenTimer = setTimeout(() => {
      reopenTimer = null;
      const next = union().join(',');
      if (next !== openCoins) void open(next);
    }, REOPEN_AFTER_MS);
    reopenTimer.unref();
  };

  const beat = setInterval(() => {
    for (const p of phones) send(p, `: ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);
  beat.unref();

  return {
    match(method, url) {
      if (method !== 'GET') return null;
      const u = new URL(url, 'http://local');
      if (u.pathname !== '/live/coins') return null;
      return [...new Set((u.searchParams.get('c') ?? '').split(',').map((c) => c.trim()).filter((c) => ADDRESS.test(c)))].slice(0, MAX_COINS_PER_PHONE);
    },
    attach(res, coins, shared) {
      res.writeHead(200, { ...shared, 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write('retry: 2000\n\n');
      const p: Phone = { coins: new Set(coins), res };
      phones.add(p);
      ready(p);
      reopenSoon();
      res.on('close', () => {
        phones.delete(p);
        reopenSoon();
      });
    },
    size: () => phones.size,
    close() {
      closed = true;
      clearInterval(beat);
      upstream?.abort();
      for (const p of phones) p.res.end();
      phones.clear();
    },
  };
}
