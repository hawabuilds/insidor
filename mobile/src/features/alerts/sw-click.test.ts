/**
 * The service worker's tap, run for real: public/sw.js is loaded into a sandbox with a fake `self`,
 * fake windows and a fake Cache Storage, and a notification tap is played through it. The worker is
 * plain JavaScript served as is, so this is the only place its tap is tested; what it must do is
 * what features/alerts/push-open.ts expects to receive.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const SOURCE = readFileSync(new URL('../../../public/sw.js', import.meta.url), 'utf8');
const ORIGIN = 'https://insidor.app';

type Win = { url: string; focused: boolean; visibilityState: string; posted: string[]; focus: () => Promise<unknown>; postMessage: (m: unknown) => void };

function win(url: string, opts: { focused?: boolean; visible?: boolean; refuses?: boolean } = {}): Win {
  const w: Win = {
    url,
    focused: opts.focused === true,
    visibilityState: opts.visible === false ? 'hidden' : 'visible',
    posted: [],
    focus: () => (opts.refuses === true ? Promise.reject(new Error('not allowed')) : Promise.resolve(w)),
    /* As JSON: the message is made in the sandbox's realm. */
    postMessage: (m) => void w.posted.push(JSON.stringify(m)),
  };
  return w;
}

/** A Cache Storage kept in maps, enough for what the worker does. */
function fakeCaches() {
  const stores = new Map<string, Map<string, string>>();
  const open = async (name: string) => {
    const m = stores.get(name) ?? new Map<string, string>();
    stores.set(name, m);
    return {
      match: async (k: string) => (m.has(k) ? new Response(m.get(k)) : undefined),
      put: async (k: string, r: Response) => void m.set(k, await r.text()),
      delete: async (k: string) => m.delete(k),
    };
  };
  return { stores, api: { open, has: async (n: string) => stores.has(n), delete: async (n: string) => stores.delete(n), keys: async () => [...stores.keys()] } };
}

function load(windows: readonly Win[]) {
  const handlers = new Map<string, (e: unknown) => void>();
  const opened: string[] = [];
  const caches = fakeCaches();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, f: (e: unknown) => void) => void handlers.set(type, f),
    skipWaiting: () => undefined,
    registration: { showNotification: async () => undefined },
    clients: {
      matchAll: async () => windows,
      openWindow: async (u: string) => {
        opened.push(u);
        return null;
      },
      claim: async () => undefined,
    },
  };
  runInNewContext(SOURCE, { self, caches: caches.api, Response, URL, JSON, Date, Promise, setTimeout, clearTimeout, console });
  const tap = async (url: string) => {
    let work: Promise<unknown> = Promise.resolve();
    handlers.get('notificationclick')?.({ notification: { data: { url }, close: () => undefined }, action: '', waitUntil: (p: Promise<unknown>) => void (work = p) });
    await work;
  };
  return { tap, opened, caches };
}

const COIN = '/#/token/solana%3AEgtzTrczSC6WmPas2hXqnuQ7Bo3LRUaZx9QZ1G7kpump';

test('★ closed: the app is opened at the screen with the launch mark, and the screen is left in the cache', async () => {
  const sw = load([]);
  await sw.tap(COIN);
  assert.deepEqual(sw.opened, ['/?push=1#/token/solana%3AEgtzTrczSC6WmPas2hXqnuQ7Bo3LRUaZx9QZ1G7kpump']);
  const left = JSON.parse(sw.caches.stores.get('insidor-open')?.get('/__insidor_open') ?? '{}') as { hash?: string };
  assert.equal(left.hash, '#/token/solana%3AEgtzTrczSC6WmPas2hXqnuQ7Bo3LRUaZx9QZ1G7kpump');
});

test('★ open: the window on screen is told and focused, and nothing new is opened', async () => {
  const behind = win(`${ORIGIN}/#/`, { visible: false });
  const front = win(`${ORIGIN}/#/narratives`, { focused: true });
  const sw = load([behind, front]);
  await sw.tap('/#/post/x%3A2113437949748785214');
  assert.deepEqual(front.posted, [JSON.stringify({ type: 'insidor-open', hash: '#/post/x%3A2113437949748785214' })]);
  assert.deepEqual(behind.posted, []);
  assert.deepEqual(sw.opened, []);
});

test('★ a window that refuses focus is not trusted to have heard: the app is opened at the screen', async () => {
  const stale = win(`${ORIGIN}/#/`, { refuses: true });
  const sw = load([stale]);
  await sw.tap(COIN);
  assert.equal(stale.posted.length, 1);
  assert.deepEqual(sw.opened, ['/?push=1#/token/solana%3AEgtzTrczSC6WmPas2hXqnuQ7Bo3LRUaZx9QZ1G7kpump']);
});

test('★ tap diagnostics: with the log made, a tap writes its steps; without it, nothing', async () => {
  const front = win(`${ORIGIN}/#/`, { focused: true });
  const sw = load([front]);
  await sw.caches.api.open('insidor-taplog');
  await sw.tap(COIN);
  const rows = JSON.parse(sw.caches.stores.get('insidor-taplog')?.get('/__insidor_taplog/sw') ?? '[]') as { step: string; by: string }[];
  assert.deepEqual(rows.map((r) => r.step), ['click', 'stash', 'windows', 'posted', 'focus']);
  assert.ok(rows.every((r) => r.by === 'sw'));

  const off = load([]);
  await off.tap(COIN);
  assert.equal(off.caches.stores.has('insidor-taplog'), false);
});
