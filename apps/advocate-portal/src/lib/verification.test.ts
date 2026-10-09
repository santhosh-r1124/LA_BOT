import { describe, expect, it } from 'vitest';
import { statusInfo, stepCaption, stepStates } from './verification';

describe('verification status', () => {
  it('lists a profile only when it is verified', () => {
    expect(statusInfo('VERIFIED').listed).toBe(true);
    for (const s of ['PENDING', 'IN_REVIEW', 'REJECTED', 'SOMETHING_NEW']) {
      expect(statusInfo(s).listed).toBe(false);
    }
  });

  it('never promises that saving changes the review', () => {
    expect(statusInfo('PENDING').next).toMatch(/does not restart/);
    expect(statusInfo('REJECTED').next).toMatch(/does not send it back/);
  });

  it('describes a status it does not know without throwing', () => {
    const info = statusInfo('ON_HOLD');
    expect(info.label).toBe('On hold');
    expect(info.tone).toBe('neutral');
  });

  it('puts the steps in the right state', () => {
    expect(stepStates('PENDING')).toEqual(['done', 'current', 'todo']);
    expect(stepStates('VERIFIED')).toEqual(['done', 'done', 'done']);
    expect(stepStates('REJECTED')).toEqual(['done', 'failed', 'todo']);
  });

  it('gives every step state a word, so it is not colour alone', () => {
    expect(stepCaption('failed', 'REJECTED', 1)).toBe('Not approved');
    expect(stepCaption('current', 'IN_REVIEW', 1)).toBe('In progress');
    expect(stepCaption('current', 'PENDING', 1)).toBe('Waiting');
  });
});
