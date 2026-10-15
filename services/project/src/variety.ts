/**
 * FOR YOU'S VARIETY: no one topic fills the screen (the owner, 2026-10-15: "the feed is majority
 * gta 6 i want to see more new viral posts").
 *
 * The rule: among any `rising.varietyWindow` consecutive For You cards, at most
 * `rising.varietyPerWindow` are about the same topic. Which posts of a big topic keep a place is
 * decided strongest first (most views; a post whose views we have not read comes last), and each
 * keeps its own newest-first place: the order is never changed, only who is in it. A post that
 * does not fit leaves the live list and nothing else: it stays on Popular if it clears Popular's
 * bar, on its story's page, and — if For You ever showed it — on the scroll's older pages
 * (feed-members.ts). So nothing is hidden, a big topic is just not most of the first screen.
 *
 * A topic is joined by any of three facts, transitively: the same promoted story; the same name
 * (the judge's proposed name, else the namer's top guess), normalised so GTA6, GTA VI and gta-6
 * are one; or meaning vectors (internal.post_embedding) at least `rising.varietySameMeaning`
 * alike. Most launch-day posts were in no story, so a story alone would have caught none of them.
 *
 * Its own file because rising.ts decides who MAY be on For You and this decides how much of it one
 * topic may take; the sorting stays there. What breaks if changed carelessly: reordering here would
 * break the newest-first rule pull-to-refresh relies on; a vector bar much under the measured one
 * chains unrelated posts into one topic (single linkage), and they would then crowd each other out.
 * Nothing here is ever written to the wire: a topic is the system's reasoning.
 */

import type { Db } from '@insidor/store';

/** One For You candidate as the rule sees it, already in newest-first order. */
export interface VarietyCard {
  readonly id: string;
  /** Views, the strength a big topic's places go by; null when not read. */
  readonly views: number | null;
  /** When it went up, the tie-break for equal strength: newer first. */
  readonly at: number;
}

export interface TopicFacts {
  readonly storyId: string | null;
  /** The judge's proposed name, else the namer's top guess; null when neither. */
  readonly name: string | null;
}

const ROMAN: Readonly<Record<string, string>> = { II: '2', III: '3', IV: '4', V: '5', VI: '6', VII: '7', VIII: '8', IX: '9', X: '10' };

/**
 * A name as a topic key: letters and digits only, upper case, and a trailing roman numeral read as
 * a number when a word of two or more letters stands before it as its own word or a known tag
 * ("GTA VI", "GTAVI" → "GTA6"). Null for an empty name.
 */
export function topicName(name: string | null): string | null {
  if (name === null) return null;
  const spaced = name.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').trim();
  if (spaced === '') return null;
  const m = /^(.*?[A-Z]{2,})\s*(II|III|IV|VI|VII|VIII|IX)$/.exec(spaced) ?? /^(.*[A-Z]{2,})\s+(V|X)$/.exec(spaced);
  const joined = m === null ? spaced : `${m[1]}${ROMAN[m[2] as string]}`;
  const key = joined.replace(/\s+/g, '');
  return key === '' ? null : key;
}

/**
 * Each post's topic id: posts linked by a shared story, a shared name, or a pair in `alike`
 * (meaning vectors over the bar) are one topic. A post linked to nothing is its own topic.
 */
export function topicsOf(ids: readonly string[], facts: ReadonlyMap<string, TopicFacts>, alike: readonly (readonly [string, string])[]): ReadonlyMap<string, string> {
  const parent = new Map(ids.map((id) => [id, id] as const));
  const find = (id: string): string => {
    let root = id;
    while (parent.get(root) !== root) root = parent.get(root) ?? root;
    parent.set(id, root);
    return root;
  };
  const join = (a: string, b: string): void => {
    if (!parent.has(a) || !parent.has(b)) return;
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  };
  const firstBy = new Map<string, string>();
  for (const id of ids) {
    const f = facts.get(id);
    const name = topicName(f?.name ?? null);
    const keys = [...(f?.storyId == null ? [] : [`story:${f.storyId}`]), ...(name === null ? [] : [`name:${name}`])];
    for (const key of keys) {
      const first = firstBy.get(key);
      if (first === undefined) firstBy.set(key, id);
      else join(first, id);
    }
  }
  for (const [a, b] of alike) join(a, b);
  return new Map(ids.map((id) => [id, find(id)] as const));
}

/**
 * The cards that keep a place, in their given order: strongest first, a card joins when its topic
 * still has at most `perWindow` cards in every `window` consecutive cards of the list with it in.
 * A card of another topic only spreads a topic's cards apart, so admitting by strength never
 * breaks a place already given; a pass that admits nothing new ends it.
 */
export function withVariety<T extends VarietyCard>(cards: readonly T[], topicOf: ReadonlyMap<string, string>, perWindow: number, window: number): T[] {
  const position = new Map(cards.map((c, i) => [c.id, i] as const));
  const topic = (c: T): string => topicOf.get(c.id) ?? c.id;
  const strength = [...cards].sort((a, b) => {
    if (a.views === null || b.views === null) return a.views === null ? (b.views === null ? b.at - a.at : 1) : -1;
    return b.views - a.views || b.at - a.at;
  });
  const kept = new Set<string>();
  const fits = (card: T): boolean => {
    const list = cards.filter((c) => kept.has(c.id) || c.id === card.id);
    const at = list.flatMap((c, i) => (topic(c) === topic(card) ? [i] : []));
    for (let i = 0; i + perWindow < at.length; i += 1) if ((at[i + perWindow] as number) - (at[i] as number) < window) return false;
    return true;
  };
  let added = true;
  while (added) {
    added = false;
    for (const card of strength) {
      if (kept.has(card.id) || !fits(card)) continue;
      kept.add(card.id);
      added = true;
    }
  }
  return cards.filter((c) => kept.has(c.id)).sort((a, b) => (position.get(a.id) as number) - (position.get(b.id) as number));
}

/**
 * The names and alike pairs for the posts on offer. The namer's guess and the vectors are read in
 * savepoints: a database without them (0074, 0076) gives no pairs and no guesses, and the rule then
 * goes by story and the judge's name alone, never failing the frame.
 */
export async function loadTopicLinks(
  db: Db,
  ids: readonly string[],
  sameMeaning: number,
): Promise<{ readonly guesses: ReadonlyMap<string, string>; readonly alike: readonly (readonly [string, string])[] }> {
  if (ids.length < 2) return { guesses: new Map(), alike: [] };
  const guarded = async <R>(name: string, sql: string, params: unknown[]): Promise<R[]> => {
    let saved = true;
    try {
      await db.query(`savepoint ${name}`);
    } catch {
      saved = false;
    }
    try {
      const rows = await db.query<R & Record<string, unknown>>(sql, params);
      if (saved) await db.query(`release savepoint ${name}`);
      return rows;
    } catch (e) {
      if (saved) await db.query(`rollback to savepoint ${name}`);
      console.warn(`variety: ${name} failed: ${e instanceof Error ? e.message.slice(0, 200) : 'unknown'}`);
      return [];
    }
  };
  const guessRows = await guarded<{ item_id: string; name: string }>(
    'variety_guess',
    `select item_id, name from internal.name_guess where item_id = any($1::text[]) and rank = 1`,
    [[...ids]],
  );
  const pairRows = await guarded<{ a: string; b: string }>(
    'variety_alike',
    `select x.item_id as a, y.item_id as b
       from internal.post_embedding x
       join internal.post_embedding y on y.space = x.space and y.item_id > x.item_id
      where x.item_id = any($1::text[]) and y.item_id = any($1::text[])
        and 1 - (x.embedding <=> y.embedding) >= $2`,
    [[...ids], sameMeaning],
  );
  return { guesses: new Map(guessRows.map((r) => [r.item_id, r.name] as const)), alike: pairRows.map((r) => [r.a, r.b] as const) };
}
