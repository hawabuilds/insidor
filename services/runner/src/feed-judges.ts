/**
 * WHICH MODEL JUDGES THE FEED, AND WHICH ONE STANDS BEHIND IT — the main judge (JUDGE_MODEL) and the
 * open model (OPEN_JUDGE_MODEL, behind OPENROUTER_API_KEY), by the role Policy.judge.primary gives
 * each.
 *
 * Its own file because the choice is made in one place and read in three: the learned-examples
 * swap builds the post judge from it on every new block, the kind question is built from it once,
 * and the shadow (Policy.judge.shadow) asks the role that did not answer. Deciding it inline in
 * wiring.ts would let those three disagree about which model is "live".
 *
 * ★ BOTH ROLES GET THE SAME SETUP. Each is built through the runner's own builder for its adapter
 * with the same question, the same applied learned block, the same precedents and the same answer
 * budget; the close-match hold and the kind question are the scorer's, applied to whichever answer
 * it gets. Only the model differs — what tools/judge-open-eval.ts measured.
 *
 * ★ NO KEY, NO SECOND JUDGE — AND IT IS SAID ONCE. Without the open model's key, `other` is null:
 * no fallback and no shadow, and `primary: 'open'` runs the main judge (the boot logs why). The
 * feed never stops for want of the second supplier.
 *
 * What breaks if changed carelessly: `openHostModel` must not fail the boot. A host whose model
 * list is slow or down gets the listing we recorded (KNOWN_MODELS); without one, no open judge.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { KNOWN_MODELS, closestModel, listModels, type HostModel, type OpenJudgeSetup } from '@insidor/judge-openai-compatible';

import { errorText, type Logger } from './log.ts';

/** The two feed judges, by role (Policy.judge.primary): `main` is JUDGE_MODEL's, `open` the open model's. */
export type JudgeRole = Policy['judge']['primary'];

export interface Roles {
  /** The role that answers first. */
  readonly primary: JudgeRole;
  /** The other role, or null when there is only one judge. */
  readonly other: JudgeRole | null;
}

/** The roles in use: the policy's primary when it can run, and the other when both can. */
export function rolesFor(wanted: JudgeRole, openAvailable: boolean): Roles {
  if (!openAvailable) return { primary: 'main', other: null };
  return wanted === 'open' ? { primary: 'open', other: 'main' } : { primary: 'main', other: 'open' };
}

/**
 * The open model as the host lists it: its id, whether it reads pictures, its prices. Read once at
 * boot (no key needed); when the list cannot be read, the listing recorded in the adapter; null
 * when the open judge is dormant or the model is unknown either way. Never throws.
 */
export async function openHostModel(setup: OpenJudgeSetup, timeoutMs: number, log: Logger, fetch: typeof globalThis.fetch = globalThis.fetch): Promise<HostModel | null> {
  if (setup.state === 'dormant') return null;
  let listed: readonly HostModel[];
  try {
    listed = await listModels(fetch, setup.baseUrl, timeoutMs);
  } catch (e) {
    log.warn('the open judge host\'s model list could not be read; using the recorded listing', { model: setup.model, err: errorText(e) });
    listed = KNOWN_MODELS;
  }
  const exact = listed.find((m) => m.id === setup.model) ?? KNOWN_MODELS.find((m) => m.id === setup.model) ?? null;
  const model = exact ?? closestModel(setup.model, listed);
  if (model === null || model.usdPerInputToken === null || model.usdPerOutputToken === null) {
    log.error('the open judge is off: its host lists no priced model like the one asked for', { model: setup.model });
    return null;
  }
  if (model.id !== setup.model) log.warn('the open judge runs the closest model its host offers', { asked: setup.model, running: model.id });
  return model;
}

/** The boot's one line about the two judges: which answers, which stands behind, and why when only one. */
export function describeRoles(wanted: JudgeRole, roles: Roles, open: { readonly configured: boolean; readonly model: string | null }): { readonly message: string; readonly fields: Record<string, unknown> } {
  if (roles.other !== null) return { message: 'feed judges: two', fields: { primary: roles.primary, other: roles.other, openModel: open.model } };
  const why = !open.configured ? 'OPENROUTER_API_KEY is not set' : 'the open model could not be resolved';
  return {
    message: wanted === 'open' ? 'feed judge: the open model was asked for but cannot run; the main judge answers alone' : 'feed judge: the main judge alone — no fallback and no shadow',
    fields: { why },
  };
}
