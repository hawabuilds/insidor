/**
 * WHAT THE OPEN-MODEL JUDGE NEEDS FROM THE ENVIRONMENT, WHICH MODEL IT IS, AND HOW AN ANSWER IT GAVE
 * IS RECOGNISED LATER — the three facts the runner, the projector and the tools share about it.
 *
 * Separate from client.ts because none of them is about a request: the runner reads the setup once
 * at boot, the projector only needs to tell this judge's stored answers from the main judge's (they
 * are held to different cutoffs, Policy.judge.openCutoff), and both must agree on the id's shape.
 *
 * ★ TWO STATES, NO FAULT. Without OPENROUTER_API_KEY the open judge is `dormant`: the runner runs the
 * main judge alone — no fallback, no shadow — and says so once at boot. The key is never required,
 * because the live feed ran without it until 2026-10-16 and must keep running if it is removed.
 *
 * ★ THE MODEL HAS A DEFAULT HERE, UNLIKE THE MAIN JUDGE'S. The owner chose the model on 2026-10-15
 * after measuring three (tools/judge-open-eval.ts); OPEN_JUDGE_MODEL overrides it. Its listed facts
 * (whether it reads pictures, its prices) are read from the host's model list at boot; KNOWN_MODELS
 * is what is used when that list cannot be read, so a host's slow catalogue never turns the
 * fallback off. The prices there only shape the pessimistic estimate; a call's real cost is the
 * host's own figure in its reply.
 *
 * What breaks if changed carelessly: `isOpenJudgeId` must match the id `openJudge` writes
 * (`judge:<vendor>/<model>…`). If the two drift, the projector holds the open model's answers to the
 * main judge's cutoff and nobody is told.
 */

import { DEFAULT_BASE_URL, DEFAULT_VENDOR } from './client.ts';
import type { HostModel } from './models.ts';

export const OPEN_API_KEY = 'OPENROUTER_API_KEY';
export const OPEN_MODEL = 'OPEN_JUDGE_MODEL';
export const OPEN_BASE_URL = 'OPENROUTER_BASE_URL';
/** The router's providers to use, comma-separated, in order; set but empty: the router chooses. */
export const OPEN_PROVIDERS = 'OPEN_JUDGE_PROVIDERS';

/**
 * The providers to ask, in order (client.ts says what the others did on 2026-10-16): NextBit
 * answered the learned-block prompt cleanly every time it was not rate-limited; DeepInfra is second
 * because NextBit's shared pool was rate-limited for minutes at a time, and DeepInfra looped once
 * of the once it answered. The others looped every time and are not asked: a call refused by both
 * is a failover to the main judge, not a hand-off to a provider that bills a looping answer.
 */
export const DEFAULT_OPEN_PROVIDERS: readonly string[] = ['nextbit', 'deepinfra'];

/** The owner's pick, 2026-10-15: hand gold 70/99, missed 9/13, $0.00016 a post, against three others. */
export const DEFAULT_OPEN_MODEL = 'google/gemma-3-27b-it';

/**
 * The host's listing for the models we use, as read on 2026-10-15 (tools/judge-open-eval.ts printed
 * them): used only when the live list cannot be read at boot.
 */
export const KNOWN_MODELS: readonly HostModel[] = [
  { id: 'google/gemma-3-27b-it', vision: true, usdPerInputToken: 0.08e-6, usdPerOutputToken: 0.45e-6, contextLength: null },
  /* The backup's default on Together (its public model list, read 2026-10-16: serverless, vision;
     Together serves no Gemma 3). Its list needs a key, so the backup is priced from here. */
  { id: 'google/gemma-4-31B-it', vision: true, usdPerInputToken: 0.39e-6, usdPerOutputToken: 0.97e-6, contextLength: null },
];

export type OpenJudgeSetup =
  | { readonly state: 'dormant' }
  | {
      readonly state: 'configured';
      readonly apiKey: string;
      readonly baseUrl: string;
      readonly model: string;
      readonly vendor: string;
      readonly providers: readonly string[];
      /** False: a host of its own, not the router, sent no router-only request fields. Absent: the router. */
      readonly router?: boolean;
    };

export function readOpenJudgeSetup(env: Readonly<Record<string, string | undefined>>): OpenJudgeSetup {
  const blank = (name: string): string | null => {
    const v = env[name];
    return v === undefined || v.trim() === '' ? null : v.trim();
  };
  const apiKey = blank(OPEN_API_KEY);
  if (apiKey === null) return { state: 'dormant' };
  return { state: 'configured', apiKey, baseUrl: blank(OPEN_BASE_URL) ?? DEFAULT_BASE_URL, model: blank(OPEN_MODEL) ?? DEFAULT_OPEN_MODEL, vendor: DEFAULT_VENDOR, providers: openProviders(env) };
}

/** OPEN_JUDGE_PROVIDERS as a list: unset is the default; set but blank is none (the router chooses). */
export function openProviders(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  const v = env[OPEN_PROVIDERS];
  if (v === undefined) return DEFAULT_OPEN_PROVIDERS;
  return v.split(',').map((p) => p.trim()).filter((p) => p !== '');
}

/* ── the backup judge ─────────────────────────────────────────────────── */

export const OPEN_BACKUP_API_KEY = 'OPEN_JUDGE_BACKUP_API_KEY';
/** The owner's name for the backup host's key (2026-10-16), read when OPEN_JUDGE_BACKUP_API_KEY is not set. */
export const TOGETHER_API_KEY = 'TOGETHER_API_KEY';
export const OPEN_BACKUP_BASE_URL = 'OPEN_JUDGE_BACKUP_BASE_URL';
export const OPEN_BACKUP_MODEL = 'OPEN_JUDGE_BACKUP_MODEL';
/** Together's OpenAI-compatible address (answers 401 without a key, checked 2026-10-16). */
export const DEFAULT_BACKUP_BASE_URL = 'https://api.together.xyz/v1';
/**
 * The backup's model on Together. NOT Gemma 3: Together's public serverless and dedicated lists
 * (read 2026-10-16) have no Gemma 3; its one Gemma is Gemma 4 31B, serverless, with pictures, at
 * $0.39 in and $0.97 out a million tokens. Set OPEN_JUDGE_BACKUP_MODEL for another; a model not in
 * KNOWN_MODELS has no price here and the backup is off (the runner says so at boot).
 */
export const DEFAULT_BACKUP_MODEL = 'google/gemma-4-31B-it';

/** The vendor a host bills as, from its address: api.together.xyz → together. */
export function vendorOfHost(baseUrl: string): string {
  try {
    const parts = new URL(baseUrl).hostname.toLowerCase().split('.');
    return parts[Math.max(0, parts.length - 2)] ?? 'backup';
  } catch {
    return 'backup';
  }
}

/**
 * ★ THE SECOND OPEN MODEL ON A SECOND HOST (the owner, 2026-10-16: "a second open model on a
 * different host … switching automatically if Gemma or OpenRouter fails, errors or runs out of
 * credit"; "I'm adding TOGETHER_API_KEY as the second host"). Its key is OPEN_JUDGE_BACKUP_API_KEY,
 * else TOGETHER_API_KEY; its address OPEN_JUDGE_BACKUP_BASE_URL, else Together's; its model
 * OPEN_JUDGE_BACKUP_MODEL, else DEFAULT_BACKUP_MODEL. It never uses the router or the router's key:
 * with no backup key there is NO backup (the owner kept the saving rather than pay a second router
 * model eight times Gemma's price), never a second router model that an outage of the router or an
 * empty router account would take down with the first.
 */
export function readOpenJudgeBackupSetup(env: Readonly<Record<string, string | undefined>>): OpenJudgeSetup {
  const blank = (name: string): string | null => {
    const v = env[name];
    return v === undefined || v.trim() === '' ? null : v.trim();
  };
  const apiKey = blank(OPEN_BACKUP_API_KEY) ?? blank(TOGETHER_API_KEY);
  if (apiKey === null) return { state: 'dormant' };
  const baseUrl = blank(OPEN_BACKUP_BASE_URL) ?? DEFAULT_BACKUP_BASE_URL;
  return { state: 'configured', apiKey, baseUrl, model: blank(OPEN_BACKUP_MODEL) ?? DEFAULT_BACKUP_MODEL, vendor: vendorOfHost(baseUrl), providers: [], router: false };
}

/** Whether a stored answer's judge id is this judge's (`openJudge` writes `judge:<vendor>/…`). */
export const isOpenJudgeId = (judgeId: string | null | undefined, vendor: string = DEFAULT_VENDOR): boolean =>
  typeof judgeId === 'string' && judgeId.startsWith(`judge:${vendor}/`);
