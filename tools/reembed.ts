/**
 * RE-EMBED WHAT IS STORED, IN OUR OWN MODEL'S SPACE — the one-off fill that lets the switch from the
 * hosted model (Policy.group.image.space 'multimodal-3.1024') to our own (services/embed,
 * 'siglip2-b16-224.768') start with neighbours instead of an empty space.
 *
 *   node --env-file=.env.local tools/reembed.ts                      dry: how many rows of each kind, and how long
 *   node --env-file=.env.local tools/reembed.ts --yes [--only posts,labels,names,pictures,coins,coined]
 *        [--concurrency 2] [--limit N] [--coin-days 30]
 *
 * ★ THE OLD VECTORS ARE NOT TOUCHED. Each row is written beside the old one under the new space (every
 * vector table's key includes `space`); nothing is updated or deleted. Until the policy names the new
 * space nobody reads these rows; after it does, nobody reads the old ones. Going back is a policy edit.
 *
 * ★ RESUMABLE. Each kind's work list is "rows with a vector in some other space and none in ours",
 * newest first, so a stopped run started again carries on where it stopped, and a run after the
 * switch fills only what the runner has not. Within a run the list is walked by key (never by offset)
 * so a picture that cannot be read is passed over once, not asked for forever; the next run asks again.
 *
 * ★ FREE, BUT NOT UNBOUNDED. The service costs nothing per call; its CPU is shared with the runner's
 * own embedding. `--concurrency` requests at once (default 2: the service runs one inference at a
 * time, and two keeps its queue fed while the next request's pictures download).
 *
 * Coin pictures (internal.image_embedding, subject 'asset') are by far the most rows and the least
 * worth: a coin's vector is archived after Policy.coinVectors.keepMs (tools/archive-coin-vectors.ts),
 * and new coins are embedded by the runner as they launch. Only coins embedded in the last
 * `--coin-days` (default: that keep, 30 days) are re-embedded, newest first.
 *
 * What breaks if changed carelessly: the inputs must be built as the runner builds them — core
 * `embedInput` over the post's words and `postPicture` of its media — or the stored vectors are a
 * different representation from the live ones under the same space id.
 */

import process from 'node:process';

import type { Millis } from '../contracts/src/index.ts';
import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import type { MediaRef } from '../contracts/src/vocabulary.ts';
import { embedInput, postPicture } from '../core/src/qualify/precedents.ts';
import { httpClient, POST_SPACE, selfEmbed, SPACE } from '../adapters/embed/selfhost/src/index.ts';
import { inMemoryMeter } from '../adapters/meter/spend/src/index.ts';
import { asDb, createPool, DB_ROLE, PgCoinedPictureRepo, PgImageEmbeddingRepo, PgLabelEmbeddingRepo, PgNameExampleRepo, PgPostEmbeddingRepo, type Db } from '../store/src/index.ts';

const P = DEFAULT_POLICY;
const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const live = process.argv.includes('--yes');
const KINDS = ['posts', 'labels', 'names', 'pictures', 'coins', 'coined'] as const;
type Kind = (typeof KINDS)[number];
const only = new Set((arg('--only') ?? KINDS.join(',')).split(',').map((s) => s.trim()).filter((s): s is Kind => (KINDS as readonly string[]).includes(s)));
const concurrency = Math.max(1, Math.min(8, Number(arg('--concurrency') ?? '2')));
const limit = arg('--limit') === null ? Infinity : Math.max(1, Number(arg('--limit')));
const coinSinceMs = Date.now() - Number(arg('--coin-days') ?? String(P.coinVectors.keepMs / 86_400_000)) * 86_400_000;
/* For the dry run's estimate: measured per input on the service, 2026-10-24 (Apple M5: 39 ms a
   picture including its download, 11 ms a text). A shared Railway vCPU is assumed four times slower. */
const MS_PER_PICTURE = Number(arg('--ms-per-picture') ?? '160');
const MS_PER_TEXT = Number(arg('--ms-per-text') ?? '45');
const PAGE = 256;

/** One work item: what to embed, and how to write it. `key` orders the walk, newest first. */
interface Row {
  readonly key: readonly [string, ...string[]];
  readonly input: { readonly text: string; readonly picture: string | null } | { readonly media: MediaRef };
  readonly write: (values: Float32Array) => Promise<void>;
}

interface Source {
  /** Rows still to do, as one count, for the dry run; and how many of them carry a picture. */
  count(db: Db): Promise<{ readonly rows: number; readonly pictures: number }>;
  /** The next page after `after` (null: from the newest). */
  page(db: Db, after: readonly string[] | null): Promise<readonly Row[]>;
}

const image = (uri: string): MediaRef => ({ kind: 'image', uri, width: null, height: null, durationMs: null });
const vec = (v: Float32Array): number[] => Array.from(v);
/** Tuple-after clause for a newest-first keyset walk over `cols`, parameters from `$from`. */
const after = (cols: readonly string[], from: number, given: readonly string[] | null): string =>
  given === null ? 'true' : `(${cols.join(', ')}) < (${cols.map((c, i) => `$${from + i}${c.endsWith('_at') ? '::timestamptz' : ''}`).join(', ')})`;

function sources(): Record<Kind, Source> {
  return {
    /* Each judged post's words-and-picture vector (0074): the projector's story match. */
    posts: {
      async count(db) {
        const [r] = await db.query<{ n: string; p: string }>(
          `select count(*) as n, count(*) filter (where jsonb_array_length(coalesce(i.media, '[]'::jsonb)) > 0) as p
             from (select distinct item_id from internal.post_embedding where space <> $1) e join public.item i using (item_id)
            where not exists (select 1 from internal.post_embedding n where n.item_id = e.item_id and n.space = $1)`,
          [POST_SPACE],
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
          [POST_SPACE, PAGE, ...(given ?? [])],
        );
        const repo = new PgPostEmbeddingRepo(db);
        return rows.map((r) => ({
          key: [r.at, r.item_id],
          input: embedInput(r.body ?? '', postPicture(r.media), P),
          write: async (values) => void (await repo.putMany([{ itemId: r.item_id, values }], POST_SPACE)),
        }));
      },
    },
    /* The owner's labelled posts (0069): the judge's precedents and the not-a-meme hold. */
    labels: {
      async count(db) {
        const [r] = await db.query<{ n: string; p: string }>(
          `select count(distinct l.item_id) as n, count(distinct l.item_id) filter (where l.picture is not null) as p from internal.label_embedding l
            where l.space <> $1 and not exists (select 1 from internal.label_embedding n where n.item_id = l.item_id and n.space = $1)`,
          [POST_SPACE],
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
          [POST_SPACE, PAGE, ...(given ?? [])],
        );
        const repo = new PgLabelEmbeddingRepo(db);
        return rows.map((r) => ({
          key: [r.updated_at, r.item_id],
          input: { text: r.text, picture: r.picture },
          write: async (values) =>
            void (await repo.put({ itemId: r.item_id, label: r.label, kind: r.label_kind as Parameters<PgLabelEmbeddingRepo['put']>[0]['kind'], text: r.text, why: r.why, picture: r.picture }, POST_SPACE, values)),
        }));
      },
    },
    /* The namer's example posts (0076). */
    names: {
      async count(db) {
        const [r] = await db.query<{ n: string }>(
          `select count(distinct v.item_id) as n from internal.name_example_embedding v
            where v.space <> $1 and not exists (select 1 from internal.name_example_embedding n where n.item_id = v.item_id and n.space = $1)`,
          [POST_SPACE],
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
          [POST_SPACE, PAGE, ...(given ?? [])],
        );
        const repo = new PgNameExampleRepo(db);
        return rows.map((r) => ({
          key: [r.at, r.item_id],
          input: embedInput(r.text ?? '', r.picture ?? postPicture(r.media), P),
          write: async (values) => void (await repo.putVectors([{ itemId: r.item_id, values }], POST_SPACE)),
        }));
      },
    },
    pictures: pictureSource('item', null),
    coins: pictureSource('asset', coinSinceMs),
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
          [SPACE, PAGE, ...(given ?? [])],
        );
        const repo = new PgCoinedPictureRepo(db);
        return rows.map((r) => ({ key: [r.embedded_at, r.uri], input: { media: image(r.uri) }, write: (values) => repo.put(r.uri, r.coin_ref, SPACE, vec(values)) }));
      },
    },
  };
}

/* Post pictures ('item', 0027) and coin pictures ('asset'), each one vector per picture address. */
function pictureSource(kind: 'item' | 'asset', sinceMs: number | null): Source {
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
        [SPACE, kind, since, PAGE, ...(given ?? [])],
      );
      const repo = new PgImageEmbeddingRepo(db);
      return rows.map((r) => ({
        key: [r.embedded_at, r.subject_id, r.uri],
        input: { media: image(r.uri) },
        write: (values) => repo.record(kind, r.subject_id, r.uri, SPACE, values, Date.now() as Millis),
      }));
    },
  };
}

async function run(): Promise<void> {
  const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-reembed' });
  if (!live) pool.on('connect', (c) => void c.query('set default_transaction_read_only = on'));
  const db = asDb(pool);
  const all = sources();
  const kinds = KINDS.filter((k) => only.has(k));
  try {
    if (!live) {
      let totalMs = 0;
      console.log(`DRY RUN, read only: rows still to embed into ${SPACE} / ${POST_SPACE} (coins: embedded since ${new Date(coinSinceMs).toISOString().slice(0, 10)}).`);
      for (const k of KINDS) {
        if (!only.has(k)) continue;
        const c = await all[k].count(db);
        const ms = c.pictures * MS_PER_PICTURE + c.rows * MS_PER_TEXT;
        totalMs += ms;
        /* Two pages read, as the run would walk them, so a broken work-list query shows here and not mid-run. */
        const first = await all[k].page(db, null);
        const next = first.length === 0 ? [] : await all[k].page(db, first[first.length - 1]!.key);
        console.log(`  ${k.padEnd(9)} pages read: ${first.length} then ${next.length} (newest ${first[0]?.key[0] ?? '-'})`);
        console.log(`  ${k.padEnd(9)} ${String(c.rows).padStart(8)} rows (${c.pictures} with a picture, at most)  ≈ ${(ms / 3_600_000).toFixed(1)} h at one request at a time`);
      }
      console.log(`  total ≈ ${(totalMs / 3_600_000).toFixed(1)} h at the assumed rates (--ms-per-picture, --ms-per-text). The service runs one inference at a time, so --concurrency only overlaps the downloads with it; it does not divide this.`);
      console.log('Writes nothing. Pass --yes to embed (EMBED_SERVICE_URL and EMBED_SECRET set; `coined` needs 0136 applied).');
      return;
    }
    const baseUrl = (process.env['EMBED_SERVICE_URL'] ?? '').trim();
    const secret = (process.env['EMBED_SECRET'] ?? '').trim();
    if (baseUrl === '' || secret === '') throw new Error('EMBED_SERVICE_URL and EMBED_SECRET must be set');
    const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: () => Date.now() });
    const port = selfEmbed({ client: httpClient({ baseUrl, secret, fetch: globalThis.fetch }), meter, now: () => Date.now() as Millis });
    const budget = { capUsd: 1, spentUsd: 0, maxCalls: null, deadline: (Date.now() + 365 * 86_400_000) as Millis };
    for (const k of kinds) {
      let cursor: readonly string[] | null = null;
      let done = 0;
      let unread = 0;
      const started = Date.now();
      for (;;) {
        const rows = await all[k].page(db, cursor);
        if (rows.length === 0 || done >= limit) break;
        cursor = rows[rows.length - 1]!.key;
        const chunks: Row[][] = [];
        for (let i = 0; i < rows.length; i += port.maxBatch) chunks.push(rows.slice(i, i + port.maxBatch));
        for (let i = 0; i < chunks.length; i += concurrency) {
          await Promise.all(
            chunks.slice(i, i + concurrency).map(async (chunk) => {
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
        const rate = done / Math.max(1, (Date.now() - started) / 1_000);
        console.log(`${k}: ${done} done (${unread} unread), ${rate.toFixed(1)}/s`);
      }
      console.log(`${k}: finished, ${done - unread} written, ${unread} could not be read (asked again next run).`);
    }
  } finally {
    await pool.end();
  }
}

await run();
