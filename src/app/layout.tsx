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

/**
 * Every visit starts at the top, with the cold open: the browser must not put a reload back
 * where it was. Set while the page parses, before it would restore anything.
 */
const NO_RESTORE = "try{history.scrollRestoration='manual'}catch(e){}window.scrollTo(0,0);";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={display.variable} style={{ '--accent': theme.accent } as CSSProperties}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_RESTORE }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
