/**
 * THE OWNER'S TOOLS, from the profile menu (the owner only): Add missed posts, and the invites —
 * members, the waitlist, codes out and used, top inviters with their pictures, partner codes and
 * how many joined with each — with the three controls: let the next people in from the waitlist,
 * give everyone more codes, and make a partner code.
 *
 * The server decides who the owner is (services/social, GET/POST /owner/invites, 403 to anyone
 * else); this sheet is only drawn where the app was told it is the owner. Each control answers
 * with the numbers after it, so what is on screen is what the database now holds.
 *
 * What breaks if changed carelessly: the numbers typed are sent as whole numbers or not at all.
 * A control with nothing typed says so rather than sending a zero the server would refuse.
 */

import { useEffect, useState } from 'react';

import { fetchInviteStats, giveEveryone, letInNext, makePartnerCode, type InviteStats } from '../../shared/api/invites.ts';
import { PeopleError } from '../../shared/api/people.ts';
import { hrefFor } from '../../shared/route.ts';
import { PlusIcon } from '../../shared/ui/icons.tsx';
import { Sheet, SheetBody, SheetHead } from '../../shared/ui/Sheet.tsx';
import { Avatar } from '../portfolio/Avatar.tsx';
import { cleanCode } from './invite-code.ts';
import styles from './invites.module.css';

const whole = (v: string): number | null => (/^\d{1,5}$/.test(v.trim()) && Number(v) >= 1 ? Number(v) : null);
const said = (e: unknown): string => (e instanceof PeopleError ? e.message : "That didn't go through. Try again.");

export function OwnerToolsSheet({ onClose, onMissed }: { readonly onClose: () => void; readonly onMissed: () => void }) {
  const [stats, setStats] = useState<InviteStats | 'loading' | string>('loading');
  const [note, setNote] = useState<string | null>(null);
  const [letIn, setLetIn] = useState('');
  const [give, setGive] = useState('');
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [uses, setUses] = useState('');

  useEffect(() => {
    let live = true;
    fetchInviteStats().then((s) => live && setStats(s), (e: unknown) => live && setStats(said(e)));
    return () => {
      live = false;
    };
  }, []);

  const run = async (what: () => Promise<InviteStats>, done: string) => {
    try {
      setStats(await what());
      setNote(done);
    } catch (e) {
      setNote(said(e));
    }
  };

  return (
    <Sheet label="Owner tools" onClose={onClose} fit>
      <SheetHead title="Owner tools" />
      <SheetBody last>
        <div className={styles['sheetBody']}>
          <button
            type="button"
            className={styles['ownerRow']}
            onClick={() => {
              onClose();
              onMissed();
            }}
          >
            <PlusIcon size={16} /> Add missed posts
          </button>

          <h3 className={styles['section']}>Invites</h3>
          {stats === 'loading' ? <p className={styles['empty']}>Loading the numbers</p> : null}
          {typeof stats === 'string' && stats !== 'loading' ? <p className={styles['empty']}>{stats}</p> : null}
          {typeof stats === 'object' ? (
            <>
              <div className={styles['facts']}>
                <Fact n={stats.members} label="Members" />
                <Fact n={stats.waiting} label="On the waitlist" />
                <Fact n={stats.memberCodes.allowed} label={`Codes out (${stats.perMember} each)`} />
                <Fact n={stats.memberCodes.used} label={stats.memberCodes.made > 0 ? `Used, of ${stats.memberCodes.made} made (${Math.round((stats.memberCodes.used / stats.memberCodes.made) * 100)}%)` : 'Used'} />
                <Fact n={stats.joinedWithCode} label="Joined with a code" />
                <Fact n={stats.letInFromWaitlist} label="Let in from the waitlist" />
              </div>

              <h3 className={styles['section']}>Let in from the waitlist</h3>
              <div className={styles['control']}>
                <input inputMode="numeric" placeholder="How many" value={letIn} onChange={(e) => setLetIn(e.target.value)} aria-label="How many to let in" />
                <button
                  type="button"
                  onClick={() => {
                    const n = whole(letIn);
                    if (n === null) return setNote('Type how many to let in.');
                    void run(() => letInNext(n), `Let in the next ${n}.`);
                  }}
                >
                  Let in next
                </button>
              </div>

              <h3 className={styles['section']}>Give everyone more codes</h3>
              <div className={styles['control']}>
                <input inputMode="numeric" placeholder="Codes each" value={give} onChange={(e) => setGive(e.target.value)} aria-label="Codes to give each member" />
                <button
                  type="button"
                  onClick={() => {
                    const n = whole(give);
                    if (n === null) return setNote('Type how many codes to give each member.');
                    void run(() => giveEveryone(n), `Every member got ${n} more.`);
                  }}
                >
                  Give +{whole(give) ?? 'N'}
                </button>
              </div>

              <h3 className={styles['section']}>New partner code</h3>
              <div className={styles['control']}>
                <input placeholder="Code, e.g. SUPERTEAMUK" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Partner code" autoCapitalize="characters" />
              </div>
              <div className={styles['control']}>
                <input placeholder="Partner name on the door" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Partner name" />
                <input inputMode="numeric" placeholder="Uses" value={uses} onChange={(e) => setUses(e.target.value)} aria-label="How many times it works" style={{ maxWidth: 72 }} />
              </div>
              <div className={styles['control']}>
                <button
                  type="button"
                  className={styles['primary']}
                  style={{ flex: 1 }}
                  onClick={() => {
                    const c = cleanCode(code);
                    const n = whole(uses);
                    if (c === null) return setNote('A code is 4 to 32 letters and numbers.');
                    if (label.trim() === '') return setNote('Name the partner as the door should show it.');
                    /* Empty is the server's default cap; anything typed must be a whole number. */
                    if (uses.trim() !== '' && n === null) return setNote('Type how many times the code works, or leave it empty for the usual cap.');
                    void run(() => makePartnerCode({ code: c, label: label.trim(), maxUses: n }), `${c} is live.`);
                  }}
                >
                  Make partner code
                </button>
              </div>
              {note !== null ? <p className={styles['note']} role="status">{note}</p> : null}

              <h3 className={styles['section']}>Partner codes</h3>
              {stats.partners.length === 0 ? <p className={styles['empty']}>None yet.</p> : null}
              {stats.partners.map((p) => (
                <div key={p.code} className={styles['codeRow']}>
                  <span className={styles['personText']}>
                    <b>{p.label}</b>
                    <span>{p.code}</span>
                  </span>
                  <span className={styles['when']}>{p.uses} of {p.maxUses} joined</span>
                </div>
              ))}

              <h3 className={styles['section']}>Top inviters</h3>
              {stats.topInviters.length === 0 ? <p className={styles['empty']}>Nobody has brought anyone in yet.</p> : null}
              {stats.topInviters.map((t) => (
                <a key={t.userId} className={styles['person']} href={hrefFor({ screen: 'profile', key: t.handle ?? t.userId })} onClick={onClose}>
                  <Avatar name={t.handle ?? t.name} seed={t.userId} src={t.pictureUrl} size={32} />
                  <span className={styles['personText']}>
                    <b>{t.handle !== null ? `@${t.handle}` : (t.name ?? 'A member')}</b>
                  </span>
                  <span className={styles['when']}>{t.joined} joined</span>
                </a>
              ))}
            </>
          ) : null}
        </div>
      </SheetBody>
    </Sheet>
  );
}

function Fact({ n, label }: { readonly n: number; readonly label: string }) {
  return (
    <div className={styles['fact']}>
      <b>{n.toLocaleString('en-GB')}</b>
      <span>{label}</span>
    </div>
  );
}
