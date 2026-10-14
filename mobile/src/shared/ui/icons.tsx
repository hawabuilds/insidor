/**
 * Every glyph the phone app draws, as inline SVG.
 *
 * Inline rather than an icon font or a library: there are about twenty of them, each is a
 * line or two of path data, and a dependency for twenty paths would be the largest thing in
 * the bundle. All of them take `currentColor`, so a glyph is coloured by the text it sits in
 * and never carries a colour of its own — which keeps rule 1 in tokens.css true for icons too.
 *
 * The platform marks are simplified outlines drawn here, not the platforms' logo files — except
 * X and TikTok, which are their real marks as filled paths (the owner asked for the real logos on
 * the badges, 2026-10-14). They are still `currentColor`, so the badge's white-on-black is the
 * badge's, and a filter pill draws them in its own text colour.
 */

import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { readonly size?: number };

function Stroke({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const HomeIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
  </Stroke>
);

export const LayersIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m12 4 8.5 4.5L12 13 3.5 8.5z" />
    <path d="m3.5 12.5 8.5 4.5 8.5-4.5" />
    <path d="m3.5 16.5 8.5 4.5 8.5-4.5" />
  </Stroke>
);

export const SearchIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4 4" />
  </Stroke>
);

/* The Feed tab's glyph, Trador's Feed tab's own: a rounded speech bubble with its tail at the bottom left. */
export const ChatIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M4.5 17.5V7a2.5 2.5 0 0 1 2.5-2.5h10A2.5 2.5 0 0 1 19.5 7v6a2.5 2.5 0 0 1-2.5 2.5H9l-4.5 3.5z" />
  </Stroke>
);

export const WalletIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3.5" y="6" width="17" height="13" rx="2.5" />
    <path d="M3.5 10h17" />
    <path d="M15.5 14.5h2" />
  </Stroke>
);

export const StarIcon = ({ filled = false, ...p }: IconProps & { readonly filled?: boolean }) => (
  <Stroke {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="m12 3.8 2.5 5.2 5.6.7-4.1 3.9 1 5.6L12 16.5l-5 2.7 1-5.6-4.1-3.9 5.6-.7z" />
  </Stroke>
);

export const FilterIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M5 7h14M7.5 12h9M10 17h4" />
  </Stroke>
);

export const BackIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
  </Stroke>
);

export const ChevronIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </Stroke>
);

export const ShareIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 15V4M8 7.5 12 3.5l4 4" />
    <path d="M6 11.5V19a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-7.5" />
  </Stroke>
);

export const ImageIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="4" y="4.5" width="16" height="15" rx="2.5" />
    <circle cx="9.5" cy="10" r="1.6" />
    <path d="m4.5 17 4.5-4 3.5 3 3-2.5 4 3.5" />
  </Stroke>
);

export const CheckIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Stroke>
);

export const CloseIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M6.5 6.5 17.5 17.5M17.5 6.5 6.5 17.5" />
  </Stroke>
);

export const CopyIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Stroke>
);

export const ExternalIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M8 16 16 8M9.5 8H16v6.5" />
  </Stroke>
);

export const GearIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </Stroke>
);

export const CapIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M22 9 12 4 2 9l10 5 10-5Z" />
    <path d="M6 11v5c0 1.2 2.7 3 6 3s6-1.8 6-3v-5" />
  </Stroke>
);

export const BellIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </Stroke>
);

export const UserIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
  </Stroke>
);

export const TrophyIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M8 4h8v5a4 4 0 0 1-8 0V4ZM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7" />
  </Stroke>
);

export const LockIcon = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="4.5" y="10.5" width="15" height="10" rx="2" />
    <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
  </Stroke>
);

export const LogoutIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
  </Stroke>
);

export const RocketIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M14.5 4.5c2.5-.8 4.6-.8 5 0 .8.4.8 2.5 0 5L13 16l-5-5z" />
    <path d="M8 11 5 11.5 3.5 14l4 .5M13 16l-.5 3L10 20.5l-.5-4" />
    <circle cx="15.5" cy="8.5" r="1.4" />
  </Stroke>
);

export const LineChartIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="m4 16 5-5 3.5 3L20 7" />
  </Stroke>
);

export const CandleIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M8 4v16M16 4v16" />
    <rect x="6" y="8" width="4" height="7" rx="1" />
    <rect x="14" y="6" width="4" height="9" rx="1" />
  </Stroke>
);

/** A play triangle, filled: drawn over a video's preview picture so it reads as a video. */
export const PlayIcon = (p: IconProps) => (
  <Stroke {...p} strokeWidth={1.5}>
    <path d="M8.5 5.5v13l10-6.5z" fill="currentColor" />
  </Stroke>
);

export const PlusIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 5v14M5 12h14" />
  </Stroke>
);

/* ── a coin's own links, Trador's SocialRow glyphs ───────────────────── */

/** X's logo, filled, as Trador's XIcon draws it: the link button, not the platform badge. */
export const XLogoIcon = ({ size = 20, ...rest }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...rest}>
    <path d="M18.9 2H22l-7.6 8.7L23 22h-6.8l-5.3-6.9L4.8 22H1.7l8.1-9.3L1 2h7l4.8 6.3L18.9 2zm-2.4 18h1.9L7.5 4H5.5l11 16z" />
  </svg>
);

export const TelegramIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M21 4.5L2.9 11.4c-.9.34-.88 1.62.03 1.93l4.4 1.5 1.7 5.1c.26.78 1.27.96 1.79.33l2.36-2.87 4.42 3.25c.63.46 1.53.12 1.7-.65L22.4 5.6c.17-.8-.63-1.42-1.4-1.1z" />
    <path d="M7.33 14.83L18.4 7.2l-7.7 8.36-.3 3.9" strokeWidth={1.6} />
  </Stroke>
);

export const GlobeIcon = (p: IconProps) => (
  <Stroke {...p}>
    <circle cx="12" cy="12" r="8.6" />
    <path d="M3.4 12h17.2M12 3.4c2.2 2.4 3.3 5.4 3.3 8.6s-1.1 6.2-3.3 8.6c-2.2-2.4-3.3-5.4-3.3-8.6S9.8 5.8 12 3.4z" strokeWidth={1.7} />
  </Stroke>
);

/** Trador's ArrowUpIcon: the like on a comment. */
export const ArrowUpIcon = (p: IconProps) => (
  <Stroke {...p} strokeWidth={2.2}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </Stroke>
);

/** Trador's ReplyIcon. */
export const ReplyIcon = (p: IconProps) => (
  <Stroke {...p} strokeWidth={2}>
    <path d="M10 7L5 12l5 5" />
    <path d="M5 12h9a5 5 0 015 5v1" />
  </Stroke>
);

/* ── platform marks ────────────────────────────────────────────────── */

/* A real logo mark, filled. The viewBox has a margin around the 24-unit logo so a mark fills
   about as much of its box as the outlined glyphs do, and the badge keeps its size. */
function Filled({ size = 20, children, ...rest }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="-3 -3 30 30" fill="currentColor" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const XMark = (p: IconProps) => (
  <Filled {...p}>
    <path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z" />
  </Filled>
);

export const TikTokMark = (p: IconProps) => (
  <Filled {...p}>
    <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z" />
  </Filled>
);

export const YouTubeMark = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="3" y="6" width="18" height="12" rx="3.5" />
    <path d="m10.5 9.5 4 2.5-4 2.5z" fill="currentColor" />
  </Stroke>
);

export const RedditMark = (p: IconProps) => (
  <Stroke {...p}>
    <ellipse cx="12" cy="14.5" rx="7" ry="5" />
    <path d="M12 9.5 13 4.5l3.5 1" />
    <circle cx="17.5" cy="5.5" r="1.3" />
    <path d="M9.5 16.5c1.4 1 3.6 1 5 0" />
  </Stroke>
);

export const InstagramMark = (p: IconProps) => (
  <Stroke {...p}>
    <rect x="4" y="4" width="16" height="16" rx="4.5" />
    <circle cx="12" cy="12" r="3.6" />
    <circle cx="16.8" cy="7.2" r=".6" fill="currentColor" />
  </Stroke>
);
