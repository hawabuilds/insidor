/**
 * Every glyph the phone app draws, as inline SVG.
 *
 * Inline rather than an icon font or a library: there are about twenty of them, each is a
 * line or two of path data, and a dependency for twenty paths would be the largest thing in
 * the bundle. All of them take `currentColor`, so a glyph is coloured by the text it sits in
 * and never carries a colour of its own — which keeps rule 1 in tokens.css true for icons too.
 *
 * The platform marks are simplified outlines drawn here, not the platforms' logo files.
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

export const ChatIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4 19.5l1.4-4.4A7.5 7.5 0 1 1 20 11.5z" />
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

export const PlusIcon = (p: IconProps) => (
  <Stroke {...p}>
    <path d="M12 5v14M5 12h14" />
  </Stroke>
);

/* ── platform marks ────────────────────────────────────────────────── */

export const XMark = (p: IconProps) => (
  <Stroke {...p} strokeWidth={2.2}>
    <path d="M5 4.5 19 19.5M19 4.5 5 19.5" />
  </Stroke>
);

export const TikTokMark = (p: IconProps) => (
  <Stroke {...p} strokeWidth={2}>
    <path d="M13 4v11a3.5 3.5 0 1 1-3.5-3.5" />
    <path d="M13 4c.4 2.6 2.2 4.3 4.8 4.5" />
  </Stroke>
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
