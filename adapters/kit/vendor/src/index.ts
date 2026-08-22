/**
 * The shared vocabulary of the vendor edge: defensive readers, four errors, and the
 * one shape in which "we were never given a key for this" is a value rather than a
 * throw.
 */

export { rec, str, num, int, bool, arr, missing, secondsToMillis, dateToMillis } from './read.ts';
export type { Rec } from './read.ts';
export { NotImplemented, VendorUnavailable, VendorShapeError, BudgetRefused } from './errors.ts';
export { discovered } from './discovered.ts';
export { readCredentials, credentialVariables } from './credentials.ts';
export type {
  CredentialCheck,
  CredentialEnv,
  CredentialRequirement,
  CredentialSpec,
  CredentialValues,
} from './credentials.ts';
export { shingles, cashtagKey, hashtagKey } from './text.ts';
