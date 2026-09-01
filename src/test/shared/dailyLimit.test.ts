import { describe, it, expect } from 'vitest';
import {
  CurriculumRule,
  LoadDistribution,
  autoMaxPerDay,
  buildMaxDailyByRule,
} from '../../shared/types';

const rule = (overrides: Partial<CurriculumRule> = {}): CurriculumRule => ({
  id: 'c1',
  groupId: 'g1',
  subjectId: 'subj-a',
  hoursPerWeek: 4,
  teacherId: 't1',
  ...overrides,
});

const ld = (overrides: Partial<LoadDistribution> = {}): LoadDistribution => ({
  teacherId: 't1',
  subjectId: 'subj-a',
  groupId: 'g1',
  hours: 4,
  ...overrides,
});

describe('autoMaxPerDay', () => {
  it('returns undefined without a load distribution', () => {
    expect(autoMaxPerDay(rule(), [])).toBeUndefined();
  });

  it('limits a >5h weekly load to 2 lessons per day', () => {
    expect(autoMaxPerDay(rule(), [ld({ hours: 6 })])).toBe(2);
    expect(autoMaxPerDay(rule(), [ld({ hours: 7 })])).toBe(2);
  });

  it('limits a 5h weekly load to 1 lesson per day', () => {
    expect(autoMaxPerDay(rule(), [ld({ hours: 5 })])).toBe(1);
  });

  it('limits a load under 5h to 1 lesson per day', () => {
    expect(autoMaxPerDay(rule(), [ld({ hours: 4 })])).toBe(1);
    expect(autoMaxPerDay(rule(), [ld({ hours: 1 })])).toBe(1);
  });

  it('keeps a pair allowance for double lessons even under 6h', () => {
    expect(autoMaxPerDay(rule({ doubleLesson: true }), [ld({ hours: 5 })])).toBe(2);
    expect(autoMaxPerDay(rule({ doubleLesson: true }), [ld({ hours: 3 })])).toBe(2);
  });

  it('returns undefined when no load-distribution entry matches the rule', () => {
    expect(autoMaxPerDay(rule(), [ld({ subjectId: 'subj-b' })])).toBeUndefined();
    expect(autoMaxPerDay(rule(), [ld({ groupId: 'g2' })])).toBeUndefined();
  });

  it('picks the teacher-specific entry for a split subject', () => {
    const entries = [
      ld({ hours: 2 }),
      ld({ teacherId: 't2', hours: 6 }),
    ];
    expect(autoMaxPerDay(rule(), entries)).toBe(1);
  });

  it('sums matching entries for a rule without a teacher', () => {
    const entries = [
      ld({ hours: 2 }),
      ld({ teacherId: 't2', hours: 3 }),
    ];
    expect(autoMaxPerDay(rule({ teacherId: undefined }), entries)).toBe(1);
  });
});

describe('buildMaxDailyByRule', () => {
  it('merges auto limits and lets explicit constraints win', () => {
    const project = {
      curriculum: [
        rule({ id: 'big', hoursPerWeek: 6 }),
        rule({ id: 'small', subjectId: 'subj-x', hoursPerWeek: 4 }),
        rule({ id: 'explicit', hoursPerWeek: 8 }),
      ],
      loadDistribution: [
        ld({ hours: 6 }),
        ld({ subjectId: 'subj-b', hours: 4 }),
        ld({ subjectId: 'subj-c', hours: 8 }),
      ],
      constraints: [
        { id: 'x1', kind: 'MAX_DAILY_LESSONS', ruleId: 'explicit', maxPerDay: 1 },
      ],
    };
    const map = buildMaxDailyByRule(project as any);
    expect(map.get('big')).toBe(2);
    // 'small' matches no load-distribution entry -> no auto limit
    expect(map.has('small')).toBe(false);
    expect(map.get('explicit')).toBe(1);
  });

  it('ignores rules without a load distribution entirely', () => {
    const map = buildMaxDailyByRule({
      curriculum: [rule()],
      loadDistribution: [],
      constraints: [],
    });
    expect(map.has('c1')).toBe(false);
  });
});