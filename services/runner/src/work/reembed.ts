/**
 * RE-EMBED WHAT IS STORED, IN OUR OWN MODEL'S SPACE — the work itself, owned by the runner so the
 * runner can do it in its own process (reembed-on-boot.ts) and tools/reembed.ts can do it from a
 * laptop, with one copy of the work lists between them.
 *
 * Why it is here and not in the tool: the fill has to reach the embed service on Railway's private
 * network, which only a Railway service can. Until 2026-10-24 the runner started the tool as a child
 * process; `check-python` forbids a production package from spawning anything, and rightly — a second
 * program the runner launches is a second runtime nobody reviews as part of the runner. So the work
 * moved in, and the tool became a thin command line over it.
 *
 * ★ THE OLD VECTORS ARE NOT TOUCHED. Each row is written beside the old one under the new space
 * (every vector table's key includes `space`); nothing is updated or deleted. Until the policy names
 * the new space nobody reads these rows; after it does, nobody reads the old ones.
 *
 * ★ RESUMABLE. Each kind's work list is "rows with a vector in some other space and none in ours",
 * newest first, so a stopped run started again carries on where it stopped. Within a run the list is
 * walked by key (never by offset), so a picture that cannot be read is passed over once, not asked
 * for forever; the next run asks again. That is what makes running it at every boot safe: a boot with
 * nothing left costs one empty page per kind.
 *
 * ★ BOUNDED. `concurrency` requests at once (the tool's default and the runner's: 2 — the service
 * runs one inference at a time, and two keeps its queue fed while the next request's pictures
 * download). Its CPU is shared with the runner's own embedding, so this never goes wider.
 *
 * ★ THE POST SPACE IS A PARAMETER (`postSpace`; policy.v180). Posts, labels and name examples are filled
 * into the post space the caller names — the policy's `postSpaceNext` while a switch is being prepared,
 * else its `postSpace` — so the next space can be filled while every reader still reads the current
 * one. Pictures, coins and coined pictures always go into SPACE: the picture space does not change.
 *
 * What breaks if changed carelessly: the inputs must be built as the runner builds them — core
 * `embedInput` over the post's words and `postPicture` of its media — or the stored vectors are a
 * different representation from the live ones under the same space id. And the SQL of each work list
 * must keep excluding rows already in our space, or every boot embeds everything again.
 */

import type { MediaRef, Millis } from '@insidor/contracts';
import type { EmbedPort } from '@insidor/contracts/ports/embed.ts';
import type { Policy } from '@insidor/contracts/policy.ts';
import { embedInput, postPicture } from '@insidor/core';
import { POST_SPACE as SELF_POST_SPACE, POST_SPACES, SPACE } from '@insidor/embed-selfhost';
import { PgCoinedPictureRepo, PgImageEmbeddingRepo, PgLabelEmbeddingRepo, PgNameExampleRepo, PgPostEmbeddingRepo, type Db } from '@insidor/store';

export const REEMBED_KINDS = ['posts', 'labels', 'names', 'pictures', 'coins', 'coined'] as const;
export type ReembedKind = (typeof REEMBED_KINDS)[number];
/** Rows per work-list page. */
export const REEMBED_PAGE = 256;

/** One work item: what to embed, and how to write it. `key` orders the walk, newest first. */
export interface ReembedRow {
  readonly key: readonly [string, ...string[]];
  readonly input: { readonly text: string; readonly picture: string | null } | { readonly media: MediaRef };
  readonly write: (values: Float32Array) => Promise<void>;
}

export interface ReembedSource {
  /** Rows still to do, as one count, for the dry run; and how many of them carry a picture. */
  count(db: Db): Promise<{ readonly rows: number; readonly pictures: number }>;
  /** The next page after `after` (null: from the newest). */
  page(db: Db, after: readonly string[] | null): Promise<readonly ReembedRow[]>;
}

/** What the walk says as it goes: one line a page, and one when a kind is finished. */
export type ReembedEvent =
  | { readonly kind: ReembedKind; readonly event: 'page'; readonly done: number; readonly unread: number; readonly ratePerSec: number }
  | { readonly kind: ReembedKind; readonly event: 'finished'; readonly written: number; readonly unread: number };

const image = (uri: string): MediaRef => ({ kind: 'image', uri, width: null, height: null, durationMs: null });
const vec = (v: Float32Array): number[] => Array.from(v);
/** Tuple-after clause for a newest-first keyset walk over `cols`, parameters from `$from`. */
const after = (cols: readonly string[], from: number, given: readonly string[] | null): string =>
  given === null ? 'true' : `(${cols.join(', ')}) < (${cols.map((c, i) => `$${from + i}${c.endsWith('_at') ? '::timestamptz' : ''}`).join(', ')})`;

/**
 * Every kind's work list. `coinSinceMs` bounds the coin pictures to those embedded since then (a
 * coin's vector is archived after Policy.coinVectors.keepMs; new coins are embedded as they launch).
 */
export function reembedSources(opts: { readonly policy: Policy; readonly coinSinceMs: number; readonly now?: () => number; readonly postSpace?: string }): Record<ReembedKind, ReembedSource> {
  const P = opts.policy;
  const now = opts.now ?? Date.now;
  /* The post kinds' target: our first post space unless the caller names another (reembedPostSpace). */
  const postSpace = opts.postSpace ?? SELF_POST_SPACE;
  return {
    /* Each judged post's words-and-picture vector (0074): the projector's story match. */
    posts: {
      async count(db) {
        const [r] = await db.query<{ n: string; p: string }>(
          `select count(*) as n, count(*) filter (where jsonb_array_length(coalesce(i.media, '[]'::jsonb)) > 0) as p
             from (select distinct item_id from internal.post_embedding where space <> $1) e join public.item i using (item_id)
            where not exists (select 1 from internal.post_embedding n where n.item_id = e.item_id and n.space = $1)`,
          [postSpace],
        );
        return { rows: Number(r?.n ?? 0), pictures: Number(r?.p ?? 0) };
      },
      async page(db, given) {
        const rows = await db.query<{ item_id: string; at: string; body: string | null; media: unknown }>(
          `select e.item_id, e.at::text as at, i.body, i.media
             from (select item_id, max(embedded_at) as at from internal.post_embedding where space <> $1 group by item_id) e
             join public.item i using (item_id)
            where not exists (select 1 from internal.post_embedding n where n.item_id = e.item_id and n.space = $1)
              and ${after(['e.at', 'e.item_id'], 3, given)}
            order by e.at desc, e.item_id desc limit $2`,
          [postSpace, REEMBED_PAGE, ...(given ?? [])],
        );
        const repo = new PgPostEmbeddingRepo(db);
        return rows.map((r) => ({
          key: [r.at, r.item_id],
          input: embedInput(r.body ?? '', postPicture(r.media), P),
          write: async (values) => void (await repo.putMany([{ itemId: r.item_id, values }], postSpace)),
        }));
      },
    },
    /* The owner's labelled posts (0069): the judge's precedents and the not-a-meme hold. */
    labels: {
      async count(db) {
        const [r] = await db.query<{ n: string; p: string }>(
          `select count(distinct l.item_id) as n, count(distinct l.item_id) filter (where l.picture is not null) as p from internal.label_embedding l
            where l.space <> $1 and not exists (select 1 from internal.label_embedding n where n.item_id = l.item_id and n.space = $1)`,
          [postSpace],
        );
        return { rows: Number(r?.n ?? 0), pictures: Number(r?.p ?? 0) };
      },
      async page(db, given) {
        const rows = await db.query<{ item_id: string; updated_at: string; label: 'meme' | 'not'; label_kind: string; text: string; why: string | null; picture: string | null }>(
          `select distinct on (l.updated_at, l.item_id) l.item_id, l.updated_at::text as updated_at, l.label, l.label_kind, l.text, l.why, l.picture
             from internal.label_embedding l
            where l.space <> $1 and not exists (select 1 from internal.label_embedding n where n.item_id = l.item_id and n.space = $1)
              and ${after(['l.updated_at', 'l.item_id'], 3, given)}
            order by l.updated_at desc, l.item_id desc limit $2`,
          [postSpace, REEMBED_PAGE, ...(given ?? [])],
        );
        const repo = new PgLabelEmbeddingRepo(db);
        return rows.map((r) => ({
          key: [r.updated_at, r.item_id],
          input: { text: r.text, picture: r.picture },
          write: async (values) =>
            void (await repo.put({ itemId: r.item_id, label: r.label, kind: r.label_kind as Parameters<PgLabelEmbeddingRepo['put']>[0]['kind'], text: r.text, why: r.why, picture: r.picture }, postSpace, values)),
        }));
      },
    },
    /* The namer's example posts (0076). */
    names: {
      async count(db) {
        const [r] = await db.query<{ n: string }>(
          `select count(distinct v.item_id) as n from internal.name_example_embedding v
            where v.space <> $1 and not exists (select 1 from internal.name_example_embedding n where n.item_id = v.item_id and n.space = $1)`,
          [postSpace],
        );
        return { rows: Number(r?.n ?? 0), pictures: Number(r?.n ?? 0) };
      },
      async page(db, given) {
        const rows = await db.query<{ item_id: string; at: string; text: string; picture: string | null; media: unknown }>(
          `select v.item_id, v.at::text as at, x.text, x.picture, i.media
             from (select item_id, max(embedded_at) as at from internal.name_example_embedding where space <> $1 group by item_id) v
             join lateral (select max(e.text) as text, max(e.picture) as picture from internal.name_example e where e.item_id = v.item_id) x on true
             left join public.item i on i.item_id = v.item_id
            where not exists (select 1 from internal.name_example_embedding n where n.item_id = v.item_id and n.space = $1)
              and ${after(['v.at', 'v.item_id'], 3, given)}
            order by v.at desc, v.item_id desc limit $2`,
          [postSpace, REEMBED_PAGE, ...(given ?? [])],
        );
        const repo = new PgNameExampleRepo(db);
        return rows.map((r) => ({
          key: [r.at, r.item_id],
          input: embedInput(r.text ?? '', r.picture ?? postPicture(r.media), P),
          write: async (values) => void (await repo.putVectors([{ itemId: r.item_id, values }], postSpace)),
        }));
      },
    },
    pictures: pictureSource('item', null, now),
    coins: pictureSource('asset', opts.coinSinceMs, now),
    /* The coined posts' pictures (0052): the projector's picture boost. */
    coined: {
      async count(db) {
        const [r] = await db.query<{ n: string }>(
          `select count(*) as n from internal.coined_picture c where c.space <> $1
              and not exists (select 1 from internal.coined_picture n where n.uri = c.uri and n.space = $1)`,
          [SPACE],
        );
        return { rows: Number(r?.n ?? 0), pictures: Number(r?.n ?? 0) };
      },
      async page(db, given) {
        /* Needs 0136 (one row per picture per space); before it, the write is a silent no-op. */
        const rows = await db.query<{ uri: string; coin_ref: string; embedded_at: string }>(
          `select c.uri, c.coin_ref, c.embedded_at::text as embedded_at from internal.coined_picture c where c.space <> $1
              and not exists (select 1 from internal.coined_picture n where n.uri = c.uri and n.space = $1)
              and ${after(['c.embedded_at', 'c.uri'], 3, given)}
            order by c.embedded_at desc, c.uri desc limit $2`,
          [SPACE, REEMBED_PAGE, ...(given ?? [])],
        );
        const repo = new PgCoinedPictureRepo(db);
        return rows.map((r) => ({ key: [r.embedded_at, r.uri], input: { media: image(r.uri) }, write: (values) => repo.put(r.uri, r.coin_ref, SPACE, vec(values)) }));
      },
    },
  };
}

/* Post pictures ('item', 0027) and coin pictures ('asset'), each one vector per picture address. */
function pictureSource(kind: 'item' | 'asset', sinceMs: number | null, now: () => number): ReembedSource {
  const since = sinceMs === null ? null : new Date(sinceMs).toISOString();
  return {
    async count(db) {
      const [r] = await db.query<{ n: string }>(
        `select count(*) as n from (select distinct subject_id, uri from internal.image_embedding e
            where e.subject_kind = $2 and e.space <> $1 and ($3::timestamptz is null or e.embedded_at >= $3)
              and not exists (select 1 from internal.image_embedding n where n.subject_kind = e.subject_kind and n.subject_id = e.subject_id and n.uri = e.uri and n.space = $1)) x`,
        [SPACE, kind, since],
      );
      return { rows: Number(r?.n ?? 0), pictures: Number(r?.n ?? 0) };
    },
    async page(db, given) {
      const rows = await db.query<{ subject_id: string; uri: string; embedded_at: string }>(
        `select distinct on (e.embedded_at, e.subject_id, e.uri) e.subject_id, e.uri, e.embedded_at::text as embedded_at from internal.image_embedding e
          where e.subject_kind = $2 and e.space <> $1 and ($3::timestamptz is null or e.embedded_at >= $3)
            and not exists (select 1 from internal.image_embedding n where n.subject_kind = e.subject_kind and n.subject_id = e.subject_id and n.uri = e.uri and n.space = $1)
            and ${after(['e.embedded_at', 'e.subject_id', 'e.uri'], 5, given)}
          order by e.embedded_at desc, e.subject_id desc, e.uri desc limit $4`,
        [SPACE, kind, since, REEMBED_PAGE, ...(given ?? [])],
      );
      const repo = new PgImageEmbeddingRepo(db);
      return rows.map((r) => ({
        key: [r.embedded_at, r.subject_id, r.uri],
        input: { media: image(r.uri) },
        write: (values) => repo.record(kind, r.subject_id, r.uri, SPACE, values, now() as Millis),
      }));
    },
  };
}

/**
 * The post space a fill writes posts, labels and name examples into: the policy's next space when
 * one is named, else its current one — null when neither is a space this adapter computes (the hosted
 * vendor's), and then the post kinds are not filled at all.
 */
export function reembedPostSpace(policy: Policy): string | null {
  const target = policy.group.image.postSpaceNext ?? policy.group.image.postSpace;
  return POST_SPACES.includes(target) ? target : null;
}

export interface ReembedOptions {
  readonly kinds: readonly ReembedKind[];
  /** Requests at once. */
  readonly concurrency: number;
  /** Rows per kind after which no further page is read (checked a page at a time). Infinity: all. */
  readonly limit: number;
  /** The work lists; the tool and the runner pass reembedSources(…), a test passes fakes. */
  readonly sources: Record<ReembedKind, ReembedSource>;
  readonly log: (e: ReembedEvent) => void;
  /** Checked before each page: an aborted signal stops the walk where it is (the next run resumes). */
  readonly signal?: AbortSignal;
  readonly now?: () => number;
}

/** Totals per kind, for the caller's last line. */
export interface ReembedResult {
  readonly kind: ReembedKind;
  readonly done: number;
  readonly written: number;
  readonly unread: number;
}

/**
 * Walks each kind's work list a page at a time, embeds each page in chunks of `port.maxBatch`,
 * `concurrency` chunks at once, and writes every vector the port returned. A null slot is a picture
 * that could not be read: counted as unread, not written, and asked again by the next run.
 */
export async function reembedKinds(db: Db, port: EmbedPort, opts: ReembedOptions): Promise<readonly ReembedResult[]> {
  const now = opts.now ?? Date.now;
  /* The service costs nothing per call; the budget is only what the port's signature asks for. */
  const budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: (now() + 365 * 86_400_000) as Millis };
  const results: ReembedResult[] = [];
  for (const k of opts.kinds) {
    let cursor: readonly string[] | null = null;
    let done = 0;
    let unread = 0;
    const started = now();
    for (;;) {
      if (opts.signal?.aborted === true) break;
      const rows = await opts.sources[k].page(db, cursor);
      if (rows.length === 0 || done >= opts.limit) break;
      cursor = rows[rows.length - 1]!.key;
      const chunks: ReembedRow[][] = [];
      for (let i = 0; i < rows.length; i += port.maxBatch) chunks.push(rows.slice(i, i + port.maxBatch));
      for (let i = 0; i < chunks.length; i += opts.concurrency) {
        await Promise.all(
          chunks.slice(i, i + opts.concurrency).map(async (chunk) => {
            const media = chunk.every((r) => 'media' in r.input);
            const got = media
              ? await port.embedMedia!(chunk.map((r) => (r.input as { media: MediaRef }).media), budget)
              : await port.embedPosts!(chunk.map((r) => ('media' in r.input ? { text: '', picture: r.input.media.uri } : r.input)), budget);
            for (const [j, v] of got.value.entries()) {
              if (v === null) unread += 1;
              else await chunk[j]!.write(v.values);
            }
            done += chunk.length;
          }),
        );
      }
      opts.log({ kind: k, event: 'page', done, unread, ratePerSec: done / Math.max(1, (now() - started) / 1_000) });
    }
    opts.log({ kind: k, event: 'finished', written: done - unread, unread });
    results.push({ kind: k, done, written: done - unread, unread });
  }
  return results;
}
