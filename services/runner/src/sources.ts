/**
 * THE LIVE SET, AND THE ONE PLACE A CALL'S OUTCOME BECOMES A RECORDED FACT.
 *
 * Two jobs, and they are here together because they are the two halves of one
 * sentence: which sources exist to be called, and what happened when we called them.
 *
 * ── ★ `declareSources` — WHY DORMANCY HAS TO BE WRITTEN DOWN ────────────────
 *
 * Every other fact about a source is observable: whether it answered, when, what it
 * said when it did not. Whether anybody MEANT to call it is not. Nothing downstream
 * can distinguish "no credential was supplied" from "a credential was supplied and
 * every call has failed" by looking at calls, because in both cases there are no
 * successes to look at — and those two demand opposite responses. Only a process
 * holding the environment knows, so it writes it down, once at boot and again on
 * every pass, and the projector reads it back.
 *
 * It is written for EVERY known source including the dark ones. Writing only the live
 * ones would leave a source that was turned off yesterday sitting in the table as
 * whatever it was last week, which is a stale claim rather than a missing one — the
 * worse of the two.
 *
 * ── ★ `watched` — WHY THE RECORDING IS A WRAPPER AND NOT A LINE IN THE LOOP ──
 *
 * Health is "did a call to this vendor work", and the only place that is knowable is
 * around the call. A loop that remembered to record it would record it for the verb it
 * was written for and not for the one added later: a discovery pass and a tracking
 * pass both call the same source, and a source that fails every re-read while
 * discovery happens to succeed is a source that is half broken and would read as
 * entirely fine. Wrapping the adapter means every verb on the port is covered by
 * construction, including verbs that do not exist yet.
 *
 * ★ THE WRAPPER NEVER SWALLOWS AND NEVER SUBSTITUTES. The error is re-thrown exactly
 * as it arrived, because the caller's decision — count it, log it, move to the next
 * source — is not this file's to make; and a successful call whose HEALTH WRITE failed
 * still returns its value, because losing a page of items to a bookkeeping failure
 * would be the recording mechanism causing the outage it exists to report.
 *
 * ★ AND `toItem` / `baselineKey` / `estimate` ARE PASSED THROUGH UNTOUCHED. All three are
 * pure functions over data we already hold; recording a "successful call" for them
 * would make a source look alive on the strength of parsing its own past payloads. On
 * `estimate` the point is sharper than on the other two: a dry run consists of nothing
 * BUT estimates, so a wrapper that recorded them would end a dry run with every source
 * marked as answering — a health board reporting a healthy ingest on a run that
 * contacted nobody.
 *
 * ── ★ AND ONE ERROR THAT IS NOT A SOURCE FAILURE ────────────────────────────
 *
 * `BudgetRefused` is thrown by our own meter, BEFORE the request leaves the process.
 * The vendor was never contacted, so it cannot have failed, and recording it against
 * the source's health would write our own decision into a column whose entire purpose
 * is to say what somebody else's server did. The consequence is not cosmetic: three
 * refusals in a row would drive `consecutive_failures` past `failingAfterFailures` and
 * paint the source red, so a working source would be reported broken on precisely the
 * days the budget is tight — and the operator would go looking for an outage that is
 * actually an invoice. It is re-thrown unchanged; the caller records the pause.
 */

import { sourceId } from '@insidor/contracts';
import type { Item, Millis } from '@insidor/contracts';
import type { CostEstimate } from '@insidor/contracts/ports/meter.ts';
import type { SourceHealthRepo } from '@insidor/contracts/ports/store.ts';
import type { PlannedCall, PlatformAdapter } from '@insidor/contracts/ports/platform.ts';
import type { PlatformRegistry } from '@insidor/platform-registry';
import { BudgetRefused } from '@insidor/vendor-kit';

import { errorText, type Logger } from './log.ts';

export interface WatchDeps {
  readonly health: SourceHealthRepo;
  readonly now: () => Millis;
  readonly log: Logger;
}

/**
 * How much of a vendor's message is kept.
 *
 * An operational bound rather than a product one: some vendors answer an error with a
 * whole HTML page, and a row holding one is a row nobody reads and a log line nobody
 * can scan. The head of the message is where the useful part lives; the rest is
 * available in the run row and in the log at the moment it happened.
 */
const MAX_REASON_CHARS = 500;

const reason = (e: unknown): string => errorText(e).slice(0, MAX_REASON_CHARS);

/**
 * Record the outcome without letting the recording change it.
 *
 * A health write that throws is logged and dropped. The alternative — letting it
 * escape — would turn a database hiccup into a source failure, and then into a red
 * pip, on a source that was working perfectly.
 */
async function record(deps: WatchDeps, write: () => Promise<void>, source: string): Promise<void> {
  try {
    await write();
  } catch (e) {
    deps.log.error('could not record source health', { source, err: errorText(e) });
  }
}

/** Wrap one adapter so every call it makes is recorded. */
export function watched(adapter: PlatformAdapter, deps: WatchDeps): PlatformAdapter {
  const id = adapter.id;
  const label = String(id);

  async function around<T>(call: () => Promise<T>): Promise<T> {
    let value: T;
    try {
      value = await call();
    } catch (e) {
      /* ★ OUR OWN REFUSAL IS NOT THE VENDOR'S OUTAGE. See the header. The meter threw
         before the request went out, so there is no call whose outcome this could be —
         and writing one would let a tight budget spend three passes turning a healthy
         source red. It escapes with the health record untouched, which is what leaves
         the last-success instant saying the true thing: this source last answered when
         it last answered, and today we did not ask. */
      if (e instanceof BudgetRefused) throw e;
      const at = deps.now();
      await record(deps, () => deps.health.recordFailure(id, at, reason(e)), label);
      throw e;
    }
    await record(deps, () => deps.health.recordSuccess(id, deps.now()), label);
    return value;
  }

  return {
    id,
    capabilities: adapter.capabilities,
    discover: (query, budget) => around(() => adapter.discover(query, budget)),
    observe: (ids, budget) => around(() => adapter.observe(ids, budget)),
    /* Pure arithmetic over the adapter's own price book. No call, no outcome, nothing
       to record — and recording one would end a dry run with every source marked as
       having answered. */
    estimate: (call: PlannedCall): CostEstimate => adapter.estimate(call),
    toItem: (raw: unknown, at: Millis): Item => adapter.toItem(raw, at),
    baselineKey: (item: Item, at: Millis): string => adapter.baselineKey(item, at),
  };
}

/**
 * Write what configuration says about every known source.
 *
 * Called at boot — so the indicator is honest even when nothing is calling anything —
 * and again at the top of every pass, so a row deleted by hand, or never written
 * because the database was down at boot, repairs itself rather than staying missing
 * until somebody restarts the process.
 *
 * ★ IT DOES NOT THROW. A boot that failed because it could not write a health row
 * would be a monitoring feature taking down the thing it monitors.
 */
export async function declareSources(
  registry: PlatformRegistry,
  deps: WatchDeps,
): Promise<void> {
  const at = deps.now();

  for (const adapter of registry.all()) {
    await record(deps, () => deps.health.declare(adapter.id, 'configured', null, at), String(adapter.id));
  }

  for (const absence of registry.absent()) {
    /* The detail is joined rather than dropped: it names the environment variables
       that would turn the source on, which is the only actionable half of a dormant
       row and the only way a misconfiguration says what is wrong. It stays in
       `internal`; whatever reaches a screen is the projector's decision, not this
       one's. */
    const detail = absence.detail.length === 0 ? null : absence.detail.join('; ');
    await record(
      deps,
      /* `sourceId` rather than a cast: the registry's key is a plain string union and
         the store takes the branded id, and this is the seam where one becomes the
         other. The constructor also rejects a key that is not a legal token, which is
         the check that would catch a source added to the registry under a name no
         other table could hold. */
      () => deps.health.declare(sourceId(absence.source), absence.configuration, detail, at),
      absence.source,
    );
  }
}

/**
 * The same registry, with every live adapter recorded.
 *
 * ★ A DERIVED REGISTRY RATHER THAN "REMEMBER TO WRAP AT THE CALL SITE". There is
 * exactly one object in this process that answers "which sources may I call", and if
 * the wrapped and unwrapped versions both existed, the next loop to be written would
 * take whichever one was in scope. The one it would take is the unwrapped one, because
 * that is the one the registry function returns — and the symptom would be a source
 * whose calls are working and whose health record says it has never answered.
 *
 * The absences pass through untouched: an absence is a fact about configuration, and
 * there is no call around which to record anything.
 */
export function watchedRegistry(registry: PlatformRegistry, deps: WatchDeps): PlatformRegistry {
  const wrapped = new Map<string, PlatformAdapter>();
  for (const adapter of registry.all()) wrapped.set(String(adapter.id), watched(adapter, deps));

  return {
    get: (source) => {
      /* Delegated rather than reimplemented, so the two error classes — a typo and an
         unconfigured source — keep coming from the one place that can tell them
         apart. The lookup below can only succeed for something `get` would return. */
      const adapter = registry.get(source);
      return wrapped.get(String(adapter.id)) ?? adapter;
    },
    all: () => [...wrapped.values()],
    has: (source) => registry.has(source),
    absent: () => registry.absent(),
  };
}
