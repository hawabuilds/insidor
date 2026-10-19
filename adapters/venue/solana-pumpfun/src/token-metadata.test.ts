/**
 * A launch's on-chain name, ticker and link, read from a recorded token account, and every way a
 * bad account is refused rather than half-read.
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { TOKEN_ACCOUNT } from './__fixtures__/token-account.ts';
import { readTokenMetadata, tokenMetadata, TOKEN_2022_PROGRAM } from './token-metadata.ts';

const bytes = (): Uint8Array => new Uint8Array(Buffer.from(TOKEN_ACCOUNT.data, 'base64'));

test("a launch's token account gives its name, ticker and metadata link", () => {
  assert.deepEqual(readTokenMetadata(bytes(), TOKEN_ACCOUNT.owner), {
    name: 'Polymarket PreStocks',
    symbol: 'POLYMARKET',
    uri: 'https://ipfs.io/ipfs/bafkreiegfizqv2465nkvhscjgvdixwhbacojjqukk2iz27mc57e6po3paa',
  });
});

test('an account owned by any other program is not read', () => {
  assert.equal(readTokenMetadata(bytes(), 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'), null);
});

test('a truncated or non-mint account is refused, never half-read', () => {
  const b = bytes();
  assert.equal(readTokenMetadata(b.subarray(0, b.length - 20), TOKEN_2022_PROGRAM), null, 'the uri runs past the data');
  assert.equal(readTokenMetadata(b.subarray(0, 100), TOKEN_2022_PROGRAM), null, 'no account type');
  const notMint = new Uint8Array(b);
  notMint[165] = 2;
  assert.equal(readTokenMetadata(notMint, TOKEN_2022_PROGRAM), null, 'a holder account, not a mint');
});

test('one request for many coins; a coin the chain does not know is missing, not guessed', async () => {
  const calls: unknown[] = [];
  const fetch = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ result: { value: [{ owner: TOKEN_ACCOUNT.owner, data: [TOKEN_ACCOUNT.data, 'base64'] }, null] } }));
  }) as typeof globalThis.fetch;
  const got = await tokenMetadata({ rpcUrl: 'https://rpc.invalid', fetch, timeoutMs: 1_000 }, [TOKEN_ACCOUNT.address, 'Unknown1111111111111111111111111111111111111']);
  assert.equal(calls.length, 1);
  assert.equal(got.size, 1);
  assert.equal(got.get(TOKEN_ACCOUNT.address)?.symbol, 'POLYMARKET');
});

test('a failed request throws, so "nothing there" and "could not ask" stay apart', async () => {
  const fetch = (async () => new Response('busy', { status: 429 })) as unknown as typeof globalThis.fetch;
  await assert.rejects(tokenMetadata({ rpcUrl: 'https://rpc.invalid', fetch, timeoutMs: 1_000 }, [TOKEN_ACCOUNT.address]));
});
