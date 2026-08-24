/**
 * Configuration, read exactly once, at boot, in exactly one place.
 *
 * TWO RULES, and both exist because of specific damage:
 *
 *   1. This is the ONLY module in the service permitted to touch `process.env`.
 *      Configuration read at the point of use is configuration that changes
 *      under a running process, and a value that changes mid-run makes the
 *      decision log unauditable — the row says which policy it was judged
 *      against, but not which database it was written to.
 *
 *   2. A missing value fails the process at boot, loudly, naming EVERY missing
 *      key at once. Never a plausible default. A default port, a default
 *      cadence or a default "alerts off" is the same class of bug as writing a
 *      zero rate for a censored counter: it substitutes a confident wrong value
 *      for an honest absence, and nobody finds out until it matters.
 *
 * The heartbeat is the shape worth copying: it cannot be merely absent. You
 * either declare `HEARTBEAT=on` and supply every slug, or you declare
 * `HEARTBEAT=off` and accept that a dead process will not page anyone. Silence
 * has to be chosen, not inherited — the same argument as `capabilities.absent`.
 * `DISCOVER` is the second variable built to that shape, for the same reason: a
 * defaulted-off discovery is a pipeline that runs, reports healthy and ingests
 * nothing, which is the seven-hour silent failure this service is shaped around.
 * `SPEND` is the third, and it is the one where a default is worst in BOTH
 * directions: defaulted to `live` it spends somebody's money because they did not
 * know there was a switch, and defaulted to `dry` it is that same silent failure
 * wearing a different hat.
 *
 * ── ★ AND A THIRD JOB, ADDED WITH THE PLATFORM SOURCES ─────────────────────
 *
 * This file also CAPTURES THE PLATFORM CREDENTIALS as a frozen slice on the way
 * past — see `sourceEnv` below. It is here rather than in the registry because of
 * rule 1: the registry needs an environment to resolve, and handing it the live
 * `process.env` would reintroduce exactly the configuration-that-moves this file
 * exists to forbid.
 *
 * ★ WHICH MEANS RULE 2 HAS ONE DELIBERATE EXCEPTION, AND ANYBODY "RESTORING" IT
 * WOULD BREAK THE PRODUCT IN THE ONE DIRECTION IT CANNOT AFFORD. A missing
 * platform credential does NOT fail the boot. Rule 2 exists because a defaulted
 * port or a defaulted "alerts off" fails silently; a missing platform credential
 * does not fail silently at all — it resolves to an explicit `dormant` reading,
 * is written to `internal.source_health`, and is displayed as "nobody turned this
 * on". Nothing is guessed, so the argument for failing loudly does not apply.
 * Applying it anyway would mean a product that refuses to start until every paid
 * source has been bought, and it would collapse the one distinction the whole
 * source-health feature exists to draw: "nobody turned this on" would arrive at
 * the operator in the same shape as "this is broken".
 */

import { hostname } from 'node:os';
import { DEFAULT_POLICY } from '@insidor/contracts';
import type { StageName } from '@insidor/contracts';
import { credentialSpecs } from '@insidor/platform-registry';
import type { CredentialEnv } from '@insidor/vendor-kit';

/** The stages this process supervises. See loops/ for the cadence of each. */
export const SUPERVISED_STAGES = [
  'admit',
  'track',
  'detect',
  'group',
  'qualify',
  'resolve',
  'rank',
] as const satisfies readonly StageName[];

export type SupervisedStage = (typeof SUPERVISED_STAGES)[number];

/**
 * Supervised work that is NOT a decision stage.
 *
 * ★ WHY `discover` IS NOT IN `STAGE_NAMES` AND SHOULD NOT BE. That list is the
 * DECISION vocabulary: `Decision.stage` is typed from it, `internal.decisions` has a
 * CHECK constraint enumerating it, and `core/src/features/registry.ts` expects a
 * feature set per member. Discovery decides nothing — it asks vendors what exists and
 * writes rows; ADMIT is the stage that judges what arrives. Adding it to that union
 * would put a member in the decision log's vocabulary that no decision can ever carry,
 * and would make the constraint and the type disagree by design.
 *
 * It still belongs in `internal.stage_runs`, because the question "did this finish"
 * is asked of it exactly as of the seven, and the watchdog's rule is written once
 * rather than twice. That column is deliberately free text and chainwatch already
 * writes to it under its own name; see the ★ in services/chainwatch/src/wiring.ts,
 * which is the same widening argued at length.
 */
export const SUPERVISED_TASKS = ['discover'] as const;

export type SupervisedTask = (typeof SUPERVISED_TASKS)[number];

/** Everything this process supervises, decision stage or not. */
export type SupervisedName = SupervisedStage | SupervisedTask;

export const SUPERVISED: readonly SupervisedName[] = [...SUPERVISED_STAGES, ...SUPERVISED_TASKS];

export type HeartbeatConfig =
  | { readonly kind: 'off' }
  | {
      readonly kind: 'on';
      /** Pings are `${baseUrl}/${slug}` and `${baseUrl}/${slug}/fail`. */
      readonly baseUrl: string;
      /**
       * Keyed by stage name. Deliberately a wide `string` key: the lookup then
       * yields `string | undefined`, so a stage with no slug is a case the
       * caller has to handle rather than a silent empty URL.
       */
      readonly slugs: Readonly<Record<string, string>>;
      readonly timeoutMs: number;
    };

/**
 * Whether this process goes looking for new items at all.
 *
 * ★ THE HEARTBEAT'S SHAPE, FOR THE HEARTBEAT'S REASON. You either declare
 * `DISCOVER=on` and name what to look for, or you declare `DISCOVER=off` and accept
 * that nothing new arrives from a vendor. Silence has to be CHOSEN — a defaulted-off
 * discovery is a pipeline that runs, looks healthy, and quietly ingests nothing,
 * which is the single failure this whole service is shaped around.
 *
 * ★ AND IT IS NOT THE SAME QUESTION AS "WHICH SOURCES ARE LIVE". That one is answered
 * by the environment's credentials and by nothing else — adding a key turns a source
 * on with no other edit, which is the property the platform registry exists to hold.
 * This switch is about whether we ask ANY of them, which is an operational decision
 * about this process. Merging them would make turning discovery off for an afternoon
 * indistinguishable from losing every credential.
 */
export type DiscoveryConfig =
  | { readonly kind: 'off' }
  | {
      readonly kind: 'on';
      /** What to look for. Never empty: an empty list is spelled `off`. */
      readonly terms: readonly string[];
    };

/**
 * ★ WHETHER THIS PROCESS MAY SPEND MONEY, AND HOW MUCH.
 *
 * The third variable built to HEARTBEAT's shape, and the one with the sharpest reason.
 * You either declare `SPEND=live` and accept an invoice, or you declare `SPEND=dry`
 * and get a process that resolves every source, renders every query, prices every call
 * against the same price books the live path bills against, prints the total — and
 * contacts nobody. A default here would be the worst kind: defaulted to `live` it
 * spends somebody's money because they did not know there was a switch, and defaulted
 * to `dry` it is the seven-hour silent failure this service is shaped around wearing a
 * different hat. So it is declared, like the other two.
 *
 * ── ★ WHY `dailyBudgetUsd` IS READ HERE AT ALL, GIVEN THAT THRESHOLDS LIVE IN
 *      POLICY ──────────────────────────────────────────────────────────────
 *
 * Because it is not a threshold, it is a WALLET. `budget.dailyUsd` in policy answers
 * "what may this system ever spend in a day", which is a product judgement, hashed
 * onto every decision, and correctly frozen in code. This answers "what may THIS
 * DEPLOYMENT spend", which is a fact about whose card is on file — and two people
 * running the same code with different amounts of money is not two policies.
 *
 * ★ AND IT MAY ONLY EVER LOWER THE POLICY CEILING, NEVER RAISE IT. The boot fails,
 * naming both numbers, if it is set higher. That is what keeps the two honest: policy
 * remains the maximum any deployment may spend and the number a decision row is judged
 * against, and this is the operator's tighter belt inside it. Without the check the
 * environment could quietly overrule a frozen policy, and the hash on the decision row
 * would attest to a cap that was not in force.
 *
 * The variable existed before this and was read by NOTHING — it sat in `.env.example`
 * beside a sentence promising that the judge would pause when it was reached, and
 * neither half was true. A dead knob that reads like a live one is worse than no knob,
 * because somebody sets it to five and believes they are capped at five.
 */
export type SpendConfig =
  | {
      readonly kind: 'dry';
      /**
       * Carried even in dry mode, because the dry run reports what WOULD have been
       * refused. A dry run that ignored the cap would tell a person their day costs
       * ninety cents when the ninth pass would have been paused — which is the one
       * thing they are running it to find out.
       */
      readonly dailyBudgetUsd: number;
    }
  | { readonly kind: 'live'; readonly dailyBudgetUsd: number };

export interface RunnerConfig {
  /** Session mode (port 5432). Transaction mode cannot hold the singleton lock. */
  readonly databaseUrl: string;
  readonly healthPort: number;
  /** Recorded on every run row, so two instances are distinguishable. */
  readonly host: string;
  /** How long a SIGTERM waits for in-flight loops before the process gives up. */
  readonly shutdownGraceMs: number;
  /**
   * Advisory-lock name. Two runners draining the same claim queue is failure
   * mode #2 of the build this replaces; the lock is what forecloses it.
   */
  readonly singletonLockName: string;
  readonly heartbeat: HeartbeatConfig;
  readonly discovery: DiscoveryConfig;
  /** Whether a vendor may be contacted, and the wallet if one may. See `SpendConfig`. */
  readonly spend: SpendConfig;
  /**
   * The platform credentials, as a snapshot taken here and passed forward.
   *
   * ★ WHY A SLICE OF THE ENVIRONMENT TRAVELS ON THE CONFIG OBJECT. Rule 1 of this
   * file is that nothing else in the service reads `process.env`, and the platform
   * registry needs an environment to resolve. Handing it the live `process.env` would
   * reintroduce exactly what rule 1 forbids — configuration that can change under a
   * running process. So the read happens here, once, and what travels is a frozen copy
   * containing ONLY the variables the sources themselves declare.
   *
   * ★ AND WHY IT IS A COPY OF NAMED KEYS RATHER THAN THE WHOLE ENVIRONMENT. A bag
   * holding everything is a bag somebody reads something else out of, and the thing
   * most worth reading out of this process's environment is the internal database URL.
   * The names come from the adapters' own declarations, so this list cannot drift from
   * what is actually checked.
   *
   * ★ AND WHY A MISSING PLATFORM CREDENTIAL DOES NOT FAIL THE BOOT, unlike every other
   * value in this file. Rule 2 exists because a defaulted cadence or a defaulted
   * "alerts off" fails SILENTLY. A missing platform credential does not: it is
   * resolved into an explicit `dormant` reading, written to `internal.source_health`,
   * and displayed. Nothing is inferred and nothing is guessed, so the argument for
   * failing loudly does not apply — and applying it anyway would mean a product that
   * refuses to start until every paid source has been bought, which is the opposite of
   * what activation-by-configuration means.
   */
  readonly sourceEnv: CredentialEnv;
}

export class ConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(
      `configuration is not usable; the process will not start:\n  - ${problems.join('\n  - ')}`,
    );
    this.name = 'ConfigError';
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/** Collects problems rather than throwing on the first one: a boot failure that
 *  names one missing variable per restart costs an evening. */
function reader(env: Env, problems: string[]) {
  return {
    text(key: string): string {
      const raw = env[key];
      if (raw === undefined || raw.trim() === '') {
        problems.push(`${key} is required and was not set`);
        return '';
      }
      return raw.trim();
    },
    int(key: string, min: number, max: number): number {
      const raw = env[key];
      if (raw === undefined || raw.trim() === '') {
        problems.push(`${key} is required and was not set`);
        return min;
      }
      const n = Number(raw);
      if (!Number.isInteger(n) || n < min || n > max) {
        problems.push(`${key} must be an integer in [${min}, ${max}], got ${JSON.stringify(raw)}`);
        return min;
      }
      return n;
    },
    /**
     * A number that may have a fractional part, for money.
     *
     * ★ SEPARATE FROM `int` BECAUSE ROUNDING A BUDGET IS NOT A NEUTRAL ACT. A cap
     * typed as `0.50` read through `int` fails the boot on a value that is perfectly
     * sensible, and a version that rounded it would round UP as readily as down —
     * which is a person asking for fifty cents and being given a dollar. It also
     * refuses a non-finite value explicitly: `Number('')` is 0 and `Number('abc')` is
     * NaN, and NaN compares false against every cap, so a typo would produce a meter
     * that permits every call rather than one that refuses them.
     *
     * On failure it returns `min` rather than `max`: every reader here returns a value
     * so the remaining problems can still be collected, and the one it returns must be
     * the one that cannot cause spending if a caller ever ignored the thrown error.
     */
    money(key: string, min: number, max: number): number {
      const raw = env[key];
      if (raw === undefined || raw.trim() === '') {
        problems.push(`${key} is required and was not set`);
        return min;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < min || n > max) {
        problems.push(
          `${key} must be a number in [${min}, ${max}] — dollars per day — got ${JSON.stringify(raw)}`,
        );
        return min;
      }
      return n;
    },
    choice<T extends string>(key: string, allowed: readonly T[]): T {
      const raw = env[key];
      if (raw === undefined || raw.trim() === '') {
        problems.push(`${key} is required and must be one of ${allowed.join(' | ')}`);
        return allowed[0] as T;
      }
      const v = raw.trim() as T;
      if (!allowed.includes(v)) {
        problems.push(`${key} must be one of ${allowed.join(' | ')}, got ${JSON.stringify(raw)}`);
        return allowed[0] as T;
      }
      return v;
    },
  };
}

function heartbeatSlugEnv(stage: SupervisedName): string {
  return `HEARTBEAT_SLUG_${stage.toUpperCase()}`;
}

/**
 * Copy exactly the variables the platform packages declare, and nothing else.
 *
 * Values are copied verbatim, including blanks: `readCredentials` is the one place
 * that decides what an empty string means, and a second opinion here would be a
 * second spelling of the dormant/misconfigured judgement.
 */
function platformEnv(env: Env): CredentialEnv {
  const slice: Record<string, string | undefined> = {};
  for (const spec of Object.values(credentialSpecs())) {
    for (const requirement of spec.requires) slice[requirement.variable] = env[requirement.variable];
  }
  return Object.freeze(slice);
}

export function loadRunnerConfig(env: Env): RunnerConfig {
  const problems: string[] = [];
  const r = reader(env, problems);

  const databaseUrl = r.text('DATABASE_URL');
  const healthPort = r.int('HEALTH_PORT', 1, 65_535);
  const shutdownGraceMs = r.int('SHUTDOWN_GRACE_MS', 1_000, 300_000);
  const singletonLockName = r.text('SINGLETON_LOCK_NAME');
  const mode = r.choice('HEARTBEAT', ['off', 'on'] as const);

  let heartbeat: HeartbeatConfig = { kind: 'off' };
  if (mode === 'on') {
    const baseUrl = r.text('HEARTBEAT_BASE_URL');
    const timeoutMs = r.int('HEARTBEAT_TIMEOUT_MS', 100, 30_000);
    const slugs: Record<string, string> = {};
    /* Every supervised thing, not only the seven decision stages: a discovery loop
       that dies is exactly as invisible as a stage that dies, and the heartbeat is
       what makes either one page somebody. */
    for (const stage of SUPERVISED) slugs[stage] = r.text(heartbeatSlugEnv(stage));
    heartbeat = { kind: 'on', baseUrl: baseUrl.replace(/\/+$/, ''), timeoutMs, slugs };
  }

  const discoverMode = r.choice('DISCOVER', ['off', 'on'] as const);
  let discovery: DiscoveryConfig = { kind: 'off' };
  if (discoverMode === 'on') {
    const terms = r
      .text('DISCOVER_TERMS')
      .split(',')
      .map((term) => term.trim())
      .filter((term) => term !== '');
    if (terms.length === 0) {
      problems.push(
        'DISCOVER_TERMS named no term. Set it, or declare DISCOVER=off — a discovery loop ' +
          'with nothing to look for runs, reports success, and ingests nothing.',
      );
    }
    discovery = { kind: 'on', terms };
  }

  /* ── the wallet ──────────────────────────────────────────────────────────
     Read whichever mode is declared, because a dry run reports what would have been
     refused and needs the same number to do it. */
  const spendMode = r.choice('SPEND', ['dry', 'live'] as const);

  /**
   * ★ THE CEILING IS THE POLICY NUMBER AND THE ENVIRONMENT MAY ONLY GO LOWER.
   *
   * `max` is `DEFAULT_POLICY.budget.dailyUsd`, so `DAILY_BUDGET_USD=50` against a
   * policy of 3 fails the boot naming both figures rather than quietly overruling a
   * frozen policy — which would leave the hash on every decision row attesting to a
   * cap that was not in force. The floor is not zero: a cap of zero refuses every call
   * forever, which is what `SPEND=dry` is for and is a different, clearer statement.
   * The smallest real charge in this system is $0.00015, so a cent is the smallest
   * budget that can buy anything at all.
   */
  const dailyBudgetUsd = r.money('DAILY_BUDGET_USD', 0.01, DEFAULT_POLICY.budget.dailyUsd);
  const spend: SpendConfig = { kind: spendMode, dailyBudgetUsd };

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    databaseUrl,
    healthPort,
    host: hostname(),
    shutdownGraceMs,
    singletonLockName,
    heartbeat,
    discovery,
    spend,
    sourceEnv: platformEnv(env),
  };
}
