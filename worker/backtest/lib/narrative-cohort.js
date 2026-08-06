'use strict';

const { CONFIG } = require('./config');

const NARRATIVE_CALIBRATION_MINTS = new Set([
  'HB7MPRYpegrJaJtsZvrXAEHx5kxdehiQQUNneVLnpump', // RYDER
  'GD8cdLqU3HU8FfsQDAKU1vDrewciZC2WgRfs2yAspump', // SYRAX
]);

const NON_NARRATIVE_CALIBRATION_MINTS = new Set([
  '5JVbqUVDQBeWfDVnZR2EMcXHzBVk2vV4e8sk3GVtpump', // NPNG
  'G8AWtG7QhaELFM5LCo8BKTD3yxvvvBp97LsU4fZQpump', // COOTER
  'HXuinymFnfjaiM4LkaFDLvvQ4a1WL5qoupdyUGtJpump', // FERRET
  '2vBS6D5mTPbQHChbZevmJ3Ck4uyrmdhbt1LkbyLopump', // MEMENOTE
  'HBjaduVGUFukW2TT8DSwSdqLbBAW8uSJUxek2GfTpump', // JIMOTHY2.0
  '87kdzhXBsdQdc7S9WfvWYvXsesGeRwhEDF7XSLXBpump', // HOWL
]);

function parseMintSet(raw) {
  if (!raw) return null;
  if (raw === '') return new Set();
  return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}

function narrativeMintSet() {
  const fromEnv = parseMintSet(process.env.BACKTEST_NARRATIVE_MINTS);
  if (fromEnv) return fromEnv;
  return new Set([...NARRATIVE_CALIBRATION_MINTS, ...(CONFIG.NARRATIVE_MINTS || [])]);
}

function nonNarrativeMintSet() {
  const fromEnv = parseMintSet(process.env.BACKTEST_NON_NARRATIVE_MINTS);
  if (fromEnv) return fromEnv;
  return new Set([...NON_NARRATIVE_CALIBRATION_MINTS, ...(CONFIG.NON_NARRATIVE_MINTS || [])]);
}

/** Stage 1 label before X search: narrative | non_narrative | unknown */
function resolveNarrativeCohort(mint) {
  if (!mint) return 'unknown';
  if (narrativeMintSet().has(mint)) return 'narrative';
  if (nonNarrativeMintSet().has(mint)) return 'non_narrative';
  return 'unknown';
}

function shouldSearchForViralPost(token) {
  return token?.narrative_cohort !== 'non_narrative';
}

function cohortAfterStage2(token, retained) {
  if (retained) return 'narrative';
  if (token.narrative_cohort === 'narrative') return 'narrative';
  return 'non_narrative';
}

module.exports = {
  resolveNarrativeCohort,
  shouldSearchForViralPost,
  cohortAfterStage2,
  NARRATIVE_CALIBRATION_MINTS,
  NON_NARRATIVE_CALIBRATION_MINTS,
};
