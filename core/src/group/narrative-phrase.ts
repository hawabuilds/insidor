/**
 * THE SAME WORDS, IN ANY SCRIPT — the word pairs two posts both say, for the same-words join of
 * narrative-origin.ts (Policy.narrative.origin `phrase*`).
 *
 * The owner, 2026-10-23: @rayaneAlg00's "Les japonais quand tu leurs dit que végéta est algérien"
 * quotes nothing, yet is plainly the "végéta est algérien" story @liistrk started. Nothing else
 * ties them — another judge name (HOMER, not VEGETA), 0.50 apart in vectors — but the two posts SAY
 * the same two words side by side. A phrase here is that: two content words next to each other once
 * the short and function words are dropped ("végéta est algérien" → végéta·algérien), accents
 * folded, the pair unordered. Japanese and Chinese have no spaces, so a run of katakana or of han
 * is a word, and hiragana (mostly particles) only separates them (ベジータがアルジェリア人 →
 * ベジータ·アルジェリア). Across languages the stored English translation (public.post_translation)
 * is read as more words of the same post, so a Japanese post and a French one meet in English.
 *
 * Why its own file: the join's rule (narrative-origin.ts) decides WHEN a shared phrase counts; this
 * decides only WHAT a phrase is, and both the rule and its tests read the one definition.
 *
 * ★ A PHRASE COUNTS ONLY WHEN IT IS RARE. `rarePhrases` keeps the pairs said by at most
 * `phraseMaxShare` of the posts read, so "elon·musk" or "pump·fun", which half the stories say, never
 * join anything; and the caller holds the post to the narrative's average at `phraseMeaning` too.
 *
 * ★ THE STORY'S OWN WORDS (policy.v149, the merge on words of narrative-origin.ts): `storyWords` is a
 * post's phrases above plus every two-character piece of a Japanese or Chinese run. Such a run has
 * no spaces inside it, so the same place is written 四ツ谷駅 in one post, 四ツ谷駅前 in another and
 * JR四ツ谷駅 in a third, and "weeding" is 除草, 除草作業 or 除草目的: the whole runs never match,
 * their two-character pieces (四ツ·ツ谷·谷駅, 除草) do. Katakana and han are read as one run here, so a
 * place name with a small kana inside it (四ツ谷, 霞ヶ関) stays one word.
 *
 * What breaks if changed carelessly: the function words. The posts read are mostly English, so a
 * French or Spanish "quand", "pour" or "cuando" would count as rare; FUNCTION lists the common ones
 * of the languages the stories come in. Removing it lets two posts join on "quand·leurs".
 */

import type { Policy } from '@insidor/contracts/policy.ts';

import { isCommonWord } from '../match/story-coin.ts';

/* Function words of four letters or more, in the languages the stories come in besides English (story-coin.ts COMMON has English). */
const FUNCTION = new Set([
  // French
  'avant', 'avec', 'dans', 'elle', 'elles', 'leur', 'leurs', 'mais', 'nous', 'vous', 'pour', 'quand', 'quoi', 'sont', 'sous', 'tout', 'tous', 'toute', 'toutes', 'cette',
  'comme', 'aussi', 'faire', 'fait', 'peut', 'plus', 'tres', 'encore', 'alors', 'donc', 'depuis', 'entre', 'juste', 'meme', 'rien', 'parce', 'ceux', 'celle', 'celui',
  'chez', 'avoir', 'etre', 'etait', 'sera', 'sans', 'voila', 'quel', 'quelle', 'quels', 'cest', 'ont', 'vont', 'veut', 'bien', 'trop', 'deja', 'apres', 'ici',
  // Spanish and Portuguese
  'para', 'pero', 'como', 'esta', 'este', 'esto', 'todo', 'todos', 'cuando', 'porque', 'donde', 'tiene', 'hace', 'solo', 'sobre', 'desde', 'hasta', 'ellos', 'ellas',
  'nada', 'algo', 'voce', 'isso', 'esse', 'essa', 'muito', 'pela', 'pelo', 'tambem', 'quando', 'agora', 'aqui',
  // German
  'aber', 'auch', 'dass', 'eine', 'einer', 'einen', 'nicht', 'noch', 'oder', 'sich', 'sind', 'uber', 'wenn', 'wird', 'wurde', 'schon', 'mehr', 'kann', 'dann', 'denn',
  'doch', 'hier', 'jetzt', 'alle', 'immer',
  // Italian
  'sono', 'anche', 'perche', 'questo', 'questa', 'della', 'delle', 'degli', 'nella', 'sulla', 'ancora', 'tutto', 'tutti',
  // Turkish and Indonesian
  'icin', 'gibi', 'daha', 'kadar', 'olan', 'oldu', 'bunu', 'simdi', 'bile', 'degil', 'neden', 'yang', 'untuk', 'dengan', 'tidak', 'sudah', 'akan', 'juga', 'saja', 'bisa',
]);

/* A run of katakana (with its long-vowel mark), of han, of hiragana, or of any other letters and digits. */
const TOKEN = /[\p{Script=Katakana}ー]+|\p{Script=Han}+|\p{Script=Hiragana}+|[^\s\p{P}\p{S}\p{Script=Katakana}\p{Script=Han}\p{Script=Hiragana}ー]+/gu;
const CJK = /^[\p{Script=Katakana}ー\p{Script=Han}]+$/u;
const HIRAGANA = /^\p{Script=Hiragana}+$/u;
const DIGITS = /^\p{N}+$/u;

/** The content words of a text, in order: accents folded, links, mentions and tags out. */
export function contentWords(text: string, p: Policy): readonly string[] {
  const o = p.narrative.origin;
  const generic = p.group.genericSpans;
  const clean = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/[#@$][\p{L}\p{N}_]+/gu, ' ')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .normalize('NFC')
    .replace(/['’]/g, ' '); // French elision: l'algérien is algérien
  return (clean.match(TOKEN) ?? []).filter((w) => {
    if (HIRAGANA.test(w) || DIGITS.test(w)) return false;
    if (CJK.test(w)) return [...w].length >= o.phraseMinCjkChars;
    return w.length >= o.phraseMinChars && !FUNCTION.has(w) && !isCommonWord(w, generic);
  });
}

/** The unordered pairs of neighbouring content words in each text: a post's phrases. */
export function phrasesOf(texts: readonly string[], p: Policy): ReadonlySet<string> {
  const out = new Set<string>();
  for (const t of texts) {
    const w = contentWords(t, p);
    for (let i = 0; i + 1 < w.length; i += 1) {
      const a = w[i] ?? '';
      const b = w[i + 1] ?? '';
      if (a !== b) out.add(a < b ? `${a}·${b}` : `${b}·${a}`);
    }
  }
  return out;
}

/* A run of han and katakana together (a place name keeps its small kana), and the iteration mark. */
const CJK_RUN = /[\p{Script=Han}\p{Script=Katakana}ー々]+/gu;

/** Every two-character piece of each han or katakana run in the texts (links, mentions and tags out). */
export function cjkPieces(texts: readonly string[]): ReadonlySet<string> {
  const out = new Set<string>();
  for (const t of texts) {
    const clean = t.normalize('NFKC').replace(/https?:\/\/\S+/gi, ' ').replace(/[#@$][\p{L}\p{N}_]+/gu, ' ');
    for (const run of clean.match(CJK_RUN) ?? []) {
      const c = [...run];
      for (let i = 0; i + 1 < c.length; i += 1) {
        const piece = `${c[i] ?? ''}${c[i + 1] ?? ''}`;
        if (!/^ー|ーー/u.test(piece)) out.add(piece);
      }
    }
  }
  return out;
}

/** The words a post says that may mark its story: its phrases, and the pieces of its han and katakana runs. */
export function storyWords(texts: readonly string[], p: Policy): ReadonlySet<string> {
  return new Set([...phrasesOf(texts, p), ...cjkPieces(texts)]);
}

/**
 * The phrases rare enough to tie two posts: said by at most `phraseMaxShare` of `all` (each post's
 * phrases, every post read once), and by at least two posts — a phrase only one post says ties nothing.
 */
export function rarePhrases(all: Iterable<ReadonlySet<string>>, p: Policy): ReadonlySet<string> {
  const df = new Map<string, number>();
  let n = 0;
  for (const set of all) {
    n += 1;
    for (const x of set) df.set(x, (df.get(x) ?? 0) + 1);
  }
  const most = Math.max(2, Math.floor(n * p.narrative.origin.phraseMaxShare));
  return new Set([...df].filter(([, c]) => c >= 2 && c <= most).map(([x]) => x));
}
