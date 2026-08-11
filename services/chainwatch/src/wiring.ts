/**
 * The composition root: the ONE file in this service that names other packages.
 *
 * The feed itself is unimplemented on purpose. Its body is a venue adapter call
 * — a launchpad list endpoint carrying `created_timestamp`, confirmed against
 * one generic signatures-for-address read — and the venue adapters are separate
 * packages whose names are not fixed yet. Writing a plausible one here would
 * put a chain's field names inside a service, which is the boundary this whole
 * rebuild exists to hold.
 *
 * Everything that makes this process worth deploying — the durable cursor, the
 * backoff, the coverage log, the run records — is implemented, transport
 * agnostic, and tested. Filling in `read()` is a function body, not a redesign.
 */

import {
  acquireSingletonLock,
  closeDb,
  closeStageRun,
  createDb,
  loadMintCursor,
  openStageRun,
  recordCoverageGap,
  saveMintCursor,
  upsertAssets,
  type Db,
} from '@insidor/store';

import type { ChainwatchConfig } from './config.ts';
import type { CursorStore } from './cursor.ts';
import type { MintFeed, MintSink } from './feed.ts';
import type { Logger } from './log.ts';
import { NotImplemented } from './not-implemented.ts';
import type { StageRunRecorder } from './run-record.ts';

export interface Runtime {
  readonly db: Db;
  readonly feed: MintFeed;
  readonly sink: MintSink;
  readonly cursors: CursorStore;
  readonly stageRuns: StageRunRecorder;
  close(): Promise<void>;
}

function createFeed(cfg: ChainwatchConfig): MintFeed {
  return {
    id: cfg.feedId,
    transport: cfg.transport,
    read: () =>
      Promise.reject(
        new NotImplemented(
          `mint feed ${cfg.feedId} (${cfg.transport}) — call the venue adapter's creation ` +
            'listing, confirm each mint time against the chain, and return a page whose ' +
            '`pageFull` is true when the source returned exactly the limit',
        ),
      ),
  };
}

export async function buildRuntime(cfg: ChainwatchConfig, log: Logger): Promise<Runtime> {
  const db = createDb(cfg.databaseUrl);

  // Two watchers on one cursor is two watchers each convinced they have full
  // coverage, and neither of them does.
  const solo = await acquireSingletonLock(db, cfg.singletonLockName);
  if (!solo) {
    await closeDb(db);
    throw new Error(
      `another chainwatch already holds ${cfg.singletonLockName}; refusing to start a second one`,
    );
  }

  log.info('runtime ready', { feedId: cfg.feedId, transport: cfg.transport });

  return {
    db,
    feed: createFeed(cfg),
    sink: {
      recordMints: (mints) => upsertAssets(db, mints),
      recordGap: (gap) => recordCoverageGap(db, cfg.feedId, gap),
    },
    cursors: {
      load: (feedId) => loadMintCursor(db, feedId),
      save: (cursor) => saveMintCursor(db, cursor),
    },
    stageRuns: {
      open: (stage, host, startedAt) => openStageRun(db, stage, host, startedAt),
      close: (runId, result) => closeStageRun(db, runId, result),
    },
    close: () => closeDb(db),
  };
}
