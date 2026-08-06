'use strict';

/**
 * Normalize IPFS image/metadata URLs to https://ipfs.io/ipfs/<cid>.
 * Leaves plain HTTPS URLs without /ipfs/ paths unchanged.
 */
function toIpfsIoGateway(url) {
  const s = String(url || '').trim();
  if (!s) return '';

  if (s.startsWith('ipfs://')) {
    const hash = s.slice(7).replace(/^ipfs\//, '').split(/[/?#]/)[0];
    return hash ? `https://ipfs.io/ipfs/${hash}` : '';
  }

  if (/^https:\/\/ipfs\.io\/ipfs\/[^/?#]+/.test(s)) return s;

  const m = s.match(/\/ipfs\/([^/?#]+)/);
  if (m) return `https://ipfs.io/ipfs/${m[1]}`;

  return s;
}

module.exports = { toIpfsIoGateway };
