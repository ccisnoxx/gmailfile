import { describe, expect, it } from 'vitest';
import { dateBoundary } from '../src/features/accounts/query-state';

describe('Wave 4 (TC-P2-005): dateBoundary 闰年、跨年与非法日期边界', () => {
  it('正确计算闰年 2 月 29 日与跨年 12 月 31 日的本地半开区间边界', () => {
    const leapStart = dateBoundary('2024-02-29');
    const leapEnd = dateBoundary('2024-02-29', true);
    expect(leapStart).toBeDefined();
    expect(leapEnd).toBeDefined();
    expect(leapStart).not.toBe('invalid-date');
    expect(leapEnd).not.toBe('invalid-date');

    const startDate = new Date(leapStart!);
    const endDate = new Date(leapEnd!);
    expect(startDate.getFullYear()).toBe(2024);
    expect(startDate.getMonth()).toBe(1);
    expect(startDate.getDate()).toBe(29);
    expect(endDate.getFullYear()).toBe(2024);
    expect(endDate.getMonth()).toBe(2);
    expect(endDate.getDate()).toBe(1);

    const decEnd = dateBoundary('2026-12-31', true);
    expect(decEnd).not.toBe('invalid-date');
    const janFirst = new Date(decEnd!);
    expect(janFirst.getFullYear()).toBe(2027);
    expect(janFirst.getMonth()).toBe(0);
    expect(janFirst.getDate()).toBe(1);
  });

  it('拒绝平年 2 月 29 日与非法日期字符串，空值返回 undefined', () => {
    expect(dateBoundary('')).toBeUndefined();
    expect(dateBoundary('2025-02-29')).toBe('invalid-date');
    expect(dateBoundary('2026-04-31')).toBe('invalid-date');
    expect(dateBoundary('2026-13-01')).toBe('invalid-date');
    expect(dateBoundary('2026/03/08')).toBe('invalid-date');
  });
});
