/**
 * WHAT THE OPEN-MODEL JUDGE NEEDS FROM THE ENVIRONMENT, WHICH MODEL IT IS, AND HOW AN ANSWER IT GAVE
 * IS RECOGNISED LATER — the three facts the runner, the projector and the tools share about it.
 *
 * Separate from client.ts because none of them is about a request: the runner reads the setup once
 * at boot, the projector only needs to tell which model gave a stored answer (each model is held to
 * its own cutoff, Policy.judge.cutoffs, by `answerSide`), and both must agree on the id's shape.
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
 * What breaks if changed carelessly: `answerSide` and `isOpenJudgeId` must match the id `openJudge`
 * writes (`judge:<vendor>/<model>…`). If the two drift, the projector holds a model's answers to
 * another model's cutoff and nobody is told.
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
  /* The second host's default until 2026-10-17 (its public model list, read 2026-10-16: serverless, vision;
     Together serves no Gemma 3); refused on this account as not serverless. Kept priced for OPEN_JUDGE_BACKUP_MODEL. */
  { id: 'google/gemma-4-31B-it', vision: true, usdPerInputToken: 0.39e-6, usdPerOutputToken: 0.97e-6, contextLength: null },
  /* Together, serverless, with pictures: $0.15 in and $0.50 out a million tokens, 262,144-token
     window (its model list read with the key, 2026-10-17). Its confidences sit lower than
     Gemma 3's (gold yeses: median 0.88): held to a block cutoff of 0.90 chosen on Gemma's answers
     it passes about half the hand gold it passes at its own bar. */
  { id: 'nvidia/NVIDIA-Nemotron-3.5-Super-VL', vision: true, usdPerInputToken: 0.15e-6, usdPerOutputToken: 0.5e-6, contextLength: 262_144 },
  /* The same Nemotron on the router (its model list, read 2026-10-19): $0.10 in and $0.40 out a
     million tokens. The owner moved the post judge here when the second host ran out of credit. */
  { id: 'nvidia/nemotron-3.5-super-vl', vision: true, usdPerInputToken: 0.1e-6, usdPerOutputToken: 0.4e-6, contextLength: null },
];

/** Nemotron 3.5 Super VL as the router names it: the same model as PRIMARY_POST_MODEL on the second host. */
export const ROUTER_PRIMARY_MODEL = 'nvidia/nemotron-3.5-super-vl';

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
/** What a call to that address bills as (`vendorOfHost`), and the vendor in its judge ids. */
export const BACKUP_VENDOR = 'together';
/** Nemotron 3.5 Super VL, the owner's live post judge from 2026-10-17 (KNOWN_MODELS has its listing). */
export const PRIMARY_POST_MODEL = 'nvidia/NVIDIA-Nemotron-3.5-Super-VL';
/**
 * The second host's model: Nemotron 3.5 Super VL from 2026-10-17 (the owner's switch). NOT Gemma 4
 * 31B, the default before it: Together refuses it on this account as not serverless, so with
 * TOGETHER_API_KEY set the failover was on to a model that fails every call. Set
 * OPEN_JUDGE_BACKUP_MODEL for another; a model not in KNOWN_MODELS has no price here and the second
 * host is off (the runner says so at boot).
 */
export const DEFAULT_BACKUP_MODEL = PRIMARY_POST_MODEL;

/**
 * ★ WHICH OPEN HOST ANSWERS THE FEED'S POST QUESTION FIRST (the owner, 2026-10-17: "switch the live
 * post judge to Nemotron on Together, Gemma 3 as its automatic fallback"). `second`, the default:
 * the second host's model first and the router's behind it, whenever both are configured; with one
 * of them, that one alone. `router` (OPEN_JUDGE_POST_FIRST=router) turns it back round without a
 * code change. The kind question goes with it (the measured For You numbers had the first model
 * name the kind); names, translations and titles stay on the router's model first, the cheaper.
 */
export const OPEN_POST_FIRST = 'OPEN_JUDGE_POST_FIRST';
export type PostFirst = 'second' | 'router';
export function readPostFirst(env: Readonly<Record<string, string | undefined>>): PostFirst {
  return env[OPEN_POST_FIRST]?.trim().toLowerCase() === 'router' ? 'router' : 'second';
}

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

/** The model one stored answer came from, as `judge:<vendor>/<model>` (no prompt hash, no text-only mark); null for a rule or none. */
export function judgeModelKey(judgeId: string | null | undefined): string | null {
  if (typeof judgeId !== 'string' || !judgeId.startsWith('judge:')) return null;
  return (judgeId.split('@')[0] ?? judgeId).replace(/\+text-only$/, '');
}

/**
 * ★ EACH OPEN MODEL'S PLACE FOR ITS CUTOFF (Policy.judge.cutoffs), by the model, not by the order
 * the runner asks in: the number was measured on that model's confidences, so its answers keep it
 * when the order is turned round (OPEN_JUDGE_POST_FIRST) or when one answers for the other in a
 * failover. A model not listed has no measured number and is held to the block's cutoff.
 */
const PLACE_OF_MODEL: Readonly<Record<string, 'primary' | 'fallback'>> = {
  [`judge:${BACKUP_VENDOR}/${PRIMARY_POST_MODEL}`]: 'primary',
  /* The same model on the router keeps the primary's cutoff: it was measured on Nemotron's answers. */
  [`judge:${DEFAULT_VENDOR}/${ROUTER_PRIMARY_MODEL}`]: 'primary',
  [`judge:${DEFAULT_VENDOR}/${DEFAULT_OPEN_MODEL}`]: 'fallback',
};

/** Which open model gave a stored answer, for core `answerCutoff`. */
export function answerSide(judgeId: string | null | undefined): { readonly model: string | null; readonly place: 'primary' | 'fallback' | null } {
  const model = judgeModelKey(judgeId);
  return { model, place: model === null ? null : (PLACE_OF_MODEL[model] ?? null) };
}

/** The hosts the open models are asked on: the router and the second host. */
const OPEN_VENDORS: readonly string[] = [DEFAULT_VENDOR, BACKUP_VENDOR];

/** Whether a stored answer is an open model's (`openJudge` writes `judge:<vendor>/…`), on either host. */
export const isOpenJudgeId = (judgeId: string | null | undefined): boolean =>
  typeof judgeId === 'string' && OPEN_VENDORS.some((v) => judgeId.startsWith(`judge:${v}/`));
