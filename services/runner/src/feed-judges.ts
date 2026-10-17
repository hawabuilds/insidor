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
 * ★ AND WHICH OPEN MODEL FIRST (`postJudgeOrder`, from 2026-10-17): two open models on two hosts,
 * Nemotron on Together asked the post and kind questions first and Gemma 3 on the router behind it,
 * unless OPEN_JUDGE_POST_FIRST=router. Decided here for the same reason as the roles.
 *
 * What breaks if changed carelessly: `openHostModel` must not fail the boot. A host whose model
 * list is slow or down gets the listing we recorded (KNOWN_MODELS); without one, no open judge.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { KNOWN_MODELS, answerSide, closestModel, listModels, type HostModel, type OpenJudgeSetup, type PostFirst } from '@insidor/judge-openai-compatible';

import { errorText, type Logger } from './log.ts';

/** The two feed judges, by role (Policy.judge.primary): `main` is JUDGE_MODEL's, `open` the open model's. */
export type JudgeRole = Policy['judge']['primary'];

export interface Roles {
  /** The role that answers first. */
  readonly primary: JudgeRole;
  /** The other role, or null when there is only one judge. */
  readonly other: JudgeRole | null;
}

/**
 * The roles in use: the policy's primary when it can run, and the other when both can. With no
 * main judge (no key: the owner stopped paying for it on 2026-10-16) and the open model there, the
 * open model answers alone whatever the policy wanted, rather than a failover pair whose primary
 * does not exist.
 */
export function rolesFor(wanted: JudgeRole, openAvailable: boolean, mainAvailable = true): Roles {
  if (!openAvailable) return { primary: 'main', other: null };
  if (!mainAvailable) return { primary: 'open', other: null };
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
  if (roles.primary === 'open') return { message: 'feed judge: the open model alone — the main judge has no key', fields: { openModel: open.model } };
  const why = !open.configured ? 'OPENROUTER_API_KEY is not set' : 'the open model could not be resolved';
  return {
    message: wanted === 'open' ? 'feed judge: the open model was asked for but cannot run; the main judge answers alone' : 'feed judge: the main judge alone — no fallback and no shadow',
    fields: { why },
  };
}

/** One open model to ask: its host setup and the model as the host lists it. */
export interface OpenSide {
  readonly setup: Extract<OpenJudgeSetup, { state: 'configured' }>;
  readonly model: HostModel;
}

/**
 * ★ WHICH OPEN MODEL ASKS THE POST AND KIND QUESTIONS FIRST, and which stands behind it (adapter
 * setup.ts `readPostFirst`; the owner, 2026-10-17: "Nemotron on Together at 0.70, Gemma 3 as its
 * automatic fallback"): `second` puts the second host's model first and the router's behind it;
 * `router` turns it round; with one host, that one alone and nothing behind. Exported for its test
 * and for a copy test that runs the live scorer in this order.
 */
export function postJudgeOrder(postFirst: PostFirst, router: OpenSide | null, second: OpenSide | null): { readonly first: OpenSide | null; readonly behind: OpenSide | null } {
  const first = postFirst === 'second' ? (second ?? router) : (router ?? second);
  return { first, behind: first === second ? router : second };
}

/** A model as its log lines name it: host and model. */
export const sideName = (side: OpenSide): string => `${side.setup.vendor}/${side.model.id}`;

/** Posts a call: the primary's own number (Policy.judge.open.primaryBatchSize) by the model's cutoff place, else batchSize. */
export const postsPerCall = (side: OpenSide, policy: Policy): number =>
  answerSide(`judge:${side.setup.vendor}/${side.model.id}`).place === 'primary' ? policy.judge.open.primaryBatchSize : policy.judge.open.batchSize;
