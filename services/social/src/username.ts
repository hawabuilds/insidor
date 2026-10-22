/**
 * THE USERNAME RULES — what a member may pick at sign-up, and what to offer when theirs is taken.
 * Pure, so every rule runs under a test; onboarding.ts asks the database who holds what.
 *
 *   - 3 to 15 letters, numbers or _, the X rule, so an X handle brought in as a suggestion fits
 *   - stored lower-case: `people.profile.handle` is unique as written, and @Hawa and @hawa must be
 *     one name, not two people
 *   - reserved: names that would speak for Insidor (support, admin, insidor…) or collide with a
 *     path the app reads as a page; nobody gets them
 *   - when a name is taken, a few near it that are free, never a random string
 *
 * Its own file because the phone holds the same rules (mobile features/onboarding/username.ts) to
 * answer as the person types; the server's answer is the one that counts.
 *
 * What breaks if changed carelessly: `cleanUsername` must clean exactly as the phone does, or a
 * name the phone called free is refused here with no reason the person can see.
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 15;

/** Names nobody may pick: they would speak for Insidor, or read as one of its pages. */
export const RESERVED = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 'help', 'helpdesk', 'staff', 'team', 'official',
  'mod', 'mods', 'moderator', 'owner', 'security', 'safety', 'abuse', 'legal', 'privacy', 'terms',
  'insidor', 'insidorapp', 'insidor_app', 'theinsidor', 'api', 'app', 'www', 'mail', 'email',
  'login', 'logout', 'signin', 'signup', 'register', 'settings', 'account', 'profile', 'me', 'you',
  'everyone', 'here', 'all', 'null', 'undefined', 'anonymous', 'unknown', 'wallet', 'alerts',
  'notifications', 'feed', 'search', 'portfolio', 'narratives', 'story', 'coin', 'token', 'post',
  'invite', 'invites', 'waitlist', 'leaderboard',
]);

export type UsernameProblem = 'short' | 'long' | 'characters' | 'reserved';

/** A name as typed, cleaned the one way names are stored: no @, no spaces, lower case. */
export function cleanUsername(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim().replace(/^@+/, '').toLowerCase() : '';
}

/** What is wrong with a cleaned name, or null when it may be held. */
export function usernameProblem(name: string): UsernameProblem | null {
  if (!/^[a-z0-9_]*$/.test(name)) return 'characters';
  if (name.length < USERNAME_MIN) return 'short';
  if (name.length > USERNAME_MAX) return 'long';
  if (RESERVED.has(name) || name.startsWith('insidor')) return 'reserved';
  return null;
}

/** A name in the person's words for each problem. */
export const PROBLEM_WORDS: Readonly<Record<UsernameProblem, string>> = {
  short: `At least ${USERNAME_MIN} characters.`,
  long: `Up to ${USERNAME_MAX} characters.`,
  characters: 'Only letters, numbers and _.',
  reserved: "That name isn't available.",
};

/** The base a suggestion grows from: what was typed, or a name, cut to fit and cleaned of anything else. */
export function baseOf(raw: string | null): string {
  return cleanUsername(raw ?? '').replace(/[^a-z0-9_]/g, '').slice(0, USERNAME_MAX);
}

/**
 * Names near `base`, in the order they are offered: an underscore, the name with a word, a
 * number, then the person's other names (`also`: their X handle, their name run together), then
 * more of the same. Every one passes `usernameProblem`; the caller drops the ones somebody holds.
 */
export function candidatesFor(base: string, also: readonly string[] = []): string[] {
  const out: string[] = [];
  const b = baseOf(base);
  const add = (n: string) => {
    if (usernameProblem(n) === null && !out.includes(n) && n !== b) out.push(n);
  };
  const fit = (suffix: string) => `${b.slice(0, USERNAME_MAX - suffix.length)}${suffix}`;
  if (b.length > 0) {
    add(fit('_'));
    add(fit('builds'));
    add(fit('1'));
  }
  for (const a of also) add(baseOf(a));
  if (b.length === 0) return out;
  for (const word of ['onchain', 'calls', 'early']) add(fit(word));
  for (let i = 2; i <= 9; i += 1) add(fit(String(i)));
  for (let i = 1; i <= 9; i += 1) add(fit(`_${i}`));
  return out;
}
