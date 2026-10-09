import { describe, expect, it } from 'vitest';
import { pageWindow } from './page-window';

describe('pageWindow', () => {
  it('shows every page when there are few', () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(2, 5)).toEqual([1, 2, 3, 4, 5]);
  });

  it('collapses far-away pages into gaps', () => {
    expect(pageWindow(1, 50)).toEqual([1, 2, 'gap-end', 50]);
    expect(pageWindow(25, 50)).toEqual([1, 'gap-start', 24, 25, 26, 'gap-end', 50]);
    expect(pageWindow(50, 50)).toEqual([1, 'gap-start', 49, 50]);
  });

  it('shows a single skipped page as the page itself, never as a gap', () => {
    expect(pageWindow(4, 50)).toEqual([1, 2, 3, 4, 5, 'gap-end', 50]);
    expect(pageWindow(47, 50)).toEqual([1, 'gap-start', 46, 47, 48, 49, 50]);
  });

  it('never repeats or reorders pages', () => {
    for (let total = 1; total <= 30; total++) {
      for (let current = 1; current <= total; current++) {
        const nums = pageWindow(current, total).filter((i): i is number => typeof i === 'number');
        expect(nums).toEqual([...new Set(nums)].sort((a, b) => a - b));
        expect(nums).toContain(current);
        expect(nums[0]).toBe(1);
        expect(nums.at(-1)).toBe(total);
      }
    }
  });
});
