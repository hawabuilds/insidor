/**
 * `node --experimental-strip-types tools/judge-examples.ts [--out=<file>]`
 *
 * BUILDS THE JUDGE'S LEARNED EXAMPLES: real posts the owner labelled, written as a block the feed's
 * post judge reads after its rules (`examples` in adapters/judge/anthropic). Free — no calls.
 *
 * Source: eval/src/feed/live-labels.json (the owner's corrections, `ownerLabel`, win over the first
 * labels; "unsure" posts are left out). The twice-daily re-tune (tools/retune.ts) builds the same
 * block from this file AND the owner's taps, missed posts and name calls, and tests it before the
 * live judge reads it; this tool is the by-hand version of the labels half, for feed-pass-rates.
 * Both build through eval/src/feed/examples.ts, so they split and balance posts the same way.
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

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { postTimeFromId } from '../adapters/platform/x/src/index.ts';
import { buildBlock, type OwnerCall } from '../eval/src/feed/examples.ts';

interface Labelled { readonly itemId: string; readonly text: string; readonly imageUri: string | null; readonly label: string; readonly ownerLabel?: string; readonly why: string }

const OUT = process.argv.find((a) => a.startsWith('--out='))?.slice('--out='.length) ?? new URL('../eval/src/feed/judge-examples.json', import.meta.url).pathname;

const labels = (JSON.parse(readFileSync(new URL('../eval/src/feed/live-labels.json', import.meta.url), 'utf8')) as { posts: Labelled[] }).posts;
const calls: OwnerCall[] = labels.flatMap((p) => {
  const label = p.ownerLabel ?? p.label;
  const id = /^x:(\d+)$/.exec(p.itemId)?.[1];
  return label === 'meme' || label === 'not' ? [{ itemId: p.itemId, text: p.text, imageUri: p.imageUri, label, why: p.why, at: id === undefined ? null : postTimeFromId(id), from: 'labels' as const }] : [];
});
const block = buildBlock(calls, [], DEFAULT_POLICY.learning.maxExamples);
writeFileSync(OUT, `${JSON.stringify({ about: 'The judge\'s learned examples, built by tools/judge-examples.ts from the owner\'s labels. `exampleIds` are held out of every test.', builtAt: new Date().toISOString(), exampleIds: block.exampleIds, text: block.text }, null, 1)}\n`);
console.log(`${block.used.labels} examples (${calls.filter((c) => c.label === 'meme').length} labelled memes); ${block.testNegatives.length} non-memes held back for the test; ${block.text.length} characters.`);
