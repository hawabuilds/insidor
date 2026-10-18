/**
 * Narratives (0093): the reads the grouping needs, its one write, and the reads the projector, the
 * owner's routes and the re-tune make of what it wrote.
 *
 * Its own repository, apart from stories.ts, because a narrative is not a GROUP story (0093 says
 * why): it is regrouped from scratch every pass from the posts the judge passed, so its write is a
 * whole replacement of the current post sets, and its reads are of posts and vectors, not carriers.
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
 * What breaks if changed carelessly: `save` must run inside the caller's transaction. The posts are
 * deleted and rewritten whole; committed halfway, the board would read narratives with no posts.
 */

import type { Db } from '../client.ts';

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
}

const STANDING_COLUMNS = `
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
  /** Of `members`, the early posts (0100): matched back in by the runner, never made by the regroup. Empty before 0100. */
  readonly early?: readonly string[];
}

/** What one grouping pass writes. */
export interface NarrativePass {
  readonly narratives: readonly {
    readonly id: string;
    readonly members: readonly string[];
    readonly anchor: string;
    readonly newestPostAtMs: number | null;
    readonly shown: boolean;
    readonly changed: boolean;
    /** Stored posts the regroup could not see, matched back in (0100); not in `members`. Dropped before 0100. */
    readonly early?: readonly string[];
  }[];
  readonly retired: readonly { readonly id: string; readonly into: string | null }[];
}

/** One stored owner call on a narrative, as core `foldNarrativeCalls` reads it. */
export interface NarrativeCallRecord {
  readonly id: number;
  readonly atMs: number;
  readonly narrativeId: string;
  readonly verdict: 'not_narrative' | 'merge' | 'remove_post' | 'right' | 'wrong' | 'cleared';
  readonly otherId: string | null;
  readonly coin: string | null;
  readonly members: readonly string[];
  readonly otherMembers: readonly string[];
}

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
    const sql = kind === 'post'
      ? `select item_id, embedding::text as v from internal.post_embedding where item_id = any($1::text[]) and space = $2`
      : `select distinct on (subject_id) subject_id as item_id, embedding::text as v from internal.image_embedding
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

  /** The open narratives the last pass wrote, with their posts. */
  async open(): Promise<readonly StoredNarrative[]> {
    if (!(await this.migrated())) return [];
    type Row = { narrative_id: string; anchor_item: string; shown: boolean; first_shown_at: Date | string | null; posts_changed_at: Date | string; title: string | null; title_posts: number | null; members: string[] | null; early: string[] | null };
    const early = (await this.earlyMigrated())
      ? '(select array_agg(m.item_id order by m.item_id) from internal.narrative_member m where m.narrative_id = n.narrative_id and m.early)'
      : 'null::text[]';
    const rows = await orEmpty(() => this.#db.query<Row>(
      `select n.narrative_id, n.anchor_item, n.shown, n.first_shown_at, n.posts_changed_at, n.title, n.title_posts,
              (select array_agg(m.item_id order by m.item_id) from internal.narrative_member m where m.narrative_id = n.narrative_id) as members,
              ${early} as early
         from internal.narrative n
        where n.state = 'open'`,
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
      early: r.early ?? [],
    }));
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
   * One pass, written whole: each narrative upserted (open again if it had been retired), each
   * retired one marked merged or gone, and every narrative's posts replaced. Run it inside the
   * caller's transaction. False before 0093.
   */
  async save(pass: NarrativePass): Promise<boolean> {
    if (!(await this.migrated())) return false;
    /* Before 0100 an early post could not be told from a grouped one on the next read: none is written. */
    const withEarly = await this.earlyMigrated();
    const earlyOf = (x: NarrativePass['narratives'][number]): readonly string[] => (withEarly ? x.early ?? [] : []);
    try {
      const n = pass.narratives;
      await this.#db.query(
        `insert into internal.narrative (narrative_id, state, merged_into, anchor_item, member_count, newest_post_at, shown, first_shown_at, posts_changed_at, updated_at)
         select x.id, 'open', null, x.anchor, x.members, x.newest, x.shown, case when x.shown then now() end, now(), now()
           from unnest($1::text[], $2::text[], $3::int[], $4::timestamptz[], $5::boolean[]) as x(id, anchor, members, newest, shown)
         on conflict (narrative_id) do update set
           state = 'open', merged_into = null, anchor_item = excluded.anchor_item, member_count = excluded.member_count,
           newest_post_at = excluded.newest_post_at, shown = excluded.shown,
           first_shown_at = coalesce(internal.narrative.first_shown_at, excluded.first_shown_at),
           posts_changed_at = case when internal.narrative.state <> 'open' then now() else internal.narrative.posts_changed_at end,
           updated_at = now()`,
        [n.map((x) => x.id), n.map((x) => x.anchor), n.map((x) => x.members.length + earlyOf(x).length), n.map((x) => (x.newestPostAtMs === null ? null : new Date(x.newestPostAtMs).toISOString())), n.map((x) => x.shown)],
      );
      /* A narrative whose posts changed this pass: the owner's "Not a narrative" said before now no longer hides it. */
      const changed = n.filter((x) => x.changed).map((x) => x.id);
      if (changed.length > 0) await this.#db.query(`update internal.narrative set posts_changed_at = now() where narrative_id = any($1::text[])`, [changed]);
      if (pass.retired.length > 0) {
        await this.#db.query(
          `update internal.narrative n
              set state = case when r.target is null then 'gone' else 'merged' end, merged_into = r.target, shown = false, updated_at = now()
             from unnest($1::text[], $2::text[]) as r(id, target)
            where n.narrative_id = r.id and n.state = 'open'`,
          [pass.retired.map((r) => r.id), pass.retired.map((r) => r.into)],
        );
      }
      await this.#db.query(`delete from internal.narrative_member`);
      const ids: string[] = [];
      const items: string[] = [];
      const early: boolean[] = [];
      for (const x of n) {
        for (const m of x.members) {
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
            ? `insert into internal.narrative_member (narrative_id, item_id, early) select * from unnest($1::text[], $2::text[], $3::boolean[])`
            : `insert into internal.narrative_member (narrative_id, item_id) select * from unnest($1::text[], $2::text[])`,
          withEarly ? [ids, items, early] : [ids, items],
        );
      }
      return true;
    } catch (e) {
      if (notMigrated(e)) return false;
      throw e;
    }
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

  /** The cheap model's title for a narrative, with the post count it was written for. */
  async setTitle(id: string, title: string, posts: number, model: string): Promise<void> {
    await this.#db.query(
      `update internal.narrative set title = $2, title_posts = $3, title_model = $4, titled_at = now() where narrative_id = $1`,
      [id, title, posts, model],
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

  /** For the re-tune: narratives first shown since `sinceMs`, and every narrative call since it. */
  async lessonsSince(sinceMs: number): Promise<{ readonly shown: number; readonly calls: readonly NarrativeCallRecord[] }> {
    if (!(await this.migrated())) return { shown: 0, calls: [] };
    const since = new Date(sinceMs).toISOString();
    const [count] = await orEmpty(() => this.#db.query<{ n: string | number }>(`select count(*) as n from internal.narrative where first_shown_at >= $1`, [since]), [{ n: 0 }]);
    const calls = (await this.calls()).filter((c) => c.atMs >= sinceMs);
    return { shown: Number(count?.n ?? 0), calls };
  }
}
