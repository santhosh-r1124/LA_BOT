import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Find an advocate',
  description:
    'Browse advocates by practice area, state, city and language. Listings in this setup are synthetic samples, not real advocates.',
};

export default function AdvocatesLayout({ children }: { children: ReactNode }) {
  return children;
}
