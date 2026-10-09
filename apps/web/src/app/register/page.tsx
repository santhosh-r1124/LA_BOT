import type { Metadata } from 'next';
import { firstParam, safeNextPath } from '../login/_shared/auth-logic';
import { RegisterForm } from './register-form';

export const metadata: Metadata = {
  title: 'Create an account',
  description: 'Create a free Legal Advisor account to keep your conversation history.',
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const next = safeNextPath(firstParam((await searchParams).next));
  return <RegisterForm next={next} />;
}
