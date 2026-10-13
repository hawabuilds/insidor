/**
 * FEED SETTINGS (once Alert settings) — Trador's NotificationSettings, with Insidor's kinds and the
 * hourly limit it lacked: this phone's push switch, mute, one switch per kind of alert, the multiples that count,
 * quiet hours, pushes per hour, and the Add to Home Screen guide where the phone needs it.
 *
 * ★ THE SERVER'S STATE IS SAID, NOT HIDDEN. If the alert service has push off (NOTIFY) or no keys,
 * the screen says alerts are listed but not pushed, instead of offering a switch that does nothing.
 * ★ NO DISABLED CONTROLS. While muted, the switches stay usable and a line says nothing is sent.
 *
 * It opens as Trador's does, in a sheet over Notifications (the gear there), rather than as a page;
 * the content stays Insidor's, which is Trador's plus the hourly limit and Insidor's own kinds.
 */

import { useEffect, useState } from 'react';

import { fetchAlertSettings, saveAlertPrefs, sendTestPush, type AlertPrefs, type AlertSettings as Settings, type AlertSwitch } from '../../shared/api/people.ts';
import { useLoad } from '../../shared/hooks.ts';
import { useToast } from '../../shared/ui/ComingSoon.tsx';
import { CloseIcon } from '../../shared/ui/icons.tsx';
import { currentPush, disablePush, enablePush, pushPlace } from './push.ts';
import styles from './alerts.module.css';

const ROWS: readonly { readonly key: AlertSwitch; readonly label: string; readonly hint: string }[] = [
  { key: 'rising', label: 'Rising posts', hint: 'A post taking off right now, as the feed sees it.' },
  { key: 'narratives', label: 'New narratives', hint: 'When a narrative reaches the board, and when one gets its first coin.' },
  { key: 'coins', label: 'Coins for what you watch', hint: 'When a coin is matched to a narrative you starred, or proven from a post you put the bell on.' },
  { key: 'holdings', label: 'Your holdings', hint: 'When a coin you hold reaches a multiple of what you paid.' },
  { key: 'watchlist', label: 'Your watchlist', hint: 'When a coin of a narrative you watch reaches a multiple. Off to start: a watchlist is for browsing.' },
  { key: 'graduations', label: 'Graduations', hint: 'When a coin you hold or watch is close to finishing its curve, and when it does.' },
  { key: 'follows', label: 'New followers', hint: '' },
  { key: 'replies', label: 'Replies to your comments', hint: '' },
  { key: 'useful', label: 'Comments found useful', hint: 'When holders of a coin like a comment of yours.' },
];

function Switch({ on, label, onChange }: { on: boolean; label: string; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`${styles['switch']} ${on ? styles['switchOn'] : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

/**
 * Feed settings as Trador shows its notification settings: a sheet over Notifications, titled,
 * with a close button, the settings in one card. Escape and a tap on the scrim close it too.
 */
export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const [loaded] = useLoad('alert-settings', () => fetchAlertSettings());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={styles['scrim']} onClick={onClose}>
      <div className={styles['sheet']} role="dialog" aria-modal="true" aria-label="Feed settings" onClick={(e) => e.stopPropagation()}>
        <div className={styles['sheetHead']}>
          <h2 className={styles['sheetTitle']}>Feed settings</h2>
          <button type="button" className={styles['sheetClose']} aria-label="Close" onClick={onClose}>
            <CloseIcon size={16} />
          </button>
        </div>
        {loaded.state === 'loading' ? <p className={styles['sheetNote']}>Loading</p> : null}
        {loaded.state === 'failed' ? <p className={styles['sheetNote']}>Your settings couldn't be read just now.</p> : null}
        {loaded.state === 'ready' ? <Body initial={loaded.value} /> : null}
      </div>
    </div>
  );
}

function Body({ initial }: { initial: Settings }) {
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [device, setDevice] = useState<'on' | 'off' | 'denied'>('off');
  const place = pushPlace();
  useEffect(() => {
    void currentPush().then(setDevice, () => undefined);
  }, []);
  const p = s.prefs;

  const save = async (next: AlertPrefs) => {
    setS({ ...s, prefs: next });
    try {
      setS(await saveAlertPrefs(next));
    } catch (e) {
      toast("Couldn't save that", e instanceof Error ? e.message : '');
    }
  };
  const togglePush = async (on: boolean) => {
    if (!on) {
      await disablePush();
      setDevice('off');
      return;
    }
    if (s.push.publicKey === null) return;
    const r = await enablePush(s.push.publicKey);
    setDevice(r === 'on' ? 'on' : r === 'denied' ? 'denied' : 'off');
    if (r === 'failed') toast("Couldn't turn notifications on", 'Try again in a moment.');
  };
  const test = async () => {
    const r = await sendTestPush().catch(() => ({ sent: 0, why: 'Notifications could not be reached just now.' }));
    toast(r.sent > 0 ? 'Test sent' : 'Nothing sent', r.why ?? 'Check your phone.');
  };
  const serverPush = s.push.on && s.push.configured;
  const multiple = (m: number) => {
    const has = p.multiples.includes(m);
    if (has && p.multiples.length === 1) return;
    void save({ ...p, multiples: has ? p.multiples.filter((x) => x !== m) : [...p.multiples, m].sort((a, b) => a - b) });
  };

  return (
    <>
      {place === 'needs-home-screen' ? (
        <div className={styles['guide']}>
          <b>Add Insidor to your Home Screen first</b>
          <ol>
            <li>Tap the Share button in Safari.</li>
            <li>Choose Add to Home Screen, then Add.</li>
            <li>Open Insidor from your Home Screen and come back here.</li>
          </ol>
          <span>On iPhone, Safari only delivers notifications to apps on the Home Screen.</span>
        </div>
      ) : null}
      {place === 'unsupported' ? <p className={styles['sheetNote']}>This browser can't show push notifications. Everything still lands in your feed.</p> : null}
      {!serverPush ? <p className={styles['sheetNote']}>Your feed fills in here, but this server is not sending pushes yet.</p> : null}

      {place === 'ready' && serverPush ? (
        <div className={styles['set']}>
          <div className={styles['setRow']}>
            <div>
              <b>Feed notifications</b>
              <span>{device === 'denied' ? 'Blocked in your browser settings: allow it there.' : device === 'on' ? 'This phone gets your feed notifications.' : 'Turn on feed notifications on this phone.'}</span>
            </div>
            {device !== 'denied' ? <Switch on={device === 'on'} label="Feed notifications" onChange={(on) => void togglePush(on)} /> : null}
          </div>
          {device === 'on' ? <button type="button" className={styles['link']} onClick={() => void test()}>Send a test push</button> : null}
        </div>
      ) : null}

      <div className={styles['set']}>
        <div className={styles['setRow']}>
          <div>
            <b>Mute everything</b>
            <span>{p.muted ? 'Muted: nothing is sent and nothing is listed.' : 'One switch, above all the others.'}</span>
          </div>
          <Switch on={p.muted} label="Mute everything" onChange={(muted) => void save({ ...p, muted })} />
        </div>
      </div>

      <div className={styles['set']}>
        {ROWS.map((r) => (
          <div key={r.key}>
            <div className={styles['setRow']}>
              <div>
                <b>{r.label}</b>
                {r.hint !== '' ? <span>{r.hint}</span> : null}
              </div>
              <Switch on={p.on[r.key]} label={r.label} onChange={(on) => void save({ ...p, on: { ...p.on, [r.key]: on } })} />
            </div>
            {r.key === 'holdings' ? (
              <div className={styles['chips']} role="group" aria-label="Multiples that notify you">
                {s.multiplesOffered.map((m) => (
                  <button key={m} type="button" aria-pressed={p.multiples.includes(m)} className={p.multiples.includes(m) ? styles['chipOn'] : styles['chip']} onClick={() => multiple(m)}>
                    {m}x
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className={styles['set']}>
        <div className={styles['setRow']}>
          <div>
            <b>Pushes per hour</b>
            <span>Past this, the rest wait in your feed.</span>
          </div>
          <div className={styles['stepper']}>
            {p.perHour > 1 ? <button type="button" aria-label="Fewer" onClick={() => void save({ ...p, perHour: p.perHour - 1 })}>−</button> : <span />}
            <b>{p.perHour}</b>
            {p.perHour < s.maxPerHour ? <button type="button" aria-label="More" onClick={() => void save({ ...p, perHour: p.perHour + 1 })}>+</button> : <span />}
          </div>
        </div>
        <div className={styles['setRow']}>
          <div>
            <b>Quiet hours</b>
            <span>{p.quietStart !== null && p.quietEnd !== null ? `${p.quietStart} to ${p.quietEnd}, ${p.timezone}. They land in your feed, not as pushes.` : 'Off'}</span>
          </div>
          <Switch
            on={p.quietStart !== null}
            label="Quiet hours"
            onChange={(on) => void save(on ? { ...p, quietStart: '22:00', quietEnd: '07:00', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } : { ...p, quietStart: null, quietEnd: null })}
          />
        </div>
        {p.quietStart !== null && p.quietEnd !== null ? (
          <div className={styles['times']}>
            <label>From <input type="time" value={p.quietStart} onChange={(e) => void save({ ...p, quietStart: e.target.value })} /></label>
            <label>To <input type="time" value={p.quietEnd} onChange={(e) => void save({ ...p, quietEnd: e.target.value })} /></label>
          </div>
        ) : null}
      </div>
    </>
  );
}
