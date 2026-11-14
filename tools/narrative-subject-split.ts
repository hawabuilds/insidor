/**
 * `node --env-file=.env.local --experimental-strip-types tools/narrative-subject-split.ts [dry] [--out <file.md>]`
 * `node --env-file=.env.local --experimental-strip-types tools/narrative-subject-split.ts live [--out <file.md>]`
 *
 * TAKE OUT OF EACH NARRATIVE THE POSTS THAT ARE NOT ABOUT ITS SUBJECT (the owner, 2026-11-14: "loads
 * of posts are grouped into the same narrative where they don't share the same exact character or
 * meme"). Run once, after policy.v242's subject rule is live: the rule stops new mixing, but
 * narratives are permanent, so what was mixed before stays mixed until this runs. The worst: one
 * narrative held 2,023 posts, 5% of them about its title's subject, after the quotes-and-closeness
 * merge folded 90 narratives into it.
 *
 * For each open narrative of three posts or more that the owner never made a call on, and that is
 * not a meme war between countries (those are one story by their own rule, core group/fight-native.ts):
 *
 *   its subject   the distinctive judge name (core `subjectName`) most of its posts carry, counting
 *                 one family as one ("jensen" with "jensenhuang"); a narrative none of whose posts
 *                 carries one is left as it is — without its pictures we cannot tell
 *   stays         a post that names that subject or says it in its words (core `sameSubjectNamed`,
 *                 the live rule's own test)
 *   back          a narrative the automatic "same story" merge folded into it comes back under its own
 *                 id and title with the leaving posts about ITS anchor post's subject, when there are
 *                 two or more (store PgNarrativeRepo `unmerge`)
 *   released      every other leaving post goes into no narrative (store `release`); the next pass
 *                 may group the ones still in its window again, by the subject rule
 *
 * Names and words only — every judge answer and post text is kept for good, while post vectors are
 * kept three days — so it reaches back over every narrative. Free: nothing embedded, judged or
 * titled. `dry` (the default) reads only; `live` writes in one transaction. Safe to run again: a
 * second run finds nothing leaving.
 *
 * What breaks if changed carelessly: the owner's narratives. Any narrative he made a call on — a
 * merge, a split, an added or removed post, a title, a coin — is never touched, nor any post in it.
 */

import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY as P } from '../contracts/src/policy.ts';
import { compactName, detailOf, oneFamily, sameSubjectNamed, subjectName, type NarrativePost, type PostDetail } from '../core/src/index.ts';
import { createPool, DB_ROLE, PgNarrativeRepo, withTransaction } from '../store/src/index.ts';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(name);
  return i < 0 ? null : (process.argv[i + 1] ?? null);
};
const mode = process.argv[2] === 'live' ? 'live' : 'dry';
const MIN_MEMBERS = 3;
const FAMILY = P.narrative.same.familyMinChars;

interface Narr { id: string; title: string | null; count: number }
interface Folded { id: string; title: string | null; into: string; anchor: string; at: number }
interface Plan {
  readonly id: string;
  readonly title: string | null;
  readonly subject: string;
  readonly before: number;
  readonly back: readonly { readonly id: string; readonly title: string | null; readonly items: readonly string[] }[];
  readonly released: readonly string[];
  readonly releasedNames: ReadonlyMap<string, number>;
}

const pool = createPool(DB_ROLE.internal, { env: { DATABASE_URL_INTERNAL: process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'] }, applicationName: 'insidor-subject-split' });
const started = Date.now();
try {
  const plans = await withTransaction(pool, async (db) => {
    await db.query('set transaction read only');
    const repo = new PgNarrativeRepo(db);
    /* His edits to a narrative's posts or title keep it as he left it; "Not a narrative" and his coin calls do not
       (the 2,023-post blob was called Not a narrative on 4 Nov and came back on the posts it took after). */
    const EDITS = new Set(['merge', 'split', 'remove_post', 'add_post', 'rename']);
    const untouchable = new Set((await repo.calls()).filter((c) => EDITS.has(c.verdict)).flatMap((c) => [c.narrativeId, ...(c.verdict === 'merge' && c.otherId !== null ? [c.otherId] : [])]));
    const open = (await db.query<{ narrative_id: string; title: string | null; member_count: number }>(
      `select narrative_id, title, member_count from internal.narrative
        where state = 'open' and member_count >= $1 and (fight is null or cardinality(fight) = 0)`,
      [MIN_MEMBERS],
    )).filter((r) => !untouchable.has(r.narrative_id)).map((r): Narr => ({ id: r.narrative_id, title: r.title, count: r.member_count }));
    const folded = (await db.query<{ narrative_id: string; title: string | null; merged_into: string; anchor_item: string; created_at: Date }>(
      `select narrative_id, title, merged_into, anchor_item, created_at from internal.narrative where state = 'merged' and merged_by = 'same_story'`,
    )).filter((r) => !untouchable.has(r.narrative_id)).map((r): Folded => ({ id: r.narrative_id, title: r.title, into: r.merged_into, anchor: r.anchor_item, at: r.created_at.getTime() }));
    const ids = open.map((n) => n.id);
    const members = await db.query<{ narrative_id: string; item_id: string }>(
      `select narrative_id, item_id from internal.narrative_member where narrative_id = any($1::text[])`,
      [ids],
    );
    const items = [...new Set([...members.map((m) => m.item_id), ...folded.map((f) => f.anchor)])];
    const facts = new Map<string, { names: string[]; text: string }>();
    for (let i = 0; i < items.length; i += 5_000) {
      const rows = await db.query<{ item_id: string; body: string | null; proposed_name: string | null; alternate_names: string[] | null }>(
        `select x.item_id, it.body, j.proposed_name, j.alternate_names
           from unnest($1::text[]) as x(item_id)
           left join public.item it on it.item_id = x.item_id
           left join lateral (select pj.proposed_name, pj.alternate_names from internal.post_judgement pj
                               where pj.item_id = x.item_id and pj.prompt_id not like 'post-kind%'
                               order by pj.judged_at desc, pj.id desc limit 1) j on true`,
        [items.slice(i, i + 5_000)],
      );
      for (const r of rows) facts.set(r.item_id, { names: [r.proposed_name, ...(r.alternate_names ?? [])].filter((n): n is string => n !== null && n.trim() !== ''), text: r.body ?? '' });
    }
    const detailCache = new Map<string, PostDetail>();
    const detail = (id: string): PostDetail => {
      let d = detailCache.get(id);
      if (d === undefined) {
        const f = facts.get(id) ?? { names: [], text: '' };
        const post: NarrativePost = { itemId: id, atMs: 0, text: f.text, names: f.names, hasPicture: false };
        d = detailOf(post, P);
        detailCache.set(id, d);
      }
      return d;
    };
    /* The subject a set of posts is about: the distinctive name whose family most of them carry, and its raw spelling. */
    const subjectOf = (posts: readonly string[]): { key: string; raw: string } | null => {
      const raw = new Map<string, string>();
      for (const id of posts) for (const n of facts.get(id)?.names ?? []) {
        const k = subjectName(n, P);
        if (k !== null && !raw.has(k)) raw.set(k, n);
      }
      let best: { key: string; raw: string; count: number } | null = null;
      for (const [k, r] of raw) {
        const count = posts.filter((id) => [...detail(id).subjects].some((s) => oneFamily(s, k, FAMILY))).length;
        if (best === null || count > best.count || (count === best.count && (k.length < best.key.length || (k.length === best.key.length && k < best.key)))) best = { key: k, raw: r, count };
      }
      return best === null ? null : { key: best.key, raw: best.raw };
    };
    const about = (subject: { raw: string }) => detailOf({ itemId: '', atMs: 0, text: '', names: [subject.raw], hasPicture: false }, P);
    const main0 = about;
    /* A post stays when the live rule says it is about the subject — or, more leniently here, when a name
       of its own (generic ones too: SHIBA in a Shiba Inu story) is of the subject's family, or its words
       run together hold the subject ("GTA 6" in a post the judge named GTAVI). This only keeps posts. */
    const stays = (id: string, key: string, main: PostDetail): boolean => {
      if (sameSubjectNamed(detail(id), main, FAMILY)) return true;
      const f = facts.get(id);
      if ((f?.names ?? []).some((n) => oneFamily(compactName(n), key, FAMILY))) return true;
      return key.length >= 4 && compactName(f?.text ?? '').includes(key);
    };

    const byNarr = new Map<string, string[]>();
    for (const m of members) byNarr.set(m.narrative_id, [...(byNarr.get(m.narrative_id) ?? []), m.item_id]);
    const foldedInto = new Map<string, Folded[]>();
    for (const f of folded) foldedInto.set(f.into, [...(foldedInto.get(f.into) ?? []), f]);

    const out: Plan[] = [];
    for (const n of open) {
      const posts = byNarr.get(n.id) ?? [];
      const subject = subjectOf(posts);
      if (subject === null) continue;
      /* ★ WHEN WE CANNOT TELL, IT STAYS AS IT IS: when more of its posts carry no judge name, or one
         generic kind's name (HAMSTER, PANDA, PEPE), than carry its subject, the subject is a minor name
         and the narrative is about something only its pictures could show. */
      const carries = posts.filter((id) => stays(id, subject.key, main0(subject))).length;
      const unnamed = posts.filter((id) => (facts.get(id)?.names.length ?? 0) === 0).length;
      const kinds = new Map<string, number>();
      for (const id of posts) {
        const first = facts.get(id)?.names[0];
        if (first !== undefined && subjectName(first, P) === null) kinds.set(compactName(first), (kinds.get(compactName(first)) ?? 0) + 1);
      }
      if (unnamed > carries || Math.max(0, ...kinds.values()) > carries) continue;
      const main = main0(subject);
      const leaving = posts.filter((id) => !stays(id, subject.key, main));
      if (leaving.length === 0) continue;
      let pool2 = [...leaving];
      const back: Plan['back'][number][] = [];
      for (const f of [...(foldedInto.get(n.id) ?? [])].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
        if (!pool2.includes(f.anchor)) continue;
        const own = subjectOf([f.anchor]);
        if (own === null) continue;
        const theirs = about(own);
        const mine = pool2.filter((id) => sameSubjectNamed(detail(id), theirs, FAMILY));
        if (mine.length < 2) continue;
        back.push({ id: f.id, title: f.title, items: mine });
        pool2 = pool2.filter((id) => !mine.includes(id));
      }
      const releasedNames = new Map<string, number>();
      for (const id of pool2) {
        const k = facts.get(id)?.names[0]?.toUpperCase() ?? '-';
        releasedNames.set(k, (releasedNames.get(k) ?? 0) + 1);
      }
      out.push({ id: n.id, title: n.title, subject: subject.key, before: posts.length, back, released: pool2, releasedNames });
    }
    return out;
  });

  if (mode === 'live') {
    const done = await withTransaction(pool, async (db) => {
      const repo = new PgNarrativeRepo(db);
      let reopened = 0;
      let released = 0;
      for (const plan of plans) {
        reopened += await repo.unmerge(plan.back.map((b) => ({ id: b.id, from: plan.id, items: b.items })));
        released += await repo.release(plan.id, plan.released);
      }
      return { reopened, released };
    });
    console.log(`written: ${done.reopened} narratives back, ${done.released} posts released`);
  }

  const totalBack = plans.reduce((s, x) => s + x.back.length, 0);
  const totalReleased = plans.reduce((s, x) => s + x.released.length, 0);
  const moved = plans.reduce((s, x) => s + x.back.reduce((t, b) => t + b.items.length, 0), 0);
  const lines = [
    `# Posts out of narratives not about them (${mode === 'live' ? 'written' : 'dry run: nothing written'}), ${new Date().toISOString().slice(0, 16)} UTC`,
    '',
    `${plans.length} narratives hold posts not about their subject: ${totalBack} folded narratives come back with ${moved} posts, ${totalReleased} posts go into no narrative. Planned in ${Date.now() - started} ms.`,
    '',
    '| narrative | title | subject | posts now | after | back | released (top judge names) |',
    '|---|---|---|---|---|---|---|',
    ...[...plans].sort((a, b) => b.released.length + b.back.length - (a.released.length + a.back.length)).map((x) => {
      const after = x.before - x.released.length - x.back.reduce((s, b) => s + b.items.length, 0);
      const names = [...x.releasedNames].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${v}`).join(', ');
      const back = x.back.map((b) => `${b.title ?? b.id} (${b.items.length})`).join('; ');
      return `| ${x.id} | ${x.title ?? ''} | ${x.subject} | ${x.before} | ${after} | ${back} | ${names} |`;
    }),
  ];
  console.log(lines.slice(0, 3).join('\n'));
  const out = arg('--out');
  if (out !== null) writeFileSync(out, lines.join('\n') + '\n');
} finally {
  await pool.end();
}
