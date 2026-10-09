import type { Metadata } from 'next';
import { firstParam } from '../login/_shared/auth-logic';
import { ResetPasswordClient } from './reset-password-client';

export const metadata: Metadata = {
  title: 'Reset your password',
  description: 'Get a link to choose a new Legal Advisor password.',
  // A reset link carries a one-time token; keep it out of search indexes.
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = firstParam((await searchParams).token);
  return <ResetPasswordClient token={token} />;
}
