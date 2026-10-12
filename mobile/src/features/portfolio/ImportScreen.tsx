/**
 * IMPORT A WALLET — a clear warning first, then a box whose contents go straight into the sign-in
 * provider's own wallet SDK on this phone (@insidor/wallet-embedded KeyImport). Insidor's servers
 * never receive the key; it is not stored, logged or kept in the app's state, and the box empties
 * the moment the import ends or is cancelled.
 */

import { useState } from 'react';

import { KeyImport } from '@insidor/wallet-embedded';

import { SIGN_IN_CONFIGURED } from '../../shared/sign-in.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { BackIcon } from '../../shared/ui/icons.tsx';
import { useWallet } from '../../shared/wallet.tsx';
import box from './wallet.module.css';

export function ImportScreen() {
  const { state } = useWallet();
  const toast = useToast();
  const [understood, setUnderstood] = useState(false);
  const ready = SIGN_IN_CONFIGURED && state.kind === 'connected';

  return (
    <section className={box['page']}>
      <button type="button" className={box['back']} aria-label="Back" onClick={() => window.history.back()}>
        <BackIcon size={22} />
      </button>
      <h1 className={box['title']}>Import a wallet</h1>
      <div className={box['warning']} role="note">
        <b>Read this first</b>
        <ul>
          <li>Anyone with a private key controls that wallet and everything in it.</li>
          <li>The key goes from this box straight into your sign-in provider's secure wallet, on this phone. Insidor's servers never receive it, and it is never stored or logged by Insidor.</li>
          <li>Only import a wallet you own. Nobody from Insidor will ever ask you for a key.</li>
        </ul>
      </div>
      {!ready ? (
        <p className={box['note']}>{SIGN_IN_CONFIGURED ? 'Sign in first to import a wallet.' : 'Sample data: this build has no sign-in, so there is nowhere to import a wallet into.'}</p>
      ) : !understood ? (
        <button type="button" className={box['linkButton']} onClick={() => setUnderstood(true)}>I understand, continue</button>
      ) : (
        <KeyImport
          classes={{ field: box['keyField'], primary: box['linkButton'], secondary: box['quietButton'], row: box['keyRow'] }}
          onDone={(outcome) => {
            setUnderstood(false);
            if (outcome === 'imported') toast('Wallet imported', 'It is in your sign-in wallet now.');
            else if (outcome === 'failed') toast("Couldn't import", 'Check the key and try again.');
          }}
        />
      )}
    </section>
  );
}
