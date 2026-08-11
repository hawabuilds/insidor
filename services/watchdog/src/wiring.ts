/**
 * The composition root. Two imports, and that is the whole point of this
 * service: `@insidor/store` for one read-only query, `@insidor/contracts` for
 * the millisecond type. No core, no adapters, no other service. If this file
 * ever grows a third internal import, the watchdog has stopped being
 * independent and the third liveness layer has quietly become the first one
 * again.
 */

import { closeDb, createDb, readWatchSnapshot, type Db } from '@insidor/store';

import type { WatchdogConfig } from './config.ts';
import type { SnapshotSource } from './snapshot.ts';

export interface Runtime {
  readonly db: Db;
  readonly snapshots: SnapshotSource;
  close(): Promise<void>;
}

export function buildRuntime(cfg: WatchdogConfig): Runtime {
  // No singleton lock here, on purpose. Two watchdogs raising the same alert is
  // noise; zero watchdogs is the failure this exists to prevent.
  const db = createDb(cfg.databaseUrl);

  return {
    db,
    snapshots: { read: (now) => readWatchSnapshot(db, now) },
    close: () => closeDb(db),
  };
}
