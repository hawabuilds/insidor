'use strict';

const INTERVAL_MS = Number(process.env.PIPELINE_HEARTBEAT_MS) || 60_000;

async function touchHeartbeat(sb, extra = {}) {
  const now = new Date().toISOString();
  const row = {
    id: 1,
    last_heartbeat: now,
    pipeline_pid: process.pid,
    updated_at: now,
    ...extra,
  };
  const { error } = await sb.from('worker_pipeline_state').upsert(row, { onConflict: 'id' });
  if (error) throw new Error(error.message);
}

function startHeartbeat(sb) {
  let timer = null;

  const tick = async () => {
    try {
      await touchHeartbeat(sb);
    } catch (e) {
      console.warn('[pipeline] heartbeat failed:', e.message);
    }
  };

  tick();
  timer = setInterval(tick, INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();

  return () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
}

module.exports = {
  INTERVAL_MS,
  touchHeartbeat,
  startHeartbeat,
};
