/**
 * A COIN'S OWN LINKS — Trador's `SocialRow.tsx`: round icon buttons beside the coin's name, X,
 * Telegram, website and TikTok, each only when the coin has it; no links, no row at all, never a
 * row of dead icons. Each opens in a new tab.
 *
 * ★ A LONG PRESS SHOWS WHERE IT GOES — the real handle or domain the read service took from the
 * URL itself ("@coin", "t.me/coin", "coin.example") — so a person can check a link before they
 * leave. The press that showed it does not also open the link.
 *
 * ★ NEVER "OFFICIAL". These are the links the coin's listing and its launch metadata name: the
 * creator's claims. They are shown as the coin's links and nothing more — no badge, no tick, no
 * word that vouches for them.
 *
 * What breaks if changed carelessly: the long-press timer must be cleared on release and on
 * scroll; one left running shows a label after the finger has gone, or swallows the next tap.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

import type { AboutLink, AboutLinkKind } from '../../shared/api/index.ts';
import { GlobeIcon, TelegramIcon, TikTokMark, XLogoIcon } from '../../shared/ui/icons.tsx';
import styles from './social.module.css';

/** How long a press is held before it shows the link's destination instead of opening it. */
const LONG_PRESS_MS = 450;
/** How long the destination stays up after a long press. */
const LABEL_SHOWN_MS = 2_400;

const ICON: Record<AboutLinkKind, { readonly name: string; readonly icon: ReactNode }> = {
  x: { name: 'X', icon: <XLogoIcon size={15} /> },
  telegram: { name: 'Telegram', icon: <TelegramIcon size={15} /> },
  website: { name: 'Website', icon: <GlobeIcon size={15} /> },
  tiktok: { name: 'TikTok', icon: <TikTokMark size={15} /> },
};

export function SocialRow({ links }: { links: readonly AboutLink[] }) {
  const [shown, setShown] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  useEffect(() => {
    if (shown === null) return;
    const t = setTimeout(() => setShown(null), LABEL_SHOWN_MS);
    return () => clearTimeout(t);
  }, [shown]);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);
  if (links.length === 0) return null;

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <div className={styles['row']}>
      {links.map((l) => (
        <a
          key={l.kind}
          className={styles['link']}
          href={l.url}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={`${ICON[l.kind].name}: ${l.label}`}
          title={l.label}
          onPointerDown={() => {
            held.current = false;
            cancel();
            timer.current = setTimeout(() => {
              held.current = true;
              setShown(l.label);
            }, LONG_PRESS_MS);
          }}
          onPointerUp={cancel}
          onPointerLeave={cancel}
          onPointerCancel={cancel}
          onContextMenu={(e) => e.preventDefault()}
          onClick={(e) => {
            if (!held.current) return;
            e.preventDefault();
            held.current = false;
          }}
        >
          {ICON[l.kind].icon}
        </a>
      ))}
      {shown !== null ? <span className={styles['label']} role="status">{shown}</span> : null}
    </div>
  );
}
