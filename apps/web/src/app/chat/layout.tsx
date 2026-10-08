import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// The chat page is a client component, so its title lives here.
export const metadata: Metadata = {
  title: 'Legal chat',
  description:
    'Ask a question about Indian law and see the matching passages from the legal library, with their sources.',
};

export default function ChatLayout({ children }: { children: ReactNode }) {
  return children;
}
