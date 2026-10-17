/**
 * THE OWNER'S RULEBOOK: a short written set of rules distilled from the owner's own inputs, rebuilt at
 * every re-tune and read by the feed's judge after the learned examples (the owner, 2026-10-16: "a
 * rulebook built from all my inputs, rebuilt at every re-tune").
 *
 * Its own file because it has three parts that must stay apart: what the writer is shown (`rulebookInput`,
 * pure), what it is asked (`rulebookRequest`, pure) and what is kept of its answer (`cleanRulebook`,
 * pure) — the one paid call between them (`writeRulebook`) is the only part that touches the network.
 *
 * ★ WRITTEN ONLY FROM WHAT THE BLOCK MAY TEACH (my call). The rulebook travels inside the block's text
 * (eval examples.ts `withRulebook`), so the re-tune's gate tests block and rulebook together on the
 * held-out posts. A rule written from a held-out post's words, its note or its diagnosis would grade
 * the rulebook on its own answer key. So the writer is shown the block's own lines (the owner's taught
 * calls with their notes, the coined posts, the names), the owner's standing decisions in settings,
 * and COUNTS over every input the owner gave (how often each note was used, how the missed posts were
 * missed) — counts say what the owner cares about without saying how any one test post was called.
 * A note is counted only once it was given to `minNoteUses` posts and is cut to `maxNoteChars`: a
 * note used once describes one post, which may be a held-out one.
 *
 * ★ A BIGGER OPEN MODEL WRITES IT (the owner, 2026-10-16: Llama 4 Maverick or Qwen on the router,
 * pennies a run). RULEBOOK_MODEL names it; meta-llama/llama-4-maverick by default. Not the judge's
 * model: writing general rules from a hundred examples is a different job from answering ten posts.
 * The call is priced before it leaves (its listed prices, every character at the policy's characters
 * per token, the whole answer budget, doubled) and refused by the meter when the line cannot cover
 * it; the host's own dollar figure is what is recorded.
 *
 * ★ THE OWNER'S OWN RULES GO FIRST (`withOwnerRules`, Policy.learning.rulebook.ownerRules): word
 * for word, above whatever the writer wrote, and the writer is shown them as standing decisions.
 *
 * ★ A RULEBOOK THAT CANNOT BE WRITTEN IS LEFT OUT, NEVER INVENTED. No key, no money, an error, or an
 * answer with no rule in it: the block goes to its test without one (the owner's own rules still
 * in it), and the run says why.
 *
 * What breaks if changed carelessly: anything a held-out post says reaching `rulebookInput`. The gate
 * would then measure a rulebook that had seen the test.
 */

import type { Millis } from '../../contracts/src/index.ts';
import type { Policy } from '../../contracts/src/policy.ts';
import type { Meter } from '../../contracts/src/ports/meter.ts';
import { DEFAULT_BASE_URL, DEFAULT_VENDOR, closestModel, listModels, type HostModel } from '../../adapters/judge/openai-compatible/src/index.ts';

export const RULEBOOK_MODEL_ENV = 'RULEBOOK_MODEL';
export const DEFAULT_RULEBOOK_MODEL = 'meta-llama/llama-4-maverick';
/** The ledger's endpoint for the writer's call; the learning book adds its prefix. */
export const RULEBOOK_ENDPOINT = 'rulebook';
/** How far over the estimate a call may come (the open judge's margin). */
const MARGIN = 2;

/** What the writer is shown. Every field is from the block or the policy, or a count — see the header. */
export interface RulebookInput {
  /** The block's own text: the taught calls with the owner's notes, the coined posts, the names. */
  readonly blockText: string;
  /** How often the owner gave each note, over every call (lower-cased, trimmed), most used first. */
  readonly noteCounts: readonly { readonly label: 'meme' | 'not'; readonly note: string; readonly n: number }[];
  /** How the owner's missed posts were missed, counted. */
  readonly missedCounts: Readonly<Record<string, number>>;
  /** The owner's calls, counted by label and by where they came from. */
  readonly callCounts: Readonly<Record<string, number>>;
}

/** Counts over every call: notes by label, calls by label and source. Words of no post. */
export function countCalls(calls: readonly { readonly label: 'meme' | 'not'; readonly from: string; readonly note: string | null }[], p: Policy): Pick<RulebookInput, 'noteCounts' | 'callCounts'> {
  const R = p.learning.rulebook;
  const notes = new Map<string, { label: 'meme' | 'not'; note: string; n: number }>();
  const callCounts: Record<string, number> = {};
  for (const c of calls) {
    callCounts[`${c.label} (${c.from})`] = (callCounts[`${c.label} (${c.from})`] ?? 0) + 1;
    const note = (c.note ?? '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, R.maxNoteChars);
    if (note === '') continue;
    const key = `${c.label}|${note}`;
    const had = notes.get(key);
    notes.set(key, { label: c.label, note, n: (had?.n ?? 0) + 1 });
  }
  return { noteCounts: [...notes.values()].filter((n) => n.n >= R.minNoteUses).sort((a, b) => b.n - a.n || (a.note < b.note ? -1 : 1)), callCounts };
}

/** The owner's standing decisions in settings, in words, so the rulebook never argues with them. */
export function standingDecisions(p: Policy): readonly string[] {
  return [
    `Posts of these kinds are never shown, whatever the first answer: ${p.judge.heldKinds.filter((k) => k !== 'NOT_MEME_MATCH').join(', ')}.`,
    'A post very close to one the owner called "not a meme" is held back.',
    'A post that is itself coin promotion (a shill) never passes.',
    'Tragedies and company or media news are not held back: people coin them.',
    `A post several people launched coins for, the first of them at least ${Math.round(p.learning.coinedYes.lateMs / 60_000)} minutes AFTER the post went up, is yes: the crowd found it on its own.`,
    ...p.learning.rulebook.ownerRules,
  ];
}

/**
 * ★ THE OWNER'S OWN RULES FIRST (Policy.learning.rulebook.ownerRules, the owner 2026-10-17): word for
 * word, at the top of the rulebook, and the written rules after them. Present when no rule could be
 * written too — the owner's rule is not the writer's to lose — so the block always carries it. Not
 * held to the written rules' caps: those bound what a model may add, not what the owner said.
 */
export function withOwnerRules(written: string | null, p: Policy): string | null {
  const own = p.learning.rulebook.ownerRules.map((r) => r.replace(/\s+/g, ' ').trim()).filter((r) => r !== '').map((r) => `- ${r}`);
  const lines = [...own, ...(written === null || written.trim() === '' ? [] : [written.trim()])];
  return lines.length === 0 ? null : lines.join('\n');
}

/** The writer's request: the system words, the user words, and the answer budget. */
export function rulebookRequest(input: RulebookInput, p: Policy): { readonly system: string; readonly user: string; readonly maxOutputTokens: number } {
  const R = p.learning.rulebook;
  const notes = input.noteCounts.slice(0, R.maxNotes).map((n) => `  ${n.label === 'meme' ? 'yes' : 'no'}: "${n.note}" × ${n.n}`);
  const counts = (r: Readonly<Record<string, number>>) => Object.entries(r).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`);
  const system = [
    'You write the rulebook for a judge. The judge reads one social post at a time and answers one question:',
    'could people launch a meme coin about this post — is it the kind of moment a crowd turns into a coin?',
    "The rulebook is the owner's own line, written down: general rules the judge can apply to posts it has never seen.",
  ].join(' ');
  const user = [
    `Write at most ${R.maxRules} rules, one per line, each line starting "- ". Each rule is one plain sentence that says which posts are yes or which are no, and why.`,
    'Generalise: name kinds of posts, subjects, tones and signals — never a single post, an account name, a post id or a coin address.',
    'Never contradict the standing decisions. Where the owner\'s calls disagree, follow the newer and the more common call. No title, no numbering, nothing but the rules.',
    '',
    "THE OWNER'S STANDING DECISIONS:",
    ...standingDecisions(p).map((d) => `- ${d}`),
    '',
    "HOW OFTEN THE OWNER GAVE EACH REASON (over every call the owner made):",
    ...(notes.length === 0 ? ['  (none)'] : notes),
    '',
    "THE OWNER'S CALLS, COUNTED:",
    ...counts(input.callCounts),
    '',
    'HOW THE POSTS THE OWNER SAYS WE MISSED WERE MISSED, COUNTED:',
    ...(Object.keys(input.missedCounts).length === 0 ? ['  (none)'] : counts(input.missedCounts)),
    '',
    "THE OWNER'S CALLS ON REAL POSTS (the examples the judge is also shown):",
    input.blockText,
  ].join('\n');
  return { system, user, maxOutputTokens: R.maxOutputTokens };
}

/** The heading the rulebook goes under in the block (eval examples.ts `withRulebook` puts it there). */
export const RULEBOOK_HEADING = "THE OWNER'S RULES — written at this re-tune from the owner's calls and standing decisions; apply them with the examples:";

/**
 * What is kept of the writer's answer: its lines that start with "- " (or "* " or "• ", as "- "),
 * at most `maxRules`, each at most `maxRuleChars`, until `maxChars`; null when none is left.
 */
export function cleanRulebook(text: string, p: Policy): string | null {
  const R = p.learning.rulebook;
  const kept: string[] = [];
  let chars = 0;
  for (const raw of text.split('\n')) {
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(.+?)\s*$/.exec(raw);
    if (m === null) continue;
    const rule = (m[1] ?? '').replace(/\s+/g, ' ').slice(0, R.maxRuleChars).trim();
    if (rule === '' || kept.length >= R.maxRules || chars + rule.length + 3 > R.maxChars) continue;
    kept.push(`- ${rule}`);
    chars += rule.length + 3;
  }
  return kept.length === 0 ? null : kept.join('\n');
}

export type Written = { readonly rules: string; readonly model: string; readonly usd: number } | { readonly rules: null; readonly why: string; readonly usd: number };

/** The one paid call. Never throws: a failure is a reason, and the block is tested without a rulebook. */
export async function writeRulebook(input: RulebookInput, o: { readonly env: Record<string, string | undefined>; readonly meter: Meter; readonly policy: Policy; readonly fetch?: typeof globalThis.fetch; readonly now?: () => number }): Promise<Written> {
  const fetch = o.fetch ?? globalThis.fetch;
  const now = o.now ?? Date.now;
  const key = (o.env['OPENROUTER_API_KEY'] ?? '').trim();
  if (key === '') return { rules: null, why: 'OPENROUTER_API_KEY is not set', usd: 0 };
  const base = (o.env['OPENROUTER_BASE_URL'] ?? '').trim() || DEFAULT_BASE_URL;
  const asked = (o.env[RULEBOOK_MODEL_ENV] ?? '').trim() || DEFAULT_RULEBOOK_MODEL;
  let model: HostModel | null;
  try {
    model = closestModel(asked, await listModels(fetch, base, o.policy.judge.timeoutMs));
  } catch (e) {
    return { rules: null, why: `the host's model list could not be read: ${e instanceof Error ? e.message : String(e)}`, usd: 0 };
  }
  if (model === null || model.usdPerInputToken === null || model.usdPerOutputToken === null) return { rules: null, why: `the host lists no priced model like ${asked}`, usd: 0 };
  const req = rulebookRequest(input, o.policy);
  const estimate = ((req.system.length + req.user.length) / o.policy.judge.charsPerToken * model.usdPerInputToken + req.maxOutputTokens * model.usdPerOutputToken) * MARGIN;
  if (!o.meter.mayspend(DEFAULT_VENDOR, estimate)) return { rules: null, why: `the learning line cannot cover the writer's $${estimate.toFixed(4)}`, usd: 0 };
  let body: Record<string, unknown>;
  try {
    const res = await fetch(`${base.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: model.id, max_tokens: req.maxOutputTokens, temperature: 0, messages: [{ role: 'system', content: req.system }, { role: 'user', content: req.user }], usage: { include: true } }),
      signal: AbortSignal.timeout(o.policy.judge.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      /* A status is an answer: the host billed nothing for it. */
      return { rules: null, why: `the writer answered ${res.status}`, usd: 0 };
    }
    body = JSON.parse(text) as Record<string, unknown>;
  } catch (e) {
    /* A lost reply may have been billed: booked at the estimate, the safe direction. */
    o.meter.record({ vendor: DEFAULT_VENDOR, endpoint: RULEBOOK_ENDPOINT, unit: 'per-call', units: 1, usd: estimate, at: now() as Millis });
    return { rules: null, why: `the writer's call failed: ${e instanceof Error ? e.message : String(e)}`, usd: estimate };
  }
  const usage = (body['usage'] ?? {}) as Record<string, unknown>;
  const cost = typeof usage['cost'] === 'number' && Number.isFinite(usage['cost']) ? usage['cost'] : null;
  const tokensIn = typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : 0;
  const tokensOut = typeof usage['completion_tokens'] === 'number' ? usage['completion_tokens'] : 0;
  const usd = cost ?? tokensIn * model.usdPerInputToken + tokensOut * model.usdPerOutputToken;
  o.meter.record({ vendor: DEFAULT_VENDOR, endpoint: RULEBOOK_ENDPOINT, unit: 'per-call', units: 1, usd, at: now() as Millis });
  const choice = (Array.isArray(body['choices']) ? body['choices'][0] : null) as { message?: { content?: unknown } } | null;
  const content = typeof choice?.message?.content === 'string' ? choice.message.content : '';
  const rules = cleanRulebook(content, o.policy);
  return rules === null ? { rules: null, why: 'the writer gave no rule', usd } : { rules, model: model.id, usd };
}
