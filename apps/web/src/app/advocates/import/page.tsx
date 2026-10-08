'use client';

import Link from 'next/link';
import { useId, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { DocumentIcon, DownloadIcon, LockIcon, SpinnerIcon } from '@/components/icons';
import { EmptyState, LoadingBlock, Notice, PageHeader } from '@/components/ui';
import { ApiRequestError } from '@/lib/api-client';
import { advocateClient, type AdvocateImportReport } from '@/lib/advocate-client';
import { useAuth } from '@/lib/auth-context';
import { formatBytes, formatCount } from '@/lib/format';
import { ArrowLeftIcon, UploadIcon } from '../_components/local-icons';
import styles from '../import.module.css';

const MAX_BYTES = 5 * 1024 * 1024;

/** [column, when it is needed, what goes in it] */
const COLUMNS: Array<[string, string, string]> = [
  [
    'advocate_id',
    'Optional',
    'Your own id for the advocate. Uploading a row with the same id again updates it.',
  ],
  ['name', 'Required', 'The name shown in the directory.'],
  [
    'email',
    'Required unless advocate_id is given',
    'Used to match an advocate that already exists.',
  ],
  ['phone', 'Optional', 'Shown on the advocate’s profile.'],
  [
    'practice_area',
    'Optional',
    'For example Consumer Law or IT Law. Separate several with a semicolon.',
  ],
  ['state', 'Required', 'A code or a name, for example TN or Tamil Nadu.'],
  ['city', 'Required', 'For example Chennai.'],
  ['language_code', 'Optional', 'For example ta or Tamil. Separate several with a semicolon.'],
  ['experience_years', 'Optional', 'A whole number from 0 to 70.'],
  ['consultation_fee', 'Optional', 'An amount in rupees.'],
  ['bio', 'Optional', 'A short description shown under About.'],
];

const TEMPLATE_HEADER = 'advocate_id,name,email,phone,practice_area,state,city,language_code';
const TEMPLATE_EXAMPLE =
  'EXAMPLE-1,Example Advocate,example.advocate@example.com,9876543210,Consumer Law,TN,Chennai,ta';

function downloadTemplate(): void {
  const csv = `${TEMPLATE_HEADER}\r\n${TEMPLATE_EXAMPLE}\r\n`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'advocates-template.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Why a picked file can't be used, or null when it can. */
function fileProblem(file: File): string | null {
  if (!/\.csv$/i.test(file.name) && !/csv/i.test(file.type)) {
    return 'That is not a CSV file. Save it as CSV and choose it again.';
  }
  if (file.size === 0) return 'That file is empty.';
  if (file.size > MAX_BYTES) return `That file is ${formatBytes(file.size)}. The limit is 5 MB.`;
  return null;
}

function Figure({
  tone,
  label,
  value,
}: {
  tone: 'ok' | 'accent' | 'muted' | 'danger';
  label: string;
  value: number;
}) {
  const color =
    tone === 'ok'
      ? 'text-ok'
      : tone === 'accent'
        ? 'text-accent'
        : tone === 'danger'
          ? 'text-danger'
          : 'text-fg-subtle';
  return (
    <div className={styles.figure}>
      <span className={styles.figureLabel}>
        <span className={`dot ${color}`} aria-hidden="true" />
        {label}
      </span>
      <span className="stat-value">{formatCount(value)}</span>
    </div>
  );
}

export default function ImportAdvocatesPage() {
  const { user, accessToken, loading } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dryRun, setDryRun] = useState(false);
  const [asSample, setAsSample] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<AdvocateImportReport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const errorId = useId();

  const isAdmin = user?.role === 'ADMIN' || user?.role === 'LEGAL_ADMIN';

  function pick(next: File | null) {
    setReport(null);
    setError(null);
    if (!next) {
      setFile(null);
      setFileError(null);
      return;
    }
    const problem = fileProblem(next);
    setFileError(problem);
    setFile(problem ? null : next);
  }

  function onDrop(e: DragEvent<HTMLLabelElement>) {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files?.[0] ?? null);
  }

  async function run(check: boolean) {
    if (!file || !accessToken) return;
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      setReport(await advocateClient.importCsv(file, accessToken, check, asSample));
    } catch (err) {
      setError(
        err instanceof ApiRequestError && err.code !== 'network_error'
          ? err.message
          : 'Could not reach the server. Check that the API is running and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void run(dryRun);
  }

  return (
    <main className="page page-narrow">
      <Link href="/advocates" className="btn btn-ghost btn-sm -ml-2 mb-3">
        <ArrowLeftIcon />
        Back to directory
      </Link>
      <PageHeader
        eyebrow="Administration"
        title="Import advocates"
        description="Upload a CSV file to add advocates to the directory. New advocates are added and existing ones are updated. Nothing is ever deleted."
      />

      {loading ? (
        <LoadingBlock label="Checking your account" />
      ) : !isAdmin ? (
        <EmptyState
          icon={LockIcon}
          title="Only administrators can import advocates"
          action={
            user ? (
              <Link href="/advocates" className="btn btn-secondary">
                Back to directory
              </Link>
            ) : (
              <Link href="/login" className="btn btn-primary">
                Log in
              </Link>
            )
          }
        >
          {user
            ? 'You are signed in with an account that is not an administrator.'
            : 'Log in with the administrator account set in the server’s configuration.'}
        </EmptyState>
      ) : (
        <>
          <form onSubmit={onSubmit} className="surface stack stack-lg p-5 sm:p-6" noValidate>
            <div className="field">
              <span className="label" id={`${inputId}-label`}>
                CSV file
              </span>
              {file ? (
                <div className={styles.picked}>
                  <span className={styles.pickedIcon} aria-hidden="true">
                    <DocumentIcon />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={styles.pickedName}>{file.name}</p>
                    <p className="hint">{formatBytes(file.size)}</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      pick(null);
                      if (inputRef.current) inputRef.current.value = '';
                    }}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <label
                  htmlFor={inputId}
                  className={styles.zone}
                  data-drag={dragging}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={onDrop}
                >
                  <span className={styles.zoneIcon} aria-hidden="true">
                    <UploadIcon />
                  </span>
                  <span className={styles.zoneTitle}>
                    {dragging ? 'Drop the file to select it' : 'Drag a CSV file here'}
                  </span>
                  <span className="hint">or</span>
                  <span className="btn btn-secondary btn-sm" aria-hidden="true">
                    Choose a file
                  </span>
                  <span className="hint">CSV, up to 5 MB</span>
                </label>
              )}
              <input
                ref={inputRef}
                id={inputId}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                aria-labelledby={`${inputId}-label`}
                aria-describedby={fileError ? errorId : undefined}
                aria-invalid={fileError ? true : undefined}
                onChange={(e) => {
                  pick(e.target.files?.[0] ?? null);
                  e.target.value = '';
                }}
              />
              {fileError && (
                <p id={errorId} role="alert" className="field-error">
                  {fileError}
                </p>
              )}
            </div>

            <fieldset className="stack">
              <legend className="sr-only">Options</legend>
              <label className="choice">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                />
                <span>
                  <span className="strong">Check the file only</span>
                  <span className="hint block">
                    Reads every row and shows what would happen. Nothing is saved.
                  </span>
                </span>
              </label>
              <label className="choice">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={asSample}
                  onChange={(e) => setAsSample(e.target.checked)}
                />
                <span>
                  <span className="strong">Mark every row as sample data</span>
                  <span className="hint block">
                    Use this for test files. The listings get a “Sample listing” badge. It applies
                    to every row, including advocates that already exist.
                  </span>
                </span>
              </label>
            </fieldset>

            {error && (
              <Notice tone="danger" title="The upload did not work">
                <span className="muted">{error}</span>
              </Notice>
            )}

            <div className="cluster">
              <button
                type="submit"
                disabled={!file || busy}
                aria-busy={busy}
                className="btn btn-primary"
              >
                {busy ? (
                  <>
                    <SpinnerIcon />
                    {dryRun ? 'Checking…' : 'Importing…'}
                  </>
                ) : dryRun ? (
                  'Check file'
                ) : (
                  'Import advocates'
                )}
              </button>
              {!file && <span className="hint">Choose a file to continue.</span>}
            </div>
          </form>

          {report && (
            <section className="section-sm" aria-labelledby="report-heading" aria-live="polite">
              <Notice
                tone={report.failed > 0 ? 'warn' : 'ok'}
                role="status"
                title={
                  <span id="report-heading">
                    {report.dry_run
                      ? 'Check complete. Nothing was saved.'
                      : report.failed > 0
                        ? 'Import finished with some rows skipped'
                        : 'Import complete'}
                  </span>
                }
                action={
                  report.dry_run && file ? (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={() => void run(false)}
                      disabled={busy}
                    >
                      Import this file now
                    </button>
                  ) : undefined
                }
              >
                <span className="muted">
                  {formatCount(report.total_rows)} {report.total_rows === 1 ? 'row' : 'rows'} read
                  {report.dry_run ? '. This is what an import would do.' : '.'}
                  {report.failed > 0 &&
                    ' Fix the skipped rows in the file and upload it again. Rows that already went in are not duplicated.'}
                </span>
              </Notice>

              <div className={`${styles.figures} mt-4`}>
                <Figure
                  tone="ok"
                  label={report.dry_run ? 'Would add' : 'Added'}
                  value={report.created}
                />
                <Figure
                  tone="accent"
                  label={report.dry_run ? 'Would update' : 'Updated'}
                  value={report.updated}
                />
                <Figure tone="muted" label="Unchanged" value={report.unchanged} />
                <Figure tone="danger" label="Skipped" value={report.failed} />
              </div>

              {report.errors.length > 0 && (
                <div className="mt-5">
                  <h2 className="title mb-1">Skipped rows</h2>
                  <p className="muted mb-3 text-sm">
                    {report.failed > report.errors.length
                      ? `Showing the first ${formatCount(report.errors.length)} problems.`
                      : 'Line numbers match the rows in your file, counting the header as line 1.'}
                  </p>
                  <div className={`table-wrap ${styles.problems}`} tabIndex={0}>
                    <table className="data-table">
                      <caption className="sr-only">Rows that were skipped and why</caption>
                      <thead>
                        <tr>
                          <th scope="col">Line</th>
                          <th scope="col">What is wrong</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.errors.map((e) => (
                          <tr key={`${e.line}-${e.message}`}>
                            <td className={styles.problemLine}>{e.line}</td>
                            <td className={styles.problemText}>{e.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="section-sm" aria-labelledby="columns-heading">
            <div className="section-head">
              <div>
                <h2 id="columns-heading" className="section-title">
                  Columns the file can have
                </h2>
                <p className="section-lede">
                  The first row must be the column names. Common alternatives such as{' '}
                  <code>mobile</code>, <code>specialization</code> or <code>full name</code> are
                  recognised too.
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={downloadTemplate}>
                <DownloadIcon />
                Download template
              </button>
            </div>
            <div className="table-wrap">
              <table className={`data-table ${styles.columns}`}>
                <caption className="sr-only">CSV columns</caption>
                <thead>
                  <tr>
                    <th scope="col">Column</th>
                    <th scope="col">Needed</th>
                    <th scope="col">What goes in it</th>
                  </tr>
                </thead>
                <tbody>
                  {COLUMNS.map(([name, need, help]) => (
                    <tr key={name}>
                      <td>
                        <code>{name}</code>
                      </td>
                      <td className={`${styles.need} ${need === 'Optional' ? 'subtle' : ''}`}>
                        {need}
                      </td>
                      <td className="muted">{help}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
