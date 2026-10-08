import type { Metadata } from 'next';
import { firstParam } from '../login/_shared/auth-logic';
import { VerifyEmailClient } from './verify-email-client';

export const metadata: Metadata = {
  title: 'Verify your email',
  description: 'Confirm the email address on your Legal Advisor account.',
  // The link carries a one-time token; keep it out of search indexes.
  robots: { index: false, follow: false },
};

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = firstParam((await searchParams).token);
  return <VerifyEmailClient token={token} />;
}
