/**
 * `SPEND=live node --env-file=.env.local --experimental-strip-types tools/judge-reasons.ts <rows.json> <out.json> [--ids=a,b,…] [--yes]`
 *
 * WHY THE JUDGE SAID WHAT IT SAID, FOR A HANDFUL OF POSTS. The feed's post question returns a
 * structured answer with no reason in it, on purpose: the live judge is paid per token and a
 * reason nobody reads is waste. When the owner asks why a post failed, this asks the SAME
 * question again — the live system prompt and post rules, the post's text and the picture as the
 * live judge would be shown it — with one extra request: a one-sentence reason. It is a separate
 * call and says so; the answer beside the reason may differ from the stored one, and both are kept.
 *
 * It also says whether each post's picture actually loaded, using the judge client's own frame
 * read (free: a fetch of the picture, no model call) at the live picture size. That runs without
 * --yes; the paid reasons need SPEND=live and --yes, and are metered on the learning book.
 *
 * Input: a rows file from `tools/retune.ts measure --rows=<file>`. Without --ids, every hand-gold
 * post (groups gold and missed) whose first answer did not pass is asked.
 *
 * What breaks if changed carelessly: the prompt must stay the live one (PROMPTS post-system and
 * post-coinability). A reason given to a different question explains a judge nobody runs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { DEFAULT_POLICY } from '../contracts/src/policy.ts';
import { PROMPTS, httpClient, priceFor, readJudgeSetup, VENDOR } from '../adapters/judge/anthropic/src/index.ts';
import { openSharedMeter } from './lib/shared-meter.ts';

const P = DEFAULT_POLICY;
/* A reason and a short answer fit well inside this. */
const MAX_OUTPUT_TOKENS = 400;

interface Row { readonly id: string; readonly group: string; readonly coinable: boolean | null; readonly firstPass: boolean; readonly confidence: number | null; readonly name: string | null; readonly lookedAt: string | null; readonly imageUri: string | null; readonly text: string }

const [rowsFile, outFile] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (rowsFile === undefined || outFile === undefined) {
  console.error('usage: tools/judge-reasons.ts <rows.json> <out.json> [--ids=a,b] [--yes]');
  process.exit(2);
}
const paid = process.env['SPEND'] === 'live' && process.argv.includes('--yes');
const idsArg = process.argv.find((a) => a.startsWith('--ids='))?.slice('--ids='.length) ?? null;
const rows = JSON.parse(readFileSync(rowsFile, 'utf8')) as Row[];
const chosen = idsArg !== null ? rows.filter((r) => idsArg.split(',').includes(r.id)) : rows.filter((r) => (r.group === 'gold' || r.group === 'missed') && r.coinable !== null && !r.firstPass);

const setup = readJudgeSetup(process.env);
if (setup.state !== 'configured') throw new Error(`the judge is ${setup.state}`);
const price = priceFor(setup.model);
if (price === null) throw new Error(`JUDGE_MODEL ${setup.model} has no price`);
const client = httpClient({
  apiKey: setup.apiKey, baseUrl: setup.baseUrl, model: setup.model, maxOutputTokens: MAX_OUTPUT_TOKENS, effort: price.effort,
  timeoutMs: P.judge.timeoutMs, maxAttempts: P.judge.maxAttempts, backoffMs: P.judge.backoffMs, maxWaitMs: P.judge.maxWaitMs,
  maxFrameBytes: P.judge.maxFrameBytes, pictureSize: 'small', fetch: globalThis.fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
});

const ASK = `${PROMPTS['post-coinability'].text}

For this one post, answer the question above as you would, and add one plain sentence saying why.
Reply with JSON only: {"coinable": true|false, "confidence": 0..1, "name": "NAME or null", "reason": "one sentence"}`;

const url = process.env['DATABASE_URL_INTERNAL'] || process.env['DATABASE_URL'];
const shared = paid ? await openSharedMeter(1, { ...process.env, ...(url === undefined ? {} : { DATABASE_URL_INTERNAL: url }) }, 'learning') : null;
const out: unknown[] = [];
let usd = 0;
try {
  for (const r of chosen) {
    const frame = r.imageUri === null ? null : await client.frame(r.imageUri).catch(() => null);
    const pictureLoaded = r.imageUri === null ? null : frame !== null;
    let asked: unknown = null;
    if (shared !== null) {
      const content: unknown[] = [{ type: 'text', text: `${ASK}\n\nThe post:\n${r.text}` }];
      if (frame !== null) content.push({ type: 'image', source: { type: 'base64', media_type: frame.mediaType, data: frame.base64 } });
      const res = await fetch(`${setup.baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': setup.apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: setup.model, max_tokens: MAX_OUTPUT_TOKENS, system: PROMPTS['post-system'].text, messages: [{ role: 'user', content }] }),
      });
      const body = (await res.json()) as { content?: { type: string; text?: string }[]; usage?: { input_tokens: number; output_tokens: number } };
      const cost = ((body.usage?.input_tokens ?? 0) * price.usdPerMillionInput + (body.usage?.output_tokens ?? 0) * price.usdPerMillionOutput) / 1e6;
      usd += cost;
      shared.meter.record({ vendor: VENDOR, endpoint: 'POST /v1/messages (reason)', unit: 'per-call', units: 1, usd: cost, at: Date.now() as never });
      const text = body.content?.find((c) => c.type === 'text')?.text ?? '';
      try {
        asked = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
      } catch {
        asked = { unparsed: text.slice(0, 300) };
      }
    }
    out.push({ id: r.id, group: r.group, text: r.text, imageUri: r.imageUri, pictureLoaded, lookedAt: r.lookedAt, stored: { coinable: r.coinable, confidence: r.confidence, name: r.name }, reasonCall: asked });
  }
} finally {
  await shared?.close();
}
writeFileSync(outFile, JSON.stringify(out, null, 1));
console.log(JSON.stringify({ posts: chosen.length, paid, usd: Number(usd.toFixed(4)) }));
