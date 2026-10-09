import Link from 'next/link';
import { ArrowRightIcon, BriefcaseIcon, LanguageIcon, MapPinIcon } from '@/components/icons';
import type { AdvocateDirectoryEntry } from '@/lib/advocate-client';
import {
  SAMPLE_LISTING_LABEL,
  fieldsOfPractice,
  formatInr,
  initials,
  languageName,
  practiceAreaLabel,
  stateName,
} from '@/lib/format';
import styles from '../directory.module.css';

const MAX_AREAS = 3;
const MAX_LANGUAGES = 3;

/** One directory listing. The whole row links to the profile (name = link text). */
export function AdvocateRow({ advocate: a }: { advocate: AdvocateDirectoryEntry }) {
  const name = a.display_name || 'Advocate';
  const fee = formatInr(a.consultation_fee);
  const languages = a.languages.map(languageName);
  // Internal chat categories (e.g. "Advocate Required") are not fields of practice.
  const areas = fieldsOfPractice(a.practice_areas);
  const hiddenAreas = areas.length - MAX_AREAS;

  return (
    <li className={styles.row}>
      <span className={`avatar ${styles.rowAvatar}`} aria-hidden="true">
        {initials(a.display_name)}
      </span>

      <div className={styles.rowTop}>
        <h3 className={styles.name}>
          <Link href={`/advocates/${a.id}`} className={styles.link}>
            {name}
          </Link>
        </h3>
        {a.is_sample && (
          <span className="badge badge-warn badge-sm">
            <span className="dot" aria-hidden="true" />
            {SAMPLE_LISTING_LABEL}
          </span>
        )}
      </div>

      <div className={styles.meta}>
        <span className={styles.metaItem} data-testid="advocate-location">
          <MapPinIcon />
          <span>
            {a.city}, {stateName(a.state_code)}
          </span>
        </span>
        {languages.length > 0 && (
          <span className={styles.metaItem}>
            <LanguageIcon />
            <span>
              {languages.slice(0, MAX_LANGUAGES).join(', ')}
              {languages.length > MAX_LANGUAGES && ` +${languages.length - MAX_LANGUAGES}`}
            </span>
          </span>
        )}
        {a.experience_years != null && (
          <span className={styles.metaItem}>
            <BriefcaseIcon />
            <span>{a.experience_years} yrs</span>
          </span>
        )}
        {fee && <span className={styles.metaItem}>Fee {fee}</span>}
      </div>

      {areas.length > 0 && (
        <ul className={styles.areas} aria-label="Practice areas">
          {areas.slice(0, MAX_AREAS).map((p) => (
            <li key={p} className="badge">
              {practiceAreaLabel(p)}
            </li>
          ))}
          {hiddenAreas > 0 && (
            <li className="badge">
              +{hiddenAreas}
              <span className="sr-only"> more practice areas</span>
            </li>
          )}
        </ul>
      )}

      <ArrowRightIcon className={styles.go} />
    </li>
  );
}

/** Placeholder with the same footprint as {@link AdvocateRow}. */
export function AdvocateRowSkeleton() {
  return (
    <li className={styles.skRow} aria-hidden="true">
      <div className="skeleton skeleton-circle size-11 sm:size-[3.25rem]" />
      <div className="flex min-w-0 flex-col gap-2.5 pt-1">
        <div className="skeleton h-4 w-2/5" />
        <div className="skeleton h-3.5 w-3/5" />
        <div className="mt-1 flex gap-2">
          <div className="skeleton h-6 w-24 rounded-full" />
          <div className="skeleton h-6 w-20 rounded-full" />
        </div>
      </div>
    </li>
  );
}
