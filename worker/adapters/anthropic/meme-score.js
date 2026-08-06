'use strict';

const { withRetry } = require('../../lib/retry');
const { loadEnvLocal, requireEnv } = require('../../lib/env');
const { TT_NO_THUMB_CAP } = require('../../score/lib/meme-gate');
const { applyNameabilityCap } = require('../../score/lib/nameability');
const {
  loadUsage,
  recordCall,
  canSpendType,
  isCreditError,
} = require('./budget');

const MODEL = process.env.SCORE_MODEL || 'claude-haiku-4-5-20251001';
const MODEL_TT = process.env.SCORE_MODEL_TT || process.env.SCORE_VISION_MODEL || MODEL;

const COINABILITY_CORE = `You score posts for COINABILITY — whether people would actually deploy a memecoin from this content.

You are NOT predicting whether a coin would succeed, moon, or be funny. You are NOT preferring funny over wholesome, or absurd over sincere. Both funny and wholesome things get coined. The only gate: is there a THING someone could put on a coin, or is it just a topic?

SUBJECT vs STORY (the core test):
- SUBJECT (coinable — score high): a named or nameable entity — an animal, creature, character, object, or person. Wholesome, funny, absurd, or striking all pass if the content centers the THING.
- STORY (not coinable — score low): an event, argument, opinion, or news narrative with no deployable subject as the focus. Industry takes, policy debates, match RESULTS, award snubs, transfer news as headline — not the person/group as meme.

NAMED PEOPLE & FANDOMS (always subjects when named):
A named, recognisable PERSON with a fanbase is a coinable subject — K-pop idols, athletes, streamers, actors, political figures memed as characters. Fandoms deploy coins on their faves constantly. Score these PASS (0.7+).
- Applies to: individual idols/members, named athletes, streamers, named fictional characters, named groups/bands when the group or member is the focus.
- suggested_ticker = the person's or group's name (JUNGKOOK, STRAY, MESSI, RM, ENHYPEN).
- Do NOT downgrade because the post describes something they did — the PERSON/GROUP is still the subject.

Examples:
- "Porch Frog Gerald" → subject (a frog) → HIGH
- "Cat wearing VR headset" → subject (a cat) → HIGH
- "Jungkook [does thing]" / "Yoongi roasts Jungkook" → person → HIGH (ticker JUNGKOOK or YOONGI)
- "Stray Kids win award" / "Stray Kids unveil single" → group is the focus → HIGH (ticker STRAY or group name)
- "Where is RM" / "Lee Know kdrama casting" → named idol → HIGH
- "Messi [as meme/character]" → named person → HIGH
- "Messi's team lost the final" → sports RESULT, not Messi-as-subject → LOW
- "Therapy industry criticized" / "K-pop industry faces criticism" → argument about industry → LOW
- "Therapy industry criticized as ineffective" → an argument → LOW
- "Biden tapes about classified documents" → NEWS EVENT focus → LOW; Biden memed AS character → HIGH

Score meme_score 0.0–1.0 (coinability, not success odds):
- 0.7–1.0: clear nameable subject (person, group, animal, character, object)
- 0.0–0.3: story/event/argument/opinion with no named subject as focus
- 0.4–0.6: borderline — only when genuinely unclear whether a named subject exists

Respond with ONLY valid JSON, no markdown:
{"meme_score":0.0,"reason":"one short sentence","suggested_ticker":"TICKER","suggested_name":"Coin Name"}

Rules:
- meme_score must be a number 0–1 (coinability gate)
- suggested_ticker: 2–10 uppercase letters for the SUBJECT (person name, group, creature), not the headline event
- suggested_name: short coin name for the subject
- Named person/group with fanbase visible in post: meme_score 0.7+ even if the post is about something they did
- Story/topic-only (no named subject focus): meme_score below 0.3
- If you cannot name the coinable subject in one word that would work as a ticker, score below 0.3`;

const SYSTEM_PROMPT_X = `${COINABILITY_CORE}

Platform: X (Twitter). Score from the post text.`;

const SYSTEM_PROMPT_TT = `${COINABILITY_CORE}

Platform: TikTok. You receive the video THUMBNAIL (cover frame) plus the caption. The coinable subject usually lives in the VIDEO — judge from what you SEE in the image, not hashtag spam in the caption.

TikTok notes:
- Format alone does not fail: a dance, lip-sync, or wholesome clip WITH a visible nameable subject (animal, creature, character, distinct person-as-meme) can score high
- Generic choreography, hauls, tutorials, or trend formats with NO distinct subject score low — not because of entertainment type, but because there is no THING to coin
- Key test: "Is there a THING in this frame someone could name and put on a coin?" — not "is this viral" or "would this coin succeed"`;

function buildUserPromptX(post) {
  return [
    `Platform: X`,
    `Handle: ${post.handle || 'unknown'}`,
    `Text: ${post.text || ''}`,
    post.filter_label ? `Discovered via filter: ${post.filter_label}` : '',
  ].filter(Boolean).join('\n');
}

function buildUserPromptTt(post) {
  return [
    `Platform: TikTok`,
    `Handle: ${post.handle || 'unknown'}`,
    `Caption: ${post.text || '(empty)'}`,
    post.filter_label ? `Discovered via filter: ${post.filter_label}` : '',
    '',
    'The attached image is the video cover/thumbnail. Score coinability from what you SEE — is there a nameable SUBJECT in the frame?',
  ].filter(Boolean).join('\n');
}

function postThumbnailUrl(post) {
  if (post.media_url) return String(post.media_url).trim() || null;
  const raw = post.raw;
  if (!raw || typeof raw !== 'object') return null;
  const cover = raw.videoMeta?.coverUrl || raw.covers?.default || raw.cover;
  return cover ? String(cover).trim() : null;
}

const THUMB_MAX_BYTES = 5 * 1024 * 1024;
const THUMB_FETCH_MS = 12_000;

function normalizeImageMediaType(contentType, url) {
  const ct = (contentType || '').split(';')[0].trim().toLowerCase();
  const allowed = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
  if (allowed.has(ct)) return ct;
  const lower = (url || '').toLowerCase();
  if (lower.includes('.png')) return 'image/png';
  if (lower.includes('.webp')) return 'image/webp';
  if (lower.includes('.gif')) return 'image/gif';
  return 'image/jpeg';
}

/** TikTok CDN blocks Anthropic's URL fetcher — pull cover locally, send base64. */
async function fetchThumbnailBase64(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), THUMB_FETCH_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; InsidorWorker/1.0)',
        Accept: 'image/*,*/*;q=0.8',
      },
    });
    if (!r.ok) throw new Error(`thumbnail fetch HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) throw new Error('thumbnail empty');
    if (buf.length > THUMB_MAX_BYTES) throw new Error(`thumbnail too large (${buf.length} bytes)`);
    return {
      data: buf.toString('base64'),
      media_type: normalizeImageMediaType(r.headers.get('content-type'), url),
    };
  } finally {
    clearTimeout(timer);
  }
}

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

function parseMemeScoreResponse(text, opts = {}) {
  const fallback = {
    meme_score: 0,
    reason: 'parse failure',
    suggested_ticker: null,
    suggested_name: null,
  };

  const obj = extractJson(text);
  if (!obj || typeof obj !== 'object') return fallback;

  let score = Number(obj.meme_score);
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(1, score));

  if (opts.capMax != null) score = Math.min(score, opts.capMax);

  const ticker = obj.suggested_ticker != null
    ? String(obj.suggested_ticker).replace(/^\$/, '').toUpperCase().slice(0, 10)
    : null;
  const name = obj.suggested_name != null ? String(obj.suggested_name).slice(0, 80) : null;
  const reason = obj.reason != null ? String(obj.reason).slice(0, 500) : null;

  return {
    meme_score: score,
    reason,
    suggested_ticker: ticker || null,
    suggested_name: name || null,
  };
}

function noThumbnailTikTokResult() {
  return {
    meme_score: TT_NO_THUMB_CAP,
    reason: 'no thumbnail — cannot judge TikTok video from caption alone',
    suggested_ticker: null,
    suggested_name: null,
    model: MODEL_TT,
    raw: null,
    scoring_mode: 'tt_no_thumb_cap',
  };
}

async function callAnthropic({ system, content, model }) {
  loadEnvLocal();
  const apiKey = requireEnv('ANTHROPIC_API_KEY');

  const body = {
    model,
    max_tokens: 256,
    temperature: 0.2,
    system,
    messages: [{ role: 'user', content }],
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
      const detail = await r.text().catch(() => '');
      let msg = detail;
      try {
        const j = JSON.parse(detail);
        msg = j?.error?.message || j?.message || detail;
      } catch (_) { /* use raw text */ }
      const err = new Error(`Anthropic HTTP ${r.status}${msg ? `: ${String(msg).slice(0, 240)}` : ''}`);
      err.status = r.status;
      throw err;
    }
    return r.json();
  }, { label: 'anthropic-meme-score' });

  const text = (data.content || [])
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');

  return { data, text };
}

async function scoreXPost(post, sb) {
  if (sb) {
    const usage = await loadUsage(sb);
    if (!canSpendType(usage, 'score_x')) {
      return {
        meme_score: 0,
        reason: 'anthropic daily budget exhausted',
        suggested_ticker: null,
        suggested_name: null,
        model: MODEL,
        raw: null,
        scoring_mode: 'budget_skip',
      };
    }
  }

  try {
    const { data, text } = await callAnthropic({
      model: MODEL,
      system: SYSTEM_PROMPT_X,
      content: buildUserPromptX(post),
    });
    const parsed = parseMemeScoreResponse(text);
    const result = { ...applyNameabilityCap(parsed, post.text), model: MODEL, raw: data, scoring_mode: 'x_text' };
    if (sb) await recordCall(sb, 'score_x', { model: MODEL, ...data });
    return result;
  } catch (e) {
    if (sb && isCreditError(e)) {
      console.warn('[meme-score] Anthropic credits exhausted — skip until account has balance');
    }
    throw e;
  }
}

async function scoreTikTokPost(post, sb, opts = {}) {
  const thumbUrl = postThumbnailUrl(post);
  if (!thumbUrl) return noThumbnailTikTokResult();

  if (sb) {
    const usage = await loadUsage(sb);
    if (!canSpendType(usage, 'score_tt')) {
      return {
        meme_score: TT_NO_THUMB_CAP,
        reason: 'anthropic daily budget exhausted',
        suggested_ticker: null,
        suggested_name: null,
        model: MODEL_TT,
        raw: null,
        scoring_mode: 'tt_budget_skip',
      };
    }
  }

  const userText = buildUserPromptTt(post);
  let imageBlock;
  try {
    const img = await fetchThumbnailBase64(thumbUrl);
    imageBlock = {
      type: 'image',
      source: { type: 'base64', media_type: img.media_type, data: img.data },
    };
  } catch (e) {
    console.warn(`[meme-score] TikTok thumbnail fetch failed (${post.id || post.handle}): ${e.message}`);
    return {
      meme_score: TT_NO_THUMB_CAP,
      reason: 'thumbnail fetch failed — cannot judge TikTok video visually',
      suggested_ticker: null,
      suggested_name: null,
      model: MODEL_TT,
      raw: null,
      scoring_mode: 'tt_thumb_fetch_fail',
    };
  }

  let data;
  let text;
  try {
    ({ data, text } = await callAnthropic({
      model: MODEL_TT,
      system: SYSTEM_PROMPT_TT,
      content: [imageBlock, { type: 'text', text: userText }],
    }));
  } catch (e) {
    if (sb && isCreditError(e)) {
      console.warn('[meme-score] Anthropic credits exhausted — skip until account has balance');
    }
    console.warn(`[meme-score] TikTok vision failed (${post.id || post.handle}): ${e.message}`);
    return {
      meme_score: TT_NO_THUMB_CAP,
      reason: isCreditError(e) ? 'anthropic credits exhausted' : 'vision unavailable — capped without thumbnail judgment',
      suggested_ticker: null,
      suggested_name: null,
      model: MODEL_TT,
      raw: null,
      scoring_mode: isCreditError(e) ? 'tt_budget_skip' : 'tt_vision_error_cap',
    };
  }

  const parsed = parseMemeScoreResponse(text);
  const result = { ...applyNameabilityCap(parsed, post.text), model: MODEL_TT, raw: data, scoring_mode: 'tt_vision' };
  if (sb) await recordCall(sb, 'score_tt', { model: MODEL_TT, ...data });
  return result;
}

async function memeScore(post, sb, opts = {}) {
  const platform = post.platform === 'tt' ? 'tt' : 'x';
  if (platform === 'tt') return scoreTikTokPost(post, sb, opts);
  return scoreXPost(post, sb);
}

module.exports = {
  memeScore,
  parseMemeScoreResponse,
  postThumbnailUrl,
  fetchThumbnailBase64,
  SYSTEM_PROMPT_X,
  SYSTEM_PROMPT_TT,
  SYSTEM_PROMPT: SYSTEM_PROMPT_X,
  MODEL,
  MODEL_TT,
};
