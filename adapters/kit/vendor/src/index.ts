/**
 * The shared vocabulary of the vendor edge: defensive readers, four errors, and the
 * one shape in which "we were never given a key for this" is a value rather than a
 * throw.
 *
 * WHY ONE PACKAGE RATHER THAN A COPY PER ADAPTER. Every name below answers a
 * question each adapter would otherwise answer for itself, and the answers would
 * drift within a quarter — three definitions of "is this a number", three shingle
 * widths that can never produce a matching key, three ways of saying a vendor is
 * down that a caller cannot tell apart. Drift here is not untidy, it is silent:
 * nothing fails, the adapters simply stop agreeing about what they measured.
 *
 * It re-exports NAMES, never modules, so this stays a table of contents somebody
 * chose rather than fog that grows an import cycle nobody chose. Deep imports
 * (`@insidor/vendor-kit/read.ts`) work and are preferred inside a file that needs
 * one corner.
 *
 * ★ `http.ts` IS ABSENT FROM THIS LIST ON PURPOSE. It is the only module here
 * that takes a `Headers` in its signatures, and the files that want it — the
 * three vendor clients and their own tests — import it deeply. This barrel, by
 * contrast, is what the translation halves import: `to-item.ts`, `discover.ts`,
 * the mappers, all of which are testable with no network precisely because a
 * `Response` never reaches them. Adding `export * from './http.ts'` here would
 * put the transport vocabulary in scope for every one of them without a single
 * call site changing, and the first quota reading that leaks into a mapper is
 * the point at which "this layer is pure" stops being checkable by reading it.
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
