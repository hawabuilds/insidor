/**
 * WHAT THE PROFILE MENU HOLDS, AND WHERE: the condensed gear menu's rows in order, and what sits in
 * each sheet a row opens. Pure, so the promise that grouping removed nothing runs as a test.
 *
 * ★ NOTHING REMOVED, ONLY GROUPED (the owner, 2026-10-21). Every place the long menu reached is
 * still reached: your profile and Edit profile (the header and its pencil), Export private key,
 * Import a wallet, Link a wallet to view and the linked wallets (Wallets), Show my trades and
 * Notifications (Settings), Leaderboard, Add missed posts (Owner tools), Sign out. How Insidor works
 * was taken off the menu by the owner on 2026-10-26; its page (#/learn) stays for a direct link.
 *
 * ★ ONE MENU, NO SETTINGS INSIDE IT (the owner, 2026-11-04: "settings within settings is headache").
 * Notifications and Show my trades are rows of their own; the Settings sheet is gone. Leaderboard was
 * taken off the menu by the owner the same day; its page (#/leaderboard) stays for a direct link.
 *
 * What breaks if changed carelessly: a row dropped from both lists is a feature nobody can reach.
 * menu.test.ts lists every one of them; add a new place to it when adding a row.
 */

export type MenuRow = 'wallets' | 'invites' | 'notifications' | 'show-trades' | 'learn' | 'owner' | 'leave';
export type Place =
  | 'profile'
  | 'edit-profile'
  | 'wallet-card'
  | 'export-key'
  | 'import-wallet'
  | 'link-wallet'
  | 'linked-wallets'
  | 'invites'
  | 'show-trades'
  | 'notifications'
  | 'leaderboard'
  | 'learn'
  | 'missed-posts'
  | 'invite-controls'
  | 'leave';

export interface MenuFor {
  readonly owner: boolean;
  /** Signed in with a profile (not the demo, not a session still coming back). */
  readonly member: boolean;
  /** The provider's key export can be opened. */
  readonly canExport: boolean;
}

/** The rows under the wallet card, top to bottom. */
export function menuRows(m: MenuFor): readonly MenuRow[] {
  return [
    'wallets',
    ...(m.member ? (['invites', 'notifications', 'show-trades'] as const) : (['notifications'] as const)),
    ...(m.owner ? (['owner'] as const) : []),
    'leave',
  ];
}

/** Every place one tap from the gear, or one more inside a sheet. */
export function placesOf(m: MenuFor): readonly Place[] {
  const inRow: Record<MenuRow, readonly Place[]> = {
    wallets: [...(m.canExport ? (['export-key'] as const) : []), 'import-wallet', 'link-wallet', 'linked-wallets'],
    invites: ['invites'],
    notifications: ['notifications'],
    'show-trades': ['show-trades'],
    learn: ['learn'],
    owner: ['missed-posts', 'invite-controls'],
    leave: ['leave'],
  };
  return [...(m.member ? (['profile', 'edit-profile'] as const) : []), 'wallet-card', ...menuRows(m).flatMap((r) => inRow[r])];
}

/** "3 joined" on the Invites row; null until the count is read. */
export const joinedPill = (joined: number | null): string | null => (joined === null ? null : `${joined} joined`);
