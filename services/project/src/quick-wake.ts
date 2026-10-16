/**
 * WHEN THE QUICK FRAME RUNS: the project service's launcher asks this between its jobs.
 *
 * Its own file because the launcher (tools/railway-start.mjs) is plain JavaScript that runs one job
 * at a time and holds no database connection of its own; the decision (quick-frame.ts `quickDue`)
 * and the cursor it keeps belong next to the frame they start, where they are typed and tested.
 *
 * The launcher calls `mark()` just before every full frame and `maybe()` between jobs and every
 * loop tick. `maybe()` reads the probe at most every `checkEveryMs`; when a quick frame is due it
 * moves the cursor to the probe it read and runs one, handing it the cursor before. A quick frame
 * that fails puts the cursor back, so its posts are tried again — `minGapMs` later at the soonest.
 *
 * ★ POLLED, NOT LISTENED FOR. A LISTEN needs a session connection (5432), and the session pooler
 * caps clients per user (DEPLOY.md); this service's DATABASE_URL is the transaction pooler. One
 * pooled client asking three index reads every five seconds costs less than a held session.
 *
 * What breaks if changed carelessly: `mark()` must run BEFORE the full frame, not after it. After,
 * an answer filed while the frame ran (after it had read its posts) would be behind the cursor and
 * wait for the next full frame — the minute this exists to save.
 */

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { asDb, createPool, DB_ROLE } from '@insidor/store';

import { quickDue, readProbe, type QuickCursor, type QuickProbe } from './quick-frame.ts';

export interface QuickWakeDeps {
  readonly probe: () => Promise<QuickProbe>;
  /** Run one quick frame from this cursor; true when it exited cleanly. */
  readonly run: (from: QuickCursor) => Promise<boolean>;
  readonly policy: Policy;
  readonly now: () => number;
  readonly log: (fields: Record<string, unknown>) => void;
}

export interface QuickWake {
  mark(): Promise<void>;
  maybe(): Promise<void>;
  close(): Promise<void>;
}

const cursorOf = (p: QuickProbe): QuickCursor => ({ answerId: p.answerId, atMs: p.atMs });

export function quickWake(deps: QuickWakeDeps, close: () => Promise<void> = async () => {}): QuickWake {
  let cursor: QuickCursor | null = null;
  let lastQuickAt: number | null = null;
  let lastCheckAt: number | null = null;
  let failing = false;
  const probe = async (): Promise<QuickProbe | null> => {
    try {
      const p = await deps.probe();
      if (failing) deps.log({ level: 'info', msg: 'quick frame probe answers again' });
      failing = false;
      return p;
    } catch (e) {
      /* Said once per outage: the full frame still runs on its minute. */
      if (!failing) deps.log({ level: 'warn', msg: 'quick frame probe failed; For You moves with the full frame only', err: e instanceof Error ? e.message : String(e) });
      failing = true;
      return null;
    }
  };
  return {
    async mark() {
      if (!deps.policy.rising.quickFrame.on) return;
      const p = await probe();
      /* A failed read keeps the older cursor: a larger set of changed posts, never a missed one. */
      if (p !== null) cursor = cursorOf(p);
    },
    async maybe() {
      const q = deps.policy.rising.quickFrame;
      const now = deps.now();
      if (!q.on || cursor === null || (lastCheckAt !== null && now - lastCheckAt < q.checkEveryMs)) return;
      lastCheckAt = now;
      const p = await probe();
      if (p === null || !quickDue(cursor, lastQuickAt, p, now, deps.policy)) return;
      const from = cursor;
      cursor = cursorOf(p);
      lastQuickAt = now;
      const ok = await deps.run(from);
      if (!ok) cursor = from;
    },
    close,
  };
}

/** The launcher's wake: one pooled client on the service credential, and the quick frame as a child. */
export function openQuickWake(env: Readonly<Record<string, string | undefined>>, run: QuickWakeDeps['run'], log: QuickWakeDeps['log'], policy: Policy = DEFAULT_POLICY): QuickWake {
  const pool = createPool(DB_ROLE.service, { applicationName: 'insidor-project-wake', env: { DATABASE_URL_SERVICE: env['DATABASE_URL'] }, max: 1 });
  return quickWake({ probe: () => readProbe(asDb(pool)), run, policy, now: () => Date.now(), log }, () => pool.end());
}
