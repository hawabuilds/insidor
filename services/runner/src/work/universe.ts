/**
 * THE COIN UNIVERSE, LIVE: every new coin's metadata read, and its origin checked.
 *
 * Two steps a pass, both newest first and both bounded by `policy.universe`:
 *
 *   metadata  the coin's metadata document, by content id through our own gateway — free.
 *             Runs on a dry run too: it spends nothing.
 *   origin    the creator's link (contracts/src/origin.ts, core's `checkCreatorLink`), then
 *             the posts we already hold that name the coin (core's `matchCandidates`): picture
 *             plus name plus timing, never a name alone. `decideOrigin` gives the status.
 *
 * ★ FREE FIRST, AND A COIN SETTLED FOR FREE IS NEVER PRICED. A creator's post made after the
 * coin is promotion by its id's own time; a coin no post of ours names cannot be matched.
 * Only what is left reaches a paid step — reading the linked post, the judge on it (asked in
 * batches across the pass, like per-post scoring), embedding the coin's picture, the judge on a
 * borderline picture — and each is priced first, checked
 * against its supplier line, and on a dry run priced and not sent. A coin whose check needed a
 * step that did not run is recorded `not_checked_yet` with what it would have cost: never
 * `unlinked`, which would say we looked.
 *
 * What breaks if changed carelessly: a linked or matched post is read ONCE. A post already in
 * the store is used as it is, and one read here is stored like any arrival, so the next coin
 * that links it costs nothing.
 */

import type { Author, Item, ItemId, Millis } from '@insidor/contracts';
import { itemId, storyId } from '@insidor/contracts';
import type { JudgePort, JudgeSubject } from '@insidor/contracts/ports/judge.ts';
import type { EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { checkCreatorLink, decideOrigin, matchCandidates, namesCoin, type Candidate, type CoinFacts, type CreatorLink, type PostFacts } from '@insidor/core';
import type { PlatformRegistry } from '@insidor/platform-registry';
import type { CoinToCheck, PgAuthorRepo, PgCoinUniverseRepo, PgImageEmbeddingRepo, PgItemRepo, PgPostJudgementRepo } from '@insidor/store';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from '../log.ts';
import { checkPair, type PairCheckDeps } from './image-pairs.ts';

export interface MetadataReader {
  read(uri: string | null): Promise<
    | { readonly kind: 'read'; readonly cid: string; readonly metadata: { readonly name: string | null; readonly ticker: string | null; readonly description: string | null; readonly imageUri: string | null; readonly links: { readonly social: string | null; readonly website: string | null; readonly chat: string | null } } }
    | { readonly kind: 'notContentAddressed' }
  >;
}

export interface UniverseDeps {
  readonly coins: Pick<PgCoinUniverseRepo, 'unread' | 'recordMetadata' | 'unchecked' | 'recordOrigin' | 'postsNaming'>;
  readonly metadata: MetadataReader;
  readonly platforms: Pick<PlatformRegistry, 'all'>;
  readonly items: Pick<PgItemRepo, 'byIds'>;
  readonly authors: Pick<PgAuthorRepo, 'byKeys'>;
  readonly postScores: Pick<PgPostJudgementRepo, 'latest' | 'record'>;
  readonly images: Pick<PgImageEmbeddingRepo, 'has' | 'record' | 'coinSimilarity'>;
  /** Store a post read here, as any arrival is stored. */
  readonly store: (items: readonly Item[], authors: readonly Author[]) => Promise<number>;
  /** The judge shown one post alone; null when none is configured. */
  readonly postJudge: JudgePort | null;
  readonly embed: EmbedPort | null;
  /** The same-subject question for a borderline picture (work/image-pairs.ts). */
  readonly pairs: PairCheckDeps | null;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface UniverseResult {
  readonly metadataRead: number;
  readonly checked: number;
  readonly settled: Readonly<Record<string, number>>;
  readonly pending: number;
  /** What the paid steps of this pass would have cost (dry) or did cost (live). */
  readonly usd: number;
}

const CALL_DEADLINE_MS = 60_000;

/** A creator post the judge has not answered yet: the coin waits for this pass's batch. */
class NeedsJudge extends Error {
  readonly item: Item;
  constructor(item: Item) {
    super('needs the judge');
    this.item = item;
  }
}

/** A paid step that did not run, and what it would have cost. */
class Pending extends Error {
  readonly step: string;
  readonly usd: number;
  constructor(step: string, usd: number) {
    super(step);
    this.step = step;
    this.usd = usd;
  }
}

export async function universePass(deps: UniverseDeps): Promise<UniverseResult> {
  const now = deps.now();
  const u = deps.policy.universe;
  const since = (now - u.lookbackMs) as Millis;

  /* ── metadata: free, so it runs on a dry run too ───────────────────── */
  const unread = await deps.coins.unread(since, u.metadataAttempts, u.metadataPerPass);
  let metadataRead = 0;
  for (let i = 0; i < unread.length; i += u.metadataConcurrency) {
    await Promise.all(
      unread.slice(i, i + u.metadataConcurrency).map(async (coin) => {
        try {
          const read = await deps.metadata.read(coin.metadataUri);
          if (read.kind === 'notContentAddressed') {
            await deps.coins.recordMetadata(coin.assetKey, { outcome: 'not_content_addressed', contentId: null, name: null, ticker: null, description: null, imageUri: null, socialLink: null, website: null, chatLink: null }, now);
          } else {
            const m = read.metadata;
            await deps.coins.recordMetadata(coin.assetKey, { outcome: 'read', contentId: read.cid, name: m.name, ticker: m.ticker, description: m.description, imageUri: m.imageUri, socialLink: m.links.social, website: m.links.website, chatLink: m.links.chat }, now);
            metadataRead += 1;
          }
        } catch (e) {
          deps.log.warn('coin metadata unavailable; tried again later', { coin: coin.assetKey, err: errorText(e) });
          await deps.coins.recordMetadata(coin.assetKey, { outcome: 'unavailable', contentId: null, name: null, ticker: null, description: null, imageUri: null, socialLink: null, website: null, chatLink: null }, now);
        }
      }),
    );
  }

  /* ── origin ─────────────────────────────────────────────────────────── */
  const due = await deps.coins.unchecked(since, (now - u.recheckAfterMs) as Millis, u.checksPerPass);
  const settled: Record<string, number> = {};
  let pending = 0;
  let usd = 0;

  /* ★ THE JUDGE IS ASKED IN BATCHES, like per-post scoring. A coin whose creator post the
     judge has not answered is set aside in the first round; the set-aside posts are judged
     together, `judge.maxBatch` to a call; the second round finishes those coins with the
     stored answers. One call per post would cost several times as much for the same answers. */
  const waiting: { coin: CoinToCheck; item: Item }[] = [];
  const finish = async (coin: CoinToCheck, round: 'first' | 'second') => {
    if (coin.launchedAt === null) {
      await deps.coins.recordOrigin(coin.assetKey, { status: 'not_checked_yet', postItemId: null, postOffsetMs: null, why: 'launch time unknown' }, now, deps.policy.version);
      pending += 1;
      return;
    }
    const spent: { usd: number } = { usd: 0 };
    try {
      const decision = await checkOne(deps, coin, coin.launchedAt, spent);
      await deps.coins.recordOrigin(coin.assetKey, decision, now, deps.policy.version);
      settled[decision.status] = (settled[decision.status] ?? 0) + 1;
    } catch (e) {
      if (e instanceof NeedsJudge && round === 'first') {
        waiting.push({ coin, item: e.item });
        usd += spent.usd;
        return;
      }
      const step = e instanceof Pending ? e : e instanceof NeedsJudge ? new Pending('the judge on the linked post', 0) : null;
      if (step === null) throw e;
      pending += 1;
      const why = deps.mode === 'dry' ? `dry run: ${step.step} would cost $${(spent.usd + step.usd).toFixed(5)}` : `paused: ${step.step}`;
      await deps.coins.recordOrigin(coin.assetKey, { status: 'not_checked_yet', postItemId: null, postOffsetMs: null, why }, now, deps.policy.version);
      spent.usd += step.usd;
    }
    usd += spent.usd;
  };

  for (const coin of due) await finish(coin, 'first');
  if (waiting.length > 0) {
    const judged = await judgeBatches(deps, [...new Map(waiting.map((w) => [w.item.itemId, w.item])).values()]);
    usd += judged.usd;
    for (const { coin, item } of waiting) {
      if (judged.answered.has(item.itemId)) {
        await finish(coin, 'second');
        continue;
      }
      /* A dry run or a paused line: the coin waits, with its share of what its batch would cost. */
      pending += 1;
      const why = deps.mode === 'dry' ? `dry run: the judge on the linked post would cost $${judged.perPostUsd.toFixed(5)} (in a batch of ${deps.postJudge?.maxBatch ?? 1})` : 'paused: the judge on the linked post';
      await deps.coins.recordOrigin(coin.assetKey, { status: 'not_checked_yet', postItemId: null, postOffsetMs: null, why }, now, deps.policy.version);
    }
  }

  const result = { metadataRead, checked: due.length, settled, pending, usd };
  deps.log.info(deps.mode === 'dry' ? 'DRY RUN — coin universe pass, paid steps priced and not sent' : 'coin universe pass', { ...result, usd: Math.round(usd * 1e5) / 1e5 });
  return result;
}

async function checkOne(deps: UniverseDeps, coin: CoinToCheck, launchedAt: Millis, spent: { usd: number }) {
  const facts: CoinFacts = { address: coin.address, ticker: coin.ticker, name: coin.name, launchedAt };

  /* 1. The creator's link. */
  const link = await creatorLink(deps, coin, launchedAt, spent);
  const creator = checkCreatorLink(link.link, facts, deps.policy);

  /* 2. The posts we hold that name it — only if the link did not settle it. */
  const match =
    creator.kind === 'origin'
      ? { result: { kind: 'none', why: 'settled by the creator\'s link' } as const, postedAt: new Map<ItemId, Millis>() }
      : await matchOwn(deps, coin, facts, spent);

  const decision = decideOrigin(creator, match.result);
  const postItemId = decision.postId === null ? null : (decision.postId as ItemId);
  const postedAt = postItemId === null ? null : (link.postedAt.get(postItemId) ?? match.postedAt.get(postItemId) ?? null);
  const why = creator.kind === 'origin' ? `the creator's link: ${decision.status}` : match.result.kind === 'none' ? `${creator.why}; ${match.result.why}` : decision.status;
  return { status: decision.status, postItemId, postOffsetMs: postedAt === null ? null : postedAt - launchedAt, why };
}

/** The creator's link, read as far as it needs to be: free when the link's own id settles it. */
async function creatorLink(deps: UniverseDeps, coin: CoinToCheck, launchedAt: Millis, spent: { usd: number }): Promise<{ link: CreatorLink; postedAt: Map<ItemId, Millis> }> {
  const postedAt = new Map<ItemId, Millis>();
  if (coin.socialLink === null) return { link: { kind: 'none' }, postedAt };
  let adapter: PlatformAdapter | undefined;
  let parsed: ReturnType<NonNullable<PlatformAdapter['parseLink']>> = null;
  for (const a of deps.platforms.all()) {
    parsed = a.parseLink?.(coin.socialLink) ?? null;
    if (parsed !== null) {
      adapter = a;
      break;
    }
  }
  if (parsed === null || adapter === undefined) return { link: { kind: 'none' }, postedAt };
  if (parsed.kind === 'account') return { link: { kind: 'account' }, postedAt };

  const id = itemId(adapter.id, parsed.sourceItemId);
  const fromId = adapter.postTimeFromId?.(parsed.sourceItemId) ?? null;
  if (fromId !== null) postedAt.set(id, fromId);
  /* Posted after the coin, by its id's own time: promotion, and nothing needs reading. */
  if (fromId !== null && fromId > launchedAt + deps.policy.origin.launchAllowanceMs) {
    return { link: { kind: 'post', post: { postId: id, postedAt: fromId, text: '', authorFollowers: null, reach: null, judged: null } }, postedAt };
  }

  let item = (await deps.items.byIds([id])).get(id) ?? null;
  let author: Author | null = null;
  if (item === null) {
    const got = await readPost(deps, adapter, parsed.sourceItemId, spent);
    item = got?.item ?? null;
    author = got?.author ?? null;
  } else {
    author = (await deps.authors.byKeys([item.authorKey])).get(item.authorKey) ?? null;
  }
  if (item === null) return { link: { kind: 'post', post: null }, postedAt };
  if (item.postedAt !== null) postedAt.set(id, item.postedAt);

  const post: PostFacts = { postId: id, postedAt: item.postedAt, text: item.text, authorFollowers: author?.audience?.value ?? null, reach: item.counters.reach?.value ?? null, judged: null };
  /* The deterministic checks first: if they settle it, the judge is never asked. */
  const without = checkCreatorLink({ kind: 'post', post }, { address: coin.address, ticker: coin.ticker, name: coin.name, launchedAt }, deps.policy);
  if (without.kind === 'notOrigin') return { link: { kind: 'post', post }, postedAt };
  const judged = await judgePost(deps, item, spent);
  return { link: { kind: 'post', post: { ...post, judged } }, postedAt };
}

/** One post read by id through its source, priced first and stored once read. */
async function readPost(deps: UniverseDeps, adapter: PlatformAdapter, sourceItemId: string, spent: { usd: number }): Promise<{ item: Item; author: Author | null } | null> {
  if (adapter.lookup === undefined) return null;
  const estimate = adapter.estimate({ kind: 'observe', sourceItemIds: [sourceItemId] });
  if (deps.mode === 'dry' || !deps.meter.mayspend(estimate.vendor, estimate.usd)) throw new Pending('reading the linked post', estimate.usd);
  try {
    const line = deps.meter.line(estimate.vendor);
    const result = await adapter.lookup([sourceItemId], { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: 1, deadline: deps.now() + CALL_DEADLINE_MS });
    spent.usd += result.spend.usd;
    const item = result.value.items[0];
    if (item === undefined) return null;
    await deps.store(result.value.items, result.value.authors);
    return { item, author: result.value.authors.find((a) => a.authorKey === item.authorKey) ?? null };
  } catch (e) {
    if (e instanceof BudgetRefused) throw new Pending('reading the linked post', estimate.usd);
    throw e;
  }
}

/**
 * The judge's "nameable subject?" on one post: the stored answer if there is one. Otherwise the
 * coin waits for this pass's batch (`NeedsJudge`); with no judge configured, it is unanswered.
 */
async function judgePost(deps: UniverseDeps, item: Item, _spent: { usd: number }): Promise<PostFacts['judged']> {
  const known = (await deps.postScores.latest([item.itemId])).get(item.itemId);
  if (known !== undefined) return { coinable: known.coinable, proposedName: known.proposedName };
  if (deps.postJudge === null) return null;
  throw new NeedsJudge(item);
}

const subjectFor = (item: Item, p: Policy): JudgeSubject => {
  const text = item.text.trim().slice(0, p.judge.maxCharsPerText);
  return { storyId: storyId(`coin-post-${String(item.itemId).replaceAll(':', '-').replaceAll('|', '-')}`), texts: text === '' ? [] : [text], media: item.media, distinctAuthors: 1, distinctSources: 1 };
};

/**
 * The set-aside creator posts, judged `maxBatch` to a call. Each answer is stored, so the
 * second round reads it for free and a post is never judged twice. On a dry run, or when the
 * line refuses, the batch is priced and not sent.
 */
async function judgeBatches(deps: UniverseDeps, items: readonly Item[]): Promise<{ answered: Set<ItemId>; usd: number; perPostUsd: number }> {
  const answered = new Set<ItemId>();
  const judge = deps.postJudge;
  let usd = 0;
  let perPostUsd = 0;
  if (judge === null) return { answered, usd, perPostUsd };
  for (let i = 0; i < items.length; i += judge.maxBatch) {
    const batch = items.slice(i, i + judge.maxBatch);
    const subjects = batch.map((item) => subjectFor(item, deps.policy));
    const estimate = judge.estimate(subjects);
    perPostUsd = estimate.usd / batch.length;
    if (deps.mode === 'dry' || !deps.meter.mayspend(estimate.vendor, estimate.usd)) {
      deps.log.info(deps.mode === 'dry' ? 'DRY RUN — creator posts priced for the judge, not sent' : 'creator posts paused for budget; they wait', { posts: batch.length, wouldSpendUsd: estimate.usd });
      continue;
    }
    const line = deps.meter.line(estimate.vendor);
    try {
      const result = await judge.judge(subjects, { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: estimate.estUnits, deadline: deps.now() + CALL_DEADLINE_MS * estimate.estUnits });
      usd += result.spend.usd;
      /* Answers come back parallel to the subjects sent. */
      for (const [index, outcome] of result.value.entries()) {
        const item = batch[index];
        if (item === undefined || outcome.kind !== 'judged') continue;
        await deps.postScores.record(item.itemId, outcome.judgement);
        answered.add(item.itemId);
      }
    } catch (e) {
      if (!(e instanceof BudgetRefused)) deps.log.error('judging creator posts failed; their coins wait', { posts: batch.length, err: errorText(e) });
    }
  }
  return { answered, usd, perPostUsd };
}

/** The posts we hold that name the coin, with what their pictures show against the coin's. */
async function matchOwn(deps: UniverseDeps, coin: CoinToCheck, facts: CoinFacts, spent: { usd: number }) {
  const postedAt = new Map<ItemId, Millis>();
  const u = deps.policy.universe;
  const naming = (await deps.coins.postsNaming([coin.name, coin.ticker], (facts.launchedAt - u.matchWindowMs) as Millis, deps.now(), u.candidatesPerCoin))
    .filter((p) => namesCoin(p.text, facts));
  if (naming.length === 0) return { result: { kind: 'none', why: 'no post we hold names it' } as const, postedAt };
  for (const p of naming) if (p.postedAt !== null) postedAt.set(p.itemId, p.postedAt);
  if (coin.imageUri === null) return { result: { kind: 'none', why: 'posts name it, but the coin has no picture to compare' } as const, postedAt };

  /* The coin's picture, embedded once. */
  const space = deps.policy.group.image.space;
  if (!(await deps.images.has('asset', coin.assetKey, coin.imageUri, space))) {
    const embed = deps.embed;
    if (embed?.embedMedia === undefined) return { result: { kind: 'none', why: 'posts name it; no picture comparison is configured' } as const, postedAt };
    const image = { kind: 'image' as const, uri: coin.imageUri, width: null, height: null, durationMs: null };
    if (deps.mode === 'dry' || !deps.meter.mayspend(embedVendor(embed), PICTURE_RESERVE_USD)) throw new Pending('embedding the coin\'s picture', PICTURE_RESERVE_USD);
    const line = deps.meter.line(embedVendor(embed));
    const result = await embed.embedMedia([image], { capUsd: line.capUsd, spentUsd: line.spentUsd, maxCalls: 1, deadline: deps.now() + CALL_DEADLINE_MS });
    spent.usd += result.spend.usd;
    const vector = result.value[0];
    if (vector === null || vector === undefined) return { result: { kind: 'none', why: 'posts name it; the coin\'s picture could not be read' } as const, postedAt };
    await deps.images.record('asset', coin.assetKey, coin.imageUri, vector.space, vector.values, deps.now());
  }

  const similar = await deps.images.coinSimilarity(coin.assetKey, naming.map((p) => p.itemId), space);
  const bars = deps.policy.group.image;
  const candidates: Candidate[] = [];
  for (const p of naming) {
    const s = similar.get(p.itemId);
    let picture: Candidate['picture'] = null;
    if (s !== undefined && s.similarity >= bars.nearIdentical) picture = 'near';
    else if (s !== undefined && s.similarity >= bars.likely) picture = 'likely';
    else if (s !== undefined && s.similarity >= bars.borderline && deps.pairs !== null) {
      if (deps.mode === 'dry') throw new Pending('the judge on a borderline picture', PAIR_RESERVE_USD);
      picture = (await checkPair(deps.pairs, s.coinUri, s.postUri)) === 'yes' ? 'confirmed' : null;
    }
    candidates.push({ postId: p.itemId, postedAt: p.postedAt, text: p.text, picture });
  }
  return { result: matchCandidates(candidates, facts, deps.policy), postedAt };
}

/* What one picture is reserved at before it is embedded (the embedding adapter reserves 3,000
   tokens a picture at $0.12 a million), and one same-subject question (one short judge call).
   Reservations, not prices: the real charge is recorded by the adapter. */
const PICTURE_RESERVE_USD = (3_000 * 0.12) / 1e6;
const PAIR_RESERVE_USD = 0.003;

/* The port's id is `embed:<vendor>/<model>`; the meter's line is the vendor's. */
const embedVendor = (embed: EmbedPort): string => embed.id.replace(/^embed:/, '').split('/')[0] ?? embed.id;
