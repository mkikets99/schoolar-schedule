import { describe, it, expect } from 'vitest';
import { ProjectState } from '../../shared/types';
import { generateSemesterSchedules } from '../../worker/generator';

const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

function busyEverywhereButMonday(teacherId: string, idPrefix: string) {
  return ['Tuesday', 'Wednesday', 'Thursday', 'Friday'].flatMap((day) =>
    PERIODS.map((p) => ({ id: `${idPrefix}-${day}-${p}`, kind: 'TEACHER_BUSY' as const, teacherId, day, periods: [p] }))
  );
}

// One teacher covers the same subject for both groups (a co-teaching / hall
// scenario). The teacher can only work on Monday, so both lessons must land in
// that day; whether the reader can place them in the SAME slot then depends
// solely on the teacher's maxGroups.
function makeProject(teacherMaxGroups?: number): ProjectState {
  return {
    version: '1.0.0',
    school: { id: 's1', name: 'Test', address: '' },
    academicYears: [],
    teachers: [
      { id: 't1', name: 'Teacher A', subjects: ['pe'], maxGroups: teacherMaxGroups },
    ],
    subjects: [{ id: 'pe', name: 'PE', shortName: 'PE' }],
    rooms: [{ id: 'gym', name: 'Gymnasium', maxGroups: 2, types: ['gym'] }],
    groups: [
      { id: 'g1', name: '7-A', grade: 7, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
      { id: 'g2', name: '7-B', grade: 7, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
    ],
    curriculum: [
      { id: 'c1', groupId: 'g1', subjectId: 'pe', hoursPerWeek: 8, teacherId: 't1', roomId: 'gym' },
      { id: 'c2', groupId: 'g2', subjectId: 'pe', hoursPerWeek: 8, teacherId: 't1', roomId: 'gym' },
    ],
    loadDistribution: [],
    constraints: [
      ...busyEverywhereButMonday('t1', 'b1'),
      { id: 'cap1', kind: 'MAX_DAILY_LESSONS' as const, ruleId: 'c1', maxPerDay: 8 },
      { id: 'cap2', kind: 'MAX_DAILY_LESSONS' as const, ruleId: 'c2', maxPerDay: 8 },
    ],
    lockedLessons: [],
  };
}

async function runSemester(project: ProjectState, settings?: any) {
  const messages: { type: string; payload?: any }[] = [];
  await generateSemesterSchedules(project, (msg) => messages.push(msg), settings);
  return messages.find((m) => m.type === 'RESULT')!.payload.schedules.semester1;
}

// Slots where one teacher teaches more than one distinct group at the same
// day+period.
function teacherMultiGroupSlots(schedule: any[]): number {
  const bySlot = new Map<string, Set<string>>();
  for (const l of schedule) {
    if (!l.teacherId) continue;
    const key = `${l.teacherId}|${l.day}|${l.period}`;
    if (!bySlot.has(key)) bySlot.set(key, new Set());
    bySlot.get(key)!.add(l.groupId);
  }
  return [...bySlot.values()].filter((g) => g.size > 1).length;
}

describe('teacher maxGroups (co-teaching / supervising several classes at once)', () => {
  it('lets one teacher take two groups in the same slot when maxGroups=2', async () => {
    const result = await runSemester(makeProject(2), { attempts: 1 });

    // Both groups are forced to Monday and the same teacher may supervise both
    // in the same slot because maxGroups=2.
    expect(teacherMultiGroupSlots(result.schedule)).toBeGreaterThan(0);
    // No slot ever exceeds the teacher's 2-group cap.
    const bySlot = new Map<string, Set<string>>();
    for (const l of result.schedule) {
      const key = `${l.teacherId}|${l.day}|${l.period}`;
      if (!bySlot.has(key)) bySlot.set(key, new Set());
      bySlot.get(key)!.add(l.groupId);
    }
    for (const groups of bySlot.values()) expect(groups.size).toBeLessThanOrEqual(2);
  });

  it('keeps a single teacher from covering two groups in one slot when maxGroups=1', async () => {
    const result = await runSemester(makeProject(1), { attempts: 1 });

    expect(teacherMultiGroupSlots(result.schedule)).toBe(0);
  });

  it('defaults to one group per teacher per slot when maxGroups is unset', async () => {
    const result = await runSemester(makeProject(undefined), { attempts: 1 });

    expect(teacherMultiGroupSlots(result.schedule)).toBe(0);
  });
});
