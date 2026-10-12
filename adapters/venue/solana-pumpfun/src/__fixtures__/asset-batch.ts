/**
 * One getAssetBatch reply, recorded 2026-10-12 for two coins and one address that is not a coin,
 * trimmed to the fields read (the provider's CDN copies and token info dropped). Real ids and
 * real content links.
 */
export const ASSET_BATCH_REPLY = {
  jsonrpc: '2.0',
  id: 1,
  result: [
    {
      interface: 'FungibleToken',
      id: 'Bm4Czuq3X7BwgU429GiLb8wTHLNBiCzcysN8Gsqpump',
      content: {
        json_uri: 'https://ipfs.io/ipfs/bafkreiex2ffd5m7lzhx7pg54o4kcnqxze3c3ajqgujz2pd2oa2fb53dy6q',
        links: { image: 'https://ipfs.io/ipfs/bafybeielkr3sq6eg2hrbp2ysds4zo4diikbb53d4orjgyzohxgrhelx7ia' },
        metadata: { name: 'Aura Bird', symbol: 'Stork' },
      },
    },
    {
      interface: 'FungibleToken',
      id: 'szicVgykSZSQHvtuxxjQ9FsSorr2YPwcVVxYj5dMNAP',
      content: {
        json_uri: 'https://ipfs.io/ipfs/bafkreibvq4svvozfqurcfcdymtqi3nj76miiw6kduauwj2avci577tpoty',
        links: { image: 'https://ipfs.io/ipfs/bafkreihsh7c3ahljvzna3q6yagkxvkjyyymwtjzo555wbcmaa72vk3f6b4' },
        metadata: { name: 'Nap Protocol', symbol: '$NAPS' },
      },
    },
    null,
  ],
};
