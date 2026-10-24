/**
 * "SHARE YOUR TRADE" — the sheet offered after a sell goes through: a live preview of the flex card,
 * its background (the post, the Insidor pattern, or the person's own picture), two switches (the SOL
 * profit, and their own @ with its picture), and Share (the phone's share sheet with the PNG) and
 * Save (the PNG to the phone).
 *
 * A new sheet, drawn with the app's one bottom sheet (shared/ui/Sheet.tsx), because the Buy and Sell
 * ticket keeps its look exactly as it is (the owner): the ticket only gains the one line that opens
 * this after a sell is sent, and opens it by itself once that sell is seen landed (sell-landed.ts).
 *
 * ★ THE CARD WAITS FOR THE SELL TO LAND. The ticket knows the sell was sent; the read service knows
 * when it landed and what each trade's own cap was (services/read trade-card.ts). Until it has, the
 * preview says so and asks again every few seconds; a sell never seen landing gets no card.
 *
 * ★ WHAT IS LEFT OFF IS SAID UNDER THE PREVIEW. A number the record does not have is not drawn (no
 * multiple, no entry, no profit), and one plain line says why, so a card with fewer numbers never
 * looks like a mistake. No post picture we can draw means the Insidor background, said the same way.
 *
 * TODO(phase 2): a video post's clip as a moving background, exported as a short video. Not offered
 * until it works — there is no chip for it, so nothing on the sheet promises it.
 *
 * What breaks if changed carelessly: pictures go through flex-draw.ts `loadPicture` (CORS-safe, our
 * storage or the person's own file). An <img> from anywhere else drawn on the canvas would taint it,
 * and Save and Share would fail with nothing to show for it.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchSellCard, type SellCard } from '../../shared/api/index.ts';
import { fetchMe } from '../../shared/api/people.ts';
import { logoSources } from '../../shared/coin-logo.ts';
import { postPicCopy } from '../../shared/post-pic.ts';
import { Button } from '../../shared/ui/Button.tsx';
import { POST_PIC_BASE } from '../../shared/ui/post-pic-base.ts';
import { Sheet, SheetBody, SheetFoot, SheetHead } from '../../shared/ui/Sheet.tsx';
import { facesFileUrl } from '../../shared/ui/usePosterPic.ts';
import { backdropChoices, fileName, leftOff, type Backdrop, type FlexFacts } from './flex-card.ts';
import { cardPng, drawCard, firstPicture, loadFonts, loadPicture } from './flex-draw.ts';
import { ASK_EVERY_MS, ASK_FOR_MS } from './sell-landed.ts';
import styles from './share.module.css';

const LOGO_BASE = ((import.meta.env?.['VITE_COIN_LOGO_BASE'] as string | undefined) ?? '').replace(/\/+$/, '');

type Read = { readonly kind: 'loading' } | { readonly kind: 'waiting' } | { readonly kind: 'unseen' } | { readonly kind: 'failed' } | Extract<SellCard, { kind: 'read' }> | { readonly kind: 'none' };

interface Me {
  readonly handle: string | null;
  readonly picture: string | null;
}

const BACKDROP_LABEL: Record<Backdrop, string> = { post: 'The post', insidor: 'Insidor', mine: 'My picture' };

export function ShareTradeSheet({ signature, mint, ticker, subline, signedIn, onClose }: {
  /** The sell's transaction, as the wallet sent it. */
  readonly signature: string;
  readonly mint: string;
  readonly ticker: string;
  /** "paired with TTWOx" for a coin priced in a stock, else the coin's name; null when neither is known. */
  readonly subline: string | null;
  readonly signedIn: boolean;
  readonly onClose: () => void;
}) {
  const [read, setRead] = useState<Read>({ kind: 'loading' });
  const [me, setMe] = useState<Me | null>(null);
  const [backdrop, setBackdrop] = useState<Backdrop | null>(null);
  const [mine, setMine] = useState<HTMLImageElement | null>(null);
  const [showProfit, setShowProfit] = useState(true);
  const [showMe, setShowMe] = useState(true);
  const [pictures, setPictures] = useState<{ post: HTMLImageElement | null; coin: HTMLImageElement | null; author: HTMLImageElement | null; me: HTMLImageElement | null } | null>(null);
  const [fontsReady, setFontsReady] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  /* The sell's facts, asked again while it has not landed. */
  useEffect(() => {
    const ac = new AbortController();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = () => {
      fetchSellCard(signature, ac.signal).then(
        (c) => {
          if (ac.signal.aborted) return;
          if (c.kind !== 'pending') return setRead(c);
          if (Date.now() - started >= ASK_FOR_MS) return setRead({ kind: 'unseen' });
          setRead({ kind: 'waiting' });
          timer = setTimeout(ask, ASK_EVERY_MS);
        },
        () => {
          if (!ac.signal.aborted) setRead({ kind: 'failed' });
        },
      );
    };
    ask();
    void loadFonts().then(() => setFontsReady(true));
    return () => {
      ac.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [signature]);

  /* The person's own @ and picture, for the last line. */
  useEffect(() => {
    if (!signedIn) return;
    let live = true;
    fetchMe().then(
      (card) => {
        if (!live) return;
        const handle = card.handle === null || card.handle.trim() === '' ? null : `@${card.handle.replace(/^@/, '')}`;
        const picture = facesFileUrl(card.pictureFile ?? null) ?? (card.pictureUrl !== null && card.pictureUrl.startsWith('https://') ? card.pictureUrl : null);
        setMe({ handle, picture });
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [signedIn]);

  const card = read.kind === 'read' ? read : null;

  /* Every picture the card may use, loaded once, CORS-safe; one that fails is simply absent. */
  useEffect(() => {
    if (card === null) return;
    let live = true;
    const post = card.post;
    const postSources = post?.pictureFile == null ? [] : [postPicCopy(post.pictureFile, POST_PIC_BASE, 'sheet'), postPicCopy(post.pictureFile, POST_PIC_BASE, 'card')].flatMap((u) => (u === null ? [] : [u]));
    void Promise.all([
      firstPicture(postSources),
      firstPicture(logoSources(mint, null, LOGO_BASE)),
      loadPicture(post === null ? null : facesFileUrl(post.authorPictureFile)),
      loadPicture(me?.picture ?? null),
    ]).then(([p, coin, author, mePic]) => {
      if (live) setPictures({ post: p, coin, author, me: mePic });
    });
    return () => {
      live = false;
    };
  }, [card, mint, me?.picture]);

  const choices = backdropChoices(pictures?.post != null);
  const chosen: Backdrop = backdrop !== null && choices.includes(backdrop) && (backdrop !== 'mine' || mine !== null) ? backdrop : choices[0] ?? 'insidor';

  const facts: FlexFacts | null = useMemo(() => {
    if (card === null) return null;
    return {
      ticker: card.ticker ?? ticker,
      subline: subline ?? card.name,
      multiple: card.multiple.v,
      boughtCapUsd: card.boughtCapUsd.v,
      soldCapUsd: card.soldCapUsd.v,
      profitSol: card.profitSol.v,
      author: card.post?.author ?? null,
      postedAt: card.post?.postedAt ?? null,
      me: me?.handle ?? null,
    };
  }, [card, ticker, subline, me?.handle]);

  /* Drawn again on every choice: the preview IS the exported picture, scaled down by the page. */
  useEffect(() => {
    if (facts === null || pictures === null || !fontsReady || canvas.current === null) return;
    const ground = chosen === 'post' ? pictures.post : chosen === 'mine' ? mine : null;
    drawCard(canvas.current, facts, { showProfit, showMe }, { backdrop: ground, coinLogo: pictures.coin, author: pictures.author, me: pictures.me });
  }, [facts, pictures, fontsReady, chosen, mine, showProfit, showMe]);

  const pickMine = (file: File | undefined) => {
    if (file === undefined || !file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    void loadPicture(url).then((img) => {
      if (img === null) {
        setSaid("That picture couldn't be opened.");
        return;
      }
      setMine(img);
      setBackdrop('mine');
      setSaid(null);
    });
  };

  const png = async (): Promise<File | null> => {
    if (canvas.current === null || facts === null) return null;
    const blob = await cardPng(canvas.current);
    return blob === null ? null : new File([blob], fileName(facts.ticker, facts.multiple), { type: 'image/png' });
  };

  const save = async () => {
    const file = await png();
    if (file === null) return setSaid("The card couldn't be made into a picture.");
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setSaid('Saved');
  };

  const share = async () => {
    const file = await png();
    if (file === null) return setSaid("The card couldn't be made into a picture.");
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (typeof nav.share === 'function' && nav.canShare?.({ files: [file] }) === true) {
      try {
        await nav.share({ files: [file] });
        setSaid(null);
      } catch (e) {
        /* Closing the share sheet is not a failure. */
        if (!(e instanceof DOMException && e.name === 'AbortError')) setSaid("The share sheet didn't open. Save keeps the picture instead.");
      }
      return;
    }
    await save();
  };

  const notes = card === null ? [] : leftOff(card, pictures === null || pictures.post !== null);

  return (
    <Sheet label="Share your trade" onClose={onClose} fit>
      <SheetHead title="Share your trade" />
      <SheetBody>
        <div className={styles['preview']}>
          {facts !== null && pictures !== null && fontsReady ? <canvas ref={canvas} aria-label={`Your ${facts.ticker} trade card`} role="img" /> : null}
          {facts === null || pictures === null || !fontsReady ? <p className={styles['waiting']}>{waitingLine(read)}</p> : null}
        </div>
        {notes.length > 0 ? (
          <ul className={styles['notes']}>
            {notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        ) : null}

        {facts !== null ? (
          <>
            <p className={styles['label']}>Background</p>
            <div className={styles['chips']} role="radiogroup" aria-label="Background">
              {choices.map((b) =>
                b === 'mine' ? (
                  <label key={b} className={`${styles['chip']} ${chosen === b ? styles['chipOn'] : ''}`}>
                    {BACKDROP_LABEL[b]}
                    <input type="file" accept="image/*" aria-label="Choose my picture" onChange={(e) => pickMine(e.target.files?.[0])} onClick={() => mine !== null && setBackdrop('mine')} />
                  </label>
                ) : (
                  <button key={b} type="button" role="radio" aria-checked={chosen === b} className={`${styles['chip']} ${chosen === b ? styles['chipOn'] : ''}`} onClick={() => setBackdrop(b)}>
                    {BACKDROP_LABEL[b]}
                  </button>
                ),
              )}
            </div>

            <div className={styles['rows']}>
              {facts.profitSol !== null ? <Switch label="Show SOL profit" on={showProfit} onChange={setShowProfit} /> : null}
              {facts.me !== null ? <Switch label="Show my @ and picture" on={showMe} onChange={setShowMe} /> : null}
            </div>
          </>
        ) : null}
      </SheetBody>
      {facts !== null && pictures !== null && fontsReady ? (
        <SheetFoot>
          {said !== null ? <p className={styles['said']} role="status">{said}</p> : null}
          <div className={styles['buttons']}>
            <Button look="primary" size="large" onClick={() => void share()}>Share</Button>
            <Button look="link" onClick={() => void save()}>Save</Button>
          </div>
        </SheetFoot>
      ) : null}
    </Sheet>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={styles['row']} onClick={() => onChange(!on)}>
      <span>{label}</span>
      <span className={`${styles['switch']} ${on ? styles['switchOn'] : ''}`} aria-hidden="true"><span /></span>
    </button>
  );
}

function waitingLine(read: Read): string {
  switch (read.kind) {
    case 'waiting':
      return 'Your sell is landing. The card is drawn as soon as it has.';
    case 'unseen':
      return "Your sell hasn't been seen landing, so there's no card for it yet.";
    case 'failed':
      return "The card couldn't be read just now.";
    case 'none':
      return "This sell wasn't recorded in Insidor, so there's nothing to put on a card.";
    default:
      return 'Drawing your card';
  }
}
