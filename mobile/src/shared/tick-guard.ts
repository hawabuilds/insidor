/**
 * ONE ODD TRADE NEVER MOVES A PRICE ON SCREEN (the owner, 2026-10-27, $DICTATOR's token page: "why does
 * this look like it rugged for a second when that's not what happened … just don't want it to cause a
 * panic sell for users"). The live line (live-coins.ts) hands every trade to the price store and the
 * chart as it lands; one trade priced far from the rest — a glitch in a pool's numbers, a dollar
 * value taken at a bad SOL price — drew a crash that was not there, and a holder looking at it
 * could sell into nothing.
 *
 * ★ A JUMP NEEDS A SECOND TRADE. A trade more than `JUMP` away from the coin's last accepted price is
 * held, not shown. The next trade within `CONFIRM_MS` that lands within `AGREE` of it confirms it, and
 * both are shown in order: a real dump is a run of trades at the new price, so it shows one trade
 * later. A trade back near the old price, or nothing within `CONFIRM_MS`, drops it: it never reaches
 * the card, the cap or the chart. A coin's first trade has nothing to jump from and is shown.
 *
 * Pure, and its own file, so `node --test` holds the rule; live-coins.ts keeps one guard for the app.
 *
 * What breaks if changed carelessly: `JUMP`. Set low, ordinary fast trading on a young coin (10-20%
 * between trades is common) would be held and every price would lag a trade.
 */

/** A move this large from the last accepted price (as a share of it) waits for a second trade. */
export const JUMP = 0.4;
/** The confirming trade must land within this share of the held one. */
export const AGREE = 0.15;
/** How long a held trade waits for its confirmation. */
export const CONFIRM_MS = 5_000;

interface Tick {
  readonly a: string;
  readonly p: number | null;
  readonly t: number;
}

interface CoinState {
  last: number | null;
  held: { readonly tick: Tick; readonly at: number } | null;
}

const far = (a: number, b: number, share: number): boolean => Math.abs(a - b) > share * b;

/** A guard over the live line's trades; `pass` returns the trades to show, in order, for the trades that arrived. */
export function createTickGuard<T extends Tick>() {
  const coins = new Map<string, CoinState>();
  return {
    pass(ticks: readonly T[], nowMs: number): T[] {
      const out: T[] = [];
      for (const tick of ticks) {
        const s = coins.get(tick.a) ?? { last: null, held: null };
        coins.set(tick.a, s);
        if (s.held !== null && nowMs - s.held.at > CONFIRM_MS) s.held = null;
        const p = tick.p;
        /* A trade without a dollar price moves nothing on screen; it is passed on as it is. */
        if (p === null || !(p > 0)) {
          out.push(tick);
          continue;
        }
        if (s.held !== null) {
          const heldP = s.held.tick.p as number;
          if (!far(p, heldP, AGREE)) {
            /* Confirmed: the jump was real. Both are shown, the held one first. */
            out.push(s.held.tick as T, tick);
            s.last = p;
            s.held = null;
            continue;
          }
          /* Not confirmed: the held trade is dropped and this one is judged on its own below. */
          s.held = null;
        }
        if (s.last !== null && far(p, s.last, JUMP)) {
          s.held = { tick, at: nowMs };
          continue;
        }
        out.push(tick);
        s.last = p;
      }
      return out;
    },
  };
}
