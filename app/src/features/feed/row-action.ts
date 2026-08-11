/**
 * THE BUTTON, AS A TYPE.
 *
 * A feed row shows exactly one button and which one is a function of the confirmed coin
 * count: none means Create, one means Buy, several means Compare. And when the match is not
 * confident there is NO BUTTON AT ALL — not a disabled one, not a greyed one.
 *
 * That last case is why this is a discriminated union rather than a string and a coin list.
 * `unsure` carries no coin, so it is not merely wrong to pass it to a buy component — it is
 * impossible, because `BuyAction` is a different type with a field `unsure` does not have.
 * The mistake is caught where it is made rather than in a screenshot of a buy sheet for a
 * coin we never identified.
 *
 * The same shape covers the mint-time case from the venue design: a coin whose mint time we
 * cannot confirm is not tradable, and a trade affordance must not render for it. That
 * decision is the server's — it arrives as `tradable` — and this function only obeys it.
 */

import type { BoardRow, Coin, CoinLink } from '../../shared/api/index.ts';

export interface CreateAction {
  readonly kind: 'create';
  readonly storyId: string;
}

export interface BuyAction {
  readonly kind: 'buy';
  readonly storyId: string;
  readonly coin: Coin;
}

export interface CompareAction {
  readonly kind: 'compare';
  readonly storyId: string;
  readonly coins: readonly [Coin, Coin, ...Coin[]];
}

/**
 * No button. `reason` exists so the row can say why in one short line — "which coin is not
 * settled" is information a user can act on; a silent empty cell is not.
 */
export interface NoAction {
  readonly kind: 'none';
  readonly reason: 'match_unsure' | 'not_tradable';
  readonly candidateCount: number | null;
}

export type RowAction = CreateAction | BuyAction | CompareAction | NoAction;

export function rowAction(row: Pick<BoardRow, 'id' | 'coins'>): RowAction {
  return actionFor(row.id, row.coins);
}

export function actionFor(storyId: string, coins: CoinLink): RowAction {
  switch (coins.kind) {
    case 'none':
      return { kind: 'create', storyId };

    case 'unsure':
      /* Deliberately terminal. There is no branch here that reaches for a coin, because
         `unsure` does not carry one — the wire vocabulary saw to that. */
      return { kind: 'none', reason: 'match_unsure', candidateCount: coins.candidateCount };

    case 'one':
      return coins.coin.tradable
        ? { kind: 'buy', storyId, coin: coins.coin }
        : { kind: 'none', reason: 'not_tradable', candidateCount: 1 };

    case 'several':
      /* Compare is always available even if some of them are untradable: comparing is
         reading, and the buy affordance is re-decided per coin on the story page. */
      return { kind: 'compare', storyId, coins: coins.coins };
  }
}

/** The words on the button. Kept next to the union so a fifth case cannot be added silently. */
export function actionLabel(action: CreateAction | BuyAction | CompareAction): string {
  switch (action.kind) {
    case 'create':
      return 'Create';
    case 'buy':
      return `Buy ${action.coin.ticker}`;
    case 'compare':
      return `Compare ${action.coins.length}`;
  }
}
