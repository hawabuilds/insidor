/**
 * A WALLET'S TRADES, AND WHAT ITS HOLDINGS COST — ported from Trador's `lib/walletTrades.ts`,
 * cut to launchpad coins paid for in SOL.
 *
 * Trades come from the wallet's own balance changes in a parsed transaction, never from the
 * provider's label (Trador saw a real buy labelled TRANSFER). The SOL leg has the network fee
 * added back and rent into or out of the wallet's own token accounts taken out: opening a token
 * account costs ~0.002 SOL that comes back on close, and neither is the coin's price.
 *
 * ★ COST IS IN SOL, SO PROFIT IS IN SOL. What a coin cost is the SOL paid for it; what it is
 * worth is its price in SOL now. Dollar profit would need SOL's dollar price at every past buy,
 * which a guess would supply and nothing here does.
 *
 * ★ NO HISTORY, NO NUMBER. A holding with no priced buy in the history — airdropped, sent in,
 * bought before the history we read — has no profit, and says "no buy history". Never zero.
 */

export const NATIVE = 'So11111111111111111111111111111111111111112';
/** SOL moving beside a token-for-token swap below this is fees, tips or rent, not a price. */
const SOL_NOISE = 0.003;
/** Units within this share of each other are the same holding. */
const QTY_TOLERANCE = 0.02;
const ATA_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const TOKEN_PROGRAMS = new Set(['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb']);
/** SPL Token `CloseAccount` is instruction 9, base58 "A". */
const CLOSE_ACCOUNT = 'A';

interface Ix { readonly programId?: string; readonly accounts?: readonly string[]; readonly data?: string; readonly innerInstructions?: readonly Ix[] }
export interface ParsedTx {
  readonly signature: string;
  readonly timestamp: number;
  readonly fee?: number;
  readonly feePayer?: string;
  readonly transactionError?: unknown;
  readonly accountData?: readonly {
    readonly account?: string;
    readonly nativeBalanceChange?: number;
    readonly tokenBalanceChanges?: readonly { readonly userAccount: string; readonly tokenAccount: string; readonly mint: string; readonly rawTokenAmount: { readonly tokenAmount: string; readonly decimals: number } }[];
  }[];
  readonly instructions?: readonly Ix[];
}

export interface Trade {
  readonly signature: string;
  readonly at: number;
  readonly mint: string;
  readonly side: 'buy' | 'sell';
  readonly amount: number;
  /** SOL paid (buy) or received (sell). */
  readonly sol: number;
}

interface Leg { readonly mint: string; readonly amount: number }

function ownAccounts(tx: ParsedTx, wallet: string): Map<string, string | null> {
  const found = new Map<string, string | null>();
  const visit = (ix: Ix) => {
    const a = ix.accounts ?? [];
    if (ix.programId === ATA_PROGRAM && a[2] === wallet && a[1] !== undefined) found.set(a[1], a[3] ?? null);
    if (ix.programId !== undefined && TOKEN_PROGRAMS.has(ix.programId) && ix.data === CLOSE_ACCOUNT && a[2] === wallet && a[0] !== undefined && !found.has(a[0])) found.set(a[0], null);
  };
  for (const ix of tx.instructions ?? []) {
    visit(ix);
    for (const inner of ix.innerInstructions ?? []) visit(inner);
  }
  return found;
}

/** What the wallet itself gained and lost in one transaction, by mint (SOL as NATIVE). */
export function walletLegs(tx: ParsedTx, wallet: string): readonly Leg[] {
  const tokens = new Map<string, number>();
  const own = new Map<string, string>();
  let lamports = 0;
  let wrapped = 0;
  for (const account of tx.accountData ?? []) {
    if (account.account === wallet) lamports += account.nativeBalanceChange ?? 0;
    for (const c of account.tokenBalanceChanges ?? []) {
      if (c.userAccount !== wallet) continue;
      const amount = Number(c.rawTokenAmount.tokenAmount) / 10 ** c.rawTokenAmount.decimals;
      own.set(c.tokenAccount, c.mint);
      if (c.mint === NATIVE) wrapped += amount;
      else tokens.set(c.mint, (tokens.get(c.mint) ?? 0) + amount);
    }
  }
  for (const [account, mint] of ownAccounts(tx, wallet)) if (!own.has(account)) own.set(account, mint ?? '');
  for (const account of tx.accountData ?? []) {
    if (account.account === undefined || account.account === wallet) continue;
    const mint = own.get(account.account);
    if (mint !== undefined && mint !== NATIVE) lamports += account.nativeBalanceChange ?? 0;
  }
  if (tx.feePayer === wallet) lamports += tx.fee ?? 0;
  const sol = lamports / 1e9 + wrapped;
  const legs: Leg[] = [...tokens].filter(([, a]) => a !== 0 && Number.isFinite(a)).map(([mint, amount]) => ({ mint, amount }));
  const opposed = legs.some((l) => l.amount > 0) && legs.some((l) => l.amount < 0);
  if (Math.abs(sol) >= (opposed ? SOL_NOISE : 1e-9)) legs.push({ mint: NATIVE, amount: sol });
  return legs;
}

/** A coin bought or sold for SOL. A transfer in or out, with nothing going the other way, is not a trade. */
export function tradesFromTx(tx: ParsedTx, wallet: string): readonly Trade[] {
  if (tx.transactionError !== null && tx.transactionError !== undefined) return [];
  const legs = walletLegs(tx, wallet);
  const sol = legs.find((l) => l.mint === NATIVE);
  if (sol === undefined) return [];
  return legs
    .filter((l) => l.mint !== NATIVE && Math.sign(l.amount) === -Math.sign(sol.amount))
    .map((l) => ({ signature: tx.signature, at: tx.timestamp * 1000, mint: l.mint, side: l.amount > 0 ? 'buy' : 'sell', amount: Math.abs(l.amount), sol: Math.abs(sol.amount) }));
}

export interface Position {
  readonly mint: string;
  /** Units bought and not since sold. */
  readonly qty: number;
  /** What those units cost, in SOL, at average cost. */
  readonly costSol: number;
  /** False when more was sold than bought: the rest arrived some other way. */
  readonly complete: boolean;
}

/** Average cost per coin, oldest trade first; a sell takes out its share at the running average. */
export function positionsFrom(trades: readonly Trade[]): ReadonlyMap<string, Position> {
  const book = new Map<string, { mint: string; qty: number; costSol: number; complete: boolean }>();
  for (const t of [...trades].sort((a, b) => a.at - b.at)) {
    const p = book.get(t.mint) ?? { mint: t.mint, qty: 0, costSol: 0, complete: true };
    if (t.side === 'buy') {
      p.costSol += t.sol;
      p.qty += t.amount;
    } else if (p.qty > 0) {
      const sold = Math.min(t.amount, p.qty);
      p.costSol -= p.costSol * (sold / p.qty);
      p.qty -= sold;
      if (t.amount > sold * (1 + 1e-9)) p.complete = false;
    } else {
      p.complete = false;
    }
    book.set(t.mint, p);
  }
  return book;
}

export type Profit = { readonly kind: 'known'; readonly sol: number; readonly partial: boolean } | { readonly kind: 'none'; readonly why: 'no_buy_history' };

/**
 * Unrealised profit on a holding, in SOL: what it is worth now minus what it cost. Units held
 * beyond what the history shows were bought have no known cost, so only the covered part is
 * measured and the answer is marked partial. No priced buy at all: "no buy history".
 */
export function profitOf(held: number, valueSol: number | null, position: Position | undefined): Profit {
  if (position === undefined || valueSol === null || !(held > 0) || !(position.qty > 0) || !(position.costSol > 0)) return { kind: 'none', why: 'no_buy_history' };
  const covered = Math.min(held, position.qty);
  const sol = valueSol * (covered / held) - position.costSol * (covered / position.qty);
  return { kind: 'known', sol, partial: !position.complete || held > position.qty * (1 + QTY_TOLERANCE) };
}
