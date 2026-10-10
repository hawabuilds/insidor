/**
 * CREATE COIN — a centred modal, after Trador's `CreateSheet.tsx` and `ui/Modal.tsx`.
 *
 * The picture from the post, a name and a ticker to edit, dev-buy presets, the launch fee and
 * creator earnings, and a Create button. ★ THE BUTTON SAYS "COMING SOON" AND DOES NOTHING
 * ELSE. No coin is minted, no address is generated, no success is shown.
 *
 * Two lines in the design are claims nobody can make yet, and they are rendered as what they
 * are: whether the ticker is free (nothing has asked the venue), and the fee and creator share
 * (nothing has read them). Each shows as not known, never as a placeholder number.
 */

import { useState } from 'react';
import type { Measured } from '../../shared/format/measure.ts';
import { formatCount } from '../../shared/format/number.ts';
import { PENDING_GLYPH } from '../../shared/format/rendered.ts';
import type { Notice as NoticeCopy } from '../../shared/notice.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { useComingSoon } from '../../shared/ui/ComingSoon.tsx';
import { RocketIcon } from '../../shared/ui/icons.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { Notice } from '../../shared/ui/Notice.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { DEV_BUY_PRESETS, TICKER_MAX, cleanTicker, suggestTicker } from './create-form.ts';
import styles from './create.module.css';

export interface CreateFrom {
  readonly title: string;
  readonly reach: Measured;
  readonly thumbUrl: string | null;
  /** True when the story behind it is sample data; the modal then carries the notice too. */
  readonly sample: boolean;
}

const SAMPLE_STORY: NoticeCopy = {
  headline: 'Sample data',
  detail: 'The story behind this is made up.',
};

/** A figure nobody has read yet: a dash and the words, never a placeholder number. */
function Unknown() {
  return <span className={styles['unknown']}>{PENDING_GLYPH} not known yet</span>;
}

export function CreateCoin({ from, onClose }: { from: CreateFrom; onClose: () => void }) {
  const soon = useComingSoon();
  const [name, setName] = useState(from.title);
  const [ticker, setTicker] = useState(() => suggestTicker(from.title));
  const [devBuy, setDevBuy] = useState<number | null>(DEV_BUY_PRESETS[0] ?? null);
  const views = formatCount(from.reach);

  return (
    <Modal
      title="Create coin"
      subtitle={`From ${from.title}${views.kind === 'value' ? `, ${views.text} views` : ''}`}
      onClose={onClose}
    >
      {from.sample ? <div className={styles['notice']}><Notice notice={SAMPLE_STORY} /></div> : null}

      <div className={styles['identity']}>
        <div className={styles['picture']}>
          <Thumb url={from.thumbUrl} size={92} />
          <button type="button" className={styles['change']} onClick={() => soon('Changing the picture')}>
            Change
          </button>
        </div>
        <div className={styles['inputs']}>
          <input aria-label="Name" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} />
          <input
            aria-label="Ticker"
            className={styles['tickerInput']}
            value={ticker}
            maxLength={TICKER_MAX}
            onChange={(e) => setTicker(cleanTicker(e.target.value))}
          />
        </div>
      </div>

      <p className={styles['check']}>Checking whether {ticker || 'a ticker'} is taken is coming soon.</p>

      <div className={styles['devBuy']}>
        <div>
          <b>Dev buy</b>
          <span>Optional, buy first at launch price</span>
        </div>
        <div className={styles['presets']}>
          {DEV_BUY_PRESETS.map((sol) => (
            <button
              key={sol}
              type="button"
              aria-pressed={devBuy === sol}
              className={`${styles['preset']} ${devBuy === sol ? styles['presetOn'] : ''}`}
              onClick={() => setDevBuy(devBuy === sol ? null : sol)}
            >
              {sol}
            </button>
          ))}
          <span className={styles['amount']}>{devBuy === null ? 'None' : <>{devBuy} <small>SOL</small></>}</span>
        </div>
      </div>

      <dl className={styles['terms']}>
        <div><dt>Launch fee</dt><dd><Unknown /></dd></div>
        <div><dt>You earn as creator</dt><dd><Unknown /></dd></div>
      </dl>

      <Button look="primary" size="large" className={styles['create']} onClick={() => soon('Creating a coin')}>
        <RocketIcon size={18} /> Create {ticker || 'coin'}
      </Button>
      <p className={styles['foot']}>When this is live: one approval in your wallet, listed on pump.fun.</p>
    </Modal>
  );
}
