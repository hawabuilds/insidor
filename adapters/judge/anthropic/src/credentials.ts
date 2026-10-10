/**
 * WHAT THE JUDGE NEEDS FROM THE ENVIRONMENT, and what state that leaves it in.
 *
 * The same shape as the platform adapters' credentials files (see the X adapter's): this
 * file asks "was it supplied", never "is it any good" — whether a key is well formed is
 * checked by `httpClient`, which throws `JudgeNotConfigured` at construction.
 *
 * Three states, decided here so the runner can say which at boot:
 *
 *   dormant     neither ANTHROPIC_API_KEY nor JUDGE_MODEL is set. Nobody turned the judge
 *               on; qualify abstains with `Q1_unjudged`. Not a fault.
 *   priced      JUDGE_MODEL is set and the key is not. Enough to price calls for SPEND=dry,
 *               and not enough to make one: a live process in this state fails its boot.
 *   configured  both set.
 *
 * And one that is a fault: the key set with no model. There is no default model in code —
 * which model judges is a decision with a price attached, and a default would make it for
 * whoever forgot — so that is `misconfigured`, and the boot fails naming the variable.
 */

export const API_KEY = 'ANTHROPIC_API_KEY';
export const MODEL = 'JUDGE_MODEL';
export const BASE_URL = 'ANTHROPIC_BASE_URL';

/** A public host, not a secret, so it may have a default. The key and the model may not. */
export const DEFAULT_BASE_URL = 'https://api.anthropic.com';

export type JudgeSetup =
  | { readonly state: 'dormant' }
  | { readonly state: 'priced'; readonly model: string }
  | { readonly state: 'configured'; readonly model: string; readonly apiKey: string; readonly baseUrl: string }
  | { readonly state: 'misconfigured'; readonly variable: string; readonly note: string };

export function readJudgeSetup(env: Readonly<Record<string, string | undefined>>): JudgeSetup {
  const blank = (name: string): string | null => {
    const v = env[name];
    return v === undefined || v.trim() === '' ? null : v;
  };
  const key = blank(API_KEY);
  const model = blank(MODEL);
  if (key === null && model === null) return { state: 'dormant' };
  if (model === null) {
    return { state: 'misconfigured', variable: MODEL, note: 'is not set, and there is no default model' };
  }
  if (key === null) return { state: 'priced', model: model.trim() };
  return { state: 'configured', model: model.trim(), apiKey: key, baseUrl: blank(BASE_URL) ?? DEFAULT_BASE_URL };
}
