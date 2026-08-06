'use strict';

const { t, c, row: dbRow } = require('../../../lib/db-schema');
const { CONFIG: BUDGET } = require('../../adapters/x/budget');

const LANES = {
  'catch-all': 'floor_catch_all',
  'slow-burn': 'floor_slow_burn',
  'media-lane': 'floor_media',
};

const DEFAULTS = {
  'catch-all': Number(process.env.FLOOR_CATCH_ALL_START) || 100,
  'slow-burn': Number(process.env.FLOOR_SLOW_BURN_START) || 1000,
  'media-lane': Number(process.env.FLOOR_MEDIA_START) || 100,
};

const UNDERUTILISED_WARN_PCT = Number(process.env.INGEST_UNDERUTILISED_PCT) || 0.30;
const UNDERUTILISED_WARN_MS = Number(process.env.INGEST_UNDERUTILISED_MS) || 2 * 60 * 60 * 1000;
const FLOOR_MIN_DECAY_MS = 60 * 60 * 1000;
const FLOOR_MIN_CAP_PCT = 0.25;
const HEALTH_ALARM_REPEAT_MS = 60 * 60 * 1000;
const { loadLastHealthAlarmAt, saveLastHealthAlarmAt } = require('../../lib/cron-state');
/** Holds per-lane floors when DB columns are not migrated yet (same-process fallback only). */
let runtimeLaneFloors = null;
/** In-memory underutilisation clock when ingest_underutilised_since column is absent. */
let underutilisedSinceMs = null;

function laneFloorMin(laneKey) {
  if (laneKey === 'catch-all' || laneKey === 'media-lane') return 100;
  return BUDGET.FLOOR_MIN;
}

function laneColumn(laneKey) {
  return LANES[laneKey] || LANES['catch-all'];
}

function getLaneFloors(state) {
  const floors = {
    'catch-all': state?.floor_catch_all ?? state?.adaptive_floor ?? DEFAULTS['catch-all'],
    'slow-burn': state?.floor_slow_burn ?? DEFAULTS['slow-burn'],
    'media-lane': state?.floor_media ?? DEFAULTS['media-lane'],
  };
  if (runtimeLaneFloors) {
    return { ...floors, ...runtimeLaneFloors };
  }
  return floors;
}

/** Age-aware min_faves: base × min(window/60, 1). 30m → half base; ≥60m → full base. */
function effectiveFloor(baseFloor, windowMinutes, laneKey = 'catch-all') {
  const minBase = laneFloorMin(laneKey);
  const defaultBase = DEFAULTS[laneKey] ?? DEFAULTS['catch-all'];
  const base = Math.max(minBase, Number(baseFloor) || defaultBase);
  const mins = Math.max(1, Number(windowMinutes) || 60);
  const mult = Math.min(mins / 60, 1);
  const scaled = Math.round(base * mult);
  const scaledMin = minBase <= 100 ? 30 : BUDGET.FLOOR_MIN;
  return Math.max(scaledMin, Math.min(BUDGET.FLOOR_MAX, scaled));
}

function resolveLaneFloor(state, laneKey, recencyMin) {
  const floors = getLaneFloors(state);
  const base = floors[laneKey] ?? DEFAULTS[laneKey];
  const effective = effectiveFloor(base, recencyMin, laneKey);
  return { base, effective, laneKey };
}

function maxLaneFloor(floors) {
  return Math.max(floors['catch-all'], floors['slow-burn'], floors['media-lane']);
}

function capFloorMin(state, floors, options = {}) {
  const ref = maxLaneFloor(floors);
  const cap = Math.max(BUDGET.FLOOR_MIN, Math.floor(ref * FLOOR_MIN_CAP_PCT));
  let floorMin = state?.floor_min ?? BUDGET.FLOOR_MIN;
  if (options.decayFloorMin) {
    floorMin = Math.max(BUDGET.FLOOR_MIN, Math.floor(floorMin * 0.9));
  }
  return Math.min(floorMin, cap);
}

async function persistFloors(sb, state, floors, extra = {}) {
  const decayFloorMin = !!extra.decayFloorMin;
  const floorMin = capFloorMin(state, floors, { decayFloorMin });
  const adaptive = maxLaneFloor(floors);
  const row = {
    floor_catch_all: floors['catch-all'],
    floor_slow_burn: floors['slow-burn'],
    floor_media: floors['media-lane'],
    floor_min: floorMin,
    adaptive_floor: adaptive,
    updated_at: new Date().toISOString(),
    ...extra,
  };
  delete row.decayFloorMin;

  const { data, error } = await sb
    .from(t('worker_budget_state'))
    .update(dbRow('worker_budget_state', row))
    .eq(c('worker_budget_state', 'id'), 1)
    .select('*')
    .single();

  if (error) {
    if (/floor_catch_all|schema cache/i.test(error.message)) {
      return persistFloorsLegacy(sb, state, floors, floorMin);
    }
    throw new Error('persist lane floors: ' + error.message);
  }
  runtimeLaneFloors = { ...floors };
  return data;
}

/** Pre-migration fallback when per-lane columns are not applied yet. */
async function persistFloorsLegacy(sb, state, floors, floorMin) {
  const rowLegacy = dbRow('worker_budget_state', {
    adaptive_floor: floors['catch-all'],
    floor_min: floorMin,
    updated_at: new Date().toISOString(),
  });
  const { data, error } = await sb
    .from(t('worker_budget_state'))
    .update(rowLegacy)
    .eq(c('worker_budget_state', 'id'), 1)
    .select('*')
    .single();
  if (error) throw new Error('persist lane floors (legacy): ' + error.message);
  runtimeLaneFloors = { ...floors };
  console.warn('[budget] per-lane floor columns missing — run npm run schema:ingest-floors');
  return normalizeStateFloors({ ...data, ...floors });
}

/**
 * Adjust one lane's base floor from its own results only.
 * api_raw=0 → lower 40% immediately, never raise.
 */
async function adjustLaneFloor(sb, state, laneKey, result, readTarget, cycleCtx = {}) {
  const floors = getLaneFloors(state);
  let base = floors[laneKey];
  let reason = 'unchanged';
  const raw = Number(result?.rawFromApi) || 0;
  const reads = Number(result?.reads) || 0;
  const target = Math.max(1, readTarget || 1);

  if (raw === 0) {
    base = Math.max(laneFloorMin(laneKey), Math.floor(base * 0.6));
    reason = 'api_raw=0 — lower 40%';
  } else if (cycleCtx.anyLaneZero) {
    reason = 'other lane empty — hold (no raise while any lane at zero)';
  } else if (reads > target) {
    base = Math.min(BUDGET.FLOOR_MAX, Math.ceil(base * 1.2));
    reason = `reads ${reads} > target ${target} — raise 20%`;
  } else if (reads < target * 0.6) {
    base = Math.max(laneFloorMin(laneKey), Math.floor(base * 0.8));
    reason = `reads ${reads} < 60% of target ${target} — lower 20%`;
  }

  if (base === floors[laneKey] && reason === 'unchanged') {
    return { state, base, reason };
  }

  floors[laneKey] = base;
  console.log(`[budget] ${laneKey} base_floor → ${base} (${reason})`);
  const nextState = await persistFloors(sb, state, floors);
  return { state: nextState, base, reason };
}

/** Decay floor_min + all lane bases 10%/hour when daily reads < 50% budget. */
async function maybeDecayFloorsForUnderutilisation(sb, state) {
  const spendPct = (state.reads_today || 0) / BUDGET.DAILY_TWEET_BUDGET;
  if (spendPct >= 0.5) {
    if (state.floor_min_decay_at || state.ingest_underutilised_since) {
      await sb.from(t('worker_budget_state')).update(dbRow('worker_budget_state', {
        floor_min_decay_at: null,
        updated_at: new Date().toISOString(),
      })).eq(c('worker_budget_state', 'id'), 1).then(({ error }) => {
        if (error && !/ingest_underutilised|floor_min_decay/i.test(error.message)) {
          console.warn('[budget] clear decay markers failed:', error.message);
        }
      });
    }
    return state;
  }

  const now = Date.now();
  const lastDecay = state.floor_min_decay_at ? Date.parse(state.floor_min_decay_at) : 0;
  if (lastDecay && now - lastDecay < FLOOR_MIN_DECAY_MS) return state;

  const floors = getLaneFloors(state);
  const decay = (n, laneKey) => Math.max(laneFloorMin(laneKey), Math.floor(n * 0.9));
  const nextFloors = {
    'catch-all': decay(floors['catch-all'], 'catch-all'),
    'slow-burn': decay(floors['slow-burn'], 'slow-burn'),
    'media-lane': decay(floors['media-lane'], 'media-lane'),
  };

  console.warn(
    `[budget] under-spend ${(spendPct * 100).toFixed(1)}% — decaying lane floors and floor_min 10%`,
  );

  return persistFloors(sb, state, nextFloors, {
    floor_min_decay_at: new Date().toISOString(),
    decayFloorMin: true,
  });
}

async function checkIngestHealthAlarm(sb, state) {
  const spendPct = (state.reads_today || 0) / BUDGET.DAILY_TWEET_BUDGET;
  const now = Date.now();
  const hasLaneColumns = Number.isFinite(state.floor_catch_all);
  let lastHealthAlarmAt = 0;
  try {
    lastHealthAlarmAt = await loadLastHealthAlarmAt(sb);
  } catch (_) {
    lastHealthAlarmAt = 0;
  }

  async function markHealthAlarm() {
    if (lastHealthAlarmAt && now - lastHealthAlarmAt < HEALTH_ALARM_REPEAT_MS) return;
    lastHealthAlarmAt = now;
    try {
      await saveLastHealthAlarmAt(sb, now);
    } catch (e) {
      console.warn('[budget] save health alarm failed:', e.message);
    }
  }

  function logUnderutilisedAlarm(sinceMs) {
    if (lastHealthAlarmAt && now - lastHealthAlarmAt < HEALTH_ALARM_REPEAT_MS) return;
    markHealthAlarm();
    const floors = getLaneFloors(state);
    const hours = sinceMs ? Math.round((now - sinceMs) / 3600000 * 10) / 10 : 0;
    console.error(
      '\n' + '='.repeat(72) + '\n' +
      '  INGEST UNDERUTILISED — floor likely too high\n' +
      `  daily tweets ${(state.reads_today || 0).toLocaleString()}/${BUDGET.DAILY_TWEET_BUDGET.toLocaleString()} ` +
      `(${(spendPct * 100).toFixed(1)}%${hours ? ` for ${hours}h` : ''})\n` +
      `  catch-all base=${floors['catch-all']} · slow-burn base=${floors['slow-burn']} · ` +
      `media base=${floors['media-lane']} · floor_min=${state.floor_min}\n` +
      '='.repeat(72) + '\n',
    );
  }

  if (spendPct >= UNDERUTILISED_WARN_PCT) {
    underutilisedSinceMs = null;
    if (hasLaneColumns && state.ingest_underutilised_since) {
      await sb.from(t('worker_budget_state')).update(dbRow('worker_budget_state', {
        ingest_underutilised_since: null,
        updated_at: new Date().toISOString(),
      })).eq(c('worker_budget_state', 'id'), 1).then(({ error }) => {
        if (error && !/ingest_underutilised/i.test(error.message)) {
          console.warn('[budget] clear underutilised marker failed:', error.message);
        }
      });
    }
    return state;
  }

  if (!hasLaneColumns) {
    if (!underutilisedSinceMs) underutilisedSinceMs = now;
    if (now - underutilisedSinceMs >= UNDERUTILISED_WARN_MS) {
      logUnderutilisedAlarm(underutilisedSinceMs);
    }
    return state;
  }

  let sinceMs = state.ingest_underutilised_since
    ? Date.parse(state.ingest_underutilised_since)
    : null;

  if (!sinceMs || !Number.isFinite(sinceMs)) {
    await sb.from(t('worker_budget_state')).update(dbRow('worker_budget_state', {
      ingest_underutilised_since: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })).eq(c('worker_budget_state', 'id'), 1).then(({ error }) => {
      if (error && !/ingest_underutilised/i.test(error.message)) {
        console.warn('[budget] set underutilised marker failed:', error.message);
      }
    });
    return state;
  }

  if (now - sinceMs >= UNDERUTILISED_WARN_MS) {
    logUnderutilisedAlarm(sinceMs);
  }

  return state;
}

function normalizeStateFloors(state) {
  if (!state) return state;
  const floors = getLaneFloors(state);
  state.floor_catch_all = floors['catch-all'];
  state.floor_slow_burn = floors['slow-burn'];
  state.floor_media = floors['media-lane'];
  state.adaptive_floor = maxLaneFloor(floors);
  state.floor_min = capFloorMin(state, floors);
  return state;
}

async function resetFloorsToDefaults(sb) {
  const floors = {
    'catch-all': DEFAULTS['catch-all'],
    'slow-burn': DEFAULTS['slow-burn'],
    'media-lane': DEFAULTS['media-lane'],
  };
  runtimeLaneFloors = null;
  const state = { floor_min: BUDGET.FLOOR_MIN };
  const data = await persistFloors(sb, state, floors);
  console.log(
    `[budget] floors reset — catch-all=${floors['catch-all']} slow-burn=${floors['slow-burn']} ` +
    `media=${floors['media-lane']} floor_min=${data.floor_min}`,
  );
  return data;
}

module.exports = {
  LANES,
  DEFAULTS,
  getLaneFloors,
  effectiveFloor,
  resolveLaneFloor,
  adjustLaneFloor,
  maybeDecayFloorsForUnderutilisation,
  checkIngestHealthAlarm,
  normalizeStateFloors,
  capFloorMin,
  resetFloorsToDefaults,
};
