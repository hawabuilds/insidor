/**
 * THE RE-TUNE'S TIKTOK PART (the owner, 2026-10-16: "re-tune the TikTok settings twice a day with the
 * X re-tune, same gate: beat live on coined TikToks caught and on junk, never lose a missed TikTok").
 *
 * Run by tools/retune.ts at every slot, after the X block's test, and free unless
 * Policy.learning.shortVideo.refetchOn (the re-fetch, on the learning book):
 *
 *   1. the training set refreshed (tools/lib/coined-videos.ts), new coined videos added
 *   2. what it teaches: the speed bar's views at 30/60/120 minutes, the tags, sounds and creators
 *      (the runner's learned list reads the same set: store PgFinderRepo.coinedPosts), the kinds,
 *      the naming
 *   3. THE BAR'S GATE: the learned bar replayed (core `clearsReachBar`) against the bar in use on
 *      our own readings — the coined videos we read, the videos the owner called "Not a meme", and
 *      his missed TikToks. It holds when it catches no fewer coined videos, lets no more junk
 *      through, is strictly better on one of the two, and loses no missed TikTok the bar in use
 *      catches. ★ ONE TIE ALLOWED, UNLIKE THE X GATE'S STRICT-ON-BOTH: a bar is one threshold, so
 *      lowering it can only add both catches and junk, and on 3 coined videos with early readings
 *      (2026-10-16) strict-on-both could never hold. The judge's TikTok gate (in retune.ts) is
 *      strict like X's.
 *   4. X and TikTok side by side (tools/lib/side-by-side.ts) and the biggest gap, with what is
 *      changing for it
 *   5. recorded (internal.short_video_tuning, 0085) whether the gate held, with why
 *
 * ★ A HELD BAR IS PROPOSED, NOT SWITCHED. The bar is code (Policy.rising.shortVideoSpeedBar) and the
 * runner reads no bar from the database; the owner is told the numbers to set. The block (the judge's
 * examples) is applied by the re-tune itself as for X.
 *
 * What breaks if changed carelessly: the replay must be core's `clearsReachBar` with the source's
 * scale, as the scorer runs it. A replay with its own arithmetic would gate a bar nobody runs.
 */

import { DEFAULT_POLICY, type Policy } from '../../contracts/src/policy.ts';
import { PgCoinedVideoRepo, type CoinedVideo, type Db } from '../../store/src/index.ts';
import { clearsBar, learn, readingsOf, refetch, refreshSet, SC_USD_PER_VIDEO, withBar, type Learned, type Reading } from './coined-videos.ts';
import { gaps, sideBySide, sideBySideLines, type Gap, type SideBySide } from './side-by-side.ts';
import { openSharedMeter } from './shared-meter.ts';

export interface BarGate {
  readonly proposed: { readonly earlyReach: number; readonly fastReachPerMinute: number } | null;
  readonly live: { readonly coined: number; readonly junk: number; readonly missed: number };
  readonly learned: { readonly coined: number; readonly junk: number; readonly missed: number } | null;
  /** Coined videos, junk and missed posts with readings: what the counts are out of. */
  readonly of: { readonly coined: number; readonly junk: number; readonly missed: number };
  readonly lost: readonly string[];
  readonly held: boolean;
  readonly why: string;
}

/** The learned bar against the bar in use, on our readings. Pure but for the readings passed in. */
export function gateBar(set: readonly CoinedVideo[], junk: readonly { readonly itemId: string; readonly postedMs: number | null }[], missedIds: ReadonlySet<string>, readings: ReadonlyMap<string, readonly Reading[]>, learned: Learned, p: Policy): BarGate {
  const coined = set.filter((v) => (readings.get(v.itemId)?.length ?? 0) > 0).map((v) => ({ itemId: v.itemId, postedMs: v.postedAt?.getTime() ?? null }));
  const junkRead = junk.filter((j) => (readings.get(j.itemId)?.length ?? 0) > 0);
  const missed = coined.filter((c) => missedIds.has(c.itemId));
  const count = (xs: readonly { itemId: string; postedMs: number | null }[], q: Policy) => xs.filter((x) => clearsBar(readings.get(x.itemId) ?? [], x.postedMs, q)).length;
  const live = { coined: count(coined, p), junk: count(junkRead, p), missed: count(missed, p) };
  const of = { coined: coined.length, junk: junkRead.length, missed: missed.length };
  const proposed = learned.bar.proposed;
  if (proposed === null) return { proposed, live, learned: null, of, lost: [], held: false, why: `no bar learned: ${learned.bar.why}` };
  const q = withBar(p, proposed);
  const cand = { coined: count(coined, q), junk: count(junkRead, q), missed: count(missed, q) };
  const lost = missed.filter((m) => clearsBar(readings.get(m.itemId) ?? [], m.postedMs, p) && !clearsBar(readings.get(m.itemId) ?? [], m.postedMs, q)).map((m) => m.itemId);
  const noWorse = cand.coined >= live.coined && cand.junk <= live.junk;
  const better = cand.coined > live.coined || cand.junk < live.junk;
  const held = noWorse && better && lost.length === 0;
  const why = held ? 'held: no fewer coined caught, no more junk, better on one, no missed TikTok lost'
    : lost.length > 0 ? `not held: it loses ${lost.length} missed TikTok(s) the bar in use catches`
    : !noWorse ? `not held: coined ${cand.coined} against ${live.coined} live, junk ${cand.junk} against ${live.junk}`
    : 'not held: no better than the bar in use on coined videos or junk';
  return { proposed, live, learned: cand, of, lost, held, why };
}

export interface ShortVideoPart {
  readonly setSize: number;
  readonly added: number;
  readonly stored: boolean;
  readonly refetched: { readonly asked: number; readonly gone: number; readonly usd: number } | null;
  readonly learned: Learned;
  readonly bar: BarGate;
  readonly table: SideBySide;
  readonly gap: Gap | null;
  readonly gapText: string;
  readonly lines: readonly string[];
}

/** Steps 1–4 of the header; `record` writes step 5. Never throws for a missing 0085. */
export async function shortVideoPart(db: Db, opts: { readonly env: Record<string, string | undefined>; readonly paid: boolean; readonly days: number; readonly changing: readonly string[] }, p: Policy = DEFAULT_POLICY): Promise<ShortVideoPart> {
  const sv = p.learning.shortVideo;
  let { rows, added, stored } = await refreshSet(db, new Date(), p);
  let refetched: ShortVideoPart['refetched'] = null;
  if (sv.refetchOn && opts.paid && (opts.env['SCRAPECREATORS_API_KEY'] ?? '') !== '') {
    const shared = await openSharedMeter(sv.refetchPerRun * SC_USD_PER_VIDEO + 0.001, opts.env, 'learning');
    try {
      const got = await refetch(rows, sv.refetchPerRun, shared.meter, opts.env['SCRAPECREATORS_API_KEY'] ?? '');
      refetched = { asked: got.asked, gone: got.gone, usd: got.usd };
    } finally {
      await shared.close();
    }
    if ((refetched?.asked ?? 0) > 0) ({ rows, added, stored } = await refreshSet(db, new Date(), p));
  }
  const junkRows = await db.query<{ item_id: string; posted_at: Date | null }>(
    `select distinct f.item_id, i.posted_at from internal.owner_feedback f join public.item i on i.item_id = f.item_id
      where f.subject_kind = 'post' and f.verdict = 'not' and f.item_id like 'tiktok:%'`);
  const missedIds = new Set((await db.query<{ item_id: string }>(`select item_id from internal.missed_post where source = 'tiktok' and item_id is not null`)).map((r) => r.item_id));
  const readings = await readingsOf(db, [...rows.map((r) => r.itemId), ...junkRows.map((j) => j.item_id)]);
  const learned = learn(rows, readings, p);
  const bar = gateBar(rows, junkRows.map((j) => ({ itemId: j.item_id, postedMs: j.posted_at?.getTime() ?? null })), missedIds, readings, learned, p);
  const table = await sideBySide(db, opts.days, p, { withSet: false });
  const full: SideBySide = { ...table, set: learned };
  const g = gaps(full)[0] ?? null;
  const changing = [
    ...opts.changing,
    added > 0 ? `${added} coined videos added to the training set` : null,
    bar.held && bar.proposed !== null ? `speed bar proposed: ${bar.proposed.earlyReach} in 2 h or ${bar.proposed.fastReachPerMinute}/min (owner to set Policy.rising.shortVideoSpeedBar)` : null,
  ].filter((x): x is string => x !== null);
  const gapText = g === null ? 'no number both sides can count yet'
    : `${g.metric}: TikTok ${g.tiktok} against X ${g.x}${Number.isFinite(g.times) ? ` (${g.times.toFixed(1)}x)` : ''}. What moves it: ${g.lever}.${changing.length === 0 ? '' : ` This re-tune: ${changing.join('; ')}.`}`;
  return { setSize: rows.length, added, stored, refetched, learned, bar, table: full, gap: g, gapText, lines: sideBySideLines(full, p) };
}

/** Step 5. False before 0085. */
export async function recordShortVideoPart(db: Db, slot: Date, part: ShortVideoPart, judge: Record<string, unknown> | null): Promise<boolean> {
  const l = part.learned;
  return new PgCoinedVideoRepo(db).recordTuning({
    slot, ranAt: new Date(), setSize: part.setSize,
    learned: { added: part.added, withWords: l.withWords, bySource: l.bySource, byFetch: l.byFetch, bar: { at: l.bar.at, earlyRead: l.bar.earlyRead, proposed: l.bar.proposed, why: l.bar.why }, tags: l.tags, sounds: l.sounds, creators: l.creators.length, kinds: l.kinds, naming: l.naming, refetched: part.refetched },
    gate: { bar: part.bar, judge },
    held: part.bar.proposed === null && judge === null ? null : part.bar.held || judge?.['held'] === true,
    why: [part.bar.why, judge === null ? null : String(judge['why'] ?? '')].filter((x) => x !== null && x !== '').join('; '),
    gap: part.gapText,
  });
}
