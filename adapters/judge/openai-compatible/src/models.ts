/**
 * WHICH MODELS THE HOST OFFERS, WHAT EACH COSTS, AND WHETHER IT CAN READ A PICTURE — read from the
 * host's public model list (`GET /models`, no key needed), never typed in by hand.
 *
 * Separate from client.ts because it is read once per run, before any paid call, and because the
 * two facts it decides are the ones a test of a model stands on: a model asked for by a name the
 * host does not have is replaced by the closest one it does (and the run says which), and a model
 * whose input is text only is run text-only (and the run says so). A price is the host's own
 * per-token figure in dollars; it prices the meter's pessimistic estimate before a call, and a
 * call's real cost when the host's reply does not carry one.
 *
 * What breaks if changed carelessly: `closestModel` must never pick a model from another family
 * silently. It only falls back within the same maker's prefix, and returns null otherwise, so a
 * typo stops the run instead of grading some other model under the asked-for name.
 */

import { messageOf } from '@insidor/vendor-kit/http.ts';

export interface HostModel {
  readonly id: string;
  /** The host lists "image" among the model's inputs. */
  readonly vision: boolean;
  /** Dollars per input token and per output token, as the host lists them; null when unlisted. */
  readonly usdPerInputToken: number | null;
  readonly usdPerOutputToken: number | null;
  readonly contextLength: number | null;
}

const price = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** The model list out of a `/models` reply body; entries without an id are dropped. */
export function parseModels(body: unknown): readonly HostModel[] {
  const data = (typeof body === 'object' && body !== null ? (body as Record<string, unknown>)['data'] : null) ?? [];
  if (!Array.isArray(data)) return [];
  return data.flatMap((m): HostModel[] => {
    const r = (typeof m === 'object' && m !== null ? m : {}) as Record<string, unknown>;
    const id = r['id'];
    if (typeof id !== 'string' || id.trim() === '') return [];
    const arch = (r['architecture'] ?? {}) as Record<string, unknown>;
    const inputs = Array.isArray(arch['input_modalities']) ? arch['input_modalities'] : [];
    const pricing = (r['pricing'] ?? {}) as Record<string, unknown>;
    const ctx = r['context_length'];
    return [{
      id,
      vision: inputs.includes('image'),
      usdPerInputToken: price(pricing['prompt']),
      usdPerOutputToken: price(pricing['completion']),
      contextLength: typeof ctx === 'number' ? ctx : null,
    }];
  });
}

/** Lowercase runs of letters and digits: "qwen2.5-vl-72b-instruct" → qwen2, 5, vl, 72b, instruct. */
const tokens = (id: string): readonly string[] => id.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t !== '');

/**
 * The asked-for model, or the closest the host offers from the same maker: the most shared name
 * parts, then the shortest id. Free variants (`:free`) are never picked as a stand-in — they are
 * rate-limited and may be served differently. Null when the maker has nothing that shares a part.
 */
export function closestModel(asked: string, models: readonly HostModel[]): HostModel | null {
  const exact = models.find((m) => m.id === asked);
  if (exact !== undefined) return exact;
  const maker = asked.split('/')[0] ?? '';
  const want = new Set(tokens(asked.split('/').slice(1).join('/')));
  let best: { m: HostModel; score: number } | null = null;
  for (const m of models) {
    if (!m.id.startsWith(`${maker}/`) || m.id.endsWith(':free')) continue;
    const score = tokens(m.id.slice(maker.length + 1)).filter((t) => want.has(t)).length;
    if (score === 0) continue;
    if (best === null || score > best.score || (score === best.score && m.id.length < best.m.id.length)) best = { m, score };
  }
  return best?.m ?? null;
}

/** The host's model list, read without a key. Throws with the reason when it cannot be read. */
export async function listModels(fetch: typeof globalThis.fetch, baseUrl: string, timeoutMs: number): Promise<readonly HostModel[]> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`the model list could not be read: ${messageOf(error)}`);
  }
  if (!res.ok) throw new Error(`the model list answered ${res.status}`);
  return parseModels(await res.json());
}

/**
 * What the key may still spend, by the host's own count (`GET /key`): dollars, or null when the key
 * has no limit. Read before any paid call so a key capped at $0 stops a test before the live judge's
 * re-ask is paid for, rather than after, with every open-model answer missing. The key goes in the
 * header only; nothing from the reply but the number is kept.
 */
export async function keyAllowance(fetch: typeof globalThis.fetch, baseUrl: string, apiKey: string, timeoutMs: number): Promise<{ readonly remainingUsd: number | null }> {
  let res: Response;
  try {
    res = await fetch(`${baseUrl.replace(/\/+$/, '')}/key`, { headers: { authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    throw new Error(`the key's allowance could not be read: ${messageOf(error)}`);
  }
  if (!res.ok) throw new Error(`the key's allowance answered ${res.status}`);
  const data = ((await res.json()) as { data?: { limit_remaining?: unknown } } | null)?.data ?? {};
  const left = data.limit_remaining;
  return { remainingUsd: typeof left === 'number' && Number.isFinite(left) ? left : null };
}
