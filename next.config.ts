import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // The legacy vanilla build still lives in site/ and the worker is CommonJS
  // Node — neither belongs in the Next compile graph.
  outputFileTracingExcludes: {
    '/**': ['./site/**', './design/**'],
  },

  images: {
    // Social media CDNs we render post media from. Narrow this list rather than
    // widening it — an open remote-image allowlist is an SSRF-shaped hole.
    remotePatterns: [
      { protocol: 'https', hostname: 'pbs.twimg.com' },
      { protocol: 'https', hostname: '*.tiktokcdn.com' },
      { protocol: 'https', hostname: '*.tiktokcdn-us.com' },
      { protocol: 'https', hostname: 'dd.dexscreener.com' },
    ],
  },
};

export default nextConfig;
