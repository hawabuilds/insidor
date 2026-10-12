/**
 * The import box: an uncontrolled password field, so the key is never React state, and two
 * buttons. Rendered by the phone app's Import screen after its warning; the key goes from this
 * field to the vendor's SDK through `runKeyImport` and nowhere else.
 *
 * ★ NO AUTOFILL, NO KEEPING. Autocomplete, autocorrect and password managers are told off; the
 * field is emptied on import, on cancel and when the screen closes.
 */

import { useImportWallet } from '@privy-io/react-auth/solana';
import { useEffect, useRef, useState } from 'react';

import { runKeyImport } from './key-import.ts';

export interface KeyImportClasses {
  readonly field?: string | undefined;
  readonly primary?: string | undefined;
  readonly secondary?: string | undefined;
  readonly row?: string | undefined;
}

export function KeyImport({ onDone, classes = {} }: { onDone: (outcome: 'imported' | 'cancelled' | 'failed') => void; classes?: KeyImportClasses }) {
  const box = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const { importWallet } = useImportWallet();

  useEffect(() => {
    const field = box.current;
    return () => {
      if (field !== null) field.value = '';
    };
  }, []);

  const submit = async () => {
    const field = box.current;
    if (field === null || busy) return;
    setBusy(true);
    const outcome = await runKeyImport(field, importWallet);
    setBusy(false);
    onDone(outcome === 'empty' ? 'cancelled' : outcome);
  };

  const cancel = () => {
    if (box.current !== null) box.current.value = '';
    onDone('cancelled');
  };

  return (
    <form
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        ref={box}
        className={classes.field}
        type="password"
        name="insidor-wallet-import"
        aria-label="Private key"
        placeholder="Paste the private key"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        data-form-type="other"
      />
      <div className={classes.row}>
        <button type="button" className={classes.secondary} onClick={cancel}>Cancel</button>
        {busy ? <span className={classes.secondary}>Importing</span> : <button type="submit" className={classes.primary}>Import</button>}
      </div>
    </form>
  );
}
