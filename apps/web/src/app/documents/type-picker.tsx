import Link from 'next/link';
import { ArrowRightIcon, DocumentIcon } from '@/components/icons';
import { EmptyState, Notice } from '@/components/ui';
import type { DocumentTypeInfoOut } from '@/lib/document-client';
import { DocTypeIcon } from './doc-icons';
import { PICKER_SECTIONS, typeLabel, typeMeta, type DocTypeMeta } from './doc-types';
import styles from './documents.module.css';
import { plural } from './form-helpers';

export function typeHref(documentType: string): string {
  return `/documents?type=${encodeURIComponent(documentType)}`;
}

/** Types by picker section, in the order the API sent them. Unlisted types go last. */
function bySection(types: DocumentTypeInfoOut[]) {
  const sections = PICKER_SECTIONS.map((section) => ({
    ...section,
    items: types.filter((t) => typeMeta(t.document_type).section === section.id),
  }));
  return sections.filter((s) => s.items.length > 0);
}

function TypeCard({ info }: { info: DocumentTypeInfoOut }) {
  const meta: DocTypeMeta = typeMeta(info.document_type);
  const total = info.questions.length;
  const required = info.questions.filter((q) => q.required).length;
  return (
    <li>
      <Link
        href={typeHref(info.document_type)}
        className={`${styles.type} card-interactive`}
        data-document-type={info.document_type}
      >
        <span className={styles.typeTop}>
          <span className={styles.tile} aria-hidden="true">
            <DocTypeIcon name={meta.icon} />
          </span>
          <span className={styles.count}>
            {total} {plural(total, 'question')}
          </span>
        </span>
        <span className={styles.typeName}>{typeLabel(info.document_type)}</span>
        <span className={styles.typeDesc}>{meta.description}</span>
        <span className={styles.typeFoot}>
          <span>{required} required</span>
          <span className={styles.go}>
            Start
            <ArrowRightIcon />
          </span>
        </span>
      </Link>
    </li>
  );
}

export function TypePicker({
  types,
  unknownType,
}: {
  types: DocumentTypeInfoOut[];
  /** A `?type=` value in the address bar that this server does not offer. */
  unknownType?: boolean;
}) {
  if (types.length === 0) {
    return (
      <EmptyState
        icon={DocumentIcon}
        title="No document types are available"
        action={
          <Link href="/chat" className="btn btn-secondary">
            Ask a legal question instead
          </Link>
        }
      >
        The server returned no document types. This is a server problem, not something you did. Try
        again later.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {unknownType && (
        <Notice tone="warn" title="That document type is not available" role="status">
          Choose one from the list below.
        </Notice>
      )}
      <div className={styles.sections}>
        {bySection(types).map((section) => (
          <section key={section.id} aria-labelledby={`section-${section.id}`}>
            <div className={styles.sectionHead}>
              <h2 id={`section-${section.id}`} className={styles.sectionTitle}>
                {section.title}
              </h2>
              <p className={styles.sectionNote}>{section.description}</p>
            </div>
            <ul className={styles.grid}>
              {section.items.map((info) => (
                <TypeCard key={info.document_type} info={info} />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

/** Placeholder shaped like the picker while the types load. */
export function TypePickerSkeleton() {
  return (
    <div role="status" aria-live="polite" className={styles.sections}>
      <span className="sr-only">Loading document types</span>
      {[3, 3].map((count, s) => (
        <section key={s} aria-hidden="true">
          <div className={styles.sectionHead}>
            <div className="skeleton h-6 w-48" />
            <div className="skeleton h-4 w-64 max-w-full" />
          </div>
          <div className={styles.grid}>
            {Array.from({ length: count }, (_, i) => (
              <div key={i} className="card flex h-44 flex-col gap-3">
                <div className="flex justify-between">
                  <div className="skeleton skeleton-block size-11" />
                  <div className="skeleton h-3.5 w-16" />
                </div>
                <div className="skeleton h-5 w-2/3" />
                <div className="skeleton h-3.5 w-full" />
                <div className="skeleton h-3.5 w-4/5" />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
