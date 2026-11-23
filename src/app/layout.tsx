import type { Metadata, Viewport } from 'next';
import type { CSSProperties } from 'react';
import { Unbounded } from 'next/font/google';
import { CONCEPT, SITE, theme } from '@/content';
import 'lenis/dist/lenis.css';
import './globals.css';

/** Display font for headings (self-hosted by next/font at build time). */
const display = Unbounded({ subsets: ['latin'], weight: ['500', '700', '900'], variable: '--font-display' });

export const metadata: Metadata = {
  title: `${SITE.name} | ${CONCEPT}`,
  description: `${SITE.edition}, ${SITE.dates}, ${SITE.venue}. ${SITE.disclaimer}`,
};

export const viewport: Viewport = {
  themeColor: '#000000',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable} style={{ '--accent': theme.accent } as CSSProperties}>
      <body>{children}</body>
    </html>
  );
}
