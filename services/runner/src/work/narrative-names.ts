/**
 * THE NARRATIVE-NAME SEARCH (`feed.narrativeNames`): each open narrative on the board searched on
 * the text source by its name, forward from its last search, at a like floor, the posts credited to
 * the 'narrative_name' lane (0097) so they are judged and may reach For You.
 *
 * Why it exists: two of the owner's missed posts (#16, #29 of the 2026-10-17 list) named a narrative
 * that was live on the board when they went up, and no lane asked for that name. The story-name
 * backfill (work/backfill.ts) does search a name, but backwards from a story's first post and once,
 * and its posts are judged and never shown; this asks forwards, every hour, for the feed.
 *
 * ★ WHICH NAME (`chooseName`, pure). The board's titles are written for a person ("Tesla Roadster
 * Launched Into Flight") and the judge's names are coin tickers ("FLYINGCAR"); neither is what
 * people type. So a name is a phrase of 1 to `maxWords` words taken from the title or the judged
 * names that occurs word for word in at least `minMemberPosts` of the narrative's own posts — the
 * posts prove people write it. A phrase must have a word outside `commonWords`; a single word must
 * be outside it and at least `minWordLetters` letters. A phrase beats a single word ("tesla
 * roadster" before "roadster"), then more posts beat fewer. No name: the narrative is not searched,
 * because a generic word at this floor is an hour of everything about it, judged at our cost.
 *
 * ★ FORWARD ONLY. Each ask starts where the narrative's last one began (`sinceMs`), or one `everyMs`
 * back on its first, kept in the process: a restart searches the last hour again, never a gap
 * longer than the time it was down, and never the narrative's whole past (that is the backfill's).
 *
 * ★ ONE ASK ACROSS EVERY LANGUAGE (the owner, 2026-10-18). A name is asked with no language filter
 * (`langs: []`), not in `feed.langs`. Since 16 Oct the supplier answers an OR of languages with the
 * last one only, so a filtered ask is split into one search per language (work/languages.ts) — five
 * asks a name, five times the requests under the same $0.35 day. A name is already narrow, and a
 * post that carries it is wanted in any language, so one unfiltered ask finds them all for a fifth
 * of the price. What breaks if changed carelessly: putting `feed.langs` back here quintuples this
 * lane's requests and spends its cap in a fifth of the day.
 *
 * What breaks if changed carelessly: moving the clock forward before an ask that failed would skip
 * that hour for good; it moves only on an ask that answered.
 */

import type { Author, Item, Millis } from '@insidor/contracts';
import type { Meter } from '@insidor/contracts/ports/meter.ts';
import type { DiscoveryQuery, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import type { NarrativePostRow, StoredNarrative } from '@insidor/store';

import { errorText, type Logger } from '../log.ts';
import type { FoundLane } from './arrivals.ts';
import type { LaneLedger } from './lane-ledger.ts';
import { laneSearch, type LaneAskEnd } from './lane-search.ts';

type NamePolicy = Policy['feed']['narrativeNames'];

/** Words as a search engine matches them: runs of letters and digits, lower-cased. */
export function words(text: string): readonly string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * A phrase that could name a narrative, by its words: it does not end on a common word ("dougy
 * the"), and has at least one word that is not common ("tesla roadster", "the hi"). A single word
 * only when the judge named a post by it (`named`): a title's single words are English ("police",
 * "planet"); a judged name is a coin's ("vaquita", "glorp").
 */
function acceptable(phrase: readonly string[], named: boolean, p: NamePolicy, common: ReadonlySet<string>): boolean {
  if (phrase.length === 0 || phrase.length > p.maxWords) return false;
  const last = phrase[phrase.length - 1]!;
  if (phrase.length === 1) return named && !common.has(last) && [...last].length >= p.minWordLetters && !/^\p{N}+$/u.test(last);
  return !common.has(last) && phrase.some((w) => !common.has(w));
}

/** Every span of 1..maxWords words of a text. */
function spans(ws: readonly string[], max: number): readonly (readonly string[])[] {
  const out: string[][] = [];
  for (let i = 0; i < ws.length; i += 1) for (let n = 1; n <= max && i + n <= ws.length; n += 1) out.push(ws.slice(i, i + n));
  return out;
}

export interface ChosenName {
  readonly name: string;
  /** How many of the narrative's posts read here carry it word for word. */
  readonly posts: number;
}

/**
 * The name a narrative is searched by, or null when none is safe (see the header). Pure: the title,
 * the judged names and the texts of the narrative's posts in; one phrase out.
 */
export function chooseName(title: string | null, posts: readonly Pick<NarrativePostRow, 'body' | 'proposedName' | 'alternateNames'>[], p: NamePolicy): ChosenName | null {
  const common = new Set(p.commonWords.map((w) => w.toLowerCase()));
  const candidates = new Map<string, readonly string[]>();
  const offer = (phrase: readonly string[], named: boolean) => {
    if (acceptable(phrase, named, p, common)) candidates.set(phrase.join(' '), phrase);
  };
  for (const span of spans(words(title ?? ''), p.maxWords)) offer(span, false);
  for (const post of posts) for (const n of [post.proposedName ?? '', ...post.alternateNames]) offer(words(n), true);
  if (candidates.size === 0) return null;

  const texts = posts.map((post) => ` ${words(post.body).join(' ')} `);
  let best: { name: string; size: number; posts: number } | null = null;
  for (const [name, phrase] of candidates) {
    const needle = ` ${name} `;
    const count = texts.filter((t) => t.includes(needle)).length;
    if (count < p.minMemberPosts) continue;
    const size = Math.min(phrase.length, 2); // a phrase beats a single word; among phrases, posts decide
    if (best === null || size > best.size || (size === best.size && (count > best.posts || (count === best.posts && name.length > best.name.length)))) {
      best = { name, size, posts: count };
    }
  }
  return best === null ? null : { name: best.name, posts: best.posts };
}

/** Where each narrative's last answered search began, in this process. */
export interface NarrativeNameClock {
  readonly since: Map<string, number>;
  /** When each narrative was last asked, so a pass cut short starts with the ones asked longest ago. */
  readonly asked: Map<string, number>;
}

export const narrativeNameClock = (): NarrativeNameClock => ({ since: new Map(), asked: new Map() });

export interface NarrativeNamesDeps {
  readonly sources: () => readonly PlatformAdapter[];
  readonly narratives: {
    live(sinceMs: number): Promise<readonly StoredNarrative[]>;
    standingRows(itemIds: readonly string[]): Promise<readonly NarrativePostRow[]>;
  };
  readonly store: (items: readonly Item[], authors: readonly Author[], lane?: FoundLane | null) => Promise<number>;
  readonly uncredited: (itemIds: readonly string[]) => Promise<number>;
  readonly ledger: LaneLedger;
  readonly meter: Meter;
  readonly mode: 'dry' | 'live';
  readonly policy: Policy;
  readonly log: Logger;
  readonly now: () => Millis;
}

export interface NarrativeNamesResult {
  /** Open narratives on the board. */
  readonly narratives: number;
  /** Of those, the ones a safe name was found for. */
  readonly named: number;
  readonly asked: number;
  readonly returned: number;
  readonly fresh: number;
  readonly usd: number;
  /** Why the pass stopped early, when it did. */
  readonly stopped: LaneAskEnd | null;
}

const NONE: NarrativeNamesResult = { narratives: 0, named: 0, asked: 0, returned: 0, fresh: 0, usd: 0, stopped: null };

/** The ends that stop the whole pass, not just one narrative's ask. */
const PASS_ENDS: ReadonlySet<LaneAskEnd> = new Set(['capped', 'unreadable', 'budget', 'deadline', 'dry']);

export async function narrativeNamesPass(deps: NarrativeNamesDeps, clock: NarrativeNameClock): Promise<NarrativeNamesResult> {
  const p = deps.policy.feed.narrativeNames;
  if (!p.on) return NONE;
  const source = deps.sources().find((a) => a.capabilities.discovery.includes('keyword') && a.capabilities.narrowedSearch?.filter === true);
  if (source === undefined) {
    deps.log.info('narrative-name search skipped: no source takes a filtered keyword search');
    return NONE;
  }
  const started = deps.now();
  const deadline = (started + p.passDeadlineMs) as Millis;

  /* Live ones only (shown, a post inside `narrative.dead.afterMs`): a dead story is not searched forward. */
  const open = (await deps.narratives.live(started - deps.policy.narrative.dead.afterMs)).filter((n) => n.shown);
  const named: { readonly id: string; readonly name: ChosenName }[] = [];
  for (const n of open) {
    const members = [...n.members].sort().slice(-p.membersRead);
    let rows: readonly NarrativePostRow[];
    try {
      rows = await deps.narratives.standingRows(members);
    } catch (e) {
      deps.log.warn("a narrative's posts could not be read; it is not searched this pass", { narrative: n.id, err: errorText(e) });
      continue;
    }
    const name = chooseName(n.title, rows, p);
    if (name !== null) named.push({ id: n.id, name });
  }
  named.sort((a, b) => (clock.asked.get(a.id) ?? 0) - (clock.asked.get(b.id) ?? 0));

  let asked = 0;
  let returned = 0;
  let fresh = 0;
  let usd = 0;
  let stopped: LaneAskEnd | null = null;
  for (const { id, name } of named.slice(0, p.maxNarratives)) {
    const now = deps.now();
    const sinceMs = clock.since.get(id) ?? now - p.everyMs;
    const query: DiscoveryQuery = {
      mode: 'keyword',
      term: name.name,
      sinceMs: sinceMs as Millis,
      untilMs: null,
      limit: deps.policy.feed.pageLimit,
      cursor: null,
      /* ★ No language filter: one ask across every language (see the header). */
      filter: { minApproval: Math.round(p.minApproval), mediaOnly: false, langs: [], excludeRebroadcasts: true },
    };
    const r = await laneSearch(deps, { adapter: source, query, lane: 'narrative_name', cap: p.cap, maxPages: p.maxPagesPerAsk, deadline });
    usd += r.usd;
    returned += r.returned;
    fresh += r.fresh;
    if (r.pages > 0) {
      asked += 1;
      clock.asked.set(id, now);
      /* Forward from this ask's start only when it answered; a failed or cut ask keeps its hour. */
      if (r.end === 'done' || r.end === 'pages') clock.since.set(id, now);
    }
    if (r.end === 'failed') deps.log.warn('a narrative-name search failed; its hour is asked again next pass', { narrative: id, name: name.name, err: r.error });
    if (PASS_ENDS.has(r.end)) {
      stopped = r.end;
      break;
    }
  }
  const result: NarrativeNamesResult = { narratives: open.length, named: named.length, asked, returned, fresh, usd, stopped };
  deps.log.info('narrative-name search pass', { ...result, ms: deps.now() - started });
  return result;
}
