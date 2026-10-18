/**
 * RECEIVE — Trador's Receive sheet, opened from the QR button on the Portfolio: the address as a QR
 * code another wallet's camera can read, the address whole, and a copy button.
 *
 * The QR code is drawn by our own encoder (qr.ts, held against an independent one by qr.test.ts):
 * the phone app takes no third-party package beyond the embedded wallet. Drawn as SVG squares with
 * the standard four-module quiet zone, dark on white whatever the theme, since cameras need it so.
 */

import { useMemo, useState } from 'react';

import { Button } from '../../shared/ui/Button.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { qrMatrix } from './qr.ts';
import styles from './portfolio.module.css';

/** The standard's quiet zone, in modules, on every side. */
const QUIET = 4;

export function QrCode({ text, label }: { text: string; label: string }) {
  const m = useMemo(() => qrMatrix(text), [text]);
  if (m === null) return null;
  const size = m.length + QUIET * 2;
  const path = m.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x + QUIET} ${y + QUIET}h1v1h-1z`] : []))).join('');
  return (
    <svg className={styles['qr']} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

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
        <QrCode text={address} label={`QR code for ${address}`} />
        <p className={styles['sheetNote']}>Send SOL to this address on Solana mainnet.</p>
        <div className={styles['addressBox']}>{address}</div>
        <Button look="primary" size="large" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy address'}</Button>
      </div>
    </Modal>
  );
}
