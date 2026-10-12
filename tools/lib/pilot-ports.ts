/**
 * THE HISTORY PILOT'S SUPPLIERS, wired for `tools/history-pilot.ts run`: Voyage for pictures,
 * the judge for borderline pairs and creator posts, X for creator posts and the search back,
 * GeckoTerminal for a coin's peak (free).
 *
 * Kept apart from the pilot step (services/runner/src/work/history-pilot.ts), which is tested
 * against stand-ins; this file is what it runs against for real, and only after the tool's
 * refusal checks have passed.
 *
 * ★ NOTHING IS PAID FOR TWICE. Picture vectors and pair answers are cached in var/history/,
 * so a run stopped at the cap and started again re-reads them for free. Each port returns what
 * the supplier said it cost; the step records it in the ledger.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { Millis } from '../../contracts/src/vocabulary.ts';
import type { Meter } from '../../contracts/src/ports/meter.ts';
import type { Policy } from '../../contracts/src/policy.ts';
import { checkCreatorLink, namesCoin } from '../../core/src/origin/check.ts';
import { voyageEmbed, httpClient as voyageClient } from '../../adapters/embed/voyage/src/index.ts';
import { anthropicJudge, httpClient as judgeClient, priceFor, readJudgeSetup } from '../../adapters/judge/anthropic/src/index.ts';
import { xPlatform, httpClient as xClient } from '../../adapters/platform/x/src/index.ts';
import { geckoterminal } from '../../adapters/market/geckoterminal/src/index.ts';
import type { Charge, PilotCoin, PilotPorts, ShownPost } from '../../services/runner/src/work/history-pilot.ts';

/** Every launchpad coin has a fixed supply of one billion. */
const LAUNCHPAD_SUPPLY = 1_000_000_000;
const DEADLINE_MS = 60_000;

const image = (uri: string) => ({ kind: 'image' as const, uri, width: null, height: null, durationMs: null });

function jsonFile<T>(url: URL, empty: T): { get(): T; save(v: T): void } {
  let value: T = existsSync(url) ? (JSON.parse(readFileSync(url, 'utf8')) as T) : empty;
  return { get: () => value, save: (v) => { value = v; writeFileSync(url, `${JSON.stringify(v)}\n`); } };
}

export function pilotPorts(cfg: { readonly out: URL; readonly meter: Meter; readonly policy: Policy; readonly env: Record<string, string | undefined> }): PilotPorts {
  const P = cfg.policy;
  const budget = () => {
    const line = cfg.meter.line();
    return { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: 1, deadline: Date.now() + DEADLINE_MS };
  };

  const voyageKey = cfg.env['VOYAGE_API_KEY'] ?? '';
  const xKey = cfg.env['X_API_KEY'] ?? '';
  const setup = readJudgeSetup(cfg.env);
  if (voyageKey === '' || xKey === '' || setup.state !== 'configured') throw new Error('VOYAGE_API_KEY, X_API_KEY and the judge (ANTHROPIC_API_KEY, JUDGE_MODEL) must all be set to run the pilot.');
  const price = priceFor(setup.model);
  if (price === null) throw new Error(`JUDGE_MODEL ${setup.model} has no price.`);

  const embed = voyageEmbed({ client: voyageClient({ apiKey: voyageKey, baseUrl: cfg.env['VOYAGE_API_BASE'] ?? 'https://api.voyageai.com', fetch: globalThis.fetch }), meter: cfg.meter, now: Date.now });
  const judge = anthropicJudge({
    client: judgeClient({
      apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: setup.model, maxOutputTokens: P.judge.pairMaxOutputTokens, effort: price.effort,
      timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
      maxFrameBytes: P.judge.maxFrameBytes, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    }),
    meter: cfg.meter, now: Date.now, model: setup.model, policy: P.judge, maxBatch: 1,
  });
  const x = xPlatform({ client: xClient({ apiKey: xKey, baseUrl: cfg.env['X_API_BASE'] ?? 'https://api.twitterapi.io', fetch: globalThis.fetch }), meter: cfg.meter, now: () => Date.now() });
  const market = geckoterminal({ plan: 'free', baseUrl: 'https://api.geckoterminal.com/api/v2', fetch: globalThis.fetch, timeoutMs: 15_000, now: Date.now });

  const vectors = jsonFile<Record<string, number[] | null>>(new URL('vectors.json', cfg.out), {});
  const pairs = jsonFile<Record<string, 'yes' | 'no' | 'unsure'>>(new URL('pairs.json', cfg.out), {});

  /** A picture's vector: cached, or embedded now and charged. Null when it could not be read. */
  async function vectorOf(uri: string, charges: Charge[]): Promise<number[] | null> {
    const held = vectors.get()[uri];
    if (held !== undefined) return held;
    const result = await embed.embedMedia!([image(uri)], budget());
    charges.push({ supplier: 'voyage', step: 'picture', usd: result.spend.usd });
    const v = result.value[0];
    const values = v === null || v === undefined ? null : Array.from(v.values);
    vectors.save({ ...vectors.get(), [uri]: values });
    return values;
  }
  const cosine = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);

  async function sameSubject(a: string, b: string, charges: Charge[]): Promise<'yes' | 'no' | null> {
    const k = [a, b].sort().join('|');
    const held = pairs.get()[k];
    if (held !== undefined) return held === 'unsure' ? null : held;
    const result = await judge.sameSubject!(image(a), image(b), budget());
    charges.push({ supplier: 'anthropic', step: 'confirm', usd: result.spend.usd });
    if (result.value === null) return null;
    pairs.save({ ...pairs.get(), [k]: result.value });
    return result.value === 'unsure' ? null : result.value;
  }

  /** Is this post's picture the coin's? 'near', 'likely', 'confirmed' by the judge, or null. */
  async function pictureOf(postUri: string | null, coinUri: string | null, charges: Charge[]) {
    if (postUri === null || coinUri === null) return null;
    const [a, b] = [await vectorOf(coinUri, charges), await vectorOf(postUri, charges)];
    if (a === null || b === null) return null;
    const s = cosine(a, b);
    const bars = P.group.image;
    if (s >= bars.nearIdentical) return 'near' as const;
    if (s >= bars.likely) return 'likely' as const;
    if (s >= bars.borderline) return (await sameSubject(coinUri, postUri, charges)) === 'yes' ? ('confirmed' as const) : null;
    return null;
  }

  const shownOf = (id: string, handle: string | null, postedAt: Millis | null): ShownPost => ({
    postId: `x:${id}`, authorLabel: handle === null ? 'an X account' : `@${handle}`, permalink: `https://x.com/i/status/${id}`, postedAt,
  });

  return {
    async pictureSimilarity(a: PilotCoin, b: PilotCoin) {
      const charges: Charge[] = [];
      if (a.imageUri === null || b.imageUri === null) return { value: null, charges };
      const [va, vb] = [await vectorOf(a.imageUri, charges), await vectorOf(b.imageUri, charges)];
      return { value: va === null || vb === null ? null : cosine(va, vb), charges };
    },

    async confirmPair(a: PilotCoin, b: PilotCoin) {
      const charges: Charge[] = [];
      if (a.imageUri === null || b.imageUri === null) return { value: null, charges };
      return { value: await sameSubject(a.imageUri, b.imageUri, charges), charges };
    },

    async creator(coin) {
      const charges: Charge[] = [];
      const link = coin.socialLink ?? '';
      const facts = { address: coin.address, ticker: coin.ticker ?? '', name: coin.name ?? '', launchedAt: coin.launchedAt };
      if (/tiktok\.com\//i.test(link)) return { value: { check: { kind: 'fallThrough', why: 'a TikTok link' }, post: null, gap: 'tiktok_not_searchable' }, charges };
      const parsed = x.parseLink?.(link) ?? null;
      if (parsed === null) return { value: { check: { kind: 'fallThrough', why: 'not a link we can follow' }, post: null, gap: null }, charges };
      if (parsed.kind === 'account') return { value: { check: checkCreatorLink({ kind: 'account' }, facts, P), post: null, gap: null }, charges };
      const fromId = (x.postTimeFromId?.(parsed.sourceItemId) ?? null) as Millis | null;
      /* Posted after the coin by its own id's time: promotion, and nothing needs reading. */
      if (fromId !== null && fromId > coin.launchedAt + P.origin.launchAllowanceMs) {
        return { value: { check: checkCreatorLink({ kind: 'post', post: { postId: `x:${parsed.sourceItemId}`, postedAt: fromId, text: '', authorFollowers: null, reach: null, judged: null } }, facts, P), post: null, gap: null }, charges };
      }
      const read = await x.lookup!([parsed.sourceItemId], budget());
      charges.push({ supplier: 'x', step: 'creator_post', usd: read.spend.usd });
      const item = read.value.items[0];
      if (item === undefined) return { value: { check: { kind: 'fallThrough', why: 'the linked post could not be read' }, post: null, gap: 'possibly_deleted' }, charges };
      const author = read.value.authors.find((a) => a.authorKey === item.authorKey) ?? null;
      const judged = await judge.judge([{ storyId: `pilot-${item.sourceItemId}` as never, texts: [item.text.slice(0, P.judge.maxCharsPerText)], media: item.media, distinctAuthors: 1, distinctSources: 1 }], { ...budget(), maxCalls: 1 });
      charges.push({ supplier: 'anthropic', step: 'judge', usd: judged.spend.usd });
      const outcome = judged.value[0];
      const post = {
        postId: `x:${item.sourceItemId}`, postedAt: item.postedAt, text: item.text, authorFollowers: author?.audience?.value ?? null, reach: item.counters.reach?.value ?? null,
        judged: outcome?.kind === 'judged' ? { coinable: outcome.judgement.coinable, proposedName: outcome.judgement.proposedName } : null,
      };
      return { value: { check: checkCreatorLink({ kind: 'post', post }, facts, P), post: shownOf(item.sourceItemId, author?.handle ?? null, item.postedAt), gap: null }, charges };
    },

    async searchBack(term: string, untilMs: Millis, coin: PilotCoin) {
      const charges: Charge[] = [];
      const result = await x.discover({ mode: 'keyword', term, sinceMs: null, untilMs, limit: P.backfill.searchResultCap, cursor: null }, budget());
      charges.push({ supplier: 'x', step: 'search', usd: result.spend.usd });
      const authors = new Map(result.value.authors.map((a) => [a.authorKey as string, a]));
      const facts = { ticker: coin.ticker ?? '', name: coin.name ?? term };
      const out = [];
      for (const item of result.value.items) {
        const named = namesCoin(item.text, facts);
        const firstImage = item.media.find((m) => m.kind === 'image')?.uri ?? null;
        /* Only a post that names the coin is worth a picture check. */
        const picture = named ? await pictureOf(firstImage, coin.imageUri, charges) : null;
        out.push({ postId: `x:${item.sourceItemId}`, postedAt: item.postedAt, text: item.text, picture, shown: shownOf(item.sourceItemId, authors.get(item.authorKey as string)?.handle ?? null, item.postedAt) });
      }
      return { value: out, charges };
    },

    async peak(coin: PilotCoin) {
      try {
        const m = await market.coin(coin.address, '6h');
        if (m.candles === null || m.candles.length === 0) return null;
        return Math.max(...m.candles.map((c) => c.h)) * LAUNCHPAD_SUPPLY;
      } catch {
        return null;
      }
    },
  };
}
