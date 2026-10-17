/**
 * `node --env-file=.env.local --experimental-strip-types tools/narratives.ts dry [--out <dir>] [--titles <n>]`
 *
 * THE NARRATIVES PASS, RUN READ-ONLY ON LIVE DATA, against the board it would replace. Runs the
 * runner's own pass (services/runner work/narratives.ts `group`) inside a read-only transaction —
 * nothing is written — and reports:
 *
 *   1. every narrative on the board now (public.board_row 'default') that the owner's rule removes,
 *      with its posts and why: too few posts that passed the judge (and what the others were), or
 *      posts that passed but are not one story (no two of them share meaning and a detail)
 *   2. the narratives the new grouping makes: title (the judge's names; with `--titles <n>`, the
 *      cheap open model's for the n biggest, a few hundredths of a cent each on the judge's key),
 *      posts by source, views, and the grouping pass's own timing
 *   3. the projector's board frame (services/project narrative-frame.ts) over that grouping, with
 *      the 0093 tables served from the pass and every write caught, never sent: the board's order,
 *      each page's post count, coin and views, and the frame's own timing
 *
 * `--out <dir>` writes removed.md and narratives.json there. Free without `--titles`: every vector
 * is already stored, nothing is embedded or judged.
 *
 * What breaks if changed carelessly: this must call the runner's `group`, never a copy of it, or
 * the dry run measures a grouping nobody runs (the reason tools/name-report.ts gives).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import type { Millis } from '../contracts/src/vocabulary.ts';
import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import type { TitlePort } from '../contracts/src/ports/titles.ts';
import { detailOf, isShillText, narrativeStanding, postPicture, sharedDetail, withJudgeCutoff } from '../core/src/index.ts';
import { DEFAULT_OPEN_MODEL, KNOWN_MODELS, isOpenJudgeId, openChatClient, openTitler, readOpenJudgeSetup } from '../adapters/judge/openai-compatible/src/index.ts';
import { inMemoryMeter } from '../adapters/meter/spend/src/index.ts';
import { asDb, createPool, DB_ROLE, PgLearningRepo, PgNarrativeRepo, withTransaction, type Db } from '../store/src/index.ts';
import { narrativeGrouper } from '../services/runner/src/work/narratives.ts';
import { projectNarrativeFrame } from '../services/project/src/narrative-frame.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const command = process.argv[2];
if (command !== 'dry') {
  console.error('usage: tools/narratives.ts dry [--out <dir>] [--titles <n>]');
  process.exit(2);
}
const out = arg('--out');
const titleCount = Number(arg('--titles') ?? 0);
const POST_SPACE = 'multimodal-3.1024.post';

const quiet = { info: () => {}, warn: (m: string, f?: unknown) => console.warn(m, f ?? ''), error: (m: string, f?: unknown) => console.error(m, f ?? ''), child: () => quiet };

function titlerFrom(env: NodeJS.ProcessEnv, meter: ReturnType<typeof inMemoryMeter>): TitlePort | null {
  const setup = readOpenJudgeSetup(env);
  if (setup.state !== 'configured') return null;
  const model = KNOWN_MODELS.find((m) => m.id === (setup.model || DEFAULT_OPEN_MODEL)) ?? null;
  if (model === null) return null;
  const client = openChatClient({ vendor: setup.vendor, apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: model.id, vision: false, maxOutputTokens: P.narrative.title.maxOutputTokens, timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs, maxFrameBytes: P.judge.maxFrameBytes, providers: setup.providers, router: setup.router !== false, fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  return openTitler({ client, meter, now: () => Date.now() as Millis, model, vendor: setup.vendor, providers: setup.providers, router: setup.router !== false, charsPerToken: P.judge.charsPerToken, maxOutputTokens: P.narrative.title.maxOutputTokens, maxTitleChars: P.narrative.title.maxTitleChars });
}

interface BoardStory {
  readonly id: string;
  readonly title: string;
  readonly posts: readonly string[];
}

async function board(db: Db): Promise<readonly BoardStory[]> {
  const rows = await db.query<{ story_id: string; title: string | null; ids: string[] | null }>(
    `select r.story_id, s.payload->>'title' as title,
            (select array_agg(e->>'evidenceId') from jsonb_array_elements(s.payload->'evidence') e) as ids
       from public.board_row r join public.story_view s using (story_id)
      where r.view_id = 'default' order by r."position"`,
  );
  return rows.map((r) => ({ id: r.story_id, title: r.title ?? '', posts: r.ids ?? [] }));
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-narratives-dry' });
try {
  await withTransaction(pool, async (db) => {
    await db.query('set transaction read only');
    const repo = new PgNarrativeRepo(db);
    const learning = new PgLearningRepo(db);
    const meter = inMemoryMeter({ dailyCapUsd: 0.05, softStop: 1, now: () => Date.now() });
    const grouper = narrativeGrouper({
      repo,
      save: async () => false,
      blockCutoff: async () => (await learning.latestApplied())?.cutoff ?? null,
      titler: null,
      embed: null,
      keepVectors: async () => false,
      meter,
      mode: 'dry',
      policy: P,
      postSpace: POST_SPACE,
      log: quiet,
      now: () => Date.now() as Millis,
    });
    const started = Date.now();
    const grouped = await grouper.group();
    const groupMs = Date.now() - started;
    if (typeof grouped === 'string') throw new Error(grouped);

    /* ── 1. the board now, held to the rule ── */
    const now = await board(db);
    const ids = [...new Set(now.flatMap((s) => s.posts))];
    const standing = await repo.standingRows(ids);
    const cutoff = (await learning.latestApplied())?.cutoff ?? null;
    const main = withJudgeCutoff(P, cutoff);
    const open = withJudgeCutoff(P, P.judge.openCutoff ?? cutoff);
    const why = new Map(standing.map((r) => {
      const answer = r.coinable === null || r.confidence === null || r.lookedAt === null ? null : { coinable: r.coinable, confidence: r.confidence, lookedAt: r.lookedAt, proposedName: r.proposedName };
      return [r.itemId, narrativeStanding({ answer, kindLabel: r.kindLabel, ownerCall: r.ownerCall, shill: isShillText(r.body, P.attention) || r.ownTalk }, isOpenJudgeId(r.judgeId) ? open : main)] as const;
    }));
    const vectors = await repo.vectors(ids, POST_SPACE, 'post');
    const pictures = await repo.vectors(ids, P.group.image.space, 'picture');
    const rowOf = new Map(standing.map((r) => [r.itemId, r] as const));
    const dot = (a: Float32Array, b: Float32Array) => a.reduce((t, x, i) => t + x * (b[i] ?? 0), 0);
    /* Why two or more good posts are still not one story: no vectors, not alike, or nothing shared. */
    const windowStart = Date.now() - P.narrative.windowMs;
    const inFeed = new Set((await db.query<{ item_id: string }>(`select distinct item_id from internal.item_found_by where item_id = any($1::text[])`, [ids])).map((r) => r.item_id));
    const notOneStory = (all: readonly string[]): string => {
      const fed = all.filter((g) => inFeed.has(g));
      if (fed.length < P.narrative.minPosts) return `its good posts are not feed posts: ${all.length - fed.length} of ${all.length} were found by searching the old story's name, never on the feed the judge reads`;
      const good = fed.filter((g) => (rowOf.get(g)?.atMs ?? 0) >= windowStart);
      if (good.length < P.narrative.minPosts) return `its good posts went up before the two-day window (${fed.length - good.length} of ${fed.length})`;
      const withV = good.filter((g) => vectors.has(g));
      if (withV.length < P.narrative.minPosts) return `its good posts have no meaning vector (${withV.length} of ${good.length} have one): not grouped, never scored as unlike`;
      let closest = -1;
      let linked = 0;
      for (let i = 0; i < withV.length; i += 1) for (let j = i + 1; j < withV.length; j += 1) {
        const [a, b] = [withV[i] ?? '', withV[j] ?? ''];
        const m = dot(vectors.get(a) as Float32Array, vectors.get(b) as Float32Array);
        closest = Math.max(closest, m);
        const ra = rowOf.get(a);
        const rb = rowOf.get(b);
        if (m < P.narrative.sameMeaning || ra === undefined || rb === undefined) continue;
        const d = (r: typeof ra) => detailOf({ itemId: r.itemId, atMs: r.atMs, text: r.body, names: [r.proposedName, ...r.alternateNames].filter((x): x is string => x !== null), hasPicture: postPicture(r.media) !== null }, P);
        const pa = pictures.get(a);
        const pb = pictures.get(b);
        if (sharedDetail(d(ra), d(rb), pa !== undefined && pb !== undefined && dot(pa, pb) >= P.group.image.likely) !== null) linked += 1;
      }
      if (closest < P.narrative.sameMeaning) return `its posts are not alike in meaning (closest pair ${closest.toFixed(2)}, the bar ${P.narrative.sameMeaning})`;
      if (linked === 0) return 'its posts are alike but share no name, picture or topic word';
      return 'its linked posts went into other narratives, or too far apart in time';
    };
    const narrativeOf = new Map<string, string>();
    for (const n of grouped.pass.narratives) if (n.shown) for (const m of n.members) narrativeOf.set(m, n.id);
    const removed: { story: BoardStory; cause: string; detail: string }[] = [];
    const kept: { story: BoardStory; into: readonly string[] }[] = [];
    const causes = new Map<string, number>();
    const postReasons = new Map<string, number>();
    for (const s of now) {
      const good = s.posts.filter((p) => why.get(p) === 'good');
      const bad = s.posts.filter((p) => why.get(p) !== 'good').map((p) => why.get(p) ?? 'not_found');
      for (const b of bad) postReasons.set(b, (postReasons.get(b) ?? 0) + 1);
      const counts = [...new Set(bad)].map((b) => `${bad.filter((x) => x === b).length} ${b}`).join(', ');
      const into = new Map<string, number>();
      for (const p of good) {
        const n = narrativeOf.get(p);
        if (n !== undefined) into.set(n, (into.get(n) ?? 0) + 1);
      }
      const together = [...into].filter(([, c]) => c >= P.narrative.minPosts).map(([n]) => n);
      let cause: string | null = null;
      if (good.length < P.narrative.minPosts) cause = good.length === 0 ? 'no post passed the judge' : 'only one post passed the judge';
      else if (together.length === 0) cause = notOneStory(good);
      if (cause === null) kept.push({ story: s, into: together });
      else {
        removed.push({ story: s, cause, detail: `${good.length} of ${s.posts.length} posts good${counts === '' ? '' : `; the others: ${counts}`}` });
        causes.set(cause, (causes.get(cause) ?? 0) + 1);
      }
    }

    /* ── 2. the new narratives ── */
    const shown = grouped.pass.narratives.filter((n) => n.shown);
    const titler = titleCount > 0 ? titlerFrom(process.env, meter) : null;
    const titles = new Map<string, string>();
    const nameOf = (members: readonly string[]): string => {
      const names = new Map<string, number>();
      for (const m of members) {
        const n = grouped.posts.get(m)?.proposedName;
        if (n !== null && n !== undefined && n.trim() !== '') names.set(n, (names.get(n) ?? 0) + 1);
      }
      return [...names].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? '(no name)';
    };
    if (titler !== null) {
      const biggest = [...shown].sort((a, b) => b.members.length - a.members.length).slice(0, titleCount);
      const r = await titler.title(biggest.map((n) => {
        const members = n.members.map((m) => grouped.posts.get(m)).filter((x) => x !== undefined);
        const seen = [...members].sort((a, b) => (grouped.reach.get(b.itemId) ?? -1) - (grouped.reach.get(a.itemId) ?? -1));
        return { ref: n.id, posts: seen.slice(0, P.narrative.title.postsSent).map((m) => m.body.slice(0, P.narrative.title.maxChars)), names: [...new Set(members.map((m) => m.proposedName).filter((x): x is string => x !== null))] };
      }), { capUsd: 0.05, spentUsd: 0, maxCalls: null, deadline: (Date.now() + 60_000) as Millis });
      for (const o of r.value) if (o.kind === 'titled') titles.set(o.ref, o.title);
      console.log(`titles: ${titles.size} of ${biggest.length} written, $${meter.line().spentUsd.toFixed(5)}`);
    }
    const describe = (n: (typeof shown)[number]) => {
      const members = n.members.map((m) => grouped.posts.get(m)).filter((x) => x !== undefined);
      const sources = new Map<string, number>();
      for (const m of members) sources.set(m.source, (sources.get(m.source) ?? 0) + 1);
      const views = members.reduce((s, m) => s + (grouped.reach.get(m.itemId) ?? 0), 0);
      return {
        id: n.id,
        title: titles.get(n.id) ?? nameOf(n.members),
        judgeName: nameOf(n.members),
        posts: n.members.length,
        sources: Object.fromEntries(sources),
        views,
        picture: members.map((m) => ({ m, v: grouped.reach.get(m.itemId) ?? -1 })).filter((x) => postPicture(x.m.media) !== null).sort((a, b) => b.v - a.v)[0]?.m.itemId ?? null,
        members: members.map((m) => ({ id: m.itemId, views: grouped.reach.get(m.itemId) ?? null, name: m.proposedName, text: m.body.replace(/\s+/g, ' ').slice(0, 100) })),
      };
    };
    const made = shown.map(describe).sort((a, b) => b.posts - a.posts || b.views - a.views);
    const mixed = made.filter((n) => Object.keys(n.sources).length > 1);

    const lines: string[] = [];
    lines.push(`# Narratives removed by the owner's rule (dry run, ${new Date().toISOString()})`, '');
    lines.push(`Board now: ${now.length} narratives. Removed: ${removed.length}. Kept (two or more good posts the new grouping also puts together): ${kept.length}.`, '');
    lines.push('## Removed, by cause', '');
    const short = (c: string) => c.replace(/ \(.*\)/, '').replace(/:.*/, '');
    const shortCauses = new Map<string, number>();
    for (const [c, k] of causes) shortCauses.set(short(c), (shortCauses.get(short(c)) ?? 0) + k);
    for (const [c, k] of [...shortCauses].sort((a, b) => b[1] - a[1])) lines.push(`- ${c}: ${k}`);
    lines.push('', 'The posts that kept them off, by why:', '');
    for (const [c, k] of [...postReasons].sort((a, b) => b[1] - a[1])) lines.push(`- ${c}: ${k} posts`);
    lines.push('', '## Every removed narrative', '', '| id | title | posts | why |', '|---|---|---|---|');
    for (const r of removed) lines.push(`| ${r.story.id} | ${r.story.title.replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 90)} | ${r.story.posts.join(', ')} | ${r.cause} (${r.detail}) |`);
    lines.push('', '## Kept', '', '| id | title | posts | in new narrative(s) |', '|---|---|---|---|');
    for (const k of kept) lines.push(`| ${k.story.id} | ${k.story.title.replace(/\|/g, '/').replace(/\s+/g, ' ').slice(0, 90)} | ${k.story.posts.length} | ${k.into.join(', ')} |`);
    lines.push('', `## The new grouping`, '', `Posts considered ${grouped.result.considered}, good ${grouped.result.good}, with a vector ${grouped.result.withVectors}; pairs close in meaning ${grouped.result.pairs}; narratives ${grouped.result.narratives}, shown ${grouped.result.shown}; ${mixed.length} mix sources. Grouping pass ${groupMs} ms.`, '');
    lines.push('Left out of the grouping, by why: ' + Object.entries(grouped.result.left).map(([k, v]) => `${k} ${v}`).join(', '), '');
    lines.push('| id | title | posts | sources | views |', '|---|---|---|---|---|');
    for (const n of made) lines.push(`| ${n.id} | ${n.title.replace(/\|/g, '/')} | ${n.posts} | ${Object.entries(n.sources).map(([k, v]) => `${k} ${v}`).join(', ')} | ${n.views} |`);
    const text = lines.join('\n');
    if (out !== null) {
      mkdirSync(out, { recursive: true });
      writeFileSync(`${out}/removed.md`, text + '\n');
      writeFileSync(`${out}/narratives.json`, JSON.stringify({ groupMs, result: grouped.result, removed, kept, made }, null, 1));
    }
    console.log(text.split('\n').slice(0, 12).join('\n'));
    console.log(`\nnew narratives shown: ${shown.length}; mixing sources: ${mixed.length}; grouping ${groupMs} ms`);
    for (const n of made.slice(0, 25)) console.log(`  ${String(n.posts).padStart(3)}  ${n.title.slice(0, 50).padEnd(50)} ${JSON.stringify(n.sources)} views ${n.views}`);

    /* ── 3. the projector's board frame over this grouping, nothing written ──
       The 0093 tables are served from the pass above; every write is caught and kept here. */
    const writes: { sql: string; params: readonly unknown[] }[] = [];
    const overlay: Db = {
      query: async <R extends Record<string, unknown>>(sql: string, params: readonly unknown[] = []): Promise<R[]> => {
        const q = sql.trim();
        if (/^(insert|delete|update)\b/i.test(q)) {
          writes.push({ sql: q, params });
          return [] as R[];
        }
        if (q.includes("to_regclass('internal.narrative')")) return [{ ok: true }] as unknown as R[];
        if (q.includes('from internal.narrative n')) {
          return grouped.pass.narratives.map((n) => ({ narrative_id: n.id, anchor_item: n.anchor, shown: n.shown, first_shown_at: new Date(), posts_changed_at: new Date(), title: titles.get(n.id) ?? null, title_posts: null, members: [...n.members].sort() })) as unknown as R[];
        }
        return db.query<R>(sql, params);
      },
    };
    const frameStarted = Date.now();
    const frame = await projectNarrativeFrame(overlay, 'default', { nowMs: Date.now() as Millis, sparkWindowMs: 30 * 60_000, marketFreshnessMs: P.market.readingFreshnessMs, feedFreshnessMs: P.assets.feedFreshnessMs }, Date.now() - 26 * 3_600_000, main, open);
    const frameMs = Date.now() - frameStarted;
    const pagesWritten = writes.filter((w) => w.sql.includes('public.story_view')).map((w) => JSON.parse(String(w.params[1])) as Record<string, unknown>);
    const boardOrder = writes.filter((w) => w.sql.includes('public.board_row') && w.sql.startsWith('insert')).map((w) => String(w.params[1]));
    const pageOf = new Map(pagesWritten.map((pg) => [String(pg['id']), pg] as const));
    const fl: string[] = ['', `## The board frame over it (projector, read-only, ${frameMs} ms)`, '', `${frame.boardRows} rows, ${frame.storyViews} pages, ${frame.posts} posts tagged; skipped ${frame.skipped}, withheld ${frame.withheld}.`, '', '| # | title | posts | evidence | summary | coin | views total (posts) | gained 1h (posts) |', '|---|---|---|---|---|---|---|---|'];
    boardOrder.forEach((id, i) => {
      const pg = pageOf.get(id);
      if (pg === undefined) return;
      const m = (x: unknown) => ((x as { v: number | null } | undefined)?.v ?? '-');
      const coins = pg['coins'] as Record<string, unknown>;
      const coin = coins['kind'] === 'one' ? `one ${String((coins['coin'] as Record<string, unknown>)['ticker'] ?? '')}` : coins['kind'] === 'unsure' ? `unsure ${String(coins['claimCount'])}` : String(coins['kind']);
      fl.push(`| ${i + 1} | ${String(pg['title']).replace(/\|/g, '/')} | ${String(pg['postCount'])} | ${(pg['evidence'] as unknown[]).length} | ${(pg['summary'] as string[])[0]} | ${coin} | ${m(pg['viewsTotal'])} (${String(pg['viewsTotalPosts'])}) | ${m(pg['viewsGained1h'])} (${String(pg['viewsGained1hPosts'])}) |`);
    });
    if (out !== null) {
      writeFileSync(`${out}/removed.md`, text + '\n' + fl.join('\n') + '\n');
      writeFileSync(`${out}/frame.json`, JSON.stringify({ frameMs, frame, boardOrder, pages: pagesWritten }, null, 1));
    }
    console.log(fl.join('\n'));
  });
} finally {
  await pool.end();
}
