'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { LoadingBlock, PageHeader, StatusBadge } from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import { advocateClient, type AdvocateImportReport } from '@/lib/advocate-client';
import { useAuth } from '@/lib/auth-context';

const COLUMNS: Array<[string, string]> = [
  ['advocate_id', 'Your id for the advocate. Re-uploading a row with the same id updates it.'],
  ['name', 'Required.'],
  ['email', 'Required unless advocate_id is given.'],
  ['phone', 'Optional. Shown on the listing.'],
  ['practice_area', 'e.g. Consumer Law, IT Law. Separate several with ";".'],
  ['state', 'Code or name, e.g. TN or Tamil Nadu. Required.'],
  ['city', 'Required.'],
  ['language_code', 'e.g. ta or Tamil. Separate several with ";".'],
];

export default function ImportAdvocatesPage() {
  const { user, accessToken, loading } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AdvocateImportReport | null>(null);

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'LEGAL_ADMIN';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || !accessToken) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(await advocateClient.importCsv(file, accessToken, dryRun));
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'The upload failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page page-narrow">
      <Link href="/advocates" className="btn btn-ghost btn-sm -ml-2 mb-4">
        ← Back to directory
      </Link>
      <PageHeader
        eyebrow="Administration"
        title="Import advocates"
        description="Upload a CSV file. New advocates are added as verified listings and existing ones are updated. Nothing is deleted."
      />

      {loading ? (
        <LoadingBlock label="Checking your account" />
      ) : !isAdmin ? (
        <div className="alert" role="status">
          <p className="text-sm">
            Only administrators can import advocates.{' '}
            {user ? 'You are signed in with a non-admin account.' : ''} Sign in with the admin
            account configured on the server (<code>ADMIN_EMAIL</code> / <code>ADMIN_PASSWORD</code>
            ).{' '}
            <Link href="/login" className="link font-medium">
              Log in
            </Link>
          </p>
        </div>
      ) : (
        <>
          <form onSubmit={onSubmit} className="surface flex flex-col gap-4 p-5">
            <label className="flex flex-col gap-1.5">
              <span className="label">CSV file</span>
              <input
                type="file"
                accept=".csv,text/csv"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="input"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={dryRun}
                onChange={(e) => setDryRun(e.target.checked)}
              />
              Check the file only, don&apos;t save anything
            </label>
            {error && (
              <p role="alert" className="field-error text-sm">
                {error}
              </p>
            )}
            <button type="submit" disabled={!file || busy} className="btn btn-primary self-start">
              {busy ? 'Importing…' : dryRun ? 'Check file' : 'Import'}
            </button>
          </form>

          {report && (
            <section className="surface mt-5 p-5" aria-live="polite">
              <h2 className="font-semibold">
                {report.dry_run ? 'Check complete (nothing saved)' : 'Import complete'}
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusBadge tone="ok">{report.created} added</StatusBadge>
                <StatusBadge tone="accent">{report.updated} updated</StatusBadge>
                <StatusBadge tone="neutral">{report.unchanged} unchanged</StatusBadge>
                <StatusBadge tone={report.failed ? 'danger' : 'neutral'}>
                  {report.failed} skipped
                </StatusBadge>
              </div>
              {report.errors.length > 0 && (
                <>
                  <p className="muted mt-4 text-sm">
                    Skipped rows (fix them in the file and upload it again):
                  </p>
                  <ul className="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto text-sm">
                    {report.errors.map((e) => (
                      <li key={e.line}>
                        <span className="subtle">Line {e.line}:</span> {e.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          )}

          <section className="mt-6">
            <h2 className="subtle text-xs font-semibold uppercase tracking-wider">
              Expected columns
            </h2>
            <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[10rem_1fr]">
              {COLUMNS.map(([name, help]) => (
                <div key={name} className="contents">
                  <dt>
                    <code>{name}</code>
                  </dt>
                  <dd className="muted">{help}</dd>
                </div>
              ))}
            </dl>
            <p className="subtle mt-3 text-xs">
              Common alternatives such as <code>mobile</code>, <code>specialization</code> or{' '}
              <code>full name</code> are recognised too.
            </p>
          </section>
        </>
      )}
    </main>
  );
}
