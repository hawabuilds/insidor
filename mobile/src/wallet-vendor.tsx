/**
 * THE WALLET VENDOR'S PART OF THE APP, LOADED ON ITS OWN after the first paint (main.tsx). It is
 * most of the app's code by weight (the vendor's SDK and the chain libraries under it), and none
 * of For You, Narratives or a story needs it to draw. Here it renders the vendor's provider, which
 * restores a session, opens the sign-in and signs, and draws the key import box where the Import
 * screen marked its place (shared/wallet-slot.tsx).
 *
 * Drawn beside the app, not around it, so its arrival changes nothing already on screen. What
 * breaks if changed carelessly: a static import of '@insidor/wallet-embedded' anywhere the first
 * paint reaches puts all of it back on the critical path.
 */

import { createPortal } from 'react-dom';

import { EmbeddedWalletProvider, KeyImport, type Bridge } from '@insidor/wallet-embedded';

import { useKeyImportSlot } from './shared/wallet-slot.tsx';

export default function WalletVendor({ appId, bridge }: { appId: string; bridge: Bridge }) {
  const slot = useKeyImportSlot();
  return (
    <EmbeddedWalletProvider appId={appId} bridge={bridge}>
      {slot !== null ? createPortal(<KeyImport onDone={slot.props.onDone} classes={slot.props.classes ?? {}} />, slot.node) : null}
    </EmbeddedWalletProvider>
  );
}
