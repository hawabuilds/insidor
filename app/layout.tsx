import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Insidor — catch the play before it’s a coin',
  description:
    'Insidor watches social media for things going viral, surfaces them before crypto traders find out, and lets you buy the coin that exists or create the first one.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Clash Display + General Sans are Fontshare; JetBrains Mono is Google.
            Matches the settled prototypes exactly — see app/globals.css. */}
        <link rel="preconnect" href="https://api.fontshare.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://api.fontshare.com/v2/css?f[]=clash-display@600,700&f[]=general-sans@400,500,600,650&display=swap"
          rel="stylesheet"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
