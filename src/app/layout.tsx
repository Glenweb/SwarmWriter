import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Swarm Writer — automated SEO content for WordPress',
  description:
    'Research keywords, approve a content plan, and publish SEO articles to WordPress on a schedule. RankMath-native, with internal linking against the posts you already have.',
  applicationName: 'Swarm Writer',
  openGraph: {
    title: 'Swarm Writer',
    description: 'Automated SEO content that links into the site you already built.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f7f8fb' },
    { media: '(prefers-color-scheme: dark)', color: '#080b11' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
