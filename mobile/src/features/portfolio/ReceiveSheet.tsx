/**
 * RECEIVE — Trador's Receive sheet, opened from the QR button on the Portfolio and from every
 * Deposit button: the address as a QR code another wallet's camera can read, the address whole,
 * and a copy button. A row of chains above it: Solana is the wallet's own address; every other
 * chain is a fixed address from Aurora Intents that pays out as SOL into this same wallet
 * (services/read/src/deposits.ts), with what has arrived through it shown underneath.
 *
 * The QR code is drawn by our own encoder (qr.ts, held against an independent one by qr.test.ts):
 * the phone app takes no third-party package beyond the embedded wallet. Drawn as SVG squares with
 * the standard four-module quiet zone, dark on white whatever the theme, since cameras need it so.
 *
 * ★ SOLANA NEEDS NO ONE. The Solana tab is the wallet's own address and asks no server, so the
 * sheet works exactly as before when the other chains are switched off or Aurora is down.
 *
 * ★ NO ADDRESS WITHOUT ONE FROM THE SERVER. While loading, after a failure, or when deposits from
 * other chains are not open, the sheet says so in words and shows no QR code at all.
 */

import { useEffect, useMemo, useState } from 'react';

import { Button } from '../../shared/ui/Button.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { useLoad } from '../../shared/hooks.ts';
import { fetchDepositAddress, fetchDepositArrivals } from '../../shared/api/client.ts';
import type { Arrival, DepositChain } from '../../shared/api/deposits.ts';
import { qrMatrix } from './qr.ts';
import styles from './portfolio.module.css';

/** The standard's quiet zone, in modules, on every side. */
const QUIET = 4;
const ARRIVALS_EVERY_MS = 8_000;

type Chain = 'sol' | DepositChain;
const CHAINS: readonly { readonly id: Chain; readonly name: string; readonly on: string }[] = [
  { id: 'sol', name: 'Solana', on: 'Solana' },
  { id: 'evm', name: 'Ethereum & EVM', on: 'Ethereum, Base, Arbitrum, BNB Chain, Polygon, Optimism or Avalanche' },
  { id: 'btc', name: 'Bitcoin', on: 'Bitcoin' },
  { id: 'tron', name: 'Tron', on: 'Tron' },
  { id: 'ton', name: 'TON', on: 'TON' },
  { id: 'sui', name: 'Sui', on: 'Sui' },
  { id: 'near', name: 'NEAR', on: 'NEAR' },
  { id: 'xrp', name: 'XRP', on: 'the XRP Ledger' },
  { id: 'doge', name: 'Dogecoin', on: 'Dogecoin' },
  { id: 'ltc', name: 'Litecoin', on: 'Litecoin' },
];

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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };
  return <Button look="primary" size="large" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy address'}</Button>;
}

const amount = (n: number): string => n.toLocaleString('en-US', { maximumSignificantDigits: 4 });

function ArrivalRow({ a }: { a: Arrival }) {
  const sent = `${a.sentAmount !== null ? `${amount(a.sentAmount)} ` : ''}${a.sentCoin ?? 'Deposit'}`;
  return (
    <div className={styles['arrival']}>
      <span className={`${styles['arrivalDot']} ${a.state === 'arrived' ? styles['arrivalDone'] : a.state === 'failed' ? styles['arrivalFailed'] : styles['arrivalWorking']}`} aria-hidden="true" />
      <span className={styles['arrivalWhat']}>{sent}{a.state === 'arrived' && a.gotSol !== null ? ` → ${amount(a.gotSol)} SOL` : ''}</span>
      <span className={`${styles['arrivalState']} ${a.state === 'arrived' ? styles['upInline'] : a.state === 'failed' ? styles['downInline'] : ''}`}>
        {a.state === 'arrived' ? 'In your wallet' : a.state === 'failed' ? "Didn't go through" : 'Swapping to SOL'}
      </span>
    </div>
  );
}

function Arrivals({ wallet, address }: { wallet: string; address: string }) {
  const [list, setList] = useState<readonly Arrival[] | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    const tick = () => fetchDepositArrivals(wallet, address, ac.signal).then((r) => { if (r.kind === 'read') setList(r.arrivals); }, () => undefined);
    void tick();
    const id = window.setInterval(() => void tick(), ARRIVALS_EVERY_MS);
    return () => { ac.abort(); window.clearInterval(id); };
  }, [wallet, address]);
  if (list === null || list.length === 0) return <p className={styles['sheetNote']}>Waiting for your deposit. It shows here as soon as it's seen.</p>;
  return <div className={styles['arrivals']}>{list.slice(0, 4).map((a) => <ArrivalRow key={a.txHash} a={a} />)}</div>;
}

function OtherChain({ wallet, chain }: { wallet: string; chain: (typeof CHAINS)[number] & { id: DepositChain } }) {
  const [load, reload] = useLoad(`deposit:${wallet}:${chain.id}`, (signal) => fetchDepositAddress(wallet, chain.id, signal));
  if (load.state === 'loading') return <p className={styles['sheetNote']}>Getting your {chain.name} address…</p>;
  if (load.state === 'failed') {
    return (
      <>
        <p className={styles['sheetNote']}>Couldn't get your {chain.name} address.</p>
        <Button look="quiet" size="large" onClick={reload}>Try again</Button>
      </>
    );
  }
  const d = load.value;
  if (d.kind === 'missing') {
    if (d.why === 'not_configured' || d.why === 'not_approved') return <p className={styles['sheetNote']}>Deposits from {chain.name} aren't open yet. Send SOL on Solana for now.</p>;
    return (
      <>
        <p className={styles['sheetNote']}>{d.why === 'busy' ? 'Too many requests right now. Try again in a minute.' : `Couldn't get your ${chain.name} address.`}</p>
        <Button look="quiet" size="large" onClick={reload}>Try again</Button>
      </>
    );
  }
  const coins = d.coins !== null && d.coins.length > 0 ? new Intl.ListFormat('en', { type: 'disjunction' }).format(d.coins) : 'a supported coin';
  return (
    <>
      <QrCode text={d.address} label={`QR code for your ${chain.name} deposit address`} />
      <p className={styles['sheetNote']}>Send {coins} on {chain.on}. It arrives in your wallet as SOL.</p>
      <div className={styles['addressBox']}>{d.address}</div>
      <CopyButton text={d.address} />
      <Arrivals wallet={wallet} address={d.address} />
    </>
  );
}

export function ReceiveSheet({ address, onClose }: { address: string; onClose: () => void }) {
  const [chainId, setChainId] = useState<Chain>('sol');
  const chain = CHAINS.find((c) => c.id === chainId) ?? CHAINS[0]!;
  return (
    <Modal title="Receive" onClose={onClose}>
      <div className={styles['sheet']}>
        <div className={styles['chainRow']} role="tablist" aria-label="Chain to send from">
          {CHAINS.map((c) => (
            <button key={c.id} type="button" role="tab" aria-selected={c.id === chainId} className={`${styles['chainChip']} ${c.id === chainId ? styles['chainChipOn'] : ''}`} onClick={() => setChainId(c.id)}>
              {c.name}
            </button>
          ))}
        </div>
        {chain.id === 'sol' ? (
          <>
            <QrCode text={address} label={`QR code for ${address}`} />
            <p className={styles['sheetNote']}>Send SOL to this address on Solana mainnet.</p>
            <div className={styles['addressBox']}>{address}</div>
            <CopyButton text={address} />
          </>
        ) : (
          <OtherChain key={chain.id} wallet={address} chain={chain as (typeof CHAINS)[number] & { id: DepositChain }} />
        )}
      </div>
    </Modal>
  );
}
