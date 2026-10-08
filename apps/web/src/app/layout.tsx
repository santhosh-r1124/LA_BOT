import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { AuthProvider } from '@/lib/auth-context';
import { THEME_COLOR, themeInitScript } from '@/lib/theme';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Legal Advisor — Indian legal information and advocate directory',
    template: '%s · Legal Advisor',
  },
  description:
    'Plain-language Indian legal information with sources, template document drafts and an advocate directory. Not legal advice.',
};

// Both schemes are declared; the theme toggle keeps `theme-color` in step when a
// person picks a theme that differs from their OS setting (see lib/theme.ts).
export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: THEME_COLOR.dark },
    { media: '(prefers-color-scheme: light)', color: THEME_COLOR.light },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // suppressHydrationWarning: the inline script below may set data-theme on
    // <html> before React hydrates.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* No-flash theme: applies a saved light/dark choice before first paint. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">
        <AuthProvider>
          <SiteHeader />
          <div id="main" tabIndex={-1} className="min-w-0 flex-1 outline-none">
            {children}
          </div>
          <SiteFooter />
        </AuthProvider>
      </body>
    </html>
  );
}
