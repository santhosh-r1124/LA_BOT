import Link from 'next/link';
import { CheckIcon } from '@/components/icons';
import { profileChecklist, type ChecklistKey, type ProfileLike } from '@/lib/forms';
import styles from './checklist.module.css';

/** Where each item is edited on the profile page. */
const TARGET: Record<ChecklistKey, string> = {
  location: '#location',
  practiceAreas: '#practice',
  languages: '#languages',
  experience: '#experience',
  fee: '#fee',
  bio: '#bio',
};

/**
 * How complete the directory profile is: a count, a bar and one row per field
 * with the word "Added" or "Missing", so state never rests on colour or shape.
 */
export function Checklist({
  profile,
  headingId = 'checklist-heading',
  linkTo = '/profile',
}: {
  profile: ProfileLike;
  headingId?: string;
  /** Page that edits the profile; items link to its sections. */
  linkTo?: string;
}) {
  const items = profileChecklist(profile);
  const done = items.filter((i) => i.done).length;
  const complete = done === items.length;

  return (
    <section className={`surface-flat ${styles.card}`} aria-labelledby={headingId}>
      <div className={styles.head}>
        <h2 id={headingId} className="title title-lg">
          Profile completeness
        </h2>
        <p className={styles.count}>
          <span className="tabular">{done}</span> of {items.length} done
        </p>
      </div>

      <div
        className={styles.bar}
        role="progressbar"
        aria-label="Profile completeness"
        aria-valuemin={0}
        aria-valuemax={items.length}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${items.length} done`}
      >
        <span style={{ width: `${(done / items.length) * 100}%` }} />
      </div>

      <ul className={styles.list}>
        {items.map((item) => (
          <li key={item.key} className={styles.item} data-done={item.done}>
            <span className={styles.mark} aria-hidden="true">
              {item.done ? <CheckIcon /> : null}
            </span>
            <span className={styles.text}>
              <span className={styles.label}>
                {!item.done && <span className="sr-only">Missing: </span>}
                {item.label}
              </span>
              {!item.done && <span className={styles.why}>{item.why}</span>}
            </span>
            {item.done ? (
              <span className={styles.state}>Added</span>
            ) : (
              <Link href={`${linkTo}${TARGET[item.key]}`} className={styles.add}>
                Add<span className="sr-only"> {item.label.toLowerCase()}</span>
              </Link>
            )}
          </li>
        ))}
      </ul>

      {complete && (
        <p className={styles.complete}>
          <CheckIcon />
          Every field is filled in. Keep it current as your practice changes.
        </p>
      )}
    </section>
  );
}
