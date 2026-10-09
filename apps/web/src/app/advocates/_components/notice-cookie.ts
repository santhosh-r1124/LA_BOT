/**
 * Whether the sample-data notice was dismissed, kept in a cookie rather than
 * localStorage so the server can read it and render the page in its final shape
 * (a notice that pops in or out after load shifts the layout). It holds no
 * personal data and is only sent to /advocates pages.
 */
export const SAMPLE_NOTICE_COOKIE = 'la-advocates-sample-notice';

/** The value stored by the first version of the notice, in localStorage. */
const LEGACY_STORAGE_KEY = 'la-advocates-sample-notice';

const ONE_YEAR_S = 60 * 60 * 24 * 365;

/** Browser only: remember the dismissal. Blocked cookies just mean it comes back next visit. */
export function rememberNoticeDismissed(): void {
  try {
    document.cookie = `${SAMPLE_NOTICE_COOKIE}=dismissed; Max-Age=${ONE_YEAR_S}; Path=/advocates; SameSite=Lax`;
  } catch {
    /* the notice stays dismissed for this visit only */
  }
}

/** Browser only: a dismissal saved by the earlier localStorage version. */
export function legacyNoticeDismissed(): boolean {
  try {
    return window.localStorage.getItem(LEGACY_STORAGE_KEY) === 'dismissed';
  } catch {
    return false;
  }
}
