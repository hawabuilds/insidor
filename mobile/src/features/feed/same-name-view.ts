/**
 * The same-name sheet's one decision apart from the screen, so `node --test` can hold it: what
 * its title says. It counts the list in front of the person, not the card's number, and says
 * "newest" when the search found more coins than it kept — never a total we do not have.
 */

export function sameNameTitle(shown: number, more: boolean): string {
  if (shown === 0) return 'Coins with this name';
  if (more) return `The ${shown} newest coins with this name`;
  return shown === 1 ? '1 coin with this name' : `${shown} coins with this name`;
}
