/**
 * Renders docs/graph.svg from the REAL import graph — one arrow per coupling that actually
 * exists in the source, not one per coupling somebody intended.
 *
 * WHY this is worth a tool: a changed dependency-graph SVG in a pull request is the most
 * legible possible signal that somebody added a coupling, and it is legible to a
 * non-engineer. `--verify` makes it a gate: regenerate, compare bytes, fail if the
 * committed picture no longer describes the code.
 *
 * WHY there are no edge counts or file counts in the picture: the SVG should change when a
 * COUPLING changes and at no other time. Counts would make it churn on every import and the
 * signal would be lost inside the noise within a week. Counts go to stdout instead.
 *
 * Forbidden edges — anything the dependency rule does not allow — are drawn in red and
 * reported with the file and line that created them, and the tool exits non-zero. That
 * duplicates dependency-cruiser deliberately: this one produces a picture a founder can read.
 *
 * Usage:  node tools/graph.mjs           writes docs/graph.svg
 *         node tools/graph.mjs --verify  fails if the committed file is stale
 */

import fs from 'node:fs';
import path from 'node:path';
import { ROOT, walk, read, blankNonCode, locate } from './lib/source.mjs';

/* ── the intended shape ───────────────────────────────────────────────── */

/**
 * Position is fixed by hand rather than laid out by an algorithm, so that the diff of two
 * generated SVGs is exactly the set of arrows that changed.
 */
const NODES = [
  { id: 'services', role: 'the processes', x: 60, y: 40, w: 200 },
  { id: 'app', role: 'what a person sees', x: 300, y: 40, w: 200 },
  { id: 'eval', role: 'replay and scoring', x: 540, y: 40, w: 200 },

  { id: 'core', role: 'all the logic, pure', x: 30, y: 190, w: 160 },
  { id: 'adapters', role: 'all the vendor code', x: 210, y: 190, w: 160 },
  { id: 'store', role: 'the only SQL', x: 390, y: 190, w: 160 },
  { id: 'ml', role: 'trees and labels', x: 570, y: 190, w: 160 },

  { id: 'contracts', role: 'the vocabulary — imports nothing', x: 210, y: 340, w: 340 },
];

const BOX_H = 54;

/** Mirrors .dependency-cruiser.cjs. That file is the gate; this is the picture of it. */
const ALLOWED = {
  contracts: [],
  core: ['contracts'],
  adapters: ['contracts'],
  store: ['contracts'],
  ml: ['contracts'],
  services: ['contracts', 'core', 'adapters', 'store', 'ml'],
  app: ['contracts', 'store'],
  eval: ['contracts', 'core', 'store'],
};

const PACKAGES = NODES.map((n) => n.id);

/* ── read the real imports ────────────────────────────────────────────── */

const IMPORT_RE = /\b(?:import|export)\b[^;'"`]*?\bfrom\s*['"]([^'"]+)['"]|\bimport\s*['"]([^'"]+)['"]/g;

/** Which package a specifier lands in, or null for "not one of ours". */
function targetOf(spec, fromPkg, file) {
  if (spec.startsWith('@insidor/')) {
    const name = spec.slice('@insidor/'.length).split('/')[0];
    return PACKAGES.includes(name) ? name : null;
  }
  if (spec.startsWith('.')) {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    const top = resolved.split('/')[0];
    return top === fromPkg ? null : (PACKAGES.includes(top) ? top : null);
  }
  return null;
}

const edges = new Map(); // "from->to" → [{ file, line, spec }]

for (const pkg of PACKAGES) {
  for (const file of walk(pkg, ['.ts', '.tsx', '.mts'])) {
    if (file.endsWith('.test.ts') || file.includes('/__fixtures__/')) continue;
    const raw = read(file);
    /* Strings are kept: the specifier IS a string. Comments are blanked, so a
       commented-out import does not draw an arrow. */
    const code = blankNonCode(raw, { strings: false });
    IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_RE.exec(code)) !== null) {
      const spec = m[1] ?? m[2];
      const to = targetOf(spec, pkg, file);
      if (to === null || to === pkg) continue;
      const at = code.indexOf(spec, m.index);
      const { line } = locate(raw, at === -1 ? m.index : at);
      const key = `${pkg}->${to}`;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push({ file, line, spec });
    }
  }
}

const present = new Set(PACKAGES.filter((p) => fs.existsSync(path.join(ROOT, p))));
const drawn = [...edges.keys()].sort();
const forbidden = drawn.filter((key) => {
  const [from, to] = key.split('->');
  return !(ALLOWED[from] ?? []).includes(to);
});

/* ── render ───────────────────────────────────────────────────────────── */

const node = (id) => NODES.find((n) => n.id === id);
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function edgePath(from, to, index, total) {
  const a = node(from);
  const b = node(to);
  const spread = Math.min(a.w, b.w) * 0.5;
  const offset = total === 1 ? 0 : (index - (total - 1) / 2) * (spread / Math.max(1, total - 1));
  const x1 = a.x + a.w / 2 + offset;
  const y1 = a.y + BOX_H;
  const x2 = b.x + b.w / 2 + offset;
  const y2 = b.y - 8;
  const mid = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`;
}

function svg() {
  const lines = [];
  lines.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 430" width="800" height="430" font-family="ui-monospace, SFMono-Regular, Menlo, monospace">');
  lines.push('  <!-- GENERATED by tools/graph.mjs from the real import graph. Do not edit by hand. -->');
  lines.push('  <defs>');
  lines.push('    <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#4b5563"/></marker>');
  lines.push('    <marker id="x" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#b91c1c"/></marker>');
  lines.push('  </defs>');
  lines.push('  <rect width="800" height="430" fill="#ffffff"/>');
  lines.push('  <text x="24" y="26" font-size="13" fill="#111827">insidor — who imports whom</text>');

  const byTarget = new Map();
  for (const key of drawn) {
    const [, to] = key.split('->');
    if (!byTarget.has(to)) byTarget.set(to, []);
    byTarget.get(to).push(key);
  }
  for (const [, keys] of [...byTarget.entries()].sort()) {
    keys.forEach((key, i) => {
      const [from, to] = key.split('->');
      const bad = forbidden.includes(key);
      lines.push(`  <path d="${edgePath(from, to, i, keys.length)}" fill="none" stroke="${bad ? '#b91c1c' : '#9ca3af'}" stroke-width="${bad ? 2.5 : 1.4}" marker-end="url(#${bad ? 'x' : 'a'})"/>`);
    });
  }

  for (const n of NODES) {
    const here = present.has(n.id);
    lines.push(`  <rect x="${n.x}" y="${n.y}" width="${n.w}" height="${BOX_H}" rx="6" fill="${here ? '#f9fafb' : '#ffffff'}" stroke="${here ? '#111827' : '#d1d5db'}" stroke-width="1.2"${here ? '' : ' stroke-dasharray="4 3"'}/>`);
    lines.push(`    <text x="${n.x + 12}" y="${n.y + 22}" font-size="12" fill="${here ? '#111827' : '#9ca3af'}">${esc(n.id)}/</text>`);
    lines.push(`    <text x="${n.x + 12}" y="${n.y + 40}" font-size="10" fill="${here ? '#6b7280' : '#d1d5db'}">${esc(here ? n.role : `${n.role} — not built yet`)}</text>`);
  }

  lines.push('  <text x="24" y="412" font-size="9" fill="#9ca3af">generated by tools/graph.mjs — an arrow means a real import. red means the dependency rule forbids it.</text>');
  lines.push('</svg>');
  return `${lines.join('\n')}\n`;
}

/* ── write, or verify ─────────────────────────────────────────────────── */

const OUT = 'docs/graph.svg';
const outPath = path.join(ROOT, OUT);
const rendered = svg();
const verify = process.argv.includes('--verify');

for (const key of drawn) {
  const [from, to] = key.split('->');
  const sites = edges.get(key);
  const mark = forbidden.includes(key) ? 'FORBIDDEN' : 'ok       ';
  console.log(`  ${mark}  ${from} → ${to}  (${sites.length} import site${sites.length === 1 ? '' : 's'})`);
}

if (forbidden.length > 0) {
  console.error('');
  for (const key of forbidden) {
    const [from, to] = key.split('->');
    console.error(`${from} → ${to} is forbidden. The dependency rule allows ${from} → ${(ALLOWED[from] ?? []).join(', ') || 'nothing'}.`);
    for (const site of edges.get(key)) console.error(`   ${site.file}:${site.line}   imports "${site.spec}"`);
  }
  console.error('');
  console.error('[graph] FAILED — the import graph contradicts the dependency rule');
  process.exit(1);
}

if (verify) {
  const committed = fs.existsSync(outPath) ? fs.readFileSync(outPath, 'utf8') : '';
  if (committed !== rendered) {
    console.error('');
    console.error(`[graph] FAILED — ${OUT} is stale. The import graph changed and the committed picture did not.`);
    console.error('[graph] fix: run `node tools/graph.mjs` and commit the result. Then look at the diff — a new arrow is a new coupling, and it is the thing to review.');
    process.exit(1);
  }
  console.log(`[graph] ok — ${OUT} matches the import graph`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, rendered);
console.log(`[graph] wrote ${OUT} — ${drawn.length} coupling${drawn.length === 1 ? '' : 's'} across ${present.size} of ${PACKAGES.length} packages`);
