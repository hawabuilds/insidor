#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FEATURES = new Set(['feed', 'token', 'wallet']);

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function lintHtmlScriptTags() {
  const html = read('site/index.html');
  const srcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map((m) => m[1]);
  const errors = [];
  for (const src of srcs) {
    const m = src.match(/^features\/([^/]+)\/(.+)$/);
    if (!m) continue;
    const [, feat, rest] = m;
    if (!FEATURES.has(feat)) continue;
    if (rest !== 'index.js') {
      errors.push(
        `site/index.html loads feature internal "${src}" — use features/${feat}/index.js only`,
      );
    }
  }
  return errors;
}

function lintJsImports() {
  const errors = [];
  const importRe = /\b(?:import\s+[^'";]+from\s+|require\s*\(\s*)['"](\.[^'"]+)['"]/g;

  function walk(dirRel) {
    const abs = path.join(ROOT, dirRel);
    if (!fs.existsSync(abs)) return;
    for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
      const rel = path.join(dirRel, ent.name).replace(/\\/g, '/');
      if (ent.isDirectory()) walk(rel);
      else if (ent.name.endsWith('.js')) checkFile(rel);
    }
  }

  function checkFile(fileRel) {
    const content = read(fileRel);
    const fileDir = path.dirname(fileRel);
    let match;
    while ((match = importRe.exec(content)) !== null) {
      const req = match[1];
      if (!req.startsWith('.')) continue;
      const resolved = path.normalize(path.join(fileDir, req)).replace(/\\/g, '/');
      const featM = resolved.match(/^site\/features\/([^/]+)\/(.+)$/);
      if (!featM) continue;
      const [, feat, rest] = featM;
      if (rest === 'index.js') continue;
      const importerFeat = fileRel.match(/^site\/features\/([^/]+)\//)?.[1];
      if (importerFeat === feat) continue;
      errors.push(
        `${fileRel}: imports feature internal "${req}" — use features/${feat}/index.js or shared/`,
      );
    }
  }

  walk('site/features');
  walk('site/shared');
  return errors;
}

function main() {
  const errors = [...lintHtmlScriptTags(), ...lintJsImports()];
  if (errors.length) {
    errors.forEach((e) => console.error('feature-boundary:', e));
    process.exit(1);
  }
  console.log('feature boundaries OK');
}

main();
