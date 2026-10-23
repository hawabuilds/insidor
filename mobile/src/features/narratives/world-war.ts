/**
 * "TWITTER WORLD WAR" — where the online meme wars between countries sit in the Narratives tab
 * (the owner, 2026-10-23: China vs Turkey, France vs Japan, and more starting). The server says
 * which narratives are one (`Story.countries`, services/project, only while still being posted);
 * this file only gathers them:
 *
 *   in a list    the meme wars leave the list and ONE umbrella card stands where the first of them
 *                was, so the server's order still decides where it goes. A list with none of them
 *                loaded has no umbrella (it appears when the list reaches one)
 *   inside it    one section per fight ("China vs Turkey"), in the order the server listed their
 *                narratives (most viewed first), each with its narratives in that order
 *
 * Apart from the screen so `node --test` holds it, and apart from narrative-order.ts because it is
 * one feature that can be removed in one place.
 *
 * What breaks if changed carelessly: the fight's key. Two narratives are one fight when they name
 * the same countries; the server sends them sorted, and they are sorted again here, so "Turkey,
 * China" from an older page can never become a second "China vs Turkey" section.
 */

import type { Story } from '../../shared/api/index.ts';

/** The umbrella's name on screen, the owner's. */
export const WAR_TITLE = 'Twitter World War';

/** One row of the tab's list: a narrative, or the umbrella holding the meme wars. */
export type ListItem = { readonly kind: 'story'; readonly story: Story } | { readonly kind: 'war'; readonly stories: readonly Story[] };

/** The key a list row is drawn and measured under; the umbrella's never collides with a narrative id. */
export const itemKey = (i: ListItem): string => (i.kind === 'story' ? i.story.id : ' war');

const isWar = (s: Story): boolean => s.countries !== null && s.countries.length >= 2;

/** The list with its meme wars gathered into one umbrella, standing where the first of them stood. */
export function withWarUmbrella(rows: readonly Story[]): readonly ListItem[] {
  const wars = rows.filter(isWar);
  const out: ListItem[] = [];
  let placed = false;
  for (const s of rows) {
    if (!isWar(s)) out.push({ kind: 'story', story: s });
    else if (!placed) {
      out.push({ kind: 'war', stories: wars });
      placed = true;
    }
  }
  return out;
}

/** "China vs Turkey": the fight's name, its countries in alphabetical order. */
export function fightName(countries: readonly string[]): string {
  return [...countries].sort((a, b) => a.localeCompare(b)).join(' vs ');
}

export interface FightSection {
  readonly name: string;
  readonly stories: readonly Story[];
}

/** One section per fight, in the order the server listed them; narratives not a meme war are left out. */
export function fightSections(stories: readonly Story[]): readonly FightSection[] {
  const by = new Map<string, Story[]>();
  for (const s of stories) {
    if (!isWar(s) || s.countries === null) continue;
    const name = fightName(s.countries);
    by.set(name, [...(by.get(name) ?? []), s]);
  }
  return [...by].map(([name, list]) => ({ name, stories: list }));
}
