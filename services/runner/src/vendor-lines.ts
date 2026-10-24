/**
 * The owner's per-supplier daily lines (Policy.budget.supplierLines), keyed by the vendor token
 * each supplier bills under — the map the spend meter enforces.
 *
 * Its own file because two processes must enforce the SAME lines against one ledger: the runner
 * (wiring.ts) and the one-off paid job (tools/jobs.ts via tools/lib/shared-meter.ts). Two copies of
 * this map would drift, and a line that differs between them is a cap only one of them keeps.
 *
 * What breaks if changed carelessly: a vendor missing here falls back to the default per-source
 * line, which is far below the owner's line for the big suppliers — so the symptom is a source
 * refused from mid-morning, not an overspend.
 *
 * `supplierRoles` is the same four suppliers named by role, for the owner's warnings: a warning
 * says "judge", never the vendor's name, and it is built here so a supplier added to the lines
 * cannot be missed by the warnings.
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { VENDOR as SELF_EMBED_VENDOR } from '@insidor/embed-selfhost';
import { VENDOR as EMBED_VENDOR } from '@insidor/embed-voyage';
import { VENDOR as JUDGE_VENDOR } from '@insidor/judge-anthropic';
import { BACKUP_VENDOR as SECOND_OPEN_JUDGE_VENDOR, DEFAULT_VENDOR as OPEN_JUDGE_VENDOR } from '@insidor/judge-openai-compatible';
import { SECOND_VIDEO_VENDOR, SUPPLIER_VENDORS } from '@insidor/platform-registry';

/** The one-off jobs' lines (Policy.budget.jobLines), or the learning work's, keyed the same way. */
export function jobVendorLines(policy: Policy, book: 'jobs' | 'learning' = 'jobs'): Readonly<Record<string, number>> {
  const lines = book === 'learning' ? policy.budget.learningLines : policy.budget.jobLines;
  return {
    [SUPPLIER_VENDORS.posts]: lines.posts,
    [SUPPLIER_VENDORS.video]: lines.video,
    [JUDGE_VENDOR]: lines.judge,
    [EMBED_VENDOR]: lines.embeddings,
  };
}

/**
 * Who is spending on the learning book (Policy.budget.learningLines): the scheduled re-tune, the
 * runner's own learning work (the owner's missed posts), or a test or experiment (any other tool).
 */
export type LearningUse = 'retune' | 'work' | 'test';

/**
 * ★ THE RE-TUNE'S RESERVE, TAKEN FIRST. The learning book's day as each spender may spend it: the
 * re-tune all of it; everyone else all but `retuneReserveUsd`, so the reserve is there for the
 * re-tune however much was spent before it. A test is also held to `testsUsd` on its own
 * (`testsLineUsd`), all vendors together. Never below zero.
 */
export function learningDailyCapUsd(policy: Policy, use: LearningUse): number {
  const l = policy.budget.learningLines;
  return use === 'retune' ? l.dailyUsd : Math.max(l.dailyUsd - l.retuneReserveUsd, 0);
}

/** Tests' and experiments' own day, all vendors together; never more than the capped part of the book. */
export const testsLineUsd = (policy: Policy): number => Math.min(policy.budget.learningLines.testsUsd, learningDailyCapUsd(policy, 'test'));

export function vendorLines(policy: Policy): Readonly<Record<string, number>> {
  const lines = policy.budget.supplierLines;
  return {
    [SUPPLIER_VENDORS.posts]: lines.posts,
    /* The short-video source is fetched through the scraping service, so both bill as one
       vendor: its line is the video line and the scraping line together. */
    [SUPPLIER_VENDORS.video]: lines.video + lines.actors,
    /* Its second vendor (feed, re-reads, creator pages) bills on its own account and line. */
    [SECOND_VIDEO_VENDOR.vendor]: lines.secondVideo,
    [JUDGE_VENDOR]: lines.judge,
    /* The open-model judge (Policy.judge.primary): the judge's line again, its own account. A
       warning line like the rest; as fallback and shadow it spends about $1.50 a day. */
    [OPEN_JUDGE_VENDOR]: lines.judge,
    /* The second open host (Together, Nemotron: the post judge from 2026-10-17): the judge's line
       again, its own account. About $3.60 a day as the first judge ($0.0005 a post in its copy test on 40 live posts, 2026-10-17, at about 7,200 posts a day). */
    [SECOND_OPEN_JUDGE_VENDOR]: lines.judge,
    [EMBED_VENDOR]: lines.embeddings,
    /* Our own embedding service: $0 a call (a fixed monthly machine), so the line never binds; it is
       named so its calls sit on the pictures line rather than the default per-source one. */
    [SELF_EMBED_VENDOR]: lines.embeddings,
  };
}

/** The role a supplier's line is warned under, and the vendor token its spend is metered as. */
export interface SupplierRole {
  readonly role: 'posts' | 'judge' | 'fallback judge' | 'short video' | 'pictures';
  readonly vendor: string;
}

/**
 * The lines warned on. `judges`: the vendors the feed's post question is asked of, first first
 * (wiring's `firstSide`, then the one behind it): the first is warned as "judge", the next as
 * "fallback judge". Absent: the main judge's vendor, as before the open models. From 2026-10-17
 * the first is Together (Nemotron) and the fallback the router (Gemma 3), so the owner's "judge at
 * 80% of its line" is about the supplier actually judging.
 */
export function supplierRoles(judges: readonly string[] = [JUDGE_VENDOR]): readonly SupplierRole[] {
  return [
    { role: 'posts', vendor: SUPPLIER_VENDORS.posts },
    ...judges.slice(0, 2).map((vendor, i): SupplierRole => ({ role: i === 0 ? 'judge' : 'fallback judge', vendor })),
    { role: 'short video', vendor: SUPPLIER_VENDORS.video },
    { role: 'pictures', vendor: EMBED_VENDOR },
  ];
}
