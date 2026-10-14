/**
 * "RIGHT COIN / WRONG COIN" ON A CARD'S COIN LINE, AND "WHICH COIN?" — the owner's only.
 *
 * What is asked depends on what the card shows (owner-view.ts `coinAsk`):
 *
 *   one coin   → Right coin saves 'right' with that coin. Wrong coin saves 'wrong' at once (the
 *                owner has said it is not this one, even if they never pick) and opens Which coin?,
 *                where "This one" saves 'wrong' again WITH the coin it is.
 *   any other post line → Which coin? opens the sheet; "This one" saves 'right' with that coin.
 *
 * THE "WHICH COIN?" SHEET, top to bottom (the owner, 2026-10-13): the coins we think match, tap one
 * to pick it; then "Paste contract address" with Paste (reads the clipboard) and Check; then "No
 * coin is from this post". It is the app's one bottom sheet (shared/ui/Sheet.tsx), so it closes
 * the same five ways as every other.
 *
 * ★ A PASTED ADDRESS IS CHECKED, SHOWN, THEN SAVED (PasteCoin). Check asks the social service
 * whether the address is a coin (services/social owner-coin.ts); "Can't find this coin" saves
 * nothing. A coin it knows is previewed — logo, name, ticker, market cap, highest market cap so
 * far, when it launched and how long after the post — with "This coin is older than the post"
 * when it launched before it, and only Confirm saves "This is the coin" with the address. That
 * label makes the coin the post's own for everyone once the projector next runs.
 *
 * ★ A LABEL CAN BE TAKEN BACK. Once the owner has a coin call on a post the card shows what was
 * said with "Change" (the same sheet) and "Remove my label" (a `cleared` call, 0072).
 *
 * The same pick list is drawn inside "See N coins" (features/feed/SameNameCoins.tsx), so the owner
 * can call it from the token list as well as from the card.
 */

import { useState, type ReactNode } from 'react';

import { fetchPostCoins, type RisingPost, type SearchCoin } from '../../shared/api/index.ts';
import { PeopleError } from '../../shared/api/people.ts';
import { checkCoin, saveCall, saveCoinLabel, type CoinCall, type CoinCheckResult, type PostRef } from '../../shared/api/owner.ts';
import { oneCoinLine } from '../../shared/coin-status.ts';
import { compact } from '../../shared/format/number.ts';
import { useLoad } from '../../shared/hooks.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { Sheet, SheetBody, SheetHead } from '../../shared/ui/Sheet.tsx';
import { useOwnerState } from './hooks.ts';
import { callKey, ownerStore } from './owner-store.ts';
import { coinAsk, coinCallLine, launchLine } from './owner-view.ts';
import styles from './owner.module.css';
import { tickerText } from '../../shared/format/ticker.ts';

async function call(post: RisingPost, c: CoinCall, coin: string | null): Promise<void> {
  const line = post.coins.kind === 'one' || post.coins.kind === 'matched' ? oneCoinLine(post.coins.coin) : post.coins.kind;
  try {
    const saved = await saveCall({ kind: 'coin_match', itemId: post.id, call: c, coin, shown: { line, ...(post.coins.kind === 'one' || post.coins.kind === 'matched' ? { coinId: post.coins.coin.coinId } : {}) } });
    ownerStore.remember(saved === null ? [] : [saved]);
  } catch (e) {
    ownerStore.failed(null, e instanceof PeopleError ? e.message : 'That did not save. Try again.');
  }
}

/** The coin call under a card, when the card shows a coin to call. */
export function CoinCallButtons({ post }: { post: RisingPost }) {
  const { calls } = useOwnerState();
  const [picking, setPicking] = useState<CoinCall | null>(null);
  const ask = coinAsk(post.coins);
  if (ask === null) return null;
  const saved = calls.get(callKey({ kind: 'coin_match', itemId: post.id }));
  const said = coinCallLine(saved);
  const stop = (fn: () => void) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    fn();
  };
  return (
    <>
      {said !== null ? (
        <>
          <span className={styles['saidTag']}>{said}</span>
          <button type="button" className={styles['textLink']} onClick={stop(() => setPicking('right'))}>Change</button>
          <button type="button" className={styles['textLink']} onClick={stop(() => void call(post, 'cleared', null))}>Remove my label</button>
        </>
      ) : ask.kind === 'confirm' ? (
        <>
          <Button look="quiet" className={styles['mini']} onClick={stop(() => void call(post, 'right', ask.coin.address))}>Right coin</Button>
          <Button
            look="quiet"
            className={styles['mini']}
            onClick={stop(() => {
              void call(post, 'wrong', null);
              setPicking('wrong');
            })}
          >
            Wrong coin
          </Button>
        </>
      ) : (
        <Button look="quiet" className={styles['mini']} onClick={stop(() => setPicking('right'))}>Which coin?</Button>
      )}
      {picking !== null ? <WhichCoinSheet post={post} pickedCall={picking} onClose={() => setPicking(null)} /> : null}
    </>
  );
}

/** "Which coin?": the coins we think match, a pasted address, and "No coin is from this post". */
export function WhichCoinSheet({ post, pickedCall, onClose }: { post: RisingPost; pickedCall: CoinCall; onClose: () => void }) {
  return (
    <Sheet label="Which coin?" onClose={onClose} fit>
      <SheetHead title="Which coin is from this post?" />
      <SheetBody last>
        <CoinPickLoaded post={post} pickedCall={pickedCall} onDone={onClose} paste={<PasteCoin post={{ itemId: post.id }} onSaved={onClose} />} />
      </SheetBody>
    </Sheet>
  );
}

function CoinPickLoaded({ post, pickedCall, onDone, paste }: { post: RisingPost; pickedCall: CoinCall; onDone: () => void; paste: ReactNode }) {
  const [loaded] = useLoad(`post-coins:${post.id}`, (signal) => fetchPostCoins(post.id, signal));
  return (
    <>
      {loaded.state === 'loading' ? <p className={styles['note']}>Loading the coins with this name.</p> : null}
      {loaded.state === 'failed' ? <p className={styles['note']}>The coins with this name could not be read just now.</p> : null}
      {loaded.state === 'ready' && loaded.value.items.length === 0 ? <p className={styles['note']}>No coin with this name is listed. Paste its address below.</p> : null}
      <CoinPickList post={post} items={loaded.state === 'ready' ? loaded.value.items : []} pickedCall={pickedCall} onDone={onDone} paste={paste} />
    </>
  );
}

/**
 * "This one" beside each coin, then `paste` when given, then "No coin is from this post".
 * `pickedCall` is what a pick means: 'right' from a card that could not tell, 'wrong' after the
 * owner said the card's coin is wrong.
 */
export function CoinPickList({ post, items, pickedCall, onDone, paste = null }: { post: RisingPost; items: readonly SearchCoin[]; pickedCall: CoinCall; onDone?: () => void; paste?: ReactNode }) {
  const done = () => onDone?.();
  return (
    <div className={styles['list']}>
      {items.map((c) => (
        <div key={c.coinId} className={styles['item']}>
          <span className={styles['itemText']}>
            <p>{c.ticker !== null ? tickerText(c.ticker) : (c.name ?? c.address.slice(0, 6))}</p>
            {c.name !== null ? <span className={styles['meta']}>{c.name}</span> : null}
          </span>
          <Button
            look="primary"
            onClick={() => {
              void call(post, pickedCall, c.address);
              done();
            }}
          >
            This one
          </Button>
        </div>
      ))}
      {paste}
      <div className={styles['item']}>
        <span className={styles['itemText']}>
          <span className={styles['meta']}>None of these, and no other coin, came from this post.</span>
        </span>
        <Button
          look="quiet"
          onClick={() => {
            void call(post, 'none', null);
            done();
          }}
        >
          No coin is from this post
        </Button>
      </div>
    </div>
  );
}

const ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const usd = (v: number | null): string | null => (v === null ? null : `$${compact(v)}`);
const when = (ms: number): string =>
  new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC';

type Step =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'problem'; readonly text: string }
  | { readonly kind: 'preview'; readonly result: Extract<CoinCheckResult, { found: true }> }
  | { readonly kind: 'saving'; readonly result: Extract<CoinCheckResult, { found: true }> };

/**
 * "Paste contract address": the field, Paste and Check; then the preview and Confirm. `post` is
 * the card's post, or a function giving the pasted link (Add a missed post), read at Check.
 */
export function PasteCoin({ post, onSaved }: { post: PostRef | (() => PostRef | string); onSaved: () => void }) {
  const [text, setText] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const target = (): PostRef | string => (typeof post === 'function' ? post() : post);

  const paste = async () => {
    try {
      const got = (await navigator.clipboard.readText()).trim();
      setText(got);
      setStep({ kind: 'idle' });
    } catch {
      setStep({ kind: 'problem', text: "Couldn't read the clipboard. Paste into the field instead." });
    }
  };
  const check = async () => {
    if (step.kind === 'checking' || step.kind === 'saving') return;
    const coin = text.trim();
    if (!ADDRESS.test(coin)) return setStep({ kind: 'problem', text: "That isn't a Solana address: 32 to 44 letters and numbers." });
    const ref = target();
    if (typeof ref === 'string') return setStep({ kind: 'problem', text: ref });
    setStep({ kind: 'checking' });
    try {
      const result = await checkCoin(coin, ref);
      setStep(result.found ? { kind: 'preview', result } : { kind: 'problem', text: "Can't find this coin" });
    } catch (e) {
      setStep({ kind: 'problem', text: e instanceof PeopleError ? e.message : "Couldn't check just now. Try again." });
    }
  };
  const confirm = async (result: Extract<CoinCheckResult, { found: true }>) => {
    if (step.kind === 'saving') return;
    const ref = target();
    if (typeof ref === 'string') return setStep({ kind: 'problem', text: ref });
    setStep({ kind: 'saving', result });
    try {
      const saved = await saveCoinLabel(result.coin.address, ref);
      ownerStore.remember(saved === null ? [] : [saved]);
      onSaved();
    } catch (e) {
      setStep({ kind: 'problem', text: e instanceof PeopleError ? e.message : 'That did not save. Try again.' });
    }
  };

  const shown = step.kind === 'preview' || step.kind === 'saving' ? step.result : null;
  return (
    <div className={styles['paste']}>
      <span className={styles['meta']}>Paste contract address</span>
      <div className={styles['pasteRow']}>
        <input
          className={styles['pasteInput']}
          value={text}
          placeholder="Contract address"
          aria-label="Contract address"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            if (step.kind !== 'checking' && step.kind !== 'saving') setStep({ kind: 'idle' });
          }}
        />
        <Button look="quiet" onClick={() => void paste()}>Paste</Button>
        <Button look="primary" onClick={() => void check()}>{step.kind === 'checking' ? 'Checking' : 'Check'}</Button>
      </div>
      {step.kind === 'problem' ? <p className={styles['err']}>{step.text}</p> : null}
      {shown !== null ? <Preview result={shown} saving={step.kind === 'saving'} onConfirm={() => void confirm(shown)} /> : null}
    </div>
  );
}

function Preview({ result, saving, onConfirm }: { result: Extract<CoinCheckResult, { found: true }>; saving: boolean; onConfirm: () => void }) {
  const c = result.coin;
  const launch = launchLine(result.launchedAfterMs);
  return (
    <div className={styles['preview']}>
      <div className={styles['previewHead']}>
        <CoinLogo address={c.address} ticker={c.ticker ?? c.name} imageUrl={c.logoUrl} size={44} />
        <span className={styles['itemText']}>
          <p>{c.name ?? '— no name listed'}</p>
          <span className={styles['meta']}>{c.ticker !== null ? tickerText(c.ticker) : '— no ticker listed'}</span>
        </span>
      </div>
      <dl className={styles['facts']}>
        <dt>MC</dt>
        <dd>{usd(c.marketCapUsd) ?? '— not listed by the markets'}</dd>
        <dt>Highest MC so far</dt>
        <dd>{usd(c.highestMarketCapUsd) ?? `— ${c.highestWhy ?? 'not read'}`}</dd>
        <dt>Launched</dt>
        <dd>{c.launchedAt !== null ? when(c.launchedAt) : '— the launch time could not be read'}</dd>
      </dl>
      <p className={styles['launch']}>{launch.line}</p>
      {launch.older ? <p className={styles['warn']}>This coin is older than the post</p> : null}
      {!result.postStored ? <p className={styles['meta']}>This post isn't in our system yet. Saving adds it to the missed posts.</p> : null}
      <Button look="primary" size="large" className={styles['confirm']} onClick={onConfirm}>{saving ? 'Saving' : 'Confirm'}</Button>
    </div>
  );
}
