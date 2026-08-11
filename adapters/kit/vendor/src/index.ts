/** The shared vocabulary of the vendor edge: defensive readers and four errors. */

export { rec, str, num, int, bool, arr, missing, secondsToMillis, dateToMillis } from './read.ts';
export type { Rec } from './read.ts';
export { NotImplemented, VendorUnavailable, VendorShapeError, BudgetRefused } from './errors.ts';
export { discovered } from './discovered.ts';
export { shingles, cashtagKey, hashtagKey } from './text.ts';
