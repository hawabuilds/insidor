/**
 * HOW A POST NAMES THE NARRATIVE IT IS PART OF, in the owner's words (2026-10-16): the post sheet's
 * line "Part of the GTA 6 story, 12 posts" and For You's small tag "GTA 6 story, 12 posts". One
 * place, so the sheet and the card say it the same way.
 *
 * "Story" is the owner's word for it in these two lines; the tab and the page say "Narrative". Both
 * are the product's names for the same thing and the vocabulary check allows both in the app.
 *
 * ★ ONLY WHAT THE SERVER SAID. No title: the line says "a story" rather than inventing one. No count:
 * the count is left out, never "0 posts".
 */

/** "GTA 6 story" or "a story"; and "12 posts", or null when the count is unknown. */
export function storyWords(title: string | null, posts: number | null): { readonly name: string | null; readonly count: string | null } {
  const name = title === null ? null : title.trim();
  const count = posts === null ? null : posts === 1 ? '1 post' : `${posts} posts`;
  return { name: name === '' ? null : name, count };
}
