/**
 * The phone app's buttons. Four looks, and which one is a statement:
 *
 *   primary  blue   — every action that is not a trade
 *   buy      green  — buying, and only buying (tokens.css, rule 1)
 *   sell     red    — selling, as a wash with red text, never a red fill
 *   quiet    grey   — reading: "View coins", "Make a call"
 *
 * There is no `disabled` look. A button that cannot be used is not rendered; a disabled one
 * says "this exists but you may not have it" and invites waiting for it.
 */

import type { ButtonHTMLAttributes } from 'react';
import styles from './ui.module.css';

export type ButtonLook = 'primary' | 'buy' | 'sell' | 'quiet';

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
