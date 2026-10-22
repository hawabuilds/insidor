/**
 * THE USERNAME RULES ON THE PHONE — the same rules as services/social username.ts, so the box can
 * answer as the person types before the server is asked. The server's answer is the one that
 * counts: a name it calls taken is taken, whatever this said.
 *
 * What breaks if changed carelessly: these must clean and refuse exactly as the server does
 * (3 to 15 letters, numbers or _, lower case, no @). A rule only here refuses a name the server
 * would take; a rule only there turns a green box red after Continue.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 15;

/** A name as typed, cleaned the one way names are stored: no @, no spaces, lower case. */
export function cleanUsername(raw: string): string {
  return raw.trim().replace(/^@+/, '').toLowerCase();
}

/** What the box says about a name before the server is asked; null when there is nothing to say yet. */
export function localProblem(name: string): string | null {
  if (!/^[a-z0-9_]*$/.test(name)) return 'Only letters, numbers and _.';
  if (name.length > USERNAME_MAX) return `Up to ${USERNAME_MAX} characters.`;
  return null;
}

/** Long enough and clean enough to ask the server about. */
export const askable = (name: string): boolean => localProblem(name) === null && name.length >= USERNAME_MIN;

/** What the field takes as typed: the characters a name can hold, up to the most it can be. */
export function typed(raw: string): string {
  return cleanUsername(raw).replace(/[^a-z0-9_]/g, '').slice(0, USERNAME_MAX);
}
