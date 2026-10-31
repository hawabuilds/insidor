/**
 * THE HEALTH BARS: the owner's lines for what counts as broken, shared by the by-hand health check
 * (tools/health.ts) and the alarm that runs them around the clock (health-alarm.ts).
 *
 * ★ WHY ONE FILE, WITH NO IMPORTS. On 2026-10-29 picture storage was cut off at 01:00 UTC and every
 * coin logo, poster and post picture stopped loading; tools/health.ts had the right bar and nobody
 * ran it for 13 hours. The bar now runs every few minutes from the alert service — and if the two
 * copies of it drifted, the tool would call red what the alarm calls healthy, or the reverse. So
 * both import these. Nothing here imports anything, so the tool can load it from a plain script.
 *
 * What breaks if changed carelessly: a bar loosened to make a push go away. A bar moves only when
 * the owner says what normal is (the same rule as tools/health.ts).
 */

/** Coin-logo copies are judged over this window... */
export const LOGO_WINDOW_MS = 60 * 60_000;
/** ...and failing at more than this share is down (tools/health.ts, 2026-10-29). */
export const LOGO_FAIL_PCT = 50;
/**
 * ...out of at least this many copies. Not in the by-hand check, which a person reads: one failed
 * copy in a quiet hour is 100% and would page the owner at night for nothing.
 */
export const LOGO_MIN_COPIES = 5;
/** The Tape (the running coins strip) with fewer coins than this is down. */
export const TAPE_MIN_COINS = 1;
/** Posts judged are counted over this window... */
export const JUDGED_WINDOW_MS = 30 * 60_000;
/** ...and fewer than this is judging stopped (tools/health.ts's floor). */
export const JUDGED_MIN = 10;

/**
 * Picture storage, as the status a stored logo answered with. `null`: no stored logo to try, which
 * is no claim either way. `0`: no answer at all, which is as broken as a refusal.
 */
export const picturesBroken = (status: number | null): boolean => status !== null && status !== 200;

/** The share of the window's coin-logo copies that failed, 0 when there were none. */
export const logoFailPct = (failed: number, copies: number): number => (copies === 0 ? 0 : Math.round((100 * failed) / copies));

export const logosBroken = (failed: number, copies: number, minCopies = LOGO_MIN_COPIES): boolean =>
  copies >= minCopies && logoFailPct(failed, copies) > LOGO_FAIL_PCT;

/** `null`: the read service did not answer, so the strip is empty for the app too. */
export const tapeBroken = (coins: number | null): boolean => coins === null || coins < TAPE_MIN_COINS;

export const judgingBroken = (judged: number): boolean => judged < JUDGED_MIN;

/**
 * ★ OUTPUT, NOT ONLY RUNNING (the owner, 2026-10-31: "this cant happen again with every change we
 * make or new upgrade"). On 30 Oct a picture change left the namer naming almost nothing; every bar
 * above stayed green because each watches whether a step runs. These watch what two steps PRODUCE —
 * name guesses and coin-to-post ties — over the last `FLOW_WINDOW_HOURS`, against the same hours one
 * and two days before (0155 internal.flow_counts). The larger of the two is the usual, so one bad
 * day does not become the new normal.
 */
export const FLOW_WINDOW_HOURS = 3;
/** Under this share of the usual is fallen: 30 Oct was ~10% of the usual for names, ~40% for ties. */
export const FLOW_FALLEN_SHARE = 0.5;
/** A usual under this is too quiet to judge (a night hour), and says nothing either way. */
export const FLOW_MIN_USUAL = 30;

export type FlowStep = 'names' | 'matching';

/** The usual for a window: the larger of the same hours one and two days before. */
export const flowUsual = (dayBefore: number, twoDaysBefore: number): number => Math.max(dayBefore, twoDaysBefore);

export const flowFallen = (recent: number, usual: number): boolean => usual >= FLOW_MIN_USUAL && recent < FLOW_FALLEN_SHARE * usual;
