/**
 * WHEN THE QUICK FRAME RUNS: the project service's launcher asks this on its own lane, every second.
 *
 * Its own file because the launcher (tools/railway-start.mjs) is plain JavaScript that holds no
 * database connection of its own; the decision (quick-frame.ts `quickDue`) and the cursor it keeps
 * belong next to the frame they start, where they are typed and tested.
 *
 * `maybe()` reads the probe at most every `checkEveryMs`. The first read only sets the cursor: what
 * was filed before the service started is the first full frame's. After that, when a quick frame is
 * due it moves the cursor to the probe it read and runs one, handing it the cursor before. A quick
 * frame that fails puts the cursor back, so its posts are tried again — `minGapMs` later at the
 * soonest, unless every yes since has its kind answer.
 *
 * ★ THE FULL FRAME NO LONGER MOVES THE CURSOR. It used to (`mark()` before each full frame, when the
 * two ran one after the other): an answer filed as a full frame began was left to that frame, two
 * minutes away. Now they run side by side, and every answer is this lane's to place within seconds;
 * the full frame leaves the posts that changed since it began as this lane placed them
 * (for-you-lock.ts).
 *
 * ★ POLLED, NOT LISTENED FOR. A LISTEN needs a session connection (5432), and the session pooler
 * caps clients per user (DEPLOY.md); this service's DATABASE_URL is the transaction pooler. One
 * pooled client asking a few index reads every five seconds costs less than a held session.
 *
 * What breaks if changed carelessly: the cursor must move BEFORE the frame runs, not after it. After,
 * an answer filed while the frame ran (after it had read its posts) would be behind the cursor and
 * wait for the next full frame — the minute this exists to save.
 */

import { DEFAULT_POLICY, type Policy } from '@insidor/contracts/policy.ts';
import { asDb, createPool, DB_ROLE } from '@insidor/store';

import { quickDue, readProbe, type QuickCursor, type QuickProbe } from './quick-frame.ts';

export interface QuickWakeDeps {
  /** The probe, with the yeses' kinds past this cursor when there is one. */
  readonly probe: (since: QuickCursor | null) => Promise<QuickProbe>;
  /** Run one quick frame from this cursor; true when it exited cleanly. */
  readonly run: (from: QuickCursor) => Promise<boolean>;
  readonly policy: Policy;
  readonly now: () => number;
  readonly log: (fields: Record<string, unknown>) => void;
}

export interface QuickWake {
  maybe(): Promise<void>;
  close(): Promise<void>;
}

const cursorOf = (p: QuickProbe): QuickCursor => ({ answerId: p.answerId, atMs: p.atMs });

export function quickWake(deps: QuickWakeDeps, close: () => Promise<void> = async () => {}): QuickWake {
  let cursor: QuickCursor | null = null;
  let lastQuickAt: number | null = null;
  let lastCheckAt: number | null = null;
  let lastOk = true;
  let failing = false;
  const probe = async (): Promise<QuickProbe | null> => {
    try {
      const p = await deps.probe(cursor);
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
    async maybe() {
      const q = deps.policy.rising.quickFrame;
      const now = deps.now();
      if (!q.on || (lastCheckAt !== null && now - lastCheckAt < q.checkEveryMs)) return;
      lastCheckAt = now;
      const p = await probe();
      if (p === null) return;
      /* The first read: where this lane begins. */
      if (cursor === null) {
        cursor = cursorOf(p);
        return;
      }
      /* After a failed frame the gap holds whatever the probe says: a frame that keeps failing is tried every `minGapMs`, not every check. */
      if (!lastOk && lastQuickAt !== null && now - lastQuickAt < q.minGapMs) return;
      if (!quickDue(cursor, lastQuickAt, p, now, deps.policy)) return;
      const from = cursor;
      cursor = cursorOf(p);
      lastQuickAt = now;
      lastOk = await deps.run(from);
      if (!lastOk) cursor = from;
    },
    close,
  };
}

/** The launcher's wake: one pooled client on the service credential, and the quick frame as a child. */
export function openQuickWake(env: Readonly<Record<string, string | undefined>>, run: QuickWakeDeps['run'], log: QuickWakeDeps['log'], policy: Policy = DEFAULT_POLICY): QuickWake {
  const pool = createPool(DB_ROLE.service, { applicationName: 'insidor-project-wake', env: { DATABASE_URL_SERVICE: env['DATABASE_URL'] }, max: 1 });
  return quickWake({ probe: (since) => readProbe(asDb(pool), since), run, policy, now: () => Date.now(), log }, () => pool.end());
}
