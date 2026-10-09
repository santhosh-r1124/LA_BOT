import type { IconComponent } from '@/components/icons';
import { ChatIcon, DocumentIcon } from '@/components/icons';
import { CalendarIcon, FolderIcon, InboxIcon, RupeeIcon } from '@/components/portal-icons';
import styles from './planned.module.css';

export interface PlannedFeature {
  title: string;
  text: string;
  Icon: IconComponent;
}

/**
 * Portal features that are NOT built. They are listed as plain text with a
 * "Planned" label: no counts, no sample rows, nothing that looks like live data.
 */
export const PLANNED_FEATURES: PlannedFeature[] = [
  {
    title: 'Consultation requests',
    text: 'Requests from people who found you in the directory, for you to accept or decline.',
    Icon: InboxIcon,
  },
  {
    title: 'Scheduling and availability',
    text: 'Set the days and hours you can take a call.',
    Icon: CalendarIcon,
  },
  {
    title: 'Client messaging',
    text: 'Reply to people who contact you through the platform.',
    Icon: ChatIcon,
  },
  {
    title: 'Matters',
    text: 'Keep each client matter, its notes and its dates in one place.',
    Icon: FolderIcon,
  },
  {
    title: 'Document exchange',
    text: 'Send and receive documents for a matter.',
    Icon: DocumentIcon,
  },
  {
    title: 'Earnings',
    text: 'Fees received and what is still to be paid out.',
    Icon: RupeeIcon,
  },
];

/** The not-yet-built list. `compact` drops the descriptions. */
export function PlannedList({
  compact = false,
  headingId = 'planned-heading',
}: {
  compact?: boolean;
  headingId?: string;
}) {
  return (
    <section className={styles.wrap} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className={styles.title}>
          Planned, not built yet
        </h2>
        <span className="badge badge-sm">Planned</span>
      </div>
      <p className={styles.lede}>
        None of these exist in the portal today, so there are no requests, matters or earnings to
        show. They are listed so you know what is coming. There are no dates.
      </p>
      <ul className={compact ? styles.compactList : styles.list}>
        {PLANNED_FEATURES.map(({ title, text, Icon }) => (
          <li key={title} className={styles.item}>
            <span className={styles.icon} aria-hidden="true">
              <Icon />
            </span>
            <span className={styles.itemText}>
              <span className={styles.itemTitle}>
                {title}
                <span className="sr-only"> (planned, not built yet)</span>
              </span>
              {!compact && <span className={styles.itemBody}>{text}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
