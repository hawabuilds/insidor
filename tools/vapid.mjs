/**
 * MAKE THE PUSH KEYS (VAPID) AND WRITE THEM INTO .env.local — once.
 *
 *   node tools/vapid.mjs
 *
 * A P-256 key pair from Node's own crypto, in the URL-safe base64 the push services and the
 * browser expect. ★ THE PRIVATE KEY IS NEVER PRINTED: it goes from memory into .env.local and
 * nowhere else, and this prints only that it was written and the public half (which the browser
 * is sent anyway). If .env.local already has a VAPID_PRIVATE_KEY, nothing is changed — a new
 * pair would silently cut off every phone already subscribed with the old one.
 */

import { createECDH } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const FILE = join(import.meta.dirname, '..', '.env.local');
const text = existsSync(FILE) ? readFileSync(FILE, 'utf8') : '';
const has = (name) => new RegExp(`^${name}=.+$`, 'm').test(text);

if (has('VAPID_PRIVATE_KEY')) {
  console.log('VAPID keys are already in .env.local; nothing changed.');
  process.exit(0);
}

const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const pub = ecdh.getPublicKey().toString('base64url');
const priv = Buffer.concat([Buffer.alloc(32), ecdh.getPrivateKey()]).subarray(-32).toString('base64url');

const lines = [
  '',
  '# Web push (tools/vapid.mjs). The private key stays here; never commit, print or paste it.',
  `VAPID_PUBLIC_KEY=${pub}`,
  `VAPID_PRIVATE_KEY=${priv}`,
  ...(has('VAPID_SUBJECT') ? [] : ['VAPID_SUBJECT=mailto:alerts@insidor.app']),
];
writeFileSync(FILE, `${text.replace(/\n*$/, '\n')}${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`Wrote VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY to .env.local. Public key: ${pub}`);
