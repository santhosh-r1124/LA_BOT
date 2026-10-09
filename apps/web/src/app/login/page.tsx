import type { Metadata } from 'next';
import { LoginForm } from './login-form';
import { firstParam, safeNextPath } from './_shared/auth-logic';

export const metadata: Metadata = {
  title: 'Log in',
  description: 'Log in to Legal Advisor to keep your conversation history.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = safeNextPath(firstParam((await searchParams).next));
  return <LoginForm next={next} />;
}
