/**
 * SEND: SOL or a coin to an address — built unsigned and simulated by the trade service, signed in
 * the person's wallet only if the simulation passed. Shown only when the build has TRADING on.
 */

import { useState } from 'react';

import { buildTransfer, type Holding } from '../../shared/api/index.ts';
import { useWallet } from '../../shared/wallet.tsx';
import { Button } from '../../shared/ui/Button.tsx';
import { Modal } from '../../shared/ui/Modal.tsx';
import { confirmBuilt, fromBase64, toBaseUnits, type ConfirmOutcome } from '../trade/order-flow.ts';
import styles from './send.module.css';

const SOL_DECIMALS = 9;

export function SendSheet({ holdings, onClose }: { holdings: readonly Holding[]; onClose: () => void }) {
  const { wallet, state } = useWallet();
  const [asset, setAsset] = useState<string>('SOL');
  const [to, setTo] = useState('');
  const [text, setText] = useState('');
  const [outcome, setOutcome] = useState<ConfirmOutcome | 'working' | null>(null);
  const coin = holdings.find((h) => h.address === asset) ?? null;
  const amount = toBaseUnits(text, coin === null ? SOL_DECIMALS : coin.decimals);

  if (state.kind !== 'connected' || wallet === null) return null;
  const from = state.account;
  const send = async (base: bigint) => {
    setOutcome('working');
    try {
      setOutcome(await confirmBuilt(() => buildTransfer({ wallet: from, to: to.trim(), mint: coin === null ? null : coin.address, amount: base.toString() }), { signAndSend: (p) => wallet.signAndSendTransaction(p), decode: fromBase64 }));
    } catch {
      setOutcome({ kind: 'failed' });
    }
  };

  return (
    <Modal title="Send" onClose={onClose}>
      {outcome !== null && outcome !== 'working' ? (
        <p className={styles['line']}>
          {outcome.kind === 'sent' ? <a className={styles['link']} href={`https://solscan.io/tx/${outcome.ref}`} target="_blank" rel="noopener noreferrer">Sent. See the transaction</a>
            : outcome.kind === 'blocked' ? `Nothing was signed. ${outcome.why}`
            : outcome.kind === 'refused' ? 'You declined in your wallet. Nothing was sent.'
            : outcome.kind === 'not-sent' ? outcome.why
            : 'Something went wrong signing. Nothing was sent.'}
        </p>
      ) : (
        <div className={styles['form']}>
          <label className={styles['kicker']} htmlFor="send-asset">What</label>
          <select id="send-asset" className={styles['input']} value={asset} onChange={(e) => setAsset(e.target.value)}>
            <option value="SOL">SOL</option>
            {holdings.map((h) => <option key={h.address} value={h.address}>{h.ticker ?? h.address.slice(0, 6)}</option>)}
          </select>
          <label className={styles['kicker']} htmlFor="send-to">To</label>
          <input id="send-to" className={styles['input']} autoComplete="off" spellCheck={false} placeholder="Solana address" value={to} onChange={(e) => setTo(e.target.value)} />
          <label className={styles['kicker']} htmlFor="send-amount">Amount</label>
          <input id="send-amount" className={styles['input']} inputMode="decimal" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)} />
          {coin !== null ? <p className={styles['line']}>Sending a coin to someone who never held it also pays about 0.002 SOL to open their account.</p> : null}
          {amount !== null && to.trim() !== '' && outcome === null ? <Button look="primary" size="large" onClick={() => void send(amount)}>Check and send</Button> : null}
          {outcome === 'working' ? <p className={styles['line']}>Checking the transfer, then asking your wallet to sign.</p> : null}
        </div>
      )}
    </Modal>
  );
}
