'use strict';

const fs = require('fs');
const path = require('path');

const LOCK_PATH = path.join(__dirname, '..', '.pipeline.lock');

function isPidAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code !== 'ESRCH';
  }
}

function readLock() {
  try {
    const raw = fs.readFileSync(LOCK_PATH, 'utf8').trim();
    const pid = Number(raw.split(/\s+/)[0]);
    const startedAt = raw.split(/\s+/).slice(1).join(' ') || null;
    return { pid, startedAt, raw };
  } catch {
    return null;
  }
}

function acquirePipelineLock() {
  const existing = readLock();
  if (existing?.pid && isPidAlive(existing.pid)) {
    const err = new Error(`pipeline already running (pid ${existing.pid})`);
    err.code = 'PIPELINE_LOCKED';
    err.pid = existing.pid;
    throw err;
  }

  if (existing?.pid) {
    console.warn(`[pipeline] clearing stale lock (pid ${existing.pid} dead)`);
    try {
      fs.unlinkSync(LOCK_PATH);
    } catch (_) {
      /* stale */
    }
  } else if (existing) {
    console.warn('[pipeline] clearing invalid lockfile');
    try {
      fs.unlinkSync(LOCK_PATH);
    } catch (_) {
      /* ignore */
    }
  }

  const line = `${process.pid} ${new Date().toISOString()}\n`;
  fs.writeFileSync(LOCK_PATH, line, 'utf8');
  return LOCK_PATH;
}

function releasePipelineLock() {
  const existing = readLock();
  if (existing?.pid && existing.pid !== process.pid) return false;
  try {
    fs.unlinkSync(LOCK_PATH);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  LOCK_PATH,
  acquirePipelineLock,
  releasePipelineLock,
  readLock,
  isPidAlive,
};
