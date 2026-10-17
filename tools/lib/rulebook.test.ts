/**
 * The owner's rulebook: what the writer is shown, what is kept of its answer, and the one paid call
 * on a fake host. Run: node --test --experimental-strip-types tools/lib/rulebook.test.ts
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULT_POLICY } from '../../contracts/src/policy.ts';
import { inMemoryMeter } from '../../adapters/meter/spend/src/index.ts';
import { RULEBOOK_HEADING, cleanRulebook, countCalls, rulebookRequest, standingDecisions, withOwnerRules, writeRulebook, type RulebookInput } from './rulebook.ts';

const P = DEFAULT_POLICY;

test('★ a note is counted only once two posts carry it, so one held-out post\'s note never reaches the writer', () => {
  const c = countCalls([
    { label: 'not', from: 'tap', note: 'Sports' },
    { label: 'not', from: 'tap', note: 'sports ' },
    { label: 'not', from: 'tap', note: 'a note about one post only' },
    { label: 'meme', from: 'missed', note: null },
  ], P);
  assert.deepEqual(c.noteCounts, [{ label: 'not', note: 'sports', n: 2 }]);
  assert.deepEqual(c.callCounts, { 'not (tap)': 3, 'meme (missed)': 1 });
});

test('the request carries the standing decisions, the counts and the block, and asks for at most maxRules', () => {
  const input: RulebookInput = { blockText: 'YES — people could coin this:\n  "a dog in a suit" — funny', noteCounts: [{ label: 'not', note: 'sports', n: 12 }], missedCounts: { never_found: 23 }, callCounts: { 'not (tap)': 85 } };
  const r = rulebookRequest(input, P);
  assert.match(r.user, new RegExp(`at most ${P.learning.rulebook.maxRules} rules`));
  assert.match(r.user, /SPORT/);
  assert.match(r.user, /no: "sports" × 12/);
  assert.match(r.user, /never_found: 23/);
  assert.match(r.user, /a dog in a suit/);
  assert.equal(r.maxOutputTokens, P.learning.rulebook.maxOutputTokens);
});

test('only rule lines are kept, at most maxRules and maxChars; none is null', () => {
  const many = Array.from({ length: 40 }, (_, i) => `- rule ${i}`).join('\n');
  const kept = cleanRulebook(`Here are the rules:\n${many}\n1. numbered too\nThanks!`, P);
  assert.equal(kept?.split('\n').length, P.learning.rulebook.maxRules);
  assert.ok(kept?.split('\n').every((l) => l.startsWith('- rule ')));
  assert.equal(cleanRulebook('No rules today.', P), null);
  const long = cleanRulebook(Array.from({ length: 25 }, () => `- ${'x'.repeat(400)}`).join('\n'), P);
  assert.ok((long?.length ?? 0) <= P.learning.rulebook.maxChars);
  assert.ok(long?.split('\n').every((l) => l.length <= P.learning.rulebook.maxRuleChars + 2));
});

const input: RulebookInput = { blockText: 'YES', noteCounts: [], missedCounts: {}, callCounts: {} };
const host = (reply: string, asked: string[]) =>
  (async (url: string | URL | Request, init?: RequestInit) => {
    asked.push(`${String(url)} ${typeof init?.body === 'string' ? (JSON.parse(init.body) as { model: string }).model : ''}`);
    if (String(url).endsWith('/models')) return new Response(JSON.stringify({ data: [{ id: 'meta-llama/llama-4-maverick', architecture: { input_modalities: ['text'] }, pricing: { prompt: '0.00000015', completion: '0.0000006' } }, { id: 'qwen/qwen-2.5-72b-instruct', architecture: { input_modalities: ['text'] }, pricing: { prompt: '0.00000012', completion: '0.00000039' } }] }));
    return new Response(JSON.stringify({ choices: [{ message: { content: reply } }], usage: { prompt_tokens: 5000, completion_tokens: 400, cost: 0.001 } }));
  }) as typeof globalThis.fetch;

test('★ written by the rulebook model on the open host, billed at the host\'s own figure', async () => {
  const asked: string[] = [];
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: Date.now });
  const w = await writeRulebook(input, { env: { OPENROUTER_API_KEY: 'k' }, meter, policy: P, fetch: host('- News people react to is yes.\n- Ads are no.', asked) });
  assert.deepEqual(w.rules, '- News people react to is yes.\n- Ads are no.');
  assert.ok(asked.every((a) => a.startsWith('https://openrouter.ai/')));
  assert.ok(asked.some((a) => a.endsWith('meta-llama/llama-4-maverick')), 'Llama 4 Maverick by default');
  assert.equal(meter.spentUsd('openrouter'), 0.001);
});

test('RULEBOOK_MODEL picks another writer', async () => {
  const asked: string[] = [];
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: Date.now });
  await writeRulebook(input, { env: { OPENROUTER_API_KEY: 'k', RULEBOOK_MODEL: 'qwen/qwen-2.5-72b-instruct' }, meter, policy: P, fetch: host('- x', asked) });
  assert.ok(asked.some((a) => a.endsWith('qwen/qwen-2.5-72b-instruct')));
});

test('a rulebook that cannot be written is left out with its reason, never invented', async () => {
  const meter = inMemoryMeter({ dailyCapUsd: 1, softStop: 1, now: Date.now });
  assert.equal((await writeRulebook(input, { env: {}, meter, policy: P })).rules, null, 'no key');
  const broke = inMemoryMeter({ dailyCapUsd: 0.000_001, softStop: 1, now: Date.now });
  const asked: string[] = [];
  const w = await writeRulebook(input, { env: { OPENROUTER_API_KEY: 'k' }, meter: broke, policy: P, fetch: host('- x', asked) });
  assert.equal(w.rules, null);
  assert.match('why' in w ? w.why : '', /cannot cover/);
  assert.ok(asked.every((a) => a.includes('/models')), 'refused before the call');
  const empty = await writeRulebook(input, { env: { OPENROUTER_API_KEY: 'k' }, meter, policy: P, fetch: host('I cannot help.', []) });
  assert.equal(empty.rules, null);
});

test('the heading names what the rules are', () => {
  assert.match(RULEBOOK_HEADING, /RULES/);
});

test("★ the owner's own rules go first, word for word, the written rules after, and stay when none was written", () => {
  const own = P.learning.rulebook.ownerRules;
  assert.ok(own.length > 0);
  const both = withOwnerRules('- a written rule', P)!;
  assert.deepEqual(both.split('\n'), [...own.map((r) => `- ${r}`), '- a written rule']);
  assert.equal(withOwnerRules(null, P), own.map((r) => `- ${r}`).join('\n'));
  assert.equal(withOwnerRules(null, { ...P, learning: { ...P.learning, rulebook: { ...P.learning.rulebook, ownerRules: [] } } }), null);
  for (const r of own) assert.ok(standingDecisions(P).includes(r), 'the writer is shown them as standing decisions');
});
