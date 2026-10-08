import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The page replaces this with the advocate's name once the profile has loaded.
export const metadata: Metadata = { title: 'Advocate profile' };

export default function AdvocateProfileLayout({ children }: { children: ReactNode }) {
  return children;
}
