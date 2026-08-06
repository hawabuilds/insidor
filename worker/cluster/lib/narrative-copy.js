'use strict';

const { blurbFromPosts, firstClauseTitle } = require('../../lib/text-utils');

const GENERIC_TITLES = new Set(['viral story', 'emerging narrative cluster', 'cluster']);

function shouldRegenNarrativeCopy(posts, opts = {}) {
  if (opts.forceTitle) return true;
  if (opts.regenTitle === false) return false;

  const title = (opts.existingTitle || '').trim();
  if (!title) return true;
  if (GENERIC_TITLES.has(title.toLowerCase())) return true;
  if ((opts.membersAdded || 0) > 0) return true;
  if (opts.clusterMatch === 'new') return true;

  return false;
}

function cachedNarrativeCopy(posts, opts = {}) {
  const enriched = posts || [];
  return {
    title: opts.existingTitle || firstClauseTitle(enriched[0]?.text || '') || 'Viral Story',
    blurb: opts.existingBlurb || blurbFromPosts(enriched),
    source: 'cached',
  };
}

module.exports = {
  shouldRegenNarrativeCopy,
  cachedNarrativeCopy,
  GENERIC_TITLES,
};
