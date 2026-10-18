/**
 * THE LABEL JOB'S COPY OF EACH ARCHIVED DAY OF THE DECISION LOG (0103): what is extracted from a
 * day's decisions, and how it is written and checked before that day may leave the database.
 *
 * Its own repository because two tools write it from two different sources and must agree to the
 * row: tools/archive-decisions.ts reads the live partition (`LABEL_BASIS_COLUMNS`), and
 * tools/backfill-label-basis.ts reads the archived NDJSON (`addJson`). Both feed the same
 * `LabelBasisDay`, so there is one definition of "what the label job needs", and the e2e test
 * (e2e/src/label-basis.test.ts) proves both routes give the label reads their old answers.
 *
 * ★ WHAT IS KEPT, AND WHY ONLY THAT. services/label asks the log three things: every (kind, id)
 * with min(subject_origin) and count(*); the candidates the resolve stage passed or abstained on;
 * and the stories and candidates the resolve stage decided about at all. So per day and subject:
 * the earliest origin, the count, and the distinct resolve verdicts. Pair subjects are not graded
 * and are left out; they are about half the log's distinct subjects.
 *
 * ★ WRITTEN IN SHORT STATEMENTS, SWITCHED ON LAST. Rows go in batches of `BATCH` through an upsert
 * that writes the day's exact values (never adds), so a retried day writes the same thing. Then the
 * day's rows are counted against the accumulator, and only then is the day row written — the row
 * the label job waits for before it reads the basis instead of the partition.
 *
 * What breaks if changed carelessly: the origin. It travels as microseconds since the epoch, never
 * through a JS Date, because a Date rounds to the millisecond and min(origin) must be the log's own
 * min to the microsecond for a re-graded label to match its earlier revision.
 */

import type { Db } from '../client.ts';

/** The subject kinds the label job grades (services/label GRADED_KINDS). Pair is not one. */
export const LABEL_BASIS_KINDS = ['item', 'story', 'candidate'] as const;
export type LabelBasisKind = (typeof LABEL_BASIS_KINDS)[number];

/** The columns a partition read selects for `addRow`. origin_us is exact: extract(epoch) is numeric. */
export const LABEL_BASIS_COLUMNS =
  `subject_kind, subject_id, stage, verdict, (extract(epoch from subject_origin) * 1000000)::bigint::text as origin_us`;

export interface LabelBasisSource {
  readonly subject_kind: string;
  readonly subject_id: string;
  readonly stage: string;
  readonly verdict: string;
  readonly origin_us: string | null;
}

const BATCH = 2_000;
const isKind = (k: string): k is LabelBasisKind => (LABEL_BASIS_KINDS as readonly string[]).includes(k);

/** Microseconds since the epoch of a timestamptz as row_to_json spells it ("…T22:09:13.123456+00:00"). */
export function microsOfIso(iso: string): bigint {
  const m = /^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d+))?(Z|[+-]\d\d(?::?\d\d)?)$/.exec(iso);
  if (m === null) throw new Error(`not a timestamp: ${iso}`);
  const zone = m[3] === 'Z' ? 'Z' : /^[+-]\d\d$/.test(m[3] ?? '') ? `${m[3]}:00` : (m[3] ?? 'Z');
  const seconds = Date.parse(`${m[1]}${zone}`);
  if (!Number.isFinite(seconds)) throw new Error(`not a timestamp: ${iso}`);
  const frac = BigInt((m[2] ?? '').padEnd(6, '0').slice(0, 6));
  return BigInt(seconds) * 1000n + frac;
}

/** The ISO string, in UTC, of microseconds since the epoch, with all six digits. */
export function isoOfMicros(us: bigint): string {
  const ms = us >= 0n ? us / 1000n : -((-us + 999n) / 1000n);
  const rest = us - ms * 1000n;
  return `${new Date(Number(ms)).toISOString().slice(0, 23)}${String(rest).padStart(3, '0')}Z`;
}

interface Subject {
  kind: LabelBasisKind;
  id: string;
  originUs: bigint | null;
  decisions: number;
  verdicts: Set<string> | null;
}

/** One day's basis, accumulated in memory from the day's decisions in any order. */
export class LabelBasisDay {
  readonly day: string;
  /** Every decision seen, graded kind or not: compared with the partition's own count. */
  logRows = 0;
  /** The decisions of the graded kinds: the sum of the basis rows' counts. */
  decisions = 0;
  private readonly subjects = new Map<string, Subject>();

  constructor(day: string) {
    if (!/^\d{4}-\d\d-\d\d$/.test(day)) throw new Error(`not a day: ${day}`);
    this.day = day;
  }

  get size(): number {
    return this.subjects.size;
  }

  add(kind: string, id: string, stage: string, verdict: string, originUs: bigint | null): void {
    this.logRows += 1;
    if (!isKind(kind)) return;
    this.decisions += 1;
    const key = `${kind}\u0000${id}`;
    let s = this.subjects.get(key);
    if (s === undefined) {
      s = { kind, id, originUs: null, decisions: 0, verdicts: null };
      this.subjects.set(key, s);
    }
    s.decisions += 1;
    if (originUs !== null && (s.originUs === null || originUs < s.originUs)) s.originUs = originUs;
    if (stage === 'resolve') (s.verdicts ??= new Set()).add(verdict);
  }

  /** A row read with `LABEL_BASIS_COLUMNS`. */
  addRow(r: LabelBasisSource): void {
    this.add(r.subject_kind, r.subject_id, r.stage, r.verdict, r.origin_us === null ? null : BigInt(r.origin_us));
  }

  /** One NDJSON line of the archive (row_to_json of a decision). */
  addJson(line: string): void {
    const r = JSON.parse(line) as { subject_kind: string; subject_id: string; stage: string; verdict: string; subject_origin: string | null };
    this.add(r.subject_kind, r.subject_id, r.stage, r.verdict, r.subject_origin === null ? null : microsOfIso(r.subject_origin));
  }

  rows(): readonly Subject[] {
    return [...this.subjects.values()];
  }
}

export interface LabelBasisWritten {
  readonly day: string;
  readonly subjects: number;
  readonly decisions: number;
  readonly logRows: number;
}

/**
 * Writes one day's basis and, only once its rows are counted back, the day row that makes the label
 * job read it. Throws, with the day row unwritten, on any mismatch.
 */
export async function writeLabelBasisDay(db: Db, basis: LabelBasisDay, source: 'archive' | 'backfill'): Promise<LabelBasisWritten> {
  const rows = basis.rows();
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    await db.query(
      `insert into internal.decision_label_basis (day, subject_kind, subject_id, origin_min, decisions, resolve_verdicts)
       select $1::date, t.k, t.i, t.o::timestamptz, t.n,
              case when t.v is null then null else string_to_array(t.v, ',') end
         from unnest($2::text[], $3::text[], $4::text[], $5::int[], $6::text[]) as t(k, i, o, n, v)
       on conflict (day, subject_kind, subject_id) do update
         set origin_min = excluded.origin_min, decisions = excluded.decisions, resolve_verdicts = excluded.resolve_verdicts`,
      [
        basis.day,
        chunk.map((s) => s.kind),
        chunk.map((s) => s.id),
        chunk.map((s) => (s.originUs === null ? null : isoOfMicros(s.originUs))),
        chunk.map((s) => s.decisions),
        chunk.map((s) => (s.verdicts === null ? null : [...s.verdicts].sort().join(','))),
      ],
    );
  }
  const [got] = await db.query<{ n: string; d: string | null }>(
    `select count(*)::text as n, sum(decisions)::text as d from internal.decision_label_basis where day = $1::date`,
    [basis.day],
  );
  const n = Number(got?.n ?? -1);
  const d = Number(got?.d ?? 0);
  if (n !== basis.size || d !== basis.decisions) {
    throw new Error(`${basis.day}: the label basis holds ${n} subjects and ${d} decisions, ${basis.size} and ${basis.decisions} were written; the day is not switched on`);
  }
  await db.query(
    `insert into internal.decision_label_basis_day (day, log_rows, decisions, subjects, source)
     values ($1::date, $2, $3, $4, $5)
     on conflict (day) do update
       set log_rows = excluded.log_rows, decisions = excluded.decisions, subjects = excluded.subjects,
           source = excluded.source, written_at = now()`,
    [basis.day, basis.logRows, basis.decisions, basis.size, source],
  );
  return { day: basis.day, subjects: basis.size, decisions: basis.decisions, logRows: basis.logRows };
}
