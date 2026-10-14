/**
 * The newest-first video search: a second scraper, asked one watch word a run, several runs an ask.
 *
 * WHY A SECOND ACTOR. The first scraper's sorted, date-filtered search goes through a mobile route
 * that fails device registration for hours at a time and still ends SUCCEEDED ("Scraped 0/1 search
 * queries"): every run of it from 14:52 to 16:10 UTC on 2026-10-13 was that, with 5 to 10 leftover
 * videos 6.5 to 22 hours old in it. Measured the same afternoon (16:12 UTC) on "meme" and "funny":
 *
 *   - this actor, most recent first over the past day: 58 videos in 8 s, a median 1.35 hours old,
 *     34 of them under two hours and the oldest 6.6 hours, for $0.026 once its charges settled;
 *   - another search actor that sorts by date only after fetching by relevance: 20 videos 6 days to
 *     2 years old;
 *   - the first scraper family's explore feed: 20 videos, a median 8.6 days old.
 *
 * So only keyword asks come here, and only when `TIKTOK_SEARCH_ACTOR_ID` is set; hashtags, accounts
 * and every re-read stay on the first scraper, whose detail pages work.
 *
 * WHAT IT RETURNS IS THE PLATFORM'S OWN APP SHAPE (`aweme_id`, `statistics.play_count`, a cover in
 * `video.cover.url_list`, a duration in milliseconds), not the first scraper's. `fromSearchActor`
 * rewrites one entry into the first scraper's field names, so `to-item.ts` stays the one place that
 * decides what an Item is and both actors produce the same Items, counters and fingerprints.
 *
 * What breaks if changed carelessly: the music id is read from `id_str`, never the number form,
 * which is past 2^53 and can only arrive rounded — two sounds rounded to one number would join
 * unrelated videos on a shared sound. And a run is asked for one word at 30 (`limit` is for the
 * whole run and the actor stops taking words once it is reached, so a run of several words drops
 * some), which is what capabilities.ts quotes: a larger limit costs more than the quote.
 */

import { arr, num, rec, str } from '@insidor/vendor-kit';

/** The actor's own floor on results per word; a smaller ask is raised to it. */
export const SEARCH_ACTOR_RESULTS_PER_WORD = 30;

/** What the newest-first search actor is asked: these keys are that actor's and nothing else knows them. */
export interface SearchActorInput {
  readonly keywords: readonly string[];
  /**
   * Results for the whole run, not per word: a soft limit with a floor of 30, at which the actor
   * stops taking further words. So it is 30 times the words, or the last words are never searched
   * (16:20 UTC: four words at 30 searched three and returned 32 videos).
   */
  readonly limit: number;
  /** 2 is most recent first (0 relevance, 1 most liked). */
  readonly sortType: 2;
  /** The narrowest window it offers: the past day. */
  readonly publishTime: 'YESTERDAY';
  /** Each result says which word found it (`__search_terms.keyword`), so a run can be read word by word. */
  readonly includeSearchTerms: true;
  /** Off: a paid lookup per author we never use. */
  readonly fetchUserBio: false;
}

export function toSearchActorInput(words: readonly string[]): SearchActorInput {
  return {
    keywords: words,
    limit: SEARCH_ACTOR_RESULTS_PER_WORD * Math.max(1, words.length),
    sortType: 2,
    publishTime: 'YESTERDAY',
    includeSearchTerms: true,
    fetchUserBio: false,
  };
}

/** A number the vendor may send as a string or a number; null when it is neither. */
const count = (v: unknown): number | null => (typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : num(v));

/**
 * The account's picture link: the 300px rendition, else the next one the entry carries; null for none.
 *
 * ★ A JPEG, WEBP OR PNG LINK BEFORE AN HEIC ONE. Each rendition's `url_list` is two HEIC links
 * (`…q70.heic`, on two hosts) and then a JPEG of the same picture (measured on every entry of the
 * 2026-10-14 runs). HEIC draws only in Safari: Chrome, Firefox and our storage's sniff all refuse
 * it, so taking the first link left about half of the posters on For You as a letter on desktop.
 * The links are signed, so the extension cannot be rewritten afterwards; the choice is made here.
 * An HEIC link is still taken when a rendition carries nothing else, since Safari draws it.
 */
function avatarOf(author: Record<string, unknown>): string | null {
  const links = ['avatar_300x300', 'avatar_medium', 'avatar_larger', 'avatar_168x168', 'avatar_thumb'].flatMap((key) =>
    arr(rec(author[key]).url_list).map(str).filter((u): u is string => u !== null && u.startsWith('https://')),
  );
  return links.find((u) => DRAWABLE.test(u)) ?? links[0] ?? null;
}

/** A picture link every browser draws: its path ends in .jpeg, .jpg, .webp or .png. */
const DRAWABLE = /^[^?#]*\.(jpe?g|webp|png)([?#]|$)/i;

/**
 * One entry of this actor's dataset, in the first scraper's field names. An entry with no id comes
 * back unchanged, and `toItem` refuses it as it refuses any other.
 */
export function fromSearchActor(raw: unknown): unknown {
  const r = rec(raw);
  const id = str(r.aweme_id);
  if (id === null) return raw;
  const stats = rec(r.statistics);
  const author = rec(r.author);
  const video = rec(r.video);
  const cover = rec(video.cover);
  const coverUrl = arr(cover.url_list).map(str).find((u): u is string => u !== null) ?? null;
  const durationMs = num(video.duration);
  const music = rec(r.music);
  const lang = str(r.desc_language);
  return {
    id,
    text: str(r.desc) ?? '',
    createTime: num(r.create_time),
    /* 'un' is the platform's "undetermined": no language, not a language. */
    textLanguage: lang === null || lang === 'un' ? null : lang,
    /* The account's display name, follower count and picture ride along in the same entry (the
       owner, 2026-10-13: the post sheet shows the poster's real picture). Until this was read,
       every account the search found was stored with none of the three. The picture is the 300px
       one, enough for any size the app draws it; its link is signed and expires in a day or two,
       and the next time a search returns the account the link is stored fresh. */
    authorMeta: {
      id: str(author.uid),
      name: str(author.unique_id),
      nickName: str(author.nickname),
      fans: count(author.follower_count),
      avatar: avatarOf(author),
    },
    playCount: count(stats.play_count),
    diggCount: count(stats.digg_count),
    commentCount: count(stats.comment_count),
    shareCount: count(stats.share_count),
    collectCount: count(stats.collect_count),
    videoMeta: {
      coverUrl,
      width: num(cover.width) ?? num(video.width),
      height: num(cover.height) ?? num(video.height),
      /* Milliseconds here; the first scraper's field is seconds. */
      duration: durationMs === null ? null : durationMs / 1000,
    },
    musicMeta: { musicId: str(music.id_str) ?? str(music.mid) },
    textExtra: arr(r.text_extra).flatMap((t) => {
      const name = str(rec(t).hashtag_name);
      return name === null || name === '' ? [] : [{ hashtagName: name }];
    }),
    searchTerm: str(rec(r.__search_terms).keyword),
  };
}
