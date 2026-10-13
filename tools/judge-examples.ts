/**
 * `node --experimental-strip-types tools/judge-examples.ts [--out=<file>]`
 *
 * BUILDS THE JUDGE'S LEARNED EXAMPLES: real posts the owner labelled, written as a block the feed's
 * post judge reads after its rules (`examples` in adapters/judge/anthropic). Free — no calls.
 *
 * Source: eval/src/feed/live-labels.json (the owner's corrections, `ownerLabel`, win over the first
 * labels; "unsure" posts are left out). Taps from the app join them once they exist.
 *
 * ★ A FIXED HALF IS HELD BACK. Each non-meme is put in the examples or in the test by a hash of its
 * post id, so the pass-rate tool can measure on posts the judge was never shown as examples; a
 * test made of the examples would grade nothing. Every labelled meme goes in the examples: the
 * gold set is the test for "yes".
 *
 * Output: eval/src/feed/judge-examples.json — { text, exampleIds } — `text` is what the judge reads.
 *
 * What breaks if changed carelessly: the split must stay a pure function of the post id. Anything
 * else (order, a random draw) moves posts between examples and test from one run to the next.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

interface Labelled { readonly itemId: string; readonly text: string; readonly imageUri: string | null; readonly label: string; readonly ownerLabel?: string; readonly why: string }

const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? new URL('../eval/src/feed/judge-examples.json', import.meta.url).pathname;
const EXCERPT = 140;

/** Examples or test, by the post id alone. */
export const isExample = (itemId: string): boolean => (createHash('sha256').update(itemId).digest()[0] ?? 0) % 2 === 0;

const labels = (JSON.parse(readFileSync(new URL('../eval/src/feed/live-labels.json', import.meta.url), 'utf8')) as { posts: Labelled[] }).posts;
const excerpt = (t: string): string => t.replace(/https:\/\/t\.co\/\S+/g, '').replace(/\s+/g, ' ').trim().slice(0, EXCERPT);
const memes = labels.filter((p) => (p.ownerLabel ?? p.label) === 'meme');
const nots = labels.filter((p) => (p.ownerLabel ?? p.label) === 'not' && isExample(p.itemId));

const lines = [
  "THE OWNER'S OWN CALLS ON REAL POSTS FROM THE FEED",
  'Learn where the line is from these. [picture] means the post carried one.',
  '',
  'YES — people could coin this:',
  ...memes.map((p) => `  "${excerpt(p.text)}"${p.imageUri === null ? '' : ' [picture]'} — ${p.why}`),
  '',
  'NO — nothing to coin, though it may look busy:',
  ...nots.map((p) => `  "${excerpt(p.text)}"${p.imageUri === null ? '' : ' [picture]'} — ${p.why}`),
];
writeFileSync(OUT, `${JSON.stringify({ about: 'The judge\'s learned examples, built by tools/judge-examples.ts from the owner\'s labels. `exampleIds` are held out of every test.', builtAt: new Date().toISOString(), exampleIds: [...memes, ...nots].map((p) => p.itemId), text: lines.join('\n') }, null, 1)}\n`);
console.log(`${memes.length} yes and ${nots.length} no examples; ${labels.filter((p) => (p.ownerLabel ?? p.label) === 'not' && !isExample(p.itemId)).length} non-memes held back for the test; ${lines.join('\n').length} characters.`);
