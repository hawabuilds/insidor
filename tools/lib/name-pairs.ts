/**
 * EVERY KNOWN POST → COIN PAIR, IN ONE PLACE, FOR THE TWO TOOLS THAT NEED THEM ALL: the founders'
 * coined sheet and its known origin posts (frozen files under eval/), and the database's pairs
 * (store PgNameExampleRepo.fromDatabase: the owner's confirmed coins, gold, created coins, coins
 * whose links carry the post), grouped into example POSTS with every coin name each was given,
 * and a words-and-picture vector for each.
 *
 * Shared by tools/name-examples.ts (writes them to 0076 once, for the runner) and
 * tools/name-guess-eval.ts (measures the namer with them, held out by time), so the live namer
 * and the measurement learn from exactly the same pairs.
 *
 * ★ A VECTOR IS PAID FOR ONCE. The runner's own post vectors (0074) and the owner's label vectors
 * (0069) are the same space and input, and are read first; what is left is embedded on the
 * LEARNING book and kept in a cache file, so the seed after 0076 does not pay for the
 * measurement's vectors again.
 *
 * What breaks if changed carelessly: a sheet row's post id. The known origin posts are keyed
 * `<platform>:<post id>` like the feed's items, so a known post that is also in the database is
 * one example post, not two; a sheet row whose creator post we read is keyed the same way.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import { DEFAULT_POLICY } from '../../contracts/src/policy.ts';
import type { Meter } from '../../contracts/src/ports/meter.ts';
import { embedInput, postPicture } from '../../core/src/qualify/precedents.ts';
import { voyageEmbed, httpClient as voyageClient } from '../../adapters/embed/voyage/src/index.ts';
import { loadEvidence } from '../../eval/src/gold/coin-evidence.ts';
import { goldCoins } from '../../eval/src/gold/coin-origins.ts';
import { matchCases } from '../../eval/src/gold/match-cases.ts';
import type { Db, NamePair } from '../../store/src/index.ts';
import { PgNameExampleRepo } from '../../store/src/index.ts';

/** One example post: its words, picture, time, and every coin people named after it. */
export interface PairPost {
  readonly itemId: string;
  text: string;
  picture: string | null;
  postedAtMs: number | null;
  readonly coins: { name: string; ticker: string; address: string | null; source: NamePair['source']; availableAtMs: number | null }[];
  readonly sources: Set<NamePair['source']>;
}

const platformOf = (url: string): string => (/tiktok\.com/i.test(url) ? 'tiktok' : /instagram\.com/i.test(url) ? 'instagram' : 'x');

/** The sheet's pairs: each known origin post (`known`), and each coin whose creator's post we read (`sheet`). */
export function filePairs(): NamePair[] {
  const out: NamePair[] = [];
  const coins = new Map(goldCoins().map((c) => [c.id, c] as const));
  for (const c of matchCases()) {
    if (c.kind !== 'origin') continue;
    const coin = coins.get(c.coinId);
    if (coin === undefined) continue;
    out.push({ itemId: `${c.platform}:${c.postId}`, address: coin.mint, name: coin.name.trim() || coin.ticker, ticker: coin.ticker.trim() || coin.name, source: 'known', text: c.text ?? '', picture: c.imageUri, postedAtMs: c.postedAt, availableAtMs: Date.parse(coin.createdAt) });
  }
  const ev = loadEvidence();
  for (const coin of coins.values()) {
    const creator = ev.get(coin.id)?.creator;
    const post = creator?.kind === 'post' ? creator.post : null;
    if (post === null || post === undefined || post.text.trim() === '') continue;
    out.push({ itemId: `${platformOf(post.url)}:${post.postId}`, address: coin.mint, name: coin.name.trim() || coin.ticker, ticker: coin.ticker.trim() || coin.name, source: 'sheet', text: post.text, picture: post.imageUri, postedAtMs: post.postedAt, availableAtMs: Date.parse(coin.createdAt) });
  }
  return out;
}

/** Fills a known post we never read from the stored item, when the feed holds it. */
async function fillFromItems(db: Db, pairs: NamePair[]): Promise<NamePair[]> {
  const empty = [...new Set(pairs.filter((p) => p.text === '' && p.picture === null).map((p) => p.itemId))];
  if (empty.length === 0) return pairs;
  const rows = await db.query<{ item_id: string; body: string | null; media: unknown; posted_at: Date | null }>('select item_id, body, media, posted_at from public.item where item_id = any($1::text[])', [empty]);
  const by = new Map(rows.map((r) => [r.item_id, r] as const));
  return pairs.map((p) => {
    const r = by.get(p.itemId);
    return r === undefined || p.text !== '' || p.picture !== null ? p : { ...p, text: r.body ?? '', picture: postPicture(r.media), postedAtMs: p.postedAtMs ?? (r.posted_at === null ? null : new Date(r.posted_at).getTime()) };
  });
}

/** Every pair, files and database, grouped by post. Posts with neither words nor a picture are dropped (nothing to read). */
export async function allPairPosts(db: Db): Promise<Map<string, PairPost>> {
  const fromDb = await new PgNameExampleRepo(db).fromDatabase({ linked: true, linkedDays: null });
  const pairs = await fillFromItems(db, [...filePairs(), ...fromDb]);
  const posts = new Map<string, PairPost>();
  for (const p of pairs) {
    const picture = p.picture ?? postPicture(p.media);
    const post = posts.get(p.itemId) ?? { itemId: p.itemId, text: '', picture: null, postedAtMs: null, coins: [], sources: new Set() };
    if (post.text === '' && p.text.trim() !== '') post.text = p.text;
    if (post.picture === null && picture !== null) post.picture = picture;
    if (post.postedAtMs === null) post.postedAtMs = p.postedAtMs;
    post.sources.add(p.source);
    const key = `${p.name.toLowerCase()}|${p.ticker.toUpperCase()}`;
    if (!post.coins.some((c) => `${c.name.toLowerCase()}|${c.ticker.toUpperCase()}` === key)) post.coins.push({ name: p.name, ticker: p.ticker.replace(/^\$+/, ''), address: p.address, source: p.source, availableAtMs: p.availableAtMs });
    posts.set(p.itemId, post);
  }
  for (const [id, p] of posts) if (p.text.trim() === '' && p.picture === null) posts.delete(id);
  return posts;
}

/**
 * A vector for every post: the cache file, then the runner's kept vectors (0074, 0069), then
 * paid embedding on the learning book for the rest (at most `maxPaid`). Missing ones are absent.
 */
export async function vectorsFor(db: Db, posts: readonly PairPost[], space: string, cacheFile: string, meter: Meter | null, maxPaid: number): Promise<Map<string, Float32Array>> {
  const cache: Record<string, number[]> = existsSync(cacheFile) ? (JSON.parse(readFileSync(cacheFile, 'utf8')) as Record<string, number[]>) : {};
  const out = new Map<string, Float32Array>();
  for (const p of posts) if (cache[p.itemId] !== undefined) out.set(p.itemId, Float32Array.from(cache[p.itemId] ?? []));
  const want = posts.filter((p) => !out.has(p.itemId)).map((p) => p.itemId);
  if (want.length > 0) {
    const rows = await db.query<{ item_id: string; v: string }>(
      `select item_id, embedding::text as v from internal.post_embedding where space = $1 and item_id = any($2::text[])
       union all select item_id, embedding::text from internal.label_embedding where space = $1 and item_id = any($2::text[])`,
      [space, want],
    );
    for (const r of rows) if (!out.has(r.item_id)) out.set(r.item_id, Float32Array.from(r.v.replace(/^\[|\]$/g, '').split(',').map(Number)));
  }
  const left = posts.filter((p) => !out.has(p.itemId)).slice(0, maxPaid);
  if (left.length > 0 && meter !== null) {
    const embed = voyageEmbed({ client: voyageClient({ apiKey: (process.env['VOYAGE_API_KEY'] ?? '').trim(), baseUrl: process.env['VOYAGE_API_BASE'] ?? 'https://api.voyageai.com', fetch: globalThis.fetch }), meter, now: Date.now });
    const size = embed.maxBatch;
    for (let i = 0; i < left.length; i += size) {
      const batch = left.slice(i, i + size);
      const inputs = batch.map((p) => embedInput(p.text, p.picture, DEFAULT_POLICY));
      try {
        const r = await embed.embedPosts!(inputs, { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: Date.now() + 120_000 });
        r.value.forEach((v, j) => {
          const p = batch[j];
          if (p !== undefined && v !== null) out.set(p.itemId, v.values);
        });
      } catch (e) {
        /* A batch with a picture the vendor cannot read fails whole: try those posts on their words alone. */
        const words = batch.map((p) => embedInput(p.text, null, DEFAULT_POLICY));
        try {
          const r = await embed.embedPosts!(words.map((w) => (w.text === '' ? { text: '(picture)', picture: null } : w)), { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: Date.now() + 120_000 });
          r.value.forEach((v, j) => {
            const p = batch[j];
            if (p !== undefined && v !== null && p.text !== '') out.set(p.itemId, v.values);
          });
        } catch (e2) {
          console.warn(`a batch of ${batch.length} was not embedded: ${e instanceof Error ? e.message : String(e)} / ${e2 instanceof Error ? e2.message : String(e2)}`);
        }
      }
      process.stdout.write(`\rembedded ${Math.min(i + size, left.length)} of ${left.length}`);
    }
    process.stdout.write('\n');
  }
  for (const [id, v] of out) cache[id] = Array.from(v, (x) => Math.round(x * 1e6) / 1e6);
  writeFileSync(cacheFile, JSON.stringify(cache));
  return out;
}
