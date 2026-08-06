'use strict';

const { withRetry } = require('../../lib/retry');
const { loadEnvLocal, requireEnv } = require('../../lib/env');
const {
  loadUsage,
  recordCall,
  canSpendType,
  titleBudgetUsd,
  estimatedCallCost,
  isCreditError,
} = require('./budget');
const {
  stripMatchingNoise,
  firstClauseTitle,
  blurbFromPosts,
  authorTokensFromPosts,
  titleContainsAuthorNoise,
} = require('../../lib/text-utils');

const MODEL = process.env.CLUSTER_TITLE_MODEL || process.env.SCORE_MODEL || 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You write headlines for viral internet narrative clusters.

Given up to 3 posts about the same event, respond with ONLY valid JSON (no markdown):
{"title":"Headline Here","blurb":"One sentence describing what happened."}

Rules:
- title: exactly 3–5 words, Title Case, describes THE EVENT or story (not a person's username)
- title must NOT contain @handles, $cashtags, or #hashtags
- title must NOT be a username, brand handle, or random object name unless that IS the story
- blurb: one plain sentence, no @handles, under 160 characters
- focus on what happened — the meme, moment, or news — not who posted it`;

function extractJson(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
      try {
        return JSON.parse(fence[1].trim());
      } catch (_) { /* fall through */ }
    }
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch (_) { /* fall through */ }
    }
  }
  return null;
}

function topPostsByViews(posts, n = 3) {
  return posts
    .slice()
    .sort((a, b) => (b.latestViews || b.views || 0) - (a.latestViews || a.views || 0))
    .slice(0, n);
}

function buildUserPrompt(posts) {
  const top = topPostsByViews(posts, 3);
  const blocks = top.map((p, i) => {
    const views = p.latestViews ?? p.views ?? 0;
    const body = stripMatchingNoise(p.text || '');
    return `Post ${i + 1} (${views.toLocaleString()} views):\n${body}`;
  });
  return blocks.join('\n\n');
}

function parseTitleResponse(text, posts, authorTokens) {
  const obj = extractJson(text);
  if (!obj || typeof obj !== 'object') return null;

  let title = obj.title != null ? String(obj.title).trim().replace(/\s+/g, ' ') : '';
  let blurb = obj.blurb != null ? String(obj.blurb).trim() : '';

  title = title.replace(/^["']|["']$/g, '').slice(0, 80);
  blurb = blurb.replace(/^["']|["']$/g, '').slice(0, 160);

  const wordCount = title.split(/\s+/).filter(Boolean).length;
  if (wordCount < 2 || wordCount > 8) return null;
  if (titleContainsAuthorNoise(title, authorTokens)) return null;
  if (/@|\$|#/.test(title)) return null;
  if (!blurb || titleContainsAuthorNoise(blurb, authorTokens)) {
    blurb = blurbFromPosts(posts);
  }

  return { title, blurb, source: 'claude' };
}

function fallbackCopy(posts) {
  const top = topPostsByViews(posts, 1)[0];
  const title = firstClauseTitle(top?.text || '');
  const blurb = blurbFromPosts(posts);
  return { title, blurb, source: 'fallback' };
}

async function generateNarrativeCopy(posts, opts = {}) {
  if (!posts?.length) return { title: 'Viral Story', blurb: 'Emerging narrative cluster', source: 'empty' };

  const authorTokens = authorTokensFromPosts(posts);
  const fallback = fallbackCopy(posts);

  loadEnvLocal();
  if (!process.env.ANTHROPIC_API_KEY) {
    return fallback;
  }

  const sb = opts.sb;
  if (sb) {
    const usage = await loadUsage(sb);
    const est = estimatedCallCost(usage, 'title');
    if (!canSpendType(usage, 'title') || titleBudgetUsd(usage) < est) {
      return opts.existingTitle
        ? { title: opts.existingTitle, blurb: opts.existingBlurb || fallback.blurb, source: 'budget' }
        : fallback;
    }
  }

  try {
    const apiKey = requireEnv('ANTHROPIC_API_KEY');
    const body = {
      model: MODEL,
      max_tokens: 200,
      temperature: 0.3,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserPrompt(posts) }],
    };

    const data = await withRetry(async () => {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (r.status === 429) {
        const err = new Error('HTTP 429 rate limited');
        err.status = 429;
        throw err;
      }
      if (!r.ok) {
        const err = new Error(`Anthropic HTTP ${r.status}`);
        err.status = r.status;
        throw err;
      }
      return r.json();
    }, { label: 'anthropic-narrative-title' });

    const text = (data.content || [])
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');

    const parsed = parseTitleResponse(text, posts, authorTokens);
    if (parsed) {
      if (sb) await recordCall(sb, 'title', { model: MODEL, ...data });
      return parsed;
    }

    return fallback;
  } catch (e) {
    if (sb && isCreditError(e)) {
      console.warn('[narrative-title] Anthropic credits exhausted — titles use fallback');
    } else {
      console.warn('[narrative-title]', e.message, '— using first-clause fallback');
    }
    return fallback;
  }
}

module.exports = { generateNarrativeCopy, fallbackCopy, MODEL };
