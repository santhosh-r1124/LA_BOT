import { describe, expect, it } from 'vitest';
import {
  CANCELLABLE_CONSULTATION_STATUSES,
  CONSULTATION_STATUSES,
  consultationStatusLabel,
} from './consultation';

describe('consultation helpers', () => {
  it('labels every status with user-facing text', () => {
    for (const status of CONSULTATION_STATUSES) {
      const label = consultationStatusLabel(status);
      expect(label).toBeTruthy();
      expect(label).not.toBe(status); // never leaks the raw enum value
    }
  });

  it('only allows cancelling active consultations (mirrors consultation_lifecycle.can_cancel)', () => {
    expect([...CANCELLABLE_CONSULTATION_STATUSES].sort()).toEqual(['ACCEPTED', 'REQUESTED']);
  });
});
