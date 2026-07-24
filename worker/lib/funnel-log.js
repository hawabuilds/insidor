'use strict';

/**
 * Per-cycle funnel logger — shows gate drop-offs in order.
 * Example: [cluster] funnel tt: 8 in → 6 recent → 2 replication → 1 eligible
 */
class FunnelLog {
  constructor(tag, platform = 'all') {
    this.tag = tag;
    this.platform = platform;
    this.steps = [];
  }

  in(count) {
    this.steps.push({ label: 'in', count: Number(count) || 0 });
    return this;
  }

  drop(gate, remaining) {
    this.steps.push({ label: gate, count: Number(remaining) || 0 });
    return this;
  }

  out(count) {
    this.steps.push({ label: 'out', count: Number(count) || 0 });
    return this;
  }

  toString() {
    const parts = this.steps.map((s, i) => {
      if (i === 0) return `${s.count} ${s.label}`;
      return `${s.count} ${s.label}`;
    });
    return `[${this.tag}] funnel ${this.platform}: ${parts.join(' → ')}`;
  }

  log() {
    if (this.steps.length) console.log(this.toString());
    return this;
  }
}

function mergeFunnelCounts(map, key, gate, n = 1) {
  if (!map[key]) map[key] = {};
  map[key][gate] = (map[key][gate] || 0) + n;
}

function formatGateSummary(map) {
  return Object.entries(map)
    .map(([plat, gates]) => {
      const parts = Object.entries(gates).map(([g, c]) => `${c} ${g}`).join(', ');
      return `${plat}: ${parts}`;
    })
    .join(' · ');
}

module.exports = { FunnelLog, mergeFunnelCounts, formatGateSummary };
