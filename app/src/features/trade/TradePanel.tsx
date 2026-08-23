/**
 * THE BUY PANEL.
 *
 * Its props take a `BuyAction` — the branch of the row-action union that carries a
 * confirmed, tradable coin. An unsure match is a different type and cannot be passed here,
 * which is the whole point of that union: this panel does not check whether the coin is
 * settled, because it cannot be constructed for one that is not.
 *
 * ★ TRADING IS NOT BUILT, AND THIS PANEL SAYS SO INSTEAD OF MIMING IT.
 *
 * `submitTrade` throws NotImplemented on purpose, and there is no `/quote` route on the read
 * service — `fetchQuote` can only ever come back 404. So the amount field, the quote button,
 * the "you receive" block and the confirm key are gone. A form that accepts a number, spins,
 * and then admits it cannot do anything is rule 3's mistake moved one screen later: it is an
 * affordance that says "this works, you just have to wait", and the user pays for the lie in
 * time and attention rather than in money only because nothing behind it works.
 *
 * What is left is the part that is true: which coin this is, what we know about it (nothing,
 * priced — every figure is a dash with its reason), and one plain statement of why no order
 * can be placed.
 *
 * ★ A CONNECTED WALLET CHANGES ONE SENTENCE HERE AND NOTHING ELSE. The list of what is
 * missing gets one item shorter, because it genuinely is one item shorter — that is a fact
 * about the world, which is the test everything on screen has to pass. It is emphatically
 * not a step towards a form: no field appears, no control becomes pressable, and
 * `submitTrade` still throws. A wallet is the cheapest of the three things this path needs
 * and the only one that lives in a browser; the two that remain are a venue that will price
 * the coin and a service that can submit and confirm what was signed, and neither of those
 * gets closer because somebody pressed Connect.
 *
 * WHEN A VENUE LANDS, the machinery to restore it is all still here and none of it needs to
 * be redesigned: `quote-state.ts` holds the expiry state machine (`settle`, `hasExpired`,
 * `QuoteState`, `LiveQuote`) and its rules — a quote is never cached across a render, because
 * the venue changes the moment a coin graduates off its bonding curve; `fetchQuote` and
 * `submitTrade` are in shared/api/client.ts; and the cost breakdown must render
 * `quote.costs` as an ARRAY with no fee line hardcoded anywhere, because measured all-in cost
 * ranged 1.60% to 22.72% across three same-age mints and any fixed "0.50%" would be a lie on
 * most trades. An empty array says the costs are unknown; it never implies they are zero.
 */

import type { BuyAction } from '../feed/index.ts';
/* ★ The app's ONE spelling of "shorten an opaque reference for the eye", and the header on
   `truncateRef` names this panel as the reason it is exported. It was not being used here:
   this file had its own `slice(0, 6)…slice(-4)`, which cuts UTF-16 units rather than code
   points and can therefore leave half a character behind — the exact drift that header warns
   about, on the one screen where the reference identifies what a person is about to spend
   money on. */
import { truncateRef } from '../wallet/index.ts';
import { formatAge } from '../../shared/format/duration.ts';
import { formatPrice, formatUsd } from '../../shared/format/number.ts';
import { Num } from '../../shared/ui/index.ts';
import styles from './trade.module.css';

export interface TradePanelProps {
  readonly action: BuyAction;
  readonly onClose: () => void;
  /**
   * Whether a wallet is connected. It changes ONE SENTENCE and adds no control — see the
   * note above `NEEDS`. Passed in as a boolean rather than as a `WalletState`, because the
   * only thing this panel is entitled to know is whether one of the three missing pieces has
   * arrived; which of seven wallet states we are in is the nav's business.
   */
  readonly walletConnected: boolean;
}

/**
 * ★ THE ONE THING A CONNECTED WALLET CHANGES ON THIS SCREEN, AND IT IS A SENTENCE.
 *
 * Both spellings say trading is not connected, because it is not. What differs is the list
 * of what is missing, and it differs because the list got shorter by exactly one item — that
 * is a fact about the world and it is allowed on screen. What is NOT allowed is any
 * consequence of it: no amount field appears, no button becomes pressable, no estimate
 * arrives. Connecting a wallet changes what the app knows, not what it offers.
 *
 * The two items that remain are both server-side and neither is close: a venue that will
 * price this coin, and something that can submit what a wallet signed and then tell
 * `submitted` from `filled`. `shared/api/client.ts` names the third — an idempotency key
 * minted before the first signature — and none of the three gets closer because a browser
 * gained a wallet.
 */
const NEEDS = {
  without:
    'needs: a venue that will price this coin, a wallet, and a service that can submit and ' +
    'confirm what it signs',
  with:
    'your wallet is connected — still needs: a venue that will price this coin, and a ' +
    'service that can submit and confirm what your wallet signs',
} as const;

export function TradePanel({ action, onClose, walletConnected }: TradePanelProps) {
  const { coin } = action;
  /* A fixed instant rather than a ticking clock: nothing on this panel counts down any more
     (the countdown belonged to a live quote's expiry), and a 1s interval that only re-renders
     an age is a timer nobody asked for. */
  const now = Date.now();

  return (
    <div className={styles['panel']}>
      <div className={styles['head']}>
        <div className={styles['headMeta']}>
          <div className={styles['ticker']}>${coin.ticker}</div>
          <div className={styles['name']}>
            {coin.name} · {coin.venueLabel}
          </div>
        </div>
        <button type="button" className={styles['headX']} onClick={onClose} aria-label="close">
          ✕
        </button>
      </div>

      {/* The whole value is carried in `title` so it can be read and copied; the short form
          is for the eye. A reference is a reference — it is never put where a name goes. */}
      <span className={styles['address']} title={coin.address}>
        {truncateRef(coin.address)}
      </span>

      <div className={styles['mini']}>
        <div className={styles['costLine']}>
          <span className={styles['costLabel']}>price</span>
          <Num rendered={formatPrice(coin.priceUsd)} showWord />
        </div>
        <div className={styles['costLine']}>
          <span className={styles['costLabel']}>
            market cap{coin.marketCapBasis === null ? '' : ` (${coin.marketCapBasis})`}
          </span>
          <Num rendered={formatUsd(coin.marketCapUsd)} showWord />
        </div>
        <div className={styles['costLine']}>
          {/* Absent on a bonding curve. Absence is not illiquidity, so it shows as pending
              with its reason rather than as $0. */}
          <span className={styles['costLabel']}>liquidity</span>
          <Num rendered={formatUsd(coin.liquidityUsd)} showWord />
        </div>
        <div className={styles['costLine']}>
          <span className={styles['costLabel']}>minted</span>
          <Num rendered={formatAge(coin.mintedAt, now)} dim />
        </div>
      </div>

      <div className={styles['notLive']} role="status">
        <b>Trading is not connected.</b>
        Nothing in this build can price a trade or place one, so there is no amount to enter
        and no button to press. This panel exists to show which coin the board matched and
        what we know about it.
        <span className={styles['notLiveNeeds']}>
          {walletConnected ? NEEDS.with : NEEDS.without}
        </span>
      </div>

      <div className={styles['fine']}>
        no order can be placed from this screen — and no cost estimate is shown, because a
        made-up one is worse than none
      </div>

      <button type="button" className={styles['closeBtn']} onClick={onClose}>
        Close
      </button>
    </div>
  );
}
