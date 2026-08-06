'use strict';

const { tokenize } = require('../../lib/text-utils');

function buildVector(text) {
  const vec = Object.create(null);
  for (const t of tokenize(text)) {
    vec[t] = (vec[t] || 0) + 1;
  }
  let norm = 0;
  for (const k of Object.keys(vec)) norm += vec[k] * vec[k];
  norm = Math.sqrt(norm) || 1;
  for (const k of Object.keys(vec)) vec[k] /= norm;
  return vec;
}

function cosineSimilarity(a, b) {
  if (!a || !b) return 0;
  let dot = 0;
  const keys = Object.keys(a).length < Object.keys(b).length ? Object.keys(a) : Object.keys(b);
  for (const k of keys) {
    if (a[k] && b[k]) dot += a[k] * b[k];
  }
  return dot;
}

function averageVectors(vectors) {
  if (!vectors.length) return null;
  const out = Object.create(null);
  for (const v of vectors) {
    for (const k of Object.keys(v)) out[k] = (out[k] || 0) + v[k];
  }
  for (const k of Object.keys(out)) out[k] /= vectors.length;
  let norm = 0;
  for (const k of Object.keys(out)) norm += out[k] * out[k];
  norm = Math.sqrt(norm) || 1;
  for (const k of Object.keys(out)) out[k] /= norm;
  return out;
}

function embedText(text) {
  return buildVector(text || '');
}

module.exports = { embedText, cosineSimilarity, averageVectors, buildVector };
