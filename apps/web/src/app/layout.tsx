import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { SiteHeader } from '@/components/site-header';
import { AuthProvider } from '@/lib/auth-context';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Legal Advisor — Indian Legal Information & Advocate Connect',
    template: '%s · Legal Advisor',
  },
  description:
    'AI-powered Indian legal information, document guidance and advocate discovery. Not legal advice.',
};

export const viewport: Viewport = {
  themeColor: '#0a0f1a',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <SiteHeader />
          <div id="main">{children}</div>
        </AuthProvider>
      </body>
    </html>
  );
}
