import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DocumentAssistant } from './assistant';
import { TypePickerSkeleton } from './type-picker';

export const metadata: Metadata = {
  title: 'Document assistant',
  description:
    'Answer a few questions and get a labelled draft of a rental agreement, affidavit, NDA or other Indian legal document, with notes on stamping, registration and review.',
};

export default function DocumentsPage() {
  return (
    // useSearchParams (the chosen type lives in the address) needs a Suspense boundary.
    <Suspense
      fallback={
        <main className="page">
          <TypePickerSkeleton />
        </main>
      }
    >
      <DocumentAssistant />
    </Suspense>
  );
}
