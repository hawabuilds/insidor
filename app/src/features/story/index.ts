/**
 * The story page's surface to the rest of the app. Exactly one name crosses it.
 *
 * `Coins`, `Discussion` and `EvidenceList` are three of the four components on this page
 * and none of them is exported. They take shapes that only mean anything inside a story —
 * a coin link with its `unsure` case, an evidence item with its provenance — and a
 * component elsewhere that reached for `EvidenceList` would be importing this page's idea
 * of what evidence looks like into a surface that has no story to hold it honest.
 *
 * The rule runs in both directions and this feature is on the receiving end of it too:
 * Story.tsx takes `BuyAction` from `feed/index.ts` and never from inside `feed/`, which is
 * what keeps the two surfaces unable to disagree about when a coin may be bought. See
 * feed/index.ts, which states the rule as a dependency rule rather than a convention.
 *
 * ★ WHAT BREAKS IF THIS LIST GROWS IS NOTHING VISIBLE, and that is the danger. Every name
 * added here is a piece of the story page that some other feature may now be depending on,
 * and the page stops being safe to change without reading the whole app first. The barrel
 * is small because the page is meant to stay rewritable.
 */

export { Story } from './Story.tsx';
export type { StoryProps } from './Story.tsx';
