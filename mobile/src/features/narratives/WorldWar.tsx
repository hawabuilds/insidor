/**
 * THE "TWITTER WORLD WAR" CARD AND ITS SHEET (the owner, 2026-10-23): every online meme war between
 * countries that is still being posted, under one card in the Narratives tab (world-war.ts says
 * where it stands and how the fights are gathered).
 *
 *   the card    the umbrella's name, a picture of each fight's first narrative, one line per fight
 *               with its narratives and posts ("France vs Japan   15 posts"), the total, and on
 *               Trending the viral posts' accounts it is listed by. ★ It reads every meme war from the
 *               server, as the sheet does (the same read, shared): on 24 Oct the card counted only the
 *               wars the list had loaded and said "1 narrative" while its sheet showed two
 *   the sheet   opened by a tap: one section per fight, each narrative as a row (picture, title, its
 *               posts and age, as the tab's cards say them); a row opens that narrative's page. It
 *               reads every meme war from the server (GET /narratives/:view/fights), not only the
 *               ones the list has loaded, and shows the loaded ones until that answer is in
 *
 *   the coin    ONE coin for the whole war (the owner, 2026-10-24: "build the world war coin on the
 *               card"), on the card and atop the sheet: its logo, ticker, market cap, the day's move
 *               and Buy, as a narrative card's coin line; a tap on the coin opens its chart. Which
 *               coin is the owner's call, saved from "Coin for Twitter World War" at the foot of the
 *               sheet (his wallet only) and sent with the fights (`warCoin`). No coin chosen: no line
 *
 * Facts only, as every card: which countries the server said, and counts a reader can check. A cap
 * or move the server has no current reading for is not shown, never a zero.
 *
 * Its own file so the feature can be found, and removed, in one place.
 */

import { useState } from 'react';

import { BOARD_VIEW, fetchFightNarratives, type Story, type WarCoin } from '../../shared/api/index.ts';
import { PeopleError } from '../../shared/api/people.ts';
import { saveWarCoin } from '../../shared/api/owner.ts';
import { formatUsd } from '../../shared/format/number.ts';
import { tickerText } from '../../shared/format/ticker.ts';
import { useLoad } from '../../shared/hooks.ts';
import { hrefFor } from '../../shared/route.ts';
import { stripMove } from '../../shared/running-coins.ts';
import { useCoinCap } from '../../shared/useCoinCap.ts';
import { CoinLogo } from '../../shared/ui/CoinLogo.tsx';
import { ChevronIcon } from '../../shared/ui/icons.tsx';
import { Value } from '../../shared/ui/Value.tsx';
import { useIsOwner } from '../owner/hooks.ts';
import { BuyOpen, SheetToast, type SheetNote } from '../post-sheet/index.ts';
import { Sheet, SheetBody, SheetHead } from '../../shared/ui/Sheet.tsx';
import { Thumb } from '../../shared/ui/Thumb.tsx';
import { cardLine, realNarratives, viralLine } from './narrative-order.ts';
import { WAR_TITLE, fightSections } from './world-war.ts';
import styles from './narratives.module.css';

/** Every meme war from the server, and the war's coin, shared by the card and its sheet; the list's loaded ones until it is in. */
function useFights(loaded: readonly Story[]): { readonly stories: readonly Story[]; readonly coin: WarCoin | null; readonly failed: boolean; readonly reload: () => void } {
  const [all, reload] = useLoad('narratives:fights', (signal) => fetchFightNarratives(BOARD_VIEW, signal), 'memory');
  return {
    stories: all.state === 'ready' ? realNarratives(all.value.stories) : loaded,
    coin: all.state === 'ready' ? all.value.warCoin : null,
    failed: all.state === 'failed',
    reload,
  };
}

/** A base58 coin address, as long as one is (the server checks it again). */
const ADDRESS = /^(solana:)?[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const plural = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`;
const postsOf = (list: readonly Story[]): number => list.reduce((sum, s) => sum + (s.postCount ?? s.evidence.length), 0);

/** The umbrella card, in the list where its first meme war stood; a tap opens the sheet. */
export function WarCard({ stories, place, now, trending = false }: { stories: readonly Story[]; place: number | null; now: number; trending?: boolean }) {
  const [open, setOpen] = useState(false);
  const all = useFights(stories);
  const fights = fightSections(all.stories);
  const shown = fights.flatMap((f) => f.stories);
  const viral = trending ? viralLine(shown) : null;
  return (
    <>
      <article className={styles['card']} role="button" tabIndex={0} onClick={() => setOpen(true)} onKeyDown={(e) => {
        if (e.key === 'Enter') setOpen(true);
      }}>
        <div className={styles['top']}>
          {place !== null ? <span className={styles['place']}>{place}</span> : null}
          <span className={styles['warThumbs']}>
            {fights.slice(0, 3).map((f) => (
              <Thumb key={f.name} url={f.stories[0]?.thumbUrl ?? null} file={f.stories[0]?.thumbFile ?? null} size={fights.length > 1 ? 44 : 64} radius={fights.length > 1 ? 12 : 16} hideEmpty />
            ))}
          </span>
          <div className={styles['text']}>
            <b className={styles['title']}>{WAR_TITLE}</b>
            {fights.map((f) => (
              <span key={f.name} className={styles['warFight']}>
                <b>{f.name}</b>
                {f.stories.length > 1 ? <span>{plural(f.stories.length, 'narrative')}</span> : null}
                <span>{plural(postsOf(f.stories), 'post')}</span>
              </span>
            ))}
            <span className={styles['sub']}>
              <span>{plural(shown.length, 'narrative')}</span>
              <span>{plural(postsOf(shown), 'post')}</span>
            </span>
            {viral !== null ? <span className={`${styles['speed']} ${styles['up']}`}>{viral}</span> : null}
          </div>
          <ChevronIcon size={20} />
        </div>
        {all.coin !== null ? <WarCoinLine coin={all.coin} /> : null}
      </article>
      {open ? <WarSheet loaded={stories} now={now} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

/**
 * The war's coin as a narrative card's coin line: logo, ticker, cap and the day's move (each only
 * when a current reading has it), and Buy, which opens the same Buy pop-up. A tap on the coin opens
 * its chart. `live`: read the cap live while showing (the sheet), as the narrative page does.
 */
function WarCoinLine({ coin, live = false }: { coin: WarCoin; live?: boolean }) {
  const [buying, setBuying] = useState(false);
  const [note, setNote] = useState<SheetNote | null>(null);
  const cap = useCoinCap(coin.address, coin.marketCapUsd, live);
  const move = coin.changePct.known ? stripMove(coin.changePct.amount) : null;
  const label = coin.ticker ?? coin.name ?? coin.address.slice(0, 4);
  return (
    /* Inside the card, whose tap opens the sheet: a tap here (and in the Buy pop-up, whose events bubble through React) is the coin's. */
    <div className={styles['coin']} onClick={(e) => e.stopPropagation()}>
      <a className={styles['warCoin']} href={hrefFor({ screen: 'token', coinId: `solana:${coin.address}` })}>
        <CoinLogo small address={coin.address} ticker={coin.ticker ?? coin.name} imageUrl={coin.imageUrl} size={28} />
        <b className={styles['ticker']}>{tickerText(label)}</b>
        <span className={styles['coinSub']}>
          {cap.known ? <Value r={formatUsd(cap)} num /> : null}
          {move !== null ? <span className={move.direction === 'up' ? styles['up'] : move.direction === 'down' ? styles['down'] : ''}>{` ${move.text}`}</span> : null}
        </span>
      </a>
      <button type="button" className={styles['buy']} onClick={() => setBuying(true)}>Buy</button>
      {buying ? <BuyOpen mint={coin.address} ticker={coin.ticker ?? coin.name ?? ''} onClose={() => setBuying(false)} onNote={setNote} /> : null}
      <SheetToast note={note} onDone={() => setNote(null)} />
    </div>
  );
}

/**
 * "Coin for Twitter World War", the owner's alone: paste the coin's address and Save, or take the
 * coin off. One call on the whole war (shared/api/owner.ts `saveWarCoin`); the card reads it again.
 */
function WarCoinEdit({ coin, onSaved }: { coin: WarCoin | null; onSaved: () => void }) {
  const [pasted, setPasted] = useState('');
  const [state, setState] = useState<{ readonly kind: 'idle' | 'saving' } | { readonly kind: 'said'; readonly text: string }>({ kind: 'idle' });
  const address = pasted.trim();
  const ok = ADDRESS.test(address);
  const save = (value: string | null) => {
    if (state.kind === 'saving') return;
    setState({ kind: 'saving' });
    saveWarCoin(value).then(
      () => {
        setState({ kind: 'said', text: value === null ? 'Saved: no coin for the war.' : 'Saved. The card shows it on the next refresh.' });
        setPasted('');
        onSaved();
      },
      (e: unknown) => setState({ kind: 'said', text: e instanceof PeopleError ? e.message : 'That did not save. Try again.' }),
    );
  };
  return (
    <section className={styles['warSection']}>
      <h3 className={styles['warName']}>Coin for Twitter World War</h3>
      <p className={styles['warNote']}>Only you can see this.</p>
      <div className={styles['warEdit']}>
        <input className={styles['warInput']} placeholder="Paste the coin's address" value={pasted} onChange={(e) => setPasted(e.target.value)} spellCheck={false} autoCapitalize="off" />
        {ok ? <button type="button" className={styles['warSave']} onClick={() => save(address.replace(/^solana:/, ''))}>{state.kind === 'saving' ? 'Saving' : 'Save'}</button> : null}
      </div>
      {address !== '' && !ok ? <p className={styles['warNote']}>That is not a coin address.</p> : null}
      {coin !== null ? <button type="button" className={styles['warOff']} onClick={() => save(null)}>Take the coin off</button> : null}
      {state.kind === 'said' ? <p className={styles['warNote']}>{state.text}</p> : null}
    </section>
  );
}

function WarSheet({ loaded, now, onClose }: { loaded: readonly Story[]; now: number; onClose: () => void }) {
  const all = useFights(loaded);
  const owner = useIsOwner();
  const sections = fightSections(all.stories);
  const go = (s: Story) => {
    onClose();
    window.location.hash = hrefFor({ screen: 'story', storyId: s.id });
  };
  return (
    <Sheet label={WAR_TITLE} onClose={onClose}>
      <SheetHead title={WAR_TITLE} />
      <SheetBody last>
        {all.coin !== null ? <WarCoinLine coin={all.coin} live /> : null}
        {all.failed ? <p className={styles['warNote']}>Couldn't load every fight; showing the ones in the list.</p> : null}
        {sections.length === 0 ? <p className={styles['warNote']}>No country is fighting right now.</p> : null}
        {sections.map((f) => (
          <section key={f.name} className={styles['warSection']}>
            <h3 className={styles['warName']}>{f.name}</h3>
            {f.stories.map((s) => (
              <button key={s.id} type="button" className={styles['warRow']} onClick={() => go(s)}>
                <Thumb url={s.thumbUrl} file={s.thumbFile} size={44} radius={12} hideEmpty />
                <span className={styles['text']}>
                  <b className={styles['warRowTitle']}>{s.title}</b>
                  <span className={styles['sub']}>
                    {cardLine(s, now).map((w) => <span key={w}>{w}</span>)}
                  </span>
                </span>
                <ChevronIcon size={18} />
              </button>
            ))}
          </section>
        ))}
        {owner ? <WarCoinEdit coin={all.coin} onSaved={all.reload} /> : null}
      </SheetBody>
    </Sheet>
  );
}
