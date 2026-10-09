import Link from 'next/link';
import { ScaleIcon } from '@/components/icons';

export default function NotFound() {
  return (
    <main className="page page-narrow">
      <div className="surface flex flex-col items-start gap-4 p-6 sm:p-8">
        <span className="avatar avatar-lg avatar-neutral" aria-hidden="true">
          <ScaleIcon className="size-7" />
        </span>
        <div>
          <p className="eyebrow">Error 404</p>
          <h1 className="display display-sm mt-1">This page does not exist</h1>
        </div>
        <p className="muted max-w-[52ch]">
          The address may be mistyped, or the page may have moved. The portal has an overview, a
          registration form, a login page and your profile.
        </p>
        <div className="btn-group">
          <Link href="/" className="btn btn-primary">
            Go to the overview
          </Link>
          <Link href="/profile" className="btn btn-secondary">
            Your profile
          </Link>
        </div>
      </div>
    </main>
  );
}
