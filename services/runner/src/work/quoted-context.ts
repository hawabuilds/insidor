/**
 * WHAT A QUOTE POST SAYS, WITH WHAT IT QUOTES (the owner, 2026-11-03: @elonmusk's "Prophetic" quoting a
 * Tolkien picture was judged on the one word "Prophetic" and missed).
 *
 * A quote post whose own words are a bare reaction ("Prophetic", "lol this": three words or fewer, no
 * coin address or $ticker) has the post it quotes as its subject. Such a post is shown to the judge
 * with the quoted post's words after its own, and the quoted post's picture when it has none of its
 * own. Every other quote is judged on its own words and picture, as before.
 *
 * One function, used by the runner's post judge (work/score-posts.ts) and the copy test
 * (tools/judge-open-eval.ts), so what is tested is what is asked.
 *
 * What breaks if changed carelessly: the post's own picture must come first and alone when it has one:
 * a quote that adds a picture says something the quoted post did not.
 */

import type { MediaRef } from '@insidor/contracts';

export interface QuotedPost {
  readonly text: string;
  readonly media: readonly MediaRef[];
}

/** The words and media to judge a post by, given what it quotes (null: it quotes nothing we hold). */
/** A quote whose own words are at most this many: a reaction ("Prophetic", "lol this"), not a post of its own. */
const REACTION_WORDS = 3;
/* A coin's address or a $ticker in the post's own words: a promotion, judged on its own words alone. */
const COIN_TALK = /\$[A-Za-z][A-Za-z0-9]{1,15}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;

/** Whether a quote post is a bare reaction to what it quotes: the only quotes shown with the quoted post. */
export function isReaction(ownText: string): boolean {
  const words = ownText.replace(/https?:\/\/\S+/gi, '').trim();
  if (words === '' || COIN_TALK.test(words)) return false;
  return words.split(/\s+/).length <= REACTION_WORDS;
}

export function withQuoted(own: { readonly text: string; readonly media: readonly MediaRef[] }, quoted: QuotedPost | null): { readonly text: string; readonly media: readonly MediaRef[] } {
  /* ★ ONLY A BARE REACTION (copy test of 3 Nov): shown with the quoted post, longer quotes and coin
     promotions ("tokenize his project", a contract address) passed on the quoted post's meme. A
     quote that says something of its own is judged on what it says, as before. */
  if (quoted === null || !isReaction(own.text)) return own;
  const q = quoted.text.replace(/https?:\/\/\S+/gi, '').trim();
  const text = q === '' ? own.text : own.text.trim() === '' ? `Quoting: ${q}` : `${own.text.trim()}\n\nQuoting: ${q}`;
  const media = own.media.length > 0 ? own.media : quoted.media;
  return { text, media };
}
