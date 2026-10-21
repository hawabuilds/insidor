/**
 * THE INVITE CODE BOX at the door and on the waitlist, and the line saying who the code is from:
 * "@inviter invited you" with the inviter's picture, or the partner's name for a partner code.
 *
 * The code is checked as it is typed (a moment after the last key, open to anyone signed in or
 * not), and the box says what the server said: who it is from, used up, or not a code we know.
 * A check that could not be made says nothing, rather than calling a good code bad.
 *
 * Its own file because the door (features/landing/Landing.tsx) and the waitlist (Waitlist.tsx)
 * both hold one, and both must check a code the same way.
 *
 * What breaks if changed carelessly: the answer is kept only for the code it was asked about, so a
 * slow answer for "SUPER" cannot be shown under "SUPERTEAMUK".
 */

import { useEffect, useState } from 'react';

import { checkCode, type CodeCheck, type InviteFrom } from '../../shared/api/invites.ts';
import { Avatar } from '../portfolio/Avatar.tsx';
import { cleanCode } from './invite-code.ts';
import styles from './invites.module.css';

const CHECK_AFTER_MS = 350;

/** The server's answer for the code now in the box; null while unasked or when it could not be asked. */
export function useCodeCheck(code: string): CodeCheck | null {
  const [answer, setAnswer] = useState<{ readonly for: string; readonly check: CodeCheck } | null>(null);
  const clean = cleanCode(code);
  useEffect(() => {
    if (clean === null) return;
    let live = true;
    const t = setTimeout(() => {
      checkCode(clean).then(
        (check) => live && setAnswer({ for: clean, check }),
        () => undefined,
      );
    }, CHECK_AFTER_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [clean]);
  return clean !== null && answer?.for === clean ? answer.check : null;
}

export function CodeBox({ value, onChange, check, problem }: {
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly check: CodeCheck | null;
  /** A refusal from bringing the code, shown in place of the check's line. */
  readonly problem?: string | null;
}) {
  const line = problem ?? (check?.state === 'used_up' ? 'This code has been used. Ask for another, or join the waitlist.' : check?.state === 'unknown' ? "That isn't a code we know." : null);
  return (
    <div className={styles['codeWrap']}>
      {check?.state === 'valid' && check.from !== null ? <InvitedBy from={check.from} /> : null}
      <input
        className={`${styles['code']} ${check?.state === 'valid' ? styles['codeOk'] : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        placeholder="Invite code"
        aria-label="Invite code"
        autoCapitalize="characters"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        maxLength={40}
        enterKeyHint="go"
      />
      {line !== null ? <p className={styles['codeLine']} role="status">{line}</p> : null}
    </div>
  );
}

/** "@inviter invited you", with their picture; a partner code says the partner's name. */
export function InvitedBy({ from }: { readonly from: InviteFrom }) {
  if (from.kind === 'partner') {
    return (
      <p className={styles['invitedBy']}>
        <b>{from.label}</b> invited you
      </p>
    );
  }
  const who = from.handle !== null ? `@${from.handle}` : (from.name ?? 'A member');
  return (
    <p className={styles['invitedBy']}>
      <Avatar name={from.handle ?? from.name} seed={from.userId || who} src={from.pictureUrl} size={24} />
      <span>
        <b>{who}</b> invited you
      </span>
    </p>
  );
}
