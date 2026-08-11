/**
 * Can a holding be moved back out. Coded checks, never chain nouns.
 *
 * The shape this replaces was four booleans, two of which are nouns from one
 * chain and one of which — a burned liquidity pool — cannot exist on a bonding
 * curve at all. A check that can never be answered renders as "unknown"
 * forever, and unknown suppresses the Buy affordance permanently. So the defect
 * was not that the shape was chain-specific; it was that it made a venue look
 * unsafe for a reason that does not apply to it.
 *
 * Hence two lists. `requiredChecks` is what THIS venue must answer — a check
 * that does not apply here is absent from the list rather than permanently
 * unknown. `failedChecks` is what came back bad. And `complete` is false
 * whenever a required check could not be read at all, because an unread rule is
 * not a passed rule.
 */

import type { TransferRules } from '@insidor/contracts/asset.ts';
import { bool, rec, str } from '@insidor/vendor-kit';

/** Closed list. A new check is a new code, never a free-text reason. */
export const CHECK_CODES = [
  'issuance_revoked',
  'freeze_revoked',
  'no_transfer_fee',
  'no_transfer_hook',
  'metadata_immutable',
] as const;

export type CheckCode = (typeof CHECK_CODES)[number];

/**
 * A curve holds its own supply and has no pool, so pool-related checks are not
 * merely unanswered here — they are not questions. Metadata mutability is
 * observed and reported but is not required: on this venue every asset has
 * mutable metadata at mint, so requiring it would suppress every Buy.
 */
export const REQUIRED_ON_CURVE: readonly CheckCode[] = [
  'issuance_revoked',
  'freeze_revoked',
  'no_transfer_fee',
  'no_transfer_hook',
];

/**
 * Decodes a generic token-account read into coded rules.
 *
 * An account we could not read produces `complete: false` with no failures
 * listed — which is the honest answer, and which stops the gate. Reporting it
 * as "nothing failed" is how a vendor outage becomes a market full of
 * safe-looking assets.
 */
export function toTransferRules(rawAccount: unknown): TransferRules {
  const value = rec(rawAccount).value;
  const unread = value === null || value === undefined;
  if (unread) {
    return {
      complete: false,
      hasTransferFee: false,
      hasTransferHook: false,
      issuanceRevoked: null,
      freezeRevoked: null,
      requiredChecks: REQUIRED_ON_CURVE,
      failedChecks: [],
    };
  }

  const info = rec(rec(rec(value).data).parsed).info;
  const fields = rec(info);
  const extensions = rec(fields.extensions);

  const issuanceRevoked = str(fields.mintAuthority) === null;
  const freezeRevoked = str(fields.freezeAuthority) === null;
  const hasTransferFee = 'transferFeeConfig' in extensions;
  const hasTransferHook = 'transferHook' in extensions;
  const metadataImmutable = bool(fields.isMutable) === false;

  const failed: CheckCode[] = [];
  if (!issuanceRevoked) failed.push('issuance_revoked');
  if (!freezeRevoked) failed.push('freeze_revoked');
  if (hasTransferFee) failed.push('no_transfer_fee');
  if (hasTransferHook) failed.push('no_transfer_hook');
  if (!metadataImmutable) failed.push('metadata_immutable');

  return {
    complete: true,
    hasTransferFee,
    hasTransferHook,
    issuanceRevoked,
    freezeRevoked,
    requiredChecks: REQUIRED_ON_CURVE,
    // Includes checks that are not required, so a caller can show what it saw
    // without that observation blocking anything.
    failedChecks: failed,
  };
}

/** True when every REQUIRED check was read and passed. Not a score. */
export function isTradeable(rules: TransferRules): boolean {
  if (!rules.complete) return false;
  return rules.requiredChecks.every((code) => !rules.failedChecks.includes(code));
}
