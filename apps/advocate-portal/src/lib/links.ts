import { env } from './env';

/** The public advocate directory on the Legal Advisor site. */
export const DIRECTORY_URL = `${env.NEXT_PUBLIC_WEB_BASE_URL.replace(/\/$/, '')}/advocates`;

/** The Legal Advisor site itself. */
export const WEB_URL = env.NEXT_PUBLIC_WEB_BASE_URL.replace(/\/$/, '');
