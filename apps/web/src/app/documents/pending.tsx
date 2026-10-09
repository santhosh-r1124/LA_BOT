import { ArrowLeftGlyph } from './doc-icons';
import type { DraftingMode } from './mode-note';
import styles from './documents.module.css';

/** Widths of the placeholder lines, varied so the sheet reads as text rather than stripes. */
const LINE_WIDTHS = ['w-full', 'w-11/12', 'w-full', 'w-4/5', 'w-full', 'w-10/12', 'w-3/5'];

/**
 * Shown while a draft is being made and the wait is long enough to notice. The
 * request can be cancelled from here: the answers stay in the form.
 */
export function PendingView({
  label,
  mode,
  onCancel,
}: {
  label: string;
  mode: DraftingMode;
  onCancel: () => void;
}) {
  const detail =
    mode === 'offline'
      ? 'Putting your answers into a template. This takes a moment.'
      : mode === 'ai'
        ? 'An AI model is writing the draft. This can take up to a minute.'
        : 'Preparing your draft. If an AI model is writing it, this can take up to a minute.';

  return (
    <>
      <header className="mb-8 flex max-w-2xl flex-col gap-2">
        <span className="eyebrow eyebrow-rule">Document assistant</span>
        <h1 id="doc-heading" tabIndex={-1} className="display display-sm outline-none">
          Preparing your {label}
        </h1>
        <p className="muted" role="status">
          {detail}
        </p>
      </header>

      <div className="flex max-w-3xl flex-col gap-5">
        <div className={styles.skelSheet} aria-hidden="true">
          <div className="skeleton h-5 w-28" />
          <div className="skeleton mx-auto mb-3 mt-4 h-7 w-3/5" />
          {LINE_WIDTHS.map((width, i) => (
            <div key={i} className={`skeleton h-4 ${width}`} />
          ))}
          <div className="skeleton mt-3 h-5 w-2/5" />
          {LINE_WIDTHS.slice(0, 4).map((width, i) => (
            <div key={`b${i}`} className={`skeleton h-4 ${width}`} />
          ))}
        </div>
        <div>
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            <ArrowLeftGlyph />
            Back to your answers
          </button>
        </div>
      </div>
    </>
  );
}
