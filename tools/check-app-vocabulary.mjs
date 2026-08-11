/**
 * THE APP VOCABULARY GATE — Wall D. Fails if an internal-machinery word, an internal name
 * for a user-facing thing, a vendor name, or a spend word appears anywhere in app/src.
 * Also fails on a numeric comparison against a literal of 100 or more inside a component,
 * because a threshold in a component is a product judgement made by whoever was typing.
 *
 * WHY a grep and not a rule: six internal-scoring leaks shipped in the build this replaces,
 * and three of them were reasonable-looking UI written against data the client happened to
 * have — one `.select()` string asked the database for the score, so the client had the
 * score, so the client rendered the score. A leak that arrives as a query string is not
 * something review reliably catches.
 *
 * The structural walls do most of the work: the app reads a projection with no internal
 * field in it, from a physical table with no internal column in it. This check is the
 * fourth wall, and it is the one that catches a developer reintroducing the vocabulary by
 * hand — a variable called `heat`, a comment explaining the threshold, a vendor name in a
 * loading string.
 *
 * NOT banned, deliberately: the vendors the app itself is built on. The app's own wallet
 * and swap SDKs are its dependencies, not our internals. The list below is the vendors the
 * PIPELINE buys from, whose names have no reason to exist in a browser bundle.
 *
 * Escape: `app-vocab-allow: <word>  — reason`, per line, naming the word.
 */

import { walk, read, blankNonCode, locate, inComment, identifiers, forms, Report } from './lib/source.mjs';

const SCANNED = 'app/src';
const EXTS = ['.ts', '.tsx', '.js', '.jsx', '.css', '.html'];

const BANNED = {
  'internal machinery': [
    'score', 'scores', 'scoring', 'confidence', 'threshold', 'thresholds', 'burst',
    'eta', 'propensity', 'holdout', 'explore', 'exploration', 'epsilon', 'policy',
    'policyhash', 'decider', 'verdict', 'heat', 'hysteresis', 'calibration',
    'shadowof', 'backtest', 'featureset', 'featurevector', 'posterior', 'weights',
  ],
  'our word for something the user sees': [
    'narrative', 'cluster', 'candidate', 'admit', 'qualify', 'coinable',
    'nameability', 'judge', 'judgement', 'judgment', 'abstain',
  ],
  'a vendor the pipeline buys from': [
    'anthropic', 'claude', 'apify', 'twitterapi', 'dexscreener', 'helius',
    'rugcheck', 'birdeye', 'serpapi', 'lightgbm',
  ],
  /* Named in the internal forms only. A bare `spend` is the USER's money in a trade panel;
     `spendUsd` and `usdPerDay` are ours, and ours is what has no business in a browser. */
  'what something cost us': [
    'costusd', 'spendusd', 'usdperday', 'dailyusd', 'budget', 'billing', 'quota',
    'meterusd', 'softstop',
  ],
};

const KIND_OF = new Map();
for (const [kind, words] of Object.entries(BANNED)) for (const w of words) KIND_OF.set(w, kind);

const WHY = {
  'internal machinery':
    'the client must have nothing to threshold. A judgement is projected into a closed enum once, server-side, and never re-derived here.',
  'our word for something the user sees':
    'these are pipeline stage names. The user sees stories and coins, not the machine that found them.',
  'a vendor the pipeline buys from':
    'the browser has no reason to know who we buy data from, and a name in a bundle is a name in public.',
  'what something cost us':
    'our unit economics are not a product surface.',
};

/**
 * Identifiers that contain a banned word and belong to the platform rather than to us.
 * Matched as a substring of the whole lowercased identifier.
 */
const ALLOWED_STEMS = new Map(Object.entries({
  referrerpolicy: 'a DOM attribute. Not our policy object.',
  securitypolicy: 'a browser header.',
  privacypolicy: 'a page a user can read.',
  cookiepolicy: 'the same.',
  scorecard: 'not currently used; listed so the shape of an exemption is obvious.',
}));

const hasAllowedStem = (identifier) => {
  const lower = identifier.toLowerCase();
  for (const stem of ALLOWED_STEMS.keys()) if (lower.includes(stem)) return true;
  return false;
};

/**
 * The files allowed to name the words, because naming them is what they do. Same shape and
 * same reasoning as the exemption in tools/check-vocabulary.mjs: a rule may quote the rule.
 */
const FILE_EXEMPTIONS = {
  'app/src/shared/api/wire/fields.ts': {
    words: [...Object.values(BANNED).flat()],
    why: 'this file IS the wall: it carries the allowlist of public fields and the list of internal words the decoder throws on. It must name them to reject them. Nothing in it renders; if a component imports a word from here, the component still fails this check.',
  },
};

/** A component that compares against a big number is a component making a product call. */
const COMPARISON_RE = /(?:[<>]=?|[!=]==?)\s*(\d[\d_]*(?:\.\d+)?)/g;
const COMPARISON_FLOOR = 100;

const report = new Report(
  'check-app-vocabulary',
  'app/src speaks the public wire vocabulary only — no internal machinery, no stage names, no pipeline vendor, no spend, no thresholds',
);

for (const file of walk(SCANNED, EXTS)) {
  /* Colocated tests are skipped: a test that asserts a leak is rejected must name the leak,
     and that naming is the assertion, not a use. */
  if (/\.test\.[jt]sx?$/.test(file)) continue;
  report.scanned += 1;
  const raw = read(file);
  const isComment = inComment(raw);
  const fileExempt = new Set(FILE_EXEMPTIONS[file]?.words ?? []);

  const exemptLines = new Map();
  for (const m of raw.matchAll(/app-vocab-allow:([^\n*]*)/g)) {
    const words = (m[1].match(/[A-Za-z][A-Za-z0-9_]*/g) ?? []).map((w) => w.toLowerCase());
    exemptLines.set(locate(raw, m.index).line, new Set(words));
  }

  for (const { word, offset } of identifiers(raw)) {
    /* Comments are exempt; STRING LITERALS are not. A string in this package is either a
       key we asked the server for or words a user reads — both are the leak we are hunting.
       A comment explaining why the wall exists is not. */
    if (isComment(offset) || hasAllowedStem(word)) continue;
    const { line, col } = locate(raw, offset);
    for (const form of forms(word)) {
      if (!KIND_OF.has(form)) continue;
      if (exemptLines.get(line)?.has(form) || fileExempt.has(form)) continue;
      report.add({
        file, line, col, width: word.length,
        message: `banned word "${form}" in \`${word}\` — ${KIND_OF.get(form)}`,
        why: WHY[KIND_OF.get(form)],
        fix: 'if the user needs this, the projection in store/src/projections/ must emit it as an already-made judgement with a public name. If the user does not need it, delete it.',
      });
      break;
    }
  }

  /* Thresholds, in COMPONENTS only. The rule is "a threshold in a component is a product
     judgement"; a decimal-place rule in a number formatter is neither a component nor a
     judgement, and a `z-index: 100` in CSS is layout. */
  if (file.endsWith('.tsx') || file.endsWith('.jsx')) {
    const code = blankNonCode(raw);
    COMPARISON_RE.lastIndex = 0;
    let m;
    while ((m = COMPARISON_RE.exec(code)) !== null) {
      const value = Number(m[1].replace(/_/g, ''));
      if (!Number.isFinite(value) || value < COMPARISON_FLOOR) continue;
      const { line, col } = locate(raw, m.index);
      if (exemptLines.has(line)) continue;
      report.add({
        file, line, col, width: m[0].length,
        message: `numeric comparison against ${m[1]} inside the app`,
        why: 'this is `gain >= 150000 ? "up" : "down"` again — a product judgement made in a component, invisible to everyone who decides product.',
        fix: 'the server already made this judgement and shipped it as an enum. Render the enum. If you truly need a UI threshold, add `app-vocab-allow: <reason>` on this line.',
      });
    }
  }
}

report.finish();
