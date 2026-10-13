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
 */

import type { Policy } from '@insidor/contracts/policy.ts';
import { VENDOR as EMBED_VENDOR } from '@insidor/embed-voyage';
import { VENDOR as JUDGE_VENDOR } from '@insidor/judge-anthropic';
import { SUPPLIER_VENDORS } from '@insidor/platform-registry';

/** The one-off jobs' lines (Policy.budget.jobLines), keyed the same way. */
export function jobVendorLines(policy: Policy): Readonly<Record<string, number>> {
  const lines = policy.budget.jobLines;
  return {
    [SUPPLIER_VENDORS.posts]: lines.posts,
    [SUPPLIER_VENDORS.video]: lines.video,
    [JUDGE_VENDOR]: lines.judge,
    [EMBED_VENDOR]: lines.embeddings,
  };
}

export function vendorLines(policy: Policy): Readonly<Record<string, number>> {
  const lines = policy.budget.supplierLines;
  return {
    [SUPPLIER_VENDORS.posts]: lines.posts,
    /* The short-video source is fetched through the scraping service, so both bill as one
       vendor: its line is the video line and the scraping line together. */
    [SUPPLIER_VENDORS.video]: lines.video + lines.actors,
    [JUDGE_VENDOR]: lines.judge,
    [EMBED_VENDOR]: lines.embeddings,
  };
}
