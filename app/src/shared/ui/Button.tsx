/**
 * A button.
 *
 * Note what is absent: there is no `disabled` prop.
 *
 * That is deliberate and it is a product rule, not an oversight. On the board, the case
 * where an affordance is unavailable is "we are not sure which coin this is" — and a
 * disabled button says "this exists and you may not have it", which invites the user to
 * wait for it to light up. The honest render of not knowing is no button and a line of text.
 * Removing the prop removes the temptation.
 *
 * A form submit that must be blocked while in flight uses `busy`, which keeps the button
 * pressable-looking but stops the second click.
 */

import type { MouseEventHandler, ReactNode } from 'react';
import styles from './primitives.module.css';

export type ButtonTone = 'primary' | 'default' | 'quiet';

export function Button({
  tone = 'default',
  busy = false,
  onClick,
  children,
}: {
  tone?: ButtonTone;
  busy?: boolean;
  onClick: MouseEventHandler<HTMLButtonElement>;
  children: ReactNode;
}) {
  const toneClass =
    tone === 'primary' ? styles['buttonPrimary'] : tone === 'quiet' ? styles['buttonQuiet'] : '';
  return (
    <button
      type="button"
      className={`${styles['button']} ${toneClass}`}
      aria-busy={busy}
      onClick={busy ? undefined : onClick}
    >
      {children}
    </button>
  );
}
