/**
 * THE INVITES SHEET, from the profile menu's Invites row: my codes, each with copy and share (the
 * link insidor.app/i/<CODE> opens the door with the code filled in and my face on it), and
 * "Joined with your codes": who joined, with their picture, handle and when.
 *
 * Read when the sheet opens (services/social GET /invites/mine, which makes my codes the first
 * time). A read that fails says so; it is never drawn as "no codes".
 *
 * What breaks if changed carelessly: share falls back to copying the link where the phone has no
 * share sheet, so the button always does something; a used code is shown struck through, not
 * hidden, so a member can see which of their invitations worked.
 */

import { useEffect, useState } from 'react';

import { posthog } from '../../posthog.ts';
import { fetchMyInvites, type MyInvites } from '../../shared/api/invites.ts';
import { hrefFor } from '../../shared/route.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { CopyIcon, ShareIcon } from '../../shared/ui/icons.tsx';
import { Sheet, SheetBody, SheetHead } from '../../shared/ui/Sheet.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { inviteLink } from './invite-code.ts';
import { agoOf } from './when.ts';
import styles from './invites.module.css';

export function InvitesSheet({ onClose, onRead }: { readonly onClose: () => void; readonly onRead?: (joined: number) => void }) {
  const toast = useToast();
  const [mine, setMine] = useState<MyInvites | 'loading' | 'failed'>('loading');
  useEffect(() => {
    let live = true;
    fetchMyInvites().then(
      (m) => {
        if (!live) return;
        setMine(m);
        onRead?.(m.joined.length);
      },
      () => live && setMine('failed'),
    );
    return () => {
      live = false;
    };
  }, [onRead]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      if (what === 'Invite link') posthog.capture('invite_shared', { method: 'copied_link' });
      toast(`${what} copied`);
    } catch {
      toast("Couldn't copy", text);
    }
  };
  const share = async (code: string) => {
    const url = inviteLink(window.location.origin, code);
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: 'Join me on Insidor', text: `Catch the meme before the coin. My invite code: ${code}`, url });
        posthog.capture('invite_shared', { method: 'native_share' });
        return;
      } catch {
        /* Closed without sharing: nothing to do. */
        return;
      }
    }
    await copy(url, 'Invite link');
  };

  const now = Date.now();
  return (
    <Sheet label="Invites" onClose={onClose} fit>
      <SheetHead title="Invites" />
      <SheetBody last>
        <div className={styles['sheetBody']}>
          <p className={styles['lead']}>Insidor is invite only. Each code lets one person in; share the link and it opens with your code filled in.</p>
          {mine === 'loading' ? <p className={styles['empty']}>Loading your codes</p> : null}
          {mine === 'failed' ? <p className={styles['empty']}>Your codes couldn't be read just now. Close and open again.</p> : null}
          {typeof mine === 'object' ? (
            <>
              <h3 className={styles['section']}>Your codes</h3>
              {mine.codes.map((c) => (
                <div key={c.code} className={`${styles['codeRow']} ${c.used ? styles['codeUsed'] : ''}`}>
                  <span className={styles['codeText']}>{c.code}</span>
                  {c.used ? (
                    <span className={styles['usedTag']}>Used</span>
                  ) : (
                    <>
                      <button type="button" className={styles['iconButton']} aria-label={`Copy code ${c.code}`} onClick={() => void copy(c.code, 'Code')}>
                        <CopyIcon size={16} />
                      </button>
                      <button type="button" className={styles['iconButton']} aria-label={`Share code ${c.code}`} onClick={() => void share(c.code)}>
                        <ShareIcon size={16} />
                      </button>
                    </>
                  )}
                </div>
              ))}
              <h3 className={styles['section']}>Joined with your codes</h3>
              {mine.joined.length === 0 ? <p className={styles['empty']}>Nobody yet. When someone joins with one of your codes, they show here.</p> : null}
              {mine.joined.map((j) => (
                <a key={j.userId} className={styles['person']} href={hrefFor({ screen: 'profile', key: j.handle ?? j.userId })} onClick={onClose}>
                  <Avatar name={j.handle ?? j.name} seed={j.userId} src={j.pictureUrl} size={36} />
                  <span className={styles['personText']}>
                    <b>{j.name ?? (j.handle !== null ? `@${j.handle}` : 'A member')}</b>
                    {j.handle !== null ? <span>@{j.handle}</span> : null}
                  </span>
                  <span className={styles['when']}>{agoOf(j.at, now)}</span>
                </a>
              ))}
            </>
          ) : null}
        </div>
      </SheetBody>
    </Sheet>
  );
}
