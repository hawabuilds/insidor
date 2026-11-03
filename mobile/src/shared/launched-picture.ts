/**
 * THE PICTURE OF A COIN THIS PHONE JUST LAUNCHED, FOR ITS FIRST MINUTES (the owner, 2026-11-03: "why
 * doesnt it show me the coin pfp … when i press create and click on the live coin").
 *
 * A coin seconds old has no picture anywhere a logo is read from: our storage copies it about a minute
 * after launch, the launchpad's image service and the coin's row catch up later still. The phone that
 * launched it already holds the very picture it uploaded, so the token page shows that until a stored
 * copy loads. Kept in memory for this session only, per mint; nothing is written anywhere.
 *
 * What breaks if changed carelessly: it is a fallback after every real source (CoinLogo tries ours
 * first), never in front of them, and only for a mint this phone launched.
 */

const launched = new Map<string, string>();

/** Called by the Create success screen with the mint and the picture it uploaded. */
export function noteLaunchedPicture(mint: string, imageUrl: string | null): void {
  if (imageUrl !== null && imageUrl !== '') launched.set(mint, imageUrl);
}

/** The picture this phone launched `mint` with, or null. */
export function launchedPicture(mint: string): string | null {
  return launched.get(mint) ?? null;
}
