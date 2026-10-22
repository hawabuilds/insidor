/**
 * The phone app's buttons. Five looks, and which one is a statement:
 *
 *   primary  purple — the screen's one main action (tokens.css: purple is that and little else)
 *   buy      green  — buying, and only buying (tokens.css, rule 1)
 *   sell     red    — selling, as a wash with red text, never a red fill
 *   quiet    grey   — reading: "View coins", "Make a call"
 *   link     text   — the second action under a main button: plain words, never a second fill
 *
 * `large` is the approved main button (56px, 17px corners, 700 at 17px), pinned at the bottom of
 * a sheet or screen where the thumb is; a screen with a large primary puts its other choice under
 * it as a `link`, not beside it as another filled button.
 *
 * There is no `disabled` look. A button that cannot be used is not rendered; a disabled one
 * says "this exists but you may not have it" and invites waiting for it.
 */

import type { ButtonHTMLAttributes } from 'react';
import styles from './ui.module.css';

export type ButtonLook = 'primary' | 'buy' | 'sell' | 'quiet' | 'link';

export function Button({
  look,
  size = 'small',
  className,
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled'> & {
  look: ButtonLook;
  size?: 'small' | 'large';
}) {
  return (
    <button
      type="button"
      className={`${styles['button']} ${styles[look]} ${styles[size]} ${className ?? ''}`}
      {...rest}
    />
  );
}
