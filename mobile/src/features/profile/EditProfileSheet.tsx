/**
 * EDIT PROFILE — the approved sheet: the banner with "Change banner" over it, the picture with
 * "Change picture", the name and the bio, and Save at the bottom in the thumb zone.
 *
 * ★ A PICTURE IS CHECKED ON THE PHONE AND AGAIN ON THE SERVER. The phone refuses the wrong type at
 * once and makes a big photo small (image-prep.ts); the social service checks type and size again
 * before storing it (profile-media.ts). A picture is uploaded the moment it is picked, so Save only
 * has words left to send, and a failed upload says so in the sheet without losing what was typed.
 *
 * ★ AN EMPTY NAME GOES BACK TO THE SIGN-IN'S. The service stores no name for '' and the profile
 * shows the X name again; the field says so in its placeholder rather than refusing.
 *
 * What breaks if changed carelessly: the file input must stay inside the sheet's tree. The sheet
 * closes on a tap outside it, and an input drawn elsewhere would close the sheet as it opens.
 */

import { useRef, useState } from 'react';

import { posthog } from '../../posthog.ts';
import { clearProfileImage, saveProfile, uploadProfileImage, type ProfileCard } from '../../shared/api/people.ts';
import { Sheet, SheetBody, SheetFoot, SheetHead } from '../../shared/ui/Sheet.tsx';
import { facesFileUrl } from '../../shared/ui/usePosterPic.ts';
import { Avatar } from '../portfolio/Avatar.tsx';
import { prepareImage, type ImageKind } from './image-prep.ts';
import styles from './profile.module.css';

const MAX_BIO = 160;
const MAX_NAME = 50;

export function EditProfileSheet({ card, signInName, onClose, onSaved }: {
  card: ProfileCard;
  /** The sign-in's own name, shown as the placeholder: what an empty name goes back to. */
  signInName: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(card.name ?? '');
  const [bio, setBio] = useState(card.bio);
  const [pictureFile, setPictureFile] = useState(card.pictureFile ?? null);
  const [bannerFile, setBannerFile] = useState(card.bannerFile ?? null);
  const [busy, setBusy] = useState<ImageKind | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pictureInput = useRef<HTMLInputElement>(null);
  const bannerInput = useRef<HTMLInputElement>(null);
  const bannerSrc = facesFileUrl(bannerFile);

  const pick = async (kind: ImageKind, file: File | undefined) => {
    if (file === undefined) return;
    setError(null);
    setBusy(kind);
    try {
      const prepared = await prepareImage(file, kind);
      if (!prepared.ok) {
        setError(prepared.why);
        return;
      }
      const stored = await uploadProfileImage(kind, prepared.dataUrl);
      posthog.capture('profile_image_updated', { image_kind: kind, action: 'uploaded' });
      if (kind === 'picture') setPictureFile(stored);
      else setBannerFile(stored);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That picture couldn't be saved.");
    } finally {
      setBusy(null);
    }
  };

  const clear = async (kind: ImageKind) => {
    setError(null);
    setBusy(kind);
    try {
      await clearProfileImage(kind);
      posthog.capture('profile_image_updated', { image_kind: kind, action: 'cleared' });
      if (kind === 'picture') setPictureFile(null);
      else setBannerFile(null);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That couldn't be changed.");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    setError(null);
    setBusy('save');
    try {
      await saveProfile({ name: name.trim(), bio: bio.trim() });
      posthog.capture('profile_updated', { has_name: name.trim() !== '', has_bio: bio.trim() !== '' });
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet label="Edit profile" onClose={onClose}>
      <SheetHead title="Edit profile" />
      <SheetBody>
        <div className={styles['editBanner']}>
          {bannerSrc !== null ? <img className={styles['bannerImg']} src={bannerSrc} alt="" /> : null}
          <div className={styles['pickOver']} style={{ display: 'flex', gap: 8 }}>
            {bannerFile !== null ? <button type="button" className={styles['pick']} onClick={() => void clear('banner')}>Remove</button> : null}
            <button type="button" className={styles['pick']} onClick={() => bannerInput.current?.click()}>{busy === 'banner' ? 'Uploading' : 'Change banner'}</button>
          </div>
        </div>
        <div className={styles['editRow']}>
          <Avatar name={name || card.handle} seed={card.userId} src={card.pictureUrl} file={pictureFile} size={64} />
          <button type="button" className={styles['pick']} onClick={() => pictureInput.current?.click()}>{busy === 'picture' ? 'Uploading' : 'Change picture'}</button>
          {pictureFile !== null ? <button type="button" className={styles['pick']} onClick={() => void clear('picture')}>Use my X picture</button> : null}
        </div>
        <input ref={pictureInput} className={styles['hiddenInput']} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { void pick('picture', e.target.files?.[0]); e.target.value = ''; }} />
        <input ref={bannerInput} className={styles['hiddenInput']} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { void pick('banner', e.target.files?.[0]); e.target.value = ''; }} />

        <label className={styles['field']}>
          <span>Name</span>
          <input value={name} maxLength={MAX_NAME} placeholder={signInName ?? 'Your name'} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className={styles['field']}>
          <span>Bio</span>
          <textarea value={bio} maxLength={MAX_BIO} placeholder="Say what you catch" onChange={(e) => setBio(e.target.value)} />
          <div className={styles['counter']}>{bio.length}/{MAX_BIO}</div>
        </label>
        {error !== null ? <p className={styles['error']}>{error}</p> : null}
      </SheetBody>
      <SheetFoot>
        <button type="button" className={styles['save']} onClick={() => void (busy === null ? save() : undefined)}>{busy === 'save' ? 'Saving' : 'Save'}</button>
      </SheetFoot>
    </Sheet>
  );
}
