/**
 * THE VOCABULARY GATE. Fails if a platform, chain or vendor word appears anywhere in
 * contracts/ or core/ — in an identifier, a string, a comment, or a filename.
 *
 * WHY this is the most important check in the repository: a leak almost never arrives as
 * an import, which is what the boundary rules catch. It arrives as a FIELD NAME. In the
 * build this replaces, one platform's play count was written into a column called
 * `views`, its share count into a column called `retweets`, and the reproduction count —
 * the signal the whole product is built on — was hardcoded to zero, because that platform
 * has no such concept. Nothing objected, because there was nothing to object with. Once a
 * vendor's word is in the shared vocabulary, every future platform has to pretend it has
 * the thing the word names.
 *
 * The consequence of keeping this green is the one that pays: adding a platform stays a
 * one-folder change, because the folder is the only place allowed to know that platform's
 * words. Which is why adapters/ is deliberately NOT scanned — vendor vocabulary is what
 * an adapter is for.
 *
 * Escaping it, when a word is genuinely ours:
 *   - `vocab-allow: word1 word2   — one line saying why` exempts those words on that line.
 *   - `vocab-allow-file: word1 word2` exempts those words for the whole file.
 *   - FILE_EXEMPTIONS below exempts them from the tool, with the reason in one place.
 * All three name the exact words. None of them is a blanket "ignore this file".
 */

import path from 'node:path';
import { ROOT, walk, read, locate, blankNonCode, inComment, identifiers, forms, Report } from './lib/source.mjs';

/* ── the scanned roots ────────────────────────────────────────────────── */

const SCANNED = ['contracts', 'core'];
const EXTS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.json', '.sql', '.md'];

/* ── the ban list ─────────────────────────────────────────────────────── */

/**
 * Grouped only so a failure can say what KIND of leak this is. `authorKey` is fine.
 * `followerBucket` is fine — it is an author prior, not one platform's word. `viewCount`
 * is not fine, because it forces every future source to pretend it counts views.
 */
const BANNED = {
  'a platform, or one platform\'s counter': [
    'tweet', 'tweets', 'retweet', 'retweets', 'quote', 'quotes', 'quotecount',
    'quotetweet', 'viewcount', 'views', 'playcount', 'plays', 'digg', 'diggcount',
    'likes', 'favorites', 'favourites', 'favoritecount', 'upvote', 'upvotes',
    'downvote', 'downvotes', 'karma', 'subreddit', 'sharecount', 'collectcount',
    'commentcount', 'replycount', 'repostcount', 'followerscount', 'aweme',
    'tiktok', 'twitter', 'twitterapi', 'reddit', 'instagram', 'youtube', 'facebook',
    'telegram', 'discord', 'farcaster', 'bluesky', 'mastodon', 'twitch', 'snapchat',
  ],
  'a chain, or a venue on one': [
    'solana', 'lamport', 'lamports', 'spl', 'base58', 'bonding', 'bondingcurve',
    'mint', 'mints', 'pumpfun', 'pumpswap', 'raydium', 'meteora', 'jito',
    'ethereum', 'evm', 'erc20', 'blockhash', 'metaplex',
  ],
  'a vendor we happen to buy from': [
    'anthropic', 'claude', 'haiku', 'sonnet', 'openai', 'gemini', 'apify', 'serpapi',
    'dexscreener', 'birdeye', 'helius', 'rugcheck', 'jupiter', 'privy', 'supabase',
    'postgrest', 'supavisor', 'pgvector', 'vercel', 'railway', 'flyio', 'healthchecks',
    'sentry', 'lightgbm', 'sklearn', 'onnx', 'pinecone', 'cloudflare',
  ],
};

/** Phrases that are not single identifiers, matched as plain case-insensitive text. */
const BANNED_PHRASES = ['pump.fun', 'bonding curve', 'x.com', 'gemini-embedding'];

/**
 * Banned words that are ALSO ordinary English. These are flagged in code only — never in a
 * comment or a string literal.
 *
 * WHY the exception exists: "the quotient is whatever it likes" is prose, and a check that
 * fails on it is a check somebody deletes within a week. The words that can never be an
 * accident — a vendor, a chain, `retweet`, `playCount` — stay banned everywhere, including
 * comments, because a comment is where the next person learns what to call the field.
 */
const ALSO_ENGLISH = new Set([
  'views', 'likes', 'plays', 'quote', 'quotes', 'mint', 'mints', 'bonding',
  'favorites', 'favourites', 'bonding curve',
]);

const KIND_OF = new Map();
for (const [kind, words] of Object.entries(BANNED)) for (const w of words) KIND_OF.set(w, kind);

/**
 * Stems that make an identifier ours even though it contains a banned word. Matched as a
 * substring of the whole lowercased identifier, so `setMintTime`, `MINT_TIME_SOURCES` and
 * `mintTime` all pass while `mintAddress`, `mintAuthority` and a bare `mint` do not.
 *
 * That is exactly the distinction that matters: the first group names an INSTANT — the
 * architecture's own axis, "when did this asset begin" — and the second names a chain's
 * primary key, which is a thing only an adapter may know.
 *
 * Each entry is a decision. Adding one should feel like a decision.
 */
const ALLOWED_STEMS = new Map(Object.entries({
  minttime: 'the instant an asset began. The axis everything hangs on; it names no chain.',
  mint_time: 'the same, in SCREAMING_SNAKE and in reason codes.',
  mintedat: 'the same instant, as a field.',
  premint: 'the ordering test: did the post exist before the asset did.',
  mintwindow: 'the trailing window a candidate must fall inside.',
  tradequote: 'what a trade would actually cost, at a venue. Not a quoted post.',
  quoteresult: 'the outcome of asking a venue for a price.',
  quotefailed: 'the venue could not be asked — our outage, which is not the same as illiquidity.',
  quoterequest: 'what we ask a venue for a price ON — a size and a pair, not a chain.',
  mintevent: 'one asset coming into existence, as the venue watch stream reports it.',
  mintpage: 'a page of those events, for a cursor that must not skip.',
  quoteusd: 'the budget line for asking venues for prices.',
  unquotable: 'no executable price at the probe size. The liquidity gate.',
}));

const hasAllowedStem = (identifier) => {
  const lower = identifier.toLowerCase();
  for (const stem of ALLOWED_STEMS.keys()) if (lower.includes(stem)) return true;
  return false;
};

/**
 * Words that are genuinely part of the neutral vocabulary in one specific file. Each entry
 * costs a line and a reason, and lives here rather than in the file, so that the full set
 * of exceptions is one `cat` away.
 *
 * `where: 'comments'` narrows the exemption to prose. A rule is allowed to name the words
 * it bans; a FIELD by that name in the same file still fails.
 *
 * A key ending in `/` covers a directory, for the one case where the same legitimate sense
 * recurs across a whole stage.
 */
const FILE_EXEMPTIONS = {
  'core/src/resolve/': {
    words: ['quote', 'quotes'],
    why: 'RESOLVE is the one stage that reasons about executable prices: gate G7 is "is there a quote at the probe size" and G8 is "is the all-in cost absurd". That is the market sense of the word, arriving as data on the stage input. The social sense — a quoted POST — is still banned in every other directory, including all of contracts/ and the other six stages.',
  },
  'contracts/src/ports/venue.ts': {
    words: ['quote', 'quotes'],
    why: 'in the venue port a quote is an executable price at a size — the thing the whole trade path is gated on. The banned sense is a quoted POST, which is a platform\'s word and still fails everywhere else, including the rest of contracts/ and all of core/.',
  },
  'contracts/src/vocabulary.ts': {
    words: ['retweet', 'retweets', 'playcount', 'tweet'],
    where: 'comments',
    why: 'this file states the ban and cites the live bug it exists to prevent — one source\'s share count landing in a column called `retweets`. Naming a word inside the rule that forbids it is not a use of it, and the citation is the reason the rule survives contact with a deadline.',
  },
};

const WHY = {
  'a platform, or one platform\'s counter':
    'this word belongs to one source. Put it in adapters/, and translate it into a CounterKind on the way in.',
  'a chain, or a venue on one':
    'the core must not know which chain it is on. The venue port is where a chain gets named.',
  'a vendor we happen to buy from':
    'a vendor is a line on an invoice, not a concept. It has no business in the vocabulary or the logic.',
};

const FIX =
  'move the word into adapters/ (the only place vendor names are allowed), or — if it is genuinely ours — add `vocab-allow: <word>  — reason` on the line, or an entry in FILE_EXEMPTIONS in this tool.';

/* ── pragmas ──────────────────────────────────────────────────────────── */

function pragmaWords(text, marker) {
  const out = new Map();
  const re = new RegExp(`${marker}:([^\\n*]*)`, 'g');
  let m;
  while ((m = re.exec(text)) !== null) {
    const words = (m[1].match(/[A-Za-z][A-Za-z0-9_.]*/g) ?? []).map((w) => w.toLowerCase());
    const line = locate(text, m.index).line;
    out.set(line, new Set(words));
  }
  return out;
}

/* ── the scan ─────────────────────────────────────────────────────────── */

const report = new Report(
  'check-vocabulary',
  'no platform, chain or vendor word may appear in contracts/ or core/ — code, strings, comments or filenames',
);

for (const root of SCANNED) {
  for (const file of walk(root, EXTS)) {
    report.scanned += 1;
    const text = read(file);

    const entry = FILE_EXEMPTIONS[file]
      ?? FILE_EXEMPTIONS[Object.keys(FILE_EXEMPTIONS).find((k) => k.endsWith('/') && file.startsWith(k))];
    const fileExempt = new Set(entry?.words ?? []);
    const exemptOnlyInComments = entry?.where === 'comments';
    const isComment = inComment(text);
    /* Everything blanked here is prose: a comment or a string literal. */
    const code = blankNonCode(text);
    const isProse = (offset) => code[offset] !== text[offset];

    const exempt = exemptOnlyInComments ? new Set() : fileExempt;
    for (const set of pragmaWords(text, 'vocab-allow-file').values()) for (const w of set) exempt.add(w);
    const lineExempt = pragmaWords(text, 'vocab-allow');

    const excused = (form, offset) =>
      exempt.has(form) ||
      (ALSO_ENGLISH.has(form) && isProse(offset)) ||
      (exemptOnlyInComments && fileExempt.has(form) && isComment(offset)) ||
      lineExempt.get(locate(text, offset).line)?.has(form) === true;

    /* the filename itself — `core/src/solana/…` leaks just as loudly as a field does */
    for (const segment of file.split('/').slice(1)) {
      for (const id of identifiers(path.basename(segment, path.extname(segment)))) {
        for (const form of forms(id.word)) {
          if (!KIND_OF.has(form) || exempt.has(form)) continue;
          report.add({
            file, line: 1, col: 1, width: 1,
            message: `banned word "${form}" in the FILE NAME — ${KIND_OF.get(form)}`,
            why: WHY[KIND_OF.get(form)],
            fix: 'rename the file. A directory named after a vendor is a boundary that has already been crossed.',
          });
        }
      }
    }

    for (const { word, offset } of identifiers(text)) {
      if (hasAllowedStem(word)) continue;
      const { line, col } = locate(text, offset);
      for (const form of forms(word)) {
        if (!KIND_OF.has(form)) continue;
        if (excused(form, offset)) continue;
        report.add({
          file, line, col, width: word.length,
          message: `banned word "${form}" in \`${word}\` — ${KIND_OF.get(form)}`,
          why: WHY[KIND_OF.get(form)],
          fix: FIX,
        });
        break; // one finding per identifier; the first banned form is the whole story
      }
    }

    const lower = text.toLowerCase();
    for (const phrase of BANNED_PHRASES) {
      let at = lower.indexOf(phrase);
      while (at !== -1) {
        const { line, col } = locate(text, at);
        if (!excused(phrase, at)) {
          report.add({
            file, line, col, width: phrase.length,
            message: `banned phrase "${phrase}"`,
            why: 'naming a vendor in prose is how the next person learns to name it in code.',
            fix: FIX,
          });
        }
        at = lower.indexOf(phrase, at + phrase.length);
      }
    }
  }
}

if (report.findings.length > 0) {
  console.error('');
  console.error(`[check-vocabulary] scanned ${SCANNED.map((s) => `${s}/`).join(' and ')} under ${ROOT}`);
  console.error('[check-vocabulary] adapters/ is deliberately NOT scanned — vendor words are what an adapter is for.');
}
report.finish();
