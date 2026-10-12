/**
 * RECEIVE — Trador's Receive sheet: the address, whole, and a copy button. Trador also draws a
 * QR code; the phone app takes no third-party package beyond the embedded wallet
 * (wallet/src/dependency-graph.test.ts), so there is none here yet.
 */

import { useState } from 'react';

import { Button } from '../../shared/ui/Button.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import styles from './portfolio.module.css';

export function ReceiveSheet({ address, onClose }: { address: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return (
    <Modal title="Receive" onClose={onClose}>
      <div className={styles['sheet']}>
        <p className={styles['sheetNote']}>Send SOL to this address on Solana mainnet.</p>
        <div className={styles['addressBox']}>{address}</div>
        <Button look="primary" size="large" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy address'}</Button>
      </div>
    </Modal>
  );
}
