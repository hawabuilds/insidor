'use strict';

const { postAgeMinutes, postCreatedMs } = require('./posted-at');

function recordIngestAge(stats, parsed, nowMs = Date.now()) {
  const ms = postCreatedMs(parsed);
  if (ms == null) return;
  if (!stats.ingestAgeMin) stats.ingestAgeMin = [];
  stats.ingestAgeMin.push(Math.max(0, (nowMs - ms) / 60000));
}

function median(values) {
  if (!values?.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function formatIngestAgeLine(stats) {
  const med = median(stats.ingestAgeMin);
  const medStr = med != null ? `${Math.round(med)}m` : '—';
  return (
    `fetched=${stats.returned} ingested=${stats.ingested} ` +
    `dropped_stale=${stats.droppedStale || 0} median_age_at_ingest=${medStr}`
  );
}

module.exports = { recordIngestAge, formatIngestAgeLine, median };
