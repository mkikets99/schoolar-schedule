import { describe, it, expect } from 'vitest';
import { ProjectState } from '../../shared/types';
import { directFillGaps } from '../../worker/generator';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function weekGapFor(schedule: any[], teacherId: string): number {
  let total = 0;
  for (const day of DAYS) {
    const periods = schedule
      .filter((l: any) => l.teacherId === teacherId && l.day === day)
      .map((l: any) => l.period)
      .sort((a: number, b: number) => a - b);
    for (let i = 1; i < periods.length; i++) {
      total += Math.max(0, periods[i] - periods[i - 1] - 1);
    }
  }
  return total;
}

function makeProject(): ProjectState {
  return {
    version: '1.0.0',
    school: { id: 's1', name: 'Test', address: '' },
    academicYears: [],
    teachers: [
      { id: 't1', name: 'T1', subjects: ['m'] },
      { id: 't2', name: 'T2', subjects: ['m'] },
      { id: 't3', name: 'T3', subjects: ['m'] },
      { id: 't4', name: 'T4', subjects: ['m'] },
    ],
    subjects: [{ id: 'm', name: 'Math', shortName: 'M' }],
    rooms: [],
    groups: [
      { id: 'g1', name: 'g1', grade: 1, subgroups: [], periodStart: 1, periodEnd: 8 },
      { id: 'g2', name: 'g2', grade: 1, subgroups: [], periodStart: 1, periodEnd: 8 },
      { id: 'g3', name: 'g3', grade: 1, subgroups: [], periodStart: 1, periodEnd: 8 },
    ],
    curriculum: [
      { id: 'c1', groupId: 'g1', subjectId: 'm', hoursPerWeek: 5, teacherId: 't1' },
      { id: 'c2', groupId: 'g2', subjectId: 'm', hoursPerWeek: 5, teacherId: 't1' },
      { id: 'c3', groupId: 'g3', subjectId: 'm', hoursPerWeek: 5, teacherId: 't2' },
      { id: 'c4', groupId: 'g1', subjectId: 'm', hoursPerWeek: 5, teacherId: 't3' },
      { id: 'c5', groupId: 'g2', subjectId: 'm', hoursPerWeek: 5, teacherId: 't4' },
    ],
    loadDistribution: [],
    constraints: [],
  };
}

describe('directFillGaps (worker v0.3 parallel replacement)', () => {
  it('closes a teacher-day gap by moving its own lesson into the cell, leaving the unrelated occupant', () => {
    const project = makeProject();
    // t1 teaches g1 @ Mon 1 and g2 @ Mon 4  -> t1 has a Mon gap at periods 2/3.
    // g3 (t2's group) already occupies Mon 1, so a two-way swap of t1's Mon 1
    // lesson with a g3 lesson is impossible - a direct fill is the only way.
    // With the daily-cap fix this reaches a fully gap-free [2,3].
    const schedule: any[] = [
      { id: 'a', ruleId: 'c1', groupId: 'g1', subjectId: 'm', teacherId: 't1', day: 'Monday', period: 1 },
      { id: 'b', ruleId: 'c2', groupId: 'g2', subjectId: 'm', teacherId: 't1', day: 'Monday', period: 4 },
      { id: 'c', ruleId: 'c3', groupId: 'g3', subjectId: 'm', teacherId: 't2', day: 'Monday', period: 2 },
      { id: 'd', ruleId: 'c3', groupId: 'g3', subjectId: 'm', teacherId: 't2', day: 'Monday', period: 1 },
    ];

    expect(weekGapFor(schedule, 't1')).toBe(2);
    directFillGaps(schedule, project, 8);
    expect(weekGapFor(schedule, 't1')).toBe(0);

    // t1 still has exactly two Monday lessons (day balance is unchanged) and the
    // unrelated t2/g3 lessons are untouched.
    expect(schedule.filter((l: any) => l.teacherId === 't1' && l.day === 'Monday')).toHaveLength(2);
    expect(schedule.filter((l: any) => l.teacherId === 't2')).toHaveLength(2);
    expect(schedule.find((l: any) => l.id === 'c')!.period).toBe(2);
    expect(schedule.find((l: any) => l.id === 'd')!.period).toBe(1);
  });

  it('leaves the schedule untouched when every direct fill is blocked by a group clash', () => {
    const project = makeProject();
    // t1 has a Mon gap at 2/3 ([1,4]). Both g1 and g2 are already busy at Mon 2
    // AND Mon 3 (t3/t4 lessons), so neither of t1's lessons can be moved straight
    // into either hole - the pass must change nothing.
    const schedule: any[] = [
      { id: 'a', ruleId: 'c1', groupId: 'g1', subjectId: 'm', teacherId: 't1', day: 'Monday', period: 1 },
      { id: 'b', ruleId: 'c2', groupId: 'g2', subjectId: 'm', teacherId: 't1', day: 'Monday', period: 4 },
      { id: 'e', ruleId: 'c4', groupId: 'g1', subjectId: 'm', teacherId: 't3', day: 'Monday', period: 2 },
      { id: 'g', ruleId: 'c4', groupId: 'g1', subjectId: 'm', teacherId: 't3', day: 'Monday', period: 3 },
      { id: 'f', ruleId: 'c5', groupId: 'g2', subjectId: 'm', teacherId: 't4', day: 'Monday', period: 2 },
      { id: 'h', ruleId: 'c5', groupId: 'g2', subjectId: 'm', teacherId: 't4', day: 'Monday', period: 3 },
    ];
    const before = schedule.map((l: any) => `${l.id}:${l.period}`).join(',');
    expect(weekGapFor(schedule, 't1')).toBe(2);
    directFillGaps(schedule, project, 8);
    const after = schedule.map((l: any) => `${l.id}:${l.period}`).join(',');
    expect(after).toBe(before);
  });
});
