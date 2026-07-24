'use strict';

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function fmtViews(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

function fmtRatePerMin(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M/min`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k/min`;
  return `${Math.round(n)}/min`;
}

function formatViewDist(values) {
  if (!values.length) return '—';
  return `p50 ${fmtViews(percentile(values, 0.5))} p90 ${fmtViews(percentile(values, 0.9))} max ${fmtViews(Math.max(...values))}`;
}

function formatViewsVelocityDist(values) {
  if (!values.length) return '—';
  return `p50 ${fmtRatePerMin(percentile(values, 0.5))} p90 ${fmtRatePerMin(percentile(values, 0.9))} max ${fmtRatePerMin(Math.max(...values))}`;
}

module.exports = { percentile, formatViewDist, formatViewsVelocityDist, fmtViews, fmtRatePerMin };
