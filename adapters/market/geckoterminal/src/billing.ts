/**
 * Whether a refused market-data request was refused for billing: the keyed plan's monthly
 * credits used up, or payment required. A short reason we wrote, or null.
 *
 * Its own file because two request paths share it (the main reader in index.ts and the holder
 * count in holders.ts), and a second copy of the phrases would drift from the first.
 *
 * ★ PACING IS NOT BILLING. The vendor's 429 for going too fast also invites the reader to buy a
 * bigger plan, so "plan" and "subscribe" are never matched; only the monthly credit words and a
 * 402. Calling a busy minute an empty account would send the owner to pay for nothing. The body is
 * matched, never quoted: it can carry the account's key name or plan.
 *
 * What breaks if changed carelessly: the 401 exclusion. A missing or wrong key is a setup fault,
 * not an empty account, and is already reported as one.
 */

export function billingReason(status: number, text: string): string | null {
  if (status < 400 || status >= 500 || status === 401) return null;
  if (/monthly[^.]{0,40}credit|credits? (limit|exhausted|used up|have been used)|exceeded your monthly|insufficient credit|billing/i.test(text.slice(0, 2000))) {
    return 'monthly credits used up';
  }
  if (status === 402) return 'payment required';
  return null;
}
