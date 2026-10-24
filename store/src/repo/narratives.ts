/**
 * Narratives (0093): the reads the grouping needs, its one write, and the reads the projector, the
 * owner's routes and the re-tune make of what it wrote.
 *
 * Its own repository, apart from stories.ts, because a narrative is not a GROUP story (0093 says
 * why): it is grouped from the posts the judge passed, on their vectors, so its reads are of posts
 * and vectors, not carriers, and its write is what a pass adds to the narratives already made.
 *
 * ★ ONE DEFINITION OF A POST'S STANDING, READ ONE WAY. `standingRows` is the newest answer to the
 * post question (never a kind answer: its yes/no is not the judge's verdict on the post), the kind
 * label only when the newest answer of all is a kind answer, the owner's newest call, and the
 * author's own coin talk from the post's newest split crypto read — the same columns the For You
 * feed reads (services/project rising.ts). The runner groups on them and the projector re-checks
 * them each frame, so a post the owner hides leaves its narrative within a minute.
 *
 * ★ THE EARLY POSTS (0100) are written with the narrative's own and marked: every reader reads them
 * as its posts, and only the runner tells them apart (`StoredNarrative.early`), so the regroup keeps
 * ids and says "changed" by the posts it made. Before 0100 none is written, never one unmarked.
 *
 * ★ BEFORE 0093 NOTHING FAILS: every read answers empty on a missing table or column, the grouping
 * pass writes nothing, and the board shows no narratives rather than the old stories.
 *
 * ★ PERMANENT SINCE 2026-10-18 (0106): `save` only adds — a narrative's new posts, new narratives,
 * the owner's merges (its posts moved to the narrative he chose), his splits (the posts he picked
 * moved to a new narrative) and his removed posts. Nothing is
 * rewritten whole and no narrative is retired because a pass did not see it. A narrative's post
 * count, newest post and oldest post are counted here from its stored posts after each write, so
 * the caller never has to hold every post of a narrative it grew by one.
 *
 * What breaks if changed carelessly: `save` must run inside the caller's transaction: a merge moves
 * posts and marks the narrative merged in two statements, and half of it would leave a narrative
 * with no posts that is still open.
 */

import type { Db } from '../client.ts';
import { heldPostVectors } from './post-vectors.ts';

const UNDEFINED_TABLE = '42P01';
const UNDEFINED_COLUMN = '42703';
const notMigrated = (e: unknown): boolean => {
  const code = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined;
  return code === UNDEFINED_TABLE || code === UNDEFINED_COLUMN;
};
const orEmpty = async <T>(read: () => Promise<T>, empty: T): Promise<T> => {
  try {
    return await read();
  } catch (e) {
    if (notMigrated(e)) return empty;
    throw e;
  }
};
const toMs = (v: Date | string | null): number | null => (v === null ? null : v instanceof Date ? v.getTime() : Date.parse(v));

/**
 * ★ PAGES IN TURNS: of `limit` places, at most half to pages never written and the rest to the
 * pages written longest ago; a side with fewer than its share gives its places to the other. Never
 * one side always: the never-written cannot hold every place, and a page written long ago always
 * gets its turn.
 */
export function fairTurns<T>(never: readonly T[], written: readonly T[], limit: number): readonly T[] {
  const half = Math.ceil(limit / 2);
  const fresh = never.slice(0, Math.max(half, limit - written.length));
  return [...fresh, ...written.slice(0, limit - fresh.length)];
}

/** What decides one post's standing, and what it can be matched on. */
export interface NarrativePostRow {
  readonly itemId: string;
  readonly source: string;
  readonly body: string;
  readonly media: unknown;
  /** When it went up, or when we first saw it when the source gave no time. */
  readonly atMs: number;
  readonly coinable: boolean | null;
  readonly confidence: number | null;
  readonly lookedAt: 'text' | 'picture' | 'videoFrame' | null;
  readonly proposedName: string | null;
  readonly alternateNames: readonly string[];
  readonly judgeId: string | null;
  readonly kindLabel: string | null;
  readonly ownerCall: 'meme' | 'not' | null;
  /** The author's own replies named a coin (0064 `_own`); false when not read. */
  readonly ownTalk: boolean;
  /** Who posted it (public.item.author_key): a narrative needs `narrative.minAccounts` of them. Absent from an older reader. */
  readonly authorKey?: string | null;
}

interface PostRow {
  item_id: string;
  source: string;
  body: string;
  media: unknown;
  at: Date | string;
  coinable: boolean | null;
  confidence: number | string | null;
  looked_at: 'text' | 'picture' | 'videoFrame' | null;
  proposed_name: string | null;
  alternate_names: unknown;
  judge_id: string | null;
  kind_label: string | null;
  owner_call: 'meme' | 'not' | null;
  own_talk: boolean | null;
  author_key?: string | null;
}

const STANDING_COLUMNS = `
            i.author_key,
            j.coinable, j.confidence, j.looked_at, j.proposed_name, j.alternate_names, j.judge_id,
            k.kind_label, oc.verdict as owner_call,
            coalesce((select coalesce(ca.cashtags->'_own'->'cashtags', '{}'::jsonb) <> '{}'::jsonb
                              or coalesce((ca.cashtags->'_own'->>'addresses')::int, 0) > 0
                              or coalesce((ca.cashtags->'_own'->>'ca')::int, 0) > 0
                        from internal.crypto_attention ca
                       where ca.item_id = i.item_id and ca.cashtags ? '_own'
                       order by ca.read_at desc limit 1), false) as own_talk`;

const STANDING_JOINS = `
       left join lateral (
              select pj.coinable, pj.confidence, pj.looked_at, pj.proposed_name, pj.alternate_names, pj.judge_id
                from internal.post_judgement pj
               where pj.item_id = i.item_id and pj.prompt_id not like 'post-kind%'
               order by pj.judged_at desc, pj.id desc
               limit 1
            ) j on true
       left join lateral (
              select case when pj.prompt_id like 'post-kind%' then pj.proposed_name end as kind_label
                from internal.post_judgement pj
               where pj.item_id = i.item_id
               order by pj.judged_at desc, pj.id desc
               limit 1
            ) k on true
       left join lateral (
              select ofb.verdict
                from internal.owner_feedback ofb
               where ofb.subject_kind = 'post' and ofb.item_id = i.item_id
               order by ofb.created_at desc, ofb.id desc
               limit 1
            ) oc on true`;

const namesOf = (v: unknown): readonly string[] =>
  Array.isArray(v) ? v.flatMap((x) => (typeof x === 'string' ? [x] : typeof x === 'object' && x !== null && typeof (x as { name?: unknown }).name === 'string' ? [(x as { name: string }).name] : [])) : [];

const toPost = (r: PostRow): NarrativePostRow => ({
  itemId: r.item_id,
  authorKey: r.author_key ?? null,
  source: r.source,
  body: r.body,
  media: r.media,
  atMs: toMs(r.at) ?? 0,
  coinable: r.coinable,
  confidence: r.confidence === null ? null : Number(r.confidence),
  lookedAt: r.looked_at,
  proposedName: r.proposed_name,
  alternateNames: namesOf(r.alternate_names),
  judgeId: r.judge_id,
  kindLabel: r.kind_label,
  ownerCall: r.owner_call,
  ownTalk: r.own_talk === true,
});

/** An open narrative as the last pass wrote it. */
export interface StoredNarrative {
  readonly id: string;
  readonly members: readonly string[];
  readonly anchor: string;
  readonly shown: boolean;
  readonly firstShownAtMs: number | null;
  readonly postsChangedAtMs: number;
  readonly title: string | null;
  readonly titlePosts: number | null;
  /** Who wrote the title: the titler's model, or `OWNER_TITLE_MODEL` when the owner typed it (0130). Absent from an older reader. */
  readonly titleModel?: string | null;
  /**
   * The countries of the online meme war it is (0130 `fight`): two or more, alphabetical; empty when
   * the titler said it is not one; null when never asked (and before 0130).
   */
  readonly fight?: readonly string[] | null;
  /** Who answered `fight`: the titler's model, the owner, or `FIGHT_SEED_MODEL` for a seed still waiting for the titler. Absent from an older reader. */
  readonly fightModel?: string | null;
  /** Its newest post's time as last counted (narrative.newest_post_at); absent from an older reader. */
  readonly newestPostAtMs?: number | null;
  /** When tools/narrative-rebuild.ts rebuilt it from stored posts (0106); null or absent: the runner made it. */
  readonly restoredAtMs?: number | null;
  /** Of `members`, the early posts (0100): matched back in by the runner, never made by the regroup. Empty before 0100. */
  readonly early?: readonly string[];
}

/** What one grouping pass writes: only what it adds, and the owner's merges and removals. */
export interface NarrativePass {
  readonly narratives: readonly {
    readonly id: string;
    /** All its grouped posts after this pass (what a reader of the pass, such as the times check, lists). */
    readonly members: readonly string[];
    readonly anchor: string;
    readonly newestPostAtMs: number | null;
    readonly shown: boolean;
    readonly changed: boolean;
    /** Of `members`, the ones new to it this pass: the rows written. Absent: every one of `members` (a post already in a narrative stays where it is). */
    readonly added?: readonly string[];
    /** Stored posts the regroup could not see, matched back in (0100), new to it this pass; not in `members`. Dropped before 0100. */
    readonly early?: readonly string[];
    /** When it was first shown, for a narrative the rebuild made (tools/narrative-rebuild.ts); absent: now, if shown. */
    readonly firstShownAtMs?: number | null;
    /** Rebuilt from stored posts (0106 `restored_at`). */
    readonly restored?: boolean;
  }[];
  /**
   * The merges: `id` moves all its posts to `into` and is kept as merged. `into` null is never
   * written (nothing is retired). `by` is who merged it (0108 `merged_by`): the owner's "Merge
   * with…" (the default), the regroup's same-subject rule (core group/narrative-same.ts), or its
   * same-story quote rule (core group/narrative-origin.ts, 0126) — not written before 0126.
   */
  readonly retired: readonly { readonly id: string; readonly into: string | null; readonly by?: 'owner' | 'same_subject' | 'same_story' }[];
  /** The owner's "Remove this post": the post leaves that narrative. */
  readonly removed?: readonly { readonly narrativeId: string; readonly itemId: string }[];
  /**
   * The owner's "Split": `members` still in `from` move to `into`, which is one of `narratives`
   * (written there as a new narrative with no rows of its own). One whose posts had all left `from`
   * is kept as `gone`, so its id stays given out and the split is not tried again.
   */
  readonly split?: readonly { readonly from: string; readonly into: string; readonly members: readonly string[] }[];
  /**
   * The owner's "Add a post" (0130; core group/narrative-keep.ts `ownerAdds`): `itemId` moves into
   * `into` from whatever narrative holds it, or joins it from none. Only a stored post (public.item)
   * and only into an open narrative: a post still queued for the runner to read waits for a later pass.
   */
  readonly added?: readonly { readonly itemId: string; readonly into: string }[];
  /**
   * The meme-war seeds (core group/fight-native.ts, policy.v157): new narratives of `narratives`
   * made from posts naming another country in their own language, written with their pair and
   * `fight_model` `FIGHT_SEED_MODEL`, kept off the board until the titler names both countries.
   * Only where `fight` is still null: never over the titler's or the owner's answer.
   */
  readonly fights?: readonly { readonly id: string; readonly countries: readonly string[] }[];
}

/** A stored post the meme-war rule reads (`fightPosts`): its words, language, account and views as last read. */
export interface FightPostRow {
  readonly itemId: string;
  readonly authorKey: string | null;
  readonly lang: string | null;
  readonly body: string;
  readonly atMs: number;
  readonly reach: number | null;
}

/** A narrative's state, for the owner's merges and the ids already given out. */
export interface NarrativeStateRow {
  readonly id: string;
  readonly state: 'open' | 'merged' | 'gone';
  readonly mergedInto: string | null;
}

/** One stored owner call on a narrative, as core `foldNarrativeCalls` reads it. */
export interface NarrativeCallRecord {
  readonly id: number;
  readonly atMs: number;
  readonly narrativeId: string;
  readonly verdict: 'not_narrative' | 'merge' | 'remove_post' | 'split' | 'right' | 'wrong' | 'cleared' | 'rename' | 'add_post';
  readonly otherId: string | null;
  readonly coin: string | null;
  readonly members: readonly string[];
  readonly otherMembers: readonly string[];
}

/** `title_model` on a title the owner typed (0130; services/social owner-narrative.ts writes it). */
export const OWNER_TITLE_MODEL = 'owner';

/**
 * `fight_model` on a meme-war seed (policy.v157 `narrative.fight.native`) the titler has not answered
 * yet: the pair is the rule's, the narrative is not shown. The titler's answer replaces it.
 */
export const FIGHT_SEED_MODEL = 'native-names';

export class PgNarrativeRepo {
  readonly #db: Db;
  #migrated: Promise<boolean> | null = null;
  #early: Promise<boolean> | null = null;
  constructor(db: Db) {
    this.#db = db;
  }

  /**
   * Whether 0093 is applied, asked once and never caught: inside a caller's transaction (the
   * projector's frame, the dry run) a failed statement aborts everything after it.
   */
  async migrated(): Promise<boolean> {
    this.#migrated ??= this.#db
      .query<{ ok: boolean }>(
        `select to_regclass('internal.narrative') is not null
            and exists (select 1 from information_schema.columns
                         where table_schema = 'internal' and table_name = 'owner_feedback' and column_name = 'members') as ok`,
      )
      .then((r) => r[0]?.ok === true);
    return this.#migrated;
  }

  /** Whether 0100's early column is there; asked once, never caught (as `migrated`). */
  async earlyMigrated(): Promise<boolean> {
    this.#early ??= this.#db
      .query<{ ok: boolean }>(
        `select exists (select 1 from information_schema.columns
                         where table_schema = 'internal' and table_name = 'narrative_member' and column_name = 'early') as ok`,
      )
      .then((r) => r[0]?.ok === true);
    return this.#early;
  }

  /**
   * The posts that went up since `sinceMs` and that the judge said yes to (or the owner called a
   * meme), newest first, with their standing: the feed's posts (internal.item_found_by, the posts
   * For You is made from), and with `searched` also every other post the judge answered — the
   * posts a story's name search brought in. The judge's bar, the kinds and the owner's "Not a meme"
   * are applied by the caller (core `narrativeStanding`), per answer's own cutoff.
   */
  async candidates(sinceMs: number, searched = false): Promise<readonly NarrativePostRow[]> {
    const from = searched
      ? `(select pj.item_id from internal.post_judgement pj
           where pj.judged_at >= $1 and pj.prompt_id not like 'post-kind%' and pj.coinable
          union
          select item_id from internal.item_found_by) f`
      : 'internal.item_found_by f';
    const rows = await this.#db.query<PostRow>(
      `select i.item_id, i.source, i.body, i.media, coalesce(i.posted_at, i.first_seen_at) as at, ${STANDING_COLUMNS}
         from (select distinct f.item_id from ${from}) f
         join public.item i on i.item_id = f.item_id
         ${STANDING_JOINS}
        where i.origin = 'observed'
          and coalesce(i.posted_at, i.first_seen_at) >= $1
          and (j.coinable or oc.verdict = 'meme')
        order by coalesce(i.posted_at, i.first_seen_at) desc, i.item_id`,
      [new Date(sinceMs).toISOString()],
    );
    return rows.map(toPost);
  }

  /**
   * ★ THE STORED POSTS FOR THE EARLY MATCH (0100): posts that went up in [`fromMs`, `toMs`) and that
   * the judge said yes to since `fromMs` (or the owner called a meme), with their standing, oldest
   * first, at most `limit`. Index-backed: the judged-time index (post_judgement_judged_idx) picks the
   * answers, the item key the posts — never a walk of every post or of every feed credit. With
   * `searched` false, feed posts only, as `candidates`.
   */
  async storedGood(fromMs: number, toMs: number, limit: number, searched = true): Promise<readonly NarrativePostRow[]> {
    const feedOnly = searched ? '' : 'and exists (select 1 from internal.item_found_by fb where fb.item_id = i.item_id)';
    const rows = await this.#db.query<PostRow>(
      `select i.item_id, i.source, i.body, i.media, coalesce(i.posted_at, i.first_seen_at) as at, ${STANDING_COLUMNS}
         from (select pj.item_id from internal.post_judgement pj
                where pj.judged_at >= $1 and pj.prompt_id not like 'post-kind%' and pj.coinable
               union
               select ofb.item_id from internal.owner_feedback ofb
                where ofb.subject_kind = 'post' and ofb.verdict = 'meme' and ofb.item_id is not null) f
         join public.item i on i.item_id = f.item_id
         ${STANDING_JOINS}
        where i.origin = 'observed'
          and coalesce(i.posted_at, i.first_seen_at) >= $1 and coalesce(i.posted_at, i.first_seen_at) < $2
          and (j.coinable or oc.verdict = 'meme')
          ${feedOnly}
        order by coalesce(i.posted_at, i.first_seen_at), i.item_id
        limit $3`,
      [new Date(fromMs).toISOString(), new Date(toMs).toISOString(), limit],
    );
    return rows.map(toPost);
  }

  /** The same standing columns for given posts: the projector's re-check of a narrative's posts. */
  async standingRows(itemIds: readonly string[]): Promise<readonly NarrativePostRow[]> {
    if (itemIds.length === 0) return [];
    const rows = await this.#db.query<PostRow>(
      `select i.item_id, i.source, i.body, i.media, coalesce(i.posted_at, i.first_seen_at) as at, ${STANDING_COLUMNS}
         from public.item i
         ${STANDING_JOINS}
        where i.item_id = any($1::text[])`,
      [[...itemIds]],
    );
    return rows.map(toPost);
  }

  /**
   * Unit vectors by post, in `space`, from the post table (`post_embedding`, words and picture) or
   * the picture table (`image_embedding`, the first picture held). Posts with none are absent.
   */
  async vectors(itemIds: readonly string[], space: string, kind: 'post' | 'picture'): Promise<ReadonlyMap<string, Float32Array>> {
    if (itemIds.length === 0) return new Map();
    /* The post table's vectors through the process's held copies (post-vectors.ts): read once per `embedded_at`. */
    if (kind === 'post') return orEmpty(() => heldPostVectors(this.#db, itemIds, space), new Map<string, Float32Array>());
    const sql = `select distinct on (subject_id) subject_id as item_id, embedding::text as v from internal.image_embedding
          where subject_kind = 'item' and subject_id = any($1::text[]) and space = $2 order by subject_id, uri`;
    const rows = await orEmpty(() => this.#db.query<{ item_id: string; v: string }>(sql, [[...itemIds], space]), []);
    return new Map(rows.map((r) => [r.item_id, Float32Array.from(JSON.parse(r.v) as number[])] as const));
  }

  /** Each post's view counts read since `sinceMs`, oldest first, and its newest count of all. */
  async reach(itemIds: readonly string[], sinceMs: number): Promise<{ readonly points: ReadonlyMap<string, readonly { atMs: number; reach: number }[]>; readonly latest: ReadonlyMap<string, number> }> {
    if (itemIds.length === 0) return { points: new Map(), latest: new Map() };
    const recent = await this.#db.query<{ item_id: string; captured_at: Date | string; value: number | string }>(
      `select item_id, captured_at, value from public.observation
        where item_id = any($1::text[]) and kind = 'reach' and value is not null and fidelity_kind <> 'absent' and captured_at >= $2
        order by item_id, captured_at`,
      [[...itemIds], new Date(sinceMs).toISOString()],
    );
    const latest = await this.#db.query<{ item_id: string; value: number | string }>(
      `select distinct on (item_id) item_id, value from public.observation
        where item_id = any($1::text[]) and kind = 'reach' and value is not null and fidelity_kind <> 'absent'
        order by item_id, captured_at desc`,
      [[...itemIds]],
    );
    const points = new Map<string, { atMs: number; reach: number }[]>();
    for (const r of recent) {
      const list = points.get(r.item_id) ?? [];
      list.push({ atMs: toMs(r.captured_at) ?? 0, reach: Number(r.value) });
      points.set(r.item_id, list);
    }
    return { points, latest: new Map(latest.map((r) => [r.item_id, Number(r.value)] as const)) };
  }

  /** Open narratives with their posts, as `where` (on `n`) and `tail` (order and limit) choose them. */
  async #narratives(where: string, params: readonly unknown[], tail = ''): Promise<readonly StoredNarrative[]> {
    if (!(await this.migrated())) return [];
    type Row = { narrative_id: string; anchor_item: string; shown: boolean; first_shown_at: Date | string | null; posts_changed_at: Date | string; title: string | null; title_posts: number | null; title_model: string | null; fight: string[] | null; fight_model: string | null; newest_post_at: Date | string | null; restored_at: Date | string | null; members: string[] | null; early: string[] | null };
    const early = (await this.earlyMigrated())
      ? '(select array_agg(m.item_id order by m.item_id) from internal.narrative_member m where m.narrative_id = n.narrative_id and m.early)'
      : 'null::text[]';
    const restored = (await this.#hasColumn('narrative', 'restored_at')) ? 'n.restored_at' : 'null::timestamptz';
    const withFight = await this.#hasColumn('narrative', 'fight');
    const fight = withFight ? 'n.fight' : 'null::text[]';
    const fightModel = withFight ? 'n.fight_model' : 'null::text';
    const rows = await orEmpty(() => this.#db.query<Row>(
      `select n.narrative_id, n.anchor_item, n.shown, n.first_shown_at, n.posts_changed_at, n.title, n.title_posts, n.title_model, ${fight} as fight, ${fightModel} as fight_model, n.newest_post_at, ${restored} as restored_at,
              (select array_agg(m.item_id order by m.item_id) from internal.narrative_member m where m.narrative_id = n.narrative_id) as members,
              ${early} as early
         from internal.narrative n
        where n.state = 'open' and (${where})
        ${tail}`,
      params,
    ), []);
    return rows.map((r) => ({
      id: r.narrative_id,
      members: r.members ?? [],
      anchor: r.anchor_item,
      shown: r.shown,
      firstShownAtMs: toMs(r.first_shown_at),
      postsChangedAtMs: toMs(r.posts_changed_at) ?? 0,
      title: r.title,
      titlePosts: r.title_posts,
      titleModel: r.title_model,
      fight: r.fight,
      fightModel: r.fight_model,
      newestPostAtMs: toMs(r.newest_post_at),
      restoredAtMs: toMs(r.restored_at),
      early: r.early ?? [],
    }));
  }

  /** Every open narrative with its posts. Grows with every narrative ever made: for tools, never a pass. */
  async open(): Promise<readonly StoredNarrative[]> {
    return this.#narratives('true', []);
  }

  /** These open narratives, with their posts. */
  async byIds(ids: readonly string[]): Promise<readonly StoredNarrative[]> {
    if (ids.length === 0) return [];
    return this.#narratives('n.narrative_id = any($1::text[])', [[...ids]]);
  }

  /**
   * ★ THE LIVE NARRATIVES: shown, with a post that went up since `sinceMs` — what the name searches
   * read (work/narrative-names.ts, work/narrative-back.ts). Bounded by what is live, never by every
   * narrative ever made, so the searches spend on stories still running.
   */
  async live(sinceMs: number): Promise<readonly StoredNarrative[]> {
    return this.#narratives('n.shown and n.newest_post_at >= $1', [new Date(sinceMs).toISOString()]);
  }

  /**
   * The live shown narratives the meme-war question was never asked of (0130 `fight` null), newest
   * post first, at most `limit`: the runner's catch-up for narratives titled before it was asked.
   * Empty before 0130.
   */
  async fightUnasked(sinceMs: number, limit: number): Promise<readonly StoredNarrative[]> {
    if (limit <= 0 || !(await this.migrated()) || !(await this.#hasColumn('narrative', 'fight'))) return [];
    return this.#narratives('n.shown and n.fight is null and n.newest_post_at >= $1', [new Date(sinceMs).toISOString(), limit], 'order by n.newest_post_at desc nulls last, n.narrative_id limit $2');
  }

  /**
   * The titler's meme-war answer for a narrative (0130): the countries, or none for "not one". Written
   * whatever wrote the title — the owner's title does not stop it — but ★ NEVER OVER THE OWNER'S OWN
   * ANSWER (`fight_model` `OWNER_TITLE_MODEL`, services/social "Twitter World War"). Nothing before 0130.
   */
  async setFight(id: string, countries: readonly string[], model: string): Promise<void> {
    if (!(await this.#hasColumn('narrative', 'fight'))) return;
    await this.#db.query(
      `update internal.narrative set fight = $2::text[], fight_model = $3, fight_at = now() where narrative_id = $1 and fight_model is distinct from $4`,
      [id, [...countries], model, OWNER_TITLE_MODEL],
    );
  }

  /**
   * ★ THE OPEN MEME WARS (0130 `fight`, two countries or more) with a post since `sinceMs`, shown or
   * not: what a post naming another country in its own language may join (core group/fight-native.ts),
   * a seed still waiting for the titler included, so its new posts gather there rather than seed again.
   */
  async fights(sinceMs: number): Promise<readonly StoredNarrative[]> {
    if (!(await this.migrated()) || !(await this.#hasColumn('narrative', 'fight'))) return [];
    return this.#narratives('coalesce(cardinality(n.fight), 0) >= 2 and n.newest_post_at >= $1', [new Date(sinceMs).toISOString()]);
  }

  /** The meme-war seeds the titler has not answered (`FIGHT_SEED_MODEL`, not shown), newest post first, at most `limit`. */
  async fightPending(sinceMs: number, limit: number): Promise<readonly StoredNarrative[]> {
    if (limit <= 0 || !(await this.migrated()) || !(await this.#hasColumn('narrative', 'fight'))) return [];
    return this.#narratives('not n.shown and n.fight_model = $3 and n.newest_post_at >= $1', [new Date(sinceMs).toISOString(), limit, FIGHT_SEED_MODEL], 'order by n.newest_post_at desc nulls last, n.narrative_id limit $2');
  }

  /** A seed the titler said is the war: on the board from now, as any narrative first shown. */
  async showFight(id: string): Promise<void> {
    await this.#db.query(
      `update internal.narrative set shown = true, first_shown_at = coalesce(first_shown_at, now()), updated_at = now() where narrative_id = $1 and state = 'open'`,
      [id],
    );
  }

  /**
   * ★ STORED POSTS THAT MAY NAME ANOTHER COUNTRY (policy.v157 `narrative.fight.native`): found and
   * gone up since `sinceMs`, in one of `langs`, at `minReach` views or more as last read, in no
   * narrative; highest views first, at most `limit`. Light rows: the words are matched in core and
   * only the matches' standing is read (`standingRows`). By the first-seen index — measured
   * 2026-10-24 on live data, 1,653 rows of two days in 0.19 s.
   */
  async fightPosts(sinceMs: number, langs: readonly string[], minReach: number, limit: number): Promise<readonly FightPostRow[]> {
    if (langs.length === 0 || limit <= 0 || !(await this.migrated())) return [];
    const since = new Date(sinceMs).toISOString();
    const rows = await orEmpty(() => this.#db.query<{ item_id: string; author_key: string | null; lang: string | null; body: string; at: Date | string; reach: number | string | null }>(
      `select i.item_id, i.author_key, i.lang, i.body, coalesce(i.posted_at, i.first_seen_at) as at,
              (i.counters->'reach'->>'value')::double precision as reach
         from public.item i
        where i.first_seen_at >= $1 and coalesce(i.posted_at, i.first_seen_at) >= $1
          and i.origin = 'observed' and i.lang = any($2::text[])
          and (i.counters->'reach'->>'value')::double precision >= $3
          and not exists (select 1 from internal.narrative_member m where m.item_id = i.item_id)
        order by reach desc, i.item_id
        limit $4`,
      [since, [...langs], minReach, limit],
    ), []);
    return rows.map((r) => ({ itemId: r.item_id, authorKey: r.author_key, lang: r.lang, body: r.body, atMs: toMs(r.at) ?? 0, reach: r.reach === null ? null : Number(r.reach) }));
  }

  /** The board's narratives: shown, newest post first, at most `limit` (0106 narrative_board_idx). */
  async newest(limit: number): Promise<readonly StoredNarrative[]> {
    return this.#narratives('n.shown', [limit], 'order by n.newest_post_at desc nulls last, n.narrative_id limit $1');
  }

  /**
   * The shown narratives off the board whose page is due again, at most `limit`, none of `skip`:
   * TAKEN IN TURNS (`fairTurns`) from the ones never projected and the ones written longest ago
   * (public.story_view.projected_at). Until 2026-10-23 the never-projected went first, always: about
   * 115 narratives the listing rule drops every frame (so never written) took all 25 places each
   * frame, and 751 of 957 pages went more than an hour without being written again — stale `dead`
   * flags and "today" gains from 18–21 Oct. The caller also skips, for a while, a page it tried and
   * could not write (services/project narrative-frame.ts `unwritten`).
   */
  async pagesDue(limit: number, skip: readonly string[]): Promise<readonly StoredNarrative[]> {
    const never = await this.#narratives(
      'n.shown and not (n.narrative_id = any($2::text[])) and not exists (select 1 from public.story_view v where v.story_id = n.narrative_id)',
      [limit, [...skip]],
      'order by n.updated_at, n.narrative_id limit $1',
    );
    const written = await this.#narratives(
      'n.shown and not (n.narrative_id = any($2::text[])) and exists (select 1 from public.story_view v where v.story_id = n.narrative_id)',
      [limit, [...skip]],
      'order by (select v.projected_at from public.story_view v where v.story_id = n.narrative_id) asc, n.narrative_id limit $1',
    );
    return fairTurns(never, written, limit);
  }

  /**
   * Each post's judge name (its newest answer to the post question's proposed name) and when it
   * went up, for the same-subject rule (core group/narrative-same.ts): the name says what it is
   * about, the time which of two narratives is the older. One index-backed read by the posts' ids.
   */
  async postNames(itemIds: readonly string[]): Promise<ReadonlyMap<string, { readonly name: string | null; readonly atMs: number | null }>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.#db.query<{ item_id: string; proposed_name: string | null; at: Date | string | null }>(
      `select i.item_id, coalesce(i.posted_at, i.first_seen_at) as at,
              (select pj.proposed_name from internal.post_judgement pj
                where pj.item_id = i.item_id and pj.prompt_id not like 'post-kind%'
                order by pj.judged_at desc, pj.id desc limit 1) as proposed_name
         from public.item i
        where i.item_id = any($1::text[])`,
      [[...itemIds]],
    );
    return new Map(rows.map((r) => [r.item_id, { name: r.proposed_name, atMs: toMs(r.at) }] as const));
  }

  /** Each of these narrative ids' state, and where a merged one went; ids never given out are absent. */
  async states(ids: readonly string[]): Promise<readonly NarrativeStateRow[]> {
    if (ids.length === 0 || !(await this.migrated())) return [];
    const rows = await orEmpty(() => this.#db.query<{ narrative_id: string; state: NarrativeStateRow['state']; merged_into: string | null }>(
      `select narrative_id, state, merged_into from internal.narrative where narrative_id = any($1::text[])`,
      [[...ids]],
    ), []);
    return rows.map((r) => ({ id: r.narrative_id, state: r.state, mergedInto: r.merged_into }));
  }

  /** Every merged narrative, and every narrative one was merged into: the alias list (0106 public.story_alias). */
  async merged(): Promise<readonly NarrativeStateRow[]> {
    if (!(await this.migrated())) return [];
    const rows = await orEmpty(() => this.#db.query<{ narrative_id: string; state: NarrativeStateRow['state']; merged_into: string | null }>(
      `select narrative_id, state, merged_into from internal.narrative
        where state = 'merged' or narrative_id in (select merged_into from internal.narrative where state = 'merged')`,
    ), []);
    return rows.map((r) => ({ id: r.narrative_id, state: r.state, mergedInto: r.merged_into }));
  }

  /** Every call the owner made on a narrative, oldest first. Empty before 0093. */
  async calls(): Promise<readonly NarrativeCallRecord[]> {
    if (!(await this.migrated())) return [];
    type Row = { id: string | number; at: Date | string; item_id: string; verdict: NarrativeCallRecord['verdict']; other_id: string | null; coin_address: string | null; members: string[] | null; other_members: string[] | null };
    const rows = await orEmpty(() => this.#db.query<Row>(
      `select id, created_at as at, item_id, verdict, other_id, coin_address, members, other_members
         from internal.owner_feedback where subject_kind = 'narrative' order by created_at, id`,
    ), []);
    return rows.map((r) => ({
      id: Number(r.id),
      atMs: toMs(r.at) ?? 0,
      narrativeId: r.item_id,
      verdict: r.verdict,
      otherId: r.other_id,
      coin: r.coin_address,
      members: r.members ?? [],
      otherMembers: r.other_members ?? [],
    }));
  }

  /**
   * ★ ONE PASS, ADDED: each narrative it touched upserted (a new one open; a rebuilt one may reopen a
   * gone id; a merged one is never reopened, so its alias holds), its new posts and new early posts
   * inserted — a post already in any narrative stays where it is (the one-narrative-a-post index) —
   * the owner's merges moved and marked, his removed posts deleted, and every touched narrative's
   * post count, newest post and oldest post counted again from what is stored. Nothing is deleted
   * but a post the owner removed. Run it inside the caller's transaction. False before 0093.
   */
  async save(pass: NarrativePass): Promise<boolean> {
    if (!(await this.migrated())) return false;
    /* Before 0100 an early post could not be told from a grouped one on the next read: none is written. */
    const withEarly = await this.earlyMigrated();
    const withRestored = await this.#hasColumn('narrative', 'restored_at');
    const earlyOf = (x: NarrativePass['narratives'][number]): readonly string[] => (withEarly ? x.early ?? [] : []);
    try {
      const n = pass.narratives;
      const iso = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : new Date(ms).toISOString());
      await this.#db.query(
        `insert into internal.narrative (narrative_id, state, merged_into, anchor_item, member_count, newest_post_at, shown, first_shown_at, posts_changed_at, updated_at)
         select x.id, 'open', null, x.anchor, 0, x.newest, x.shown, case when x.shown then coalesce(x.first, now()) end, now(), now()
           from unnest($1::text[], $2::text[], $3::timestamptz[], $4::boolean[], $5::timestamptz[]) as x(id, anchor, newest, shown, first)
         on conflict (narrative_id) do update set
           state = 'open', merged_into = null, shown = excluded.shown,
           first_shown_at = coalesce(internal.narrative.first_shown_at, excluded.first_shown_at),
           posts_changed_at = case when internal.narrative.state <> 'open' then now() else internal.narrative.posts_changed_at end,
           updated_at = now()
         where internal.narrative.state <> 'merged'`,
        [n.map((x) => x.id), n.map((x) => x.anchor), n.map((x) => iso(x.newestPostAtMs)), n.map((x) => x.shown), n.map((x) => iso(x.firstShownAtMs))],
      );
      const restored = n.filter((x) => x.restored === true).map((x) => x.id);
      if (withRestored && restored.length > 0) await this.#db.query(`update internal.narrative set restored_at = now() where narrative_id = any($1::text[])`, [restored]);
      /* A narrative whose posts changed this pass: the owner's "Not a narrative" said before now no longer hides it. */
      const changed = n.filter((x) => x.changed).map((x) => x.id);
      if (changed.length > 0) await this.#db.query(`update internal.narrative set posts_changed_at = now() where narrative_id = any($1::text[])`, [changed]);

      const ids: string[] = [];
      const items: string[] = [];
      const early: boolean[] = [];
      for (const x of n) {
        for (const m of x.added ?? x.members) {
          ids.push(x.id);
          items.push(m);
          early.push(false);
        }
        for (const m of earlyOf(x)) {
          ids.push(x.id);
          items.push(m);
          early.push(true);
        }
      }
      if (ids.length > 0) {
        await this.#db.query(
          withEarly
            ? `insert into internal.narrative_member (narrative_id, item_id, early) select * from unnest($1::text[], $2::text[], $3::boolean[]) on conflict do nothing`
            : `insert into internal.narrative_member (narrative_id, item_id) select * from unnest($1::text[], $2::text[]) on conflict do nothing`,
          withEarly ? [ids, items, early] : [ids, items],
        );
      }

      /* The meme-war seeds' pair, only where nothing has answered yet. */
      const fights = (pass.fights ?? []).filter((f) => f.countries.length >= 2);
      if (fights.length > 0 && (await this.#hasColumn('narrative', 'fight'))) {
        for (const f of fights) {
          await this.#db.query(`update internal.narrative set fight = $2::text[], fight_model = $3, fight_at = now() where narrative_id = $1 and fight is null`, [f.id, [...f.countries], FIGHT_SEED_MODEL]);
        }
      }

      /* The owner's merges: every post moves to the narrative he chose; the merged one stays, pointing there. */
      /* A quote merge is written only once 0126 lets merged_by say so: before it, it is not made at all. */
      const storyMerges = pass.retired.some((r) => r.by === 'same_story') && (await this.#mergedByAllows('same_story'));
      const merges = pass.retired.filter((r): r is { id: string; into: string; by?: 'owner' | 'same_subject' | 'same_story' } => r.into !== null && r.into !== r.id && (r.by !== 'same_story' || storyMerges));
      const withBy = merges.length > 0 && (await this.#hasColumn('narrative', 'merged_by'));
      for (const r of merges) {
        /* Only from an open narrative into an open one: a merge read before another pass wrote is not applied over it. */
        const moved = await this.#db.query<{ narrative_id: string }>(
          `update internal.narrative set state = 'merged', merged_into = $2, shown = false, member_count = 0, updated_at = now()${withBy ? ', merged_by = $3' : ''}
            where narrative_id = $1 and state = 'open'
              and exists (select 1 from internal.narrative t where t.narrative_id = $2 and t.state = 'open')
            returning narrative_id`,
          withBy ? [r.id, r.into, r.by ?? 'owner'] : [r.id, r.into],
        );
        if (moved.length > 0) await this.#db.query(`update internal.narrative_member set narrative_id = $2 where narrative_id = $1`, [r.id, r.into]);
      }
      /* The owner's splits, after his merges (a split names where its narrative leads now): the
         posts he picked that are still in it move to the new narrative the upsert above made. */
      const splits = pass.split ?? [];
      for (const r of splits) {
        await this.#db.query(`update internal.narrative_member set narrative_id = $2 where narrative_id = $1 and item_id = any($3::text[])`, [r.from, r.into, [...r.members]]);
      }
      /* The owner's adds, after his merges and splits (an add names where its narrative leads now). The
         one-narrative-a-post index means the post's row moves; one in no narrative gets a row. */
      const adds = pass.added ?? [];
      const addedFrom: string[] = [];
      for (const a of adds) {
        const was = await this.#db.query<{ narrative_id: string }>(`select narrative_id from internal.narrative_member where item_id = $1`, [a.itemId]);
        const moved = await this.#db.query<{ item_id: string }>(
          `insert into internal.narrative_member (narrative_id, item_id)
           select $2, $1
            where exists (select 1 from public.item i where i.item_id = $1)
              and exists (select 1 from internal.narrative t where t.narrative_id = $2 and t.state = 'open')
           on conflict (item_id) do update set narrative_id = excluded.narrative_id${withEarly ? ', early = false' : ''}
           returning item_id`,
          [a.itemId, a.into],
        );
        if (moved.length > 0) addedFrom.push(a.into, ...was.map((w) => w.narrative_id));
      }
      const removed = pass.removed ?? [];
      if (removed.length > 0) {
        await this.#db.query(
          `delete from internal.narrative_member m using unnest($1::text[], $2::text[]) as r(narrative_id, item_id)
            where m.narrative_id = r.narrative_id and m.item_id = r.item_id`,
          [removed.map((r) => r.narrativeId), removed.map((r) => r.itemId)],
        );
      }

      await this.#recount([...new Set([...n.map((x) => x.id), ...merges.map((r) => r.into), ...splits.map((r) => r.from), ...removed.map((r) => r.narrativeId), ...addedFrom])]);
      if (splits.length > 0) {
        await this.#db.query(
          `update internal.narrative n set state = 'gone', shown = false, updated_at = now()
            where n.narrative_id = any($1::text[]) and not exists (select 1 from internal.narrative_member m where m.narrative_id = n.narrative_id)`,
          [splits.map((r) => r.into)],
        );
      }
      return true;
    } catch (e) {
      if (notMigrated(e)) return false;
      throw e;
    }
  }

  /* ★ Counted from what is stored, never from what a pass held: its posts, its newest and its oldest. */
  async #recount(ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.#db.query(
      `update internal.narrative n
          set member_count = s.c, newest_post_at = s.newest, anchor_item = coalesce(s.anchor, n.anchor_item), updated_at = now()
         from (select m.narrative_id, count(*)::int as c,
                      max(coalesce(i.posted_at, i.first_seen_at)) as newest,
                      (array_agg(m.item_id order by coalesce(i.posted_at, i.first_seen_at), m.item_id))[1] as anchor
                 from internal.narrative_member m
                 left join public.item i on i.item_id = m.item_id
                where m.narrative_id = any($1::text[])
                group by m.narrative_id) s
        where n.narrative_id = s.narrative_id`,
      [[...ids]],
    );
  }

  /**
   * ★ UNDO A MERGE NOBODY ASKED FOR (tools/narrative-unmerge.ts): each narrative the old regroup
   * folded away is open again under its own id and title, with `items` moved back to it from the
   * narrative they are in now (`from`) — only posts still in `from`, so a post another narrative
   * holds stays there. A narrative not merged any more is left as it is, so a second run does
   * nothing. The projector drops its public.story_alias row and writes its page next frame. Run it
   * inside the caller's transaction.
   */
  async unmerge(list: readonly { readonly id: string; readonly from: string; readonly items: readonly string[] }[]): Promise<number> {
    if (list.length === 0 || !(await this.migrated())) return 0;
    const restored = (await this.#hasColumn('narrative', 'restored_at')) ? ', restored_at = now()' : '';
    let done = 0;
    for (const u of list) {
      const opened = await this.#db.query<{ narrative_id: string }>(
        `update internal.narrative set state = 'open', merged_into = null, shown = true, posts_changed_at = now(), updated_at = now()${restored}
          where narrative_id = $1 and state = 'merged' returning narrative_id`,
        [u.id],
      );
      if (opened.length === 0) continue;
      await this.#db.query(`update internal.narrative_member set narrative_id = $1 where narrative_id = $2 and item_id = any($3::text[])`, [u.id, u.from, [...u.items]]);
      done += 1;
    }
    await this.#recount([...new Set(list.flatMap((u) => [u.id, u.from]))]);
    return done;
  }

  readonly #columns = new Map<string, Promise<boolean>>();
  /** Whether internal.<table>.<column> is there; asked once, never caught (as `migrated`). */
  /** Whether merged_by's check names `value` (0126 adds 'same_story'); asked once. */
  #mergedByAllows(value: string): Promise<boolean> {
    const key = `merged_by=${value}`;
    let p = this.#columns.get(key);
    if (p === undefined) {
      p = this.#db
        .query<{ ok: boolean }>(
          `select coalesce(bool_or(pg_get_constraintdef(oid) like '%' || $1 || '%'), false) as ok
             from pg_constraint where conrelid = 'internal.narrative'::regclass and conname = 'narrative_merged_by_check'`,
          [value],
        )
        .then((r) => r[0]?.ok === true);
      this.#columns.set(key, p);
    }
    return p;
  }

  #hasColumn(table: string, column: string): Promise<boolean> {
    const key = `${table}.${column}`;
    let p = this.#columns.get(key);
    if (p === undefined) {
      p = this.#db
        .query<{ ok: boolean }>(
          `select exists (select 1 from information_schema.columns where table_schema = 'internal' and table_name = $1 and column_name = $2) as ok`,
          [table, column],
        )
        .then((r) => r[0]?.ok === true);
      this.#columns.set(key, p);
    }
    return p;
  }

  /**
   * The coins the narrative pages name — each page's own coin first, then the coins its sheet lists
   * — whose stored launch is not the create transaction's block time (minted_at_source other than
   * chain_rpc), newest first, at most `limit`: the coins whose "launched" the page cannot print.
   */
  async pageCoinsWithoutChainTime(limit: number): Promise<readonly string[]> {
    const rows = await this.#db.query<{ address: string }>(
      `with named as (
         select v.payload -> 'coins' -> 'coin' ->> 'address' as address, 0 as pref
           from public.story_view v where v.payload -> 'coins' ->> 'kind' = 'one'
         union all
         select s.address, 1 from public.same_name_coin s where s.subject_kind = 'story'
       )
       select a.address from (select address, min(pref) as pref from named where address is not null group by address) c
         join public.asset a on a.chain = 'solana' and a.address = c.address
        where a.minted_at_source <> 'chain_rpc'
        order by c.pref, a.first_seen_at desc
        limit $1`,
      [limit],
    );
    return rows.map((r) => r.address);
  }

  /**
   * The cheap model's title for a narrative, with the post count it was written for. ★ NEVER OVER
   * THE OWNER'S: a title he typed (services/social "Rename", 0130) is marked `OWNER_TITLE_MODEL`,
   * and this writes only where it is not, so a pass that asked before his rename landed cannot undo it.
   */
  async setTitle(id: string, title: string, posts: number, model: string): Promise<void> {
    await this.#db.query(
      `update internal.narrative set title = $2, title_posts = $3, title_model = $4, titled_at = now()
        where narrative_id = $1 and title_model is distinct from $5`,
      [id, title, posts, model, OWNER_TITLE_MODEL],
    );
  }

  /** The narrative each post is in now, by post: what the story coins read as "the same story". */
  async ofPosts(itemIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (itemIds.length === 0 || !(await this.migrated())) return new Map();
    const rows = await orEmpty(() => this.#db.query<{ item_id: string; narrative_id: string }>(
      `select item_id, narrative_id from internal.narrative_member where item_id = any($1::text[])`,
      [[...itemIds]],
    ), []);
    return new Map(rows.map((r) => [r.item_id, r.narrative_id] as const));
  }

  /**
   * ★ THE STARTING POST'S READS (core group/narrative-origin.ts): each post's quoted and linked posts
   * (internal.post_reference, 0118). A post with no row was never read with its links: absent, not
   * "none". Empty before 0118. By primary key.
   */
  async references(itemIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
    if (itemIds.length === 0) return new Map();
    const rows = await orEmpty(() => this.#db.query<{ item_id: string; refers_to: string[] }>(
      `select item_id, refers_to from internal.post_reference where item_id = any($1::text[])`,
      [[...itemIds]],
    ), []);
    return new Map(rows.map((r) => [r.item_id, r.refers_to] as const));
  }

  /**
   * ★ THE POST EACH OF THESE QUOTES (public.item.reproduction_of, policy.v145), apart from the links
   * above: those are only the URLs in a post's words, and a quote carries its quoted post in the
   * payload instead — on 23 Oct only 1,084 of a day's 3,606 quotes named theirs among their links,
   * and none of the five "Vegeta is Algerian" posts did. Kept apart because the same-story merge was
   * measured on the links alone (core group/narrative-origin.ts `quotes`). By primary key.
   */
  async quotes(itemIds: readonly string[]): Promise<ReadonlyMap<string, readonly string[]>> {
    if (itemIds.length === 0) return new Map();
    const rows = await this.#db.query<{ item_id: string; quoted: string }>(
      `select item_id, reproduction_of as quoted from public.item where item_id = any($1::text[]) and reproduction_of is not null and reproduction_of <> item_id`,
      [[...itemIds]],
    );
    return new Map(rows.map((r) => [r.item_id, [r.quoted]] as const));
  }

  /**
   * ★ THE OWNER'S PASTED POSTS (0055 internal.missed_post), pasted since `sinceMs` and read, with
   * their standing, for the regroup (policy.v145 `origin.missedLookbackMs`): a post he pasted takes
   * part in the narratives though it is older than the regroup's window. Empty before 0055.
   */
  async pastedPosts(sinceMs: number): Promise<readonly NarrativePostRow[]> {
    const rows = await orEmpty(() => this.#db.query<PostRow>(
      `select i.item_id, i.source, i.body, i.media, coalesce(i.posted_at, i.first_seen_at) as at, ${STANDING_COLUMNS}
         from (select distinct mp.item_id from internal.missed_post mp
                where mp.added_at >= $1 and mp.status = 'done' and mp.item_id is not null) f
         join public.item i on i.item_id = f.item_id
         ${STANDING_JOINS}`,
      [new Date(sinceMs).toISOString()],
    ), []);
    return rows.map(toPost);
  }

  /** Each post's stored English (0081 public.post_translation), for the same-words join; none before 0081. */
  async english(itemIds: readonly string[]): Promise<ReadonlyMap<string, string>> {
    if (itemIds.length === 0) return new Map();
    const rows = await orEmpty(() => this.#db.query<{ item_id: string; text_en: string }>(
      `select item_id, text_en from public.post_translation where item_id = any($1::text[]) and text_en is not null`,
      [[...itemIds]],
    ), []);
    return new Map(rows.map((r) => [r.item_id, r.text_en] as const));
  }

  /**
   * The posts, of these, that a coin is tied to: a coin's own link names it (internal.coin_post_link)
   * or the coin-first route tied it (internal.coin_first_post, 0117). Such a post may start a narrative
   * though the judge never passed it. By the posts' keys; empty before those tables.
   */
  async coinTied(itemIds: readonly string[]): Promise<ReadonlySet<string>> {
    if (itemIds.length === 0) return new Set();
    const links = await orEmpty(() => this.#db.query<{ item_id: string }>(
      `select distinct i.item_id from public.item i
         join internal.coin_post_link l on l.source = i.source and l.source_item_id = i.source_item_id
        where i.item_id = any($1::text[])`,
      [[...itemIds]],
    ), []);
    const first = await orEmpty(() => this.#db.query<{ item_id: string }>(`select item_id from internal.coin_first_post where item_id = any($1::text[])`, [[...itemIds]]), []);
    return new Set([...links, ...first].map((r) => r.item_id));
  }

  /**
   * ★ WHAT THE VIEWS BAR NEEDS OF A POST (core `clearsReachBar`): its readings up to `windowMs` after
   * it went up (the growth paths only look there) and its highest reading of all (the total path).
   * Two statements by the posts' ids, never a post's whole history.
   */
  async barReadings(itemIds: readonly string[], windowMs: number): Promise<ReadonlyMap<string, { readonly source: string; readonly postedAtMs: number | null; readonly readings: readonly { readonly atMs: number; readonly reach: number }[] }>> {
    if (itemIds.length === 0) return new Map();
    const early = await this.#db.query<{ item_id: string; source: string; posted_at: Date | string | null; captured_at: Date | string | null; value: number | string | null }>(
      `select i.item_id, i.source, i.posted_at, o.captured_at, o.value
         from public.item i
         left join public.observation o
           on o.item_id = i.item_id and o.kind = 'reach' and o.value is not null and o.fidelity_kind <> 'absent'
          and i.posted_at is not null and o.captured_at <= i.posted_at + make_interval(secs => $2::double precision / 1000)
        where i.item_id = any($1::text[])`,
      [[...itemIds], windowMs],
    );
    const most = await this.#db.query<{ item_id: string; captured_at: Date | string; value: number | string }>(
      `select distinct on (item_id) item_id, captured_at, value from public.observation
        where item_id = any($1::text[]) and kind = 'reach' and value is not null and fidelity_kind <> 'absent'
        order by item_id, value desc, captured_at`,
      [[...itemIds]],
    );
    const out = new Map<string, { source: string; postedAtMs: number | null; readings: { atMs: number; reach: number }[] }>();
    for (const r of early) {
      const x = out.get(r.item_id) ?? { source: r.source, postedAtMs: toMs(r.posted_at), readings: [] };
      if (r.captured_at !== null && r.value !== null) x.readings.push({ atMs: toMs(r.captured_at) ?? 0, reach: Number(r.value) });
      out.set(r.item_id, x);
    }
    for (const r of most) out.get(r.item_id)?.readings.push({ atMs: toMs(r.captured_at) ?? 0, reach: Number(r.value) });
    return out;
  }

  /** For the re-tune: narratives first shown since `sinceMs`, and every narrative call since it. */
  async lessonsSince(sinceMs: number): Promise<{ readonly shown: number; readonly calls: readonly NarrativeCallRecord[] }> {
    if (!(await this.migrated())) return { shown: 0, calls: [] };
    const since = new Date(sinceMs).toISOString();
    /* A narrative the rebuild restored (0106) was not shown that day: it is not one of the day's lessons. */
    const notRestored = (await this.#hasColumn('narrative', 'restored_at')) ? 'and restored_at is null' : '';
    const [count] = await orEmpty(() => this.#db.query<{ n: string | number }>(`select count(*) as n from internal.narrative where first_shown_at >= $1 ${notRestored}`, [since]), [{ n: 0 }]);
    const calls = (await this.calls()).filter((c) => c.atMs >= sinceMs);
    return { shown: Number(count?.n ?? 0), calls };
  }
}
