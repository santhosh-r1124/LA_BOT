/**
 * What each verification status means, in words an advocate can act on.
 * The status only ever changes when an administrator acts on it; saving the
 * profile does not move it (see `PATCH /advocates/me` in apps/api).
 */

export type Tone = 'warn' | 'accent' | 'ok' | 'danger' | 'neutral';

export interface StatusInfo {
  /** Short badge text. */
  label: string;
  tone: Tone;
  /** One sentence that says where the profile stands. */
  headline: string;
  /** What that means for being found, in plain words. */
  explain: string;
  /** What the advocate can do now. */
  next: string;
  /** True only when the profile is in the public directory. */
  listed: boolean;
}

const STATUS: Record<string, StatusInfo> = {
  PENDING: {
    label: 'Awaiting review',
    tone: 'warn',
    headline: 'Your profile is waiting for review',
    explain:
      'An administrator checks each new advocate before a profile can appear in the public directory. Until then, nobody searching the directory can find you.',
    next: 'Keep your details complete and accurate. Saving changes does not restart or speed up the review.',
    listed: false,
  },
  IN_REVIEW: {
    label: 'In review',
    tone: 'accent',
    headline: 'An administrator is reviewing your profile',
    explain: 'Your details are being checked. The profile is not in the public directory yet.',
    next: 'You can still edit your details. Check back here for the result.',
    listed: false,
  },
  VERIFIED: {
    label: 'Verified',
    tone: 'ok',
    headline: 'Your profile is listed in the directory',
    explain:
      'People using the Legal Advisor advocate directory can find you by state, practice area and language.',
    next: 'Changes you save here are shown in the directory. Keep your fee and languages current.',
    listed: true,
  },
  REJECTED: {
    label: 'Not approved',
    tone: 'danger',
    headline: 'Your profile was not approved',
    explain:
      'An administrator reviewed the profile and did not approve it, so it is not in the public directory.',
    next: 'Read the reviewer note, fix what it points to, then ask the administrator to look again. Saving changes here does not send it back for review on its own.',
    listed: false,
  },
};

export function statusInfo(status: string): StatusInfo {
  const known = STATUS[status];
  if (known) return known;
  const label = status
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());
  return {
    label,
    tone: 'neutral',
    headline: `Status: ${label}`,
    explain: 'This status is not one the portal knows how to describe.',
    next: 'Contact the administrator if you are unsure what it means.',
    listed: false,
  };
}

export type StepState = 'done' | 'current' | 'todo' | 'failed';

export const STEP_LABELS = ['Registered', 'Reviewed by an administrator', 'Listed in the directory'];

/** State of each of the three steps for a status. */
export function stepStates(status: string): [StepState, StepState, StepState] {
  switch (status) {
    case 'VERIFIED':
      return ['done', 'done', 'done'];
    case 'REJECTED':
      return ['done', 'failed', 'todo'];
    case 'IN_REVIEW':
    case 'PENDING':
      return ['done', 'current', 'todo'];
    default:
      return ['done', 'todo', 'todo'];
  }
}

/** The word shown under a step, so state is never conveyed by colour or shape alone. */
export function stepCaption(state: StepState, status: string, index: number): string {
  if (state === 'done') return 'Done';
  if (state === 'failed') return 'Not approved';
  if (state === 'current') return index === 1 && status === 'IN_REVIEW' ? 'In progress' : 'Waiting';
  return 'Not yet';
}
