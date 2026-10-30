/**
 * THE NIGHTLY SMART WALLET LIST (0154; the owner, 2026-10-30: "beat the runner"). Two statements over what
 * chainwatch already recorded: first, mark the launches that graduated — a coin our own charts (0144) now
 * show trading in another pool than the one it launched in; then judge the wallets — among the first
 * buyers of `minGraduates`+ graduates of the window, minus any whose launches name `maxAccounts`+
 * different promoting accounts — and write that night's list with a run row saying what it was judged on.
 *
 * Why in SQL, not in the job: the window is some 650,000 launches and 1.7 million buyer entries. Pulled
 * over the wire every night they would be ~100 MB of the database's transfer budget; aggregated where they
 * live, the job reads back three counts. Nothing is paid and nothing outside our own tables is read.
 *
 * ★ A PROMOTING ACCOUNT is the X account a coin's metadata links (internal.coin_metadata.social_link):
 * the profile or post the launch was promoted from. The research (reports/signals/stage1.md) found that a
 * wallet seen across 5+ such accounts is a sniper bot or an exchange — early to everything, so early to
 * every winner too — and that keeping them made the signal worse. A launch with no such link counts
 * toward a wallet's graduates but names no account.
 *
 * ★ ONE LIST PER NIGHT, never overwritten by a later night, so a replay scores a launch against the list
 * as it stood BEFORE that launch (`judged_on` < its day): judging a wallet smart on the very launch being
 * scored is the leak the research was careful to avoid.
 *
 * What breaks if changed carelessly: the graduation test. "Another pool than at launch" needs the launch's
 * own pool (0154 `pool`); comparing with a fixed launchpad pool name would call every coin launched on
 * another launchpad a graduate on its first trade.
 */

import type { Db } from '../client.ts';

export interface SmartWalletRules {
  /** Launches from this far back are judged on. */
  readonly withinMs: number;
  readonly minGraduates: number;
  /** A wallet whose launches name this many different promoting accounts or more is left out. */
  readonly maxAccounts: number;
  /** Each night's list is deleted this long after its night. */
  readonly keepListsMs: number;
}

export interface SmartWalletRun {
  readonly judgedOn: string;
  /** Launches newly seen graduating this run. */
  readonly marked: number;
  /** Launches in the window with their buyers listed (0154). */
  readonly launches: number;
  /** Of them, seen graduating. */
  readonly graduates: number;
  /** Wallets on tonight's list. */
  readonly wallets: number;
}

const iso = (ms: number): string => new Date(ms).toISOString();
const day = (ms: number): string => iso(ms).slice(0, 10);

/** The account a metadata link names, lower-cased; the path words that are not accounts are not. */
const HANDLE_SQL = `lower(substring(m.social_link from '(?:x|twitter)\\.com/([A-Za-z0-9_]{1,15})'))`;
const NOT_ACCOUNTS = ['i', 'home', 'search', 'intent', 'hashtag', 'share', 'explore', 'messages', 'notifications'];

export class PgSmartWalletRepo {
  readonly #db: Db;

  constructor(db: Db) {
    this.#db = db;
  }

  /** The newest night judged, as 'YYYY-MM-DD'; null when none was. */
  async lastJudgedOn(): Promise<string | null> {
    const rows = await this.#db.query<{ d: string | null }>(`select max(judged_on)::text as d from internal.smart_wallet_run`);
    return rows[0]?.d ?? null;
  }

  /**
   * Marks the window's graduates, judges tonight's list and writes it with its run row; `write` false
   * only counts. Run it in one transaction: a list without its run row would read as a night not judged.
   */
  async judge(nowMs: number, rules: SmartWalletRules, write: boolean): Promise<SmartWalletRun> {
    const from = iso(nowMs - rules.withinMs);
    const to = iso(nowMs);
    const judgedOn = day(nowMs);
    const marked = write
      ? await this.#count(
          `with m as (
             update internal.launch_open lo set graduated_seen_at = $3
               from internal.chart_coin c
              where c.address = lo.address and lo.launched_at >= $1 and lo.launched_at < $2
                and lo.graduated_seen_at is null and lo.pool is not null
                and c.pool is not null and c.pool <> '' and c.pool <> lo.pool
             returning 1)
           select count(*)::int as n from m`,
          [from, to, to],
        )
      : 0;
    const judged = `
      with grads as (
        select address, first_buyers from internal.launch_open
         where launched_at >= $1 and launched_at < $2 and graduated_seen_at is not null and first_buyers is not null),
      cand as (
        select w as wallet, count(distinct g.address)::int as graduates
          from grads g cross join lateral unnest(g.first_buyers) as w
         group by w having count(distinct g.address) >= $3),
      accts as (
        select w as wallet, count(distinct h.handle)::int as accounts
          from internal.launch_open lo
          cross join lateral unnest(lo.first_buyers) as w
          join cand on cand.wallet = w
          join public.asset a on a.address = lo.address
          join internal.coin_metadata m on m.asset_key = a.asset_key
          cross join lateral (select ${HANDLE_SQL} as handle) h
         where lo.launched_at >= $1 and lo.launched_at < $2 and lo.first_buyers is not null
           and h.handle is not null and not (h.handle = any ($5::text[]))
         group by w),
      smart as (
        select c.wallet, least(c.graduates, 32767) as graduates, least(coalesce(x.accounts, 0), 32767) as accounts
          from cand c left join accts x using (wallet)
         where coalesce(x.accounts, 0) < $4)`;
    const params = [from, to, rules.minGraduates, rules.maxAccounts, NOT_ACCOUNTS];
    const totals = await this.#db.query<{ launches: number; graduates: number }>(
      `select count(*)::int as launches, count(*) filter (where graduated_seen_at is not null)::int as graduates
         from internal.launch_open where launched_at >= $1 and launched_at < $2 and first_buyers is not null`,
      [from, to],
    );
    const launches = totals[0]?.launches ?? 0;
    const graduates = totals[0]?.graduates ?? 0;
    if (!write) {
      const wallets = await this.#count(`${judged} select count(*)::int as n from smart`, params);
      return { judgedOn, marked, launches, graduates, wallets };
    }
    await this.#db.query(`delete from internal.smart_wallet where judged_on = $1::date`, [judgedOn]);
    const wallets = await this.#count(
      `${judged}, put as (
         insert into internal.smart_wallet (judged_on, wallet, graduates, accounts)
         select $6::date, wallet, graduates, accounts from smart
         returning 1)
       select count(*)::int as n from put`,
      [...params, judgedOn],
    );
    await this.#db.query(
      `insert into internal.smart_wallet_run (judged_on, ran_at, launches, graduates, wallets) values ($1::date, $2, $3, $4, $5)
       on conflict (judged_on) do update set ran_at = excluded.ran_at, launches = excluded.launches, graduates = excluded.graduates, wallets = excluded.wallets`,
      [judgedOn, to, launches, graduates, wallets],
    );
    await this.#db.query(`delete from internal.smart_wallet where judged_on < $1::date`, [day(nowMs - rules.keepListsMs)]);
    return { judgedOn, marked, launches, graduates, wallets };
  }

  /** The list as it stood before `atMs`: the newest night judged before then. For replays. */
  async listBefore(atMs: number): Promise<{ readonly judgedOn: string | null; readonly wallets: ReadonlySet<string> }> {
    const run = await this.#db.query<{ d: string | null }>(`select max(judged_on)::text as d from internal.smart_wallet_run where ran_at < $1`, [iso(atMs)]);
    const judgedOn = run[0]?.d ?? null;
    if (judgedOn === null) return { judgedOn, wallets: new Set() };
    const rows = await this.#db.query<{ wallet: string }>(`select wallet from internal.smart_wallet where judged_on = $1::date`, [judgedOn]);
    return { judgedOn, wallets: new Set(rows.map((r) => r.wallet)) };
  }

  async #count(sql: string, params: readonly unknown[]): Promise<number> {
    const rows = await this.#db.query<{ n: number }>(sql, params);
    return Number(rows[0]?.n ?? 0);
  }
}
