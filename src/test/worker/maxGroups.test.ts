import { describe, it, expect } from 'vitest';
import { ProjectState } from '../../shared/types';
import { generateSemesterSchedules } from '../../worker/generator';

const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

function busyEverywhereButMonday(teacherId: string, idPrefix: string) {
  return ['Tuesday', 'Wednesday', 'Thursday', 'Friday'].flatMap((day) =>
    PERIODS.map((p) => ({ id: `${idPrefix}-${day}-${p}`, kind: 'TEACHER_BUSY' as const, teacherId, day, periods: [p] }))
  );
}

// Both PE teachers can only teach on Monday, so both groups are forced into the
// same day. Whether they can share the gym then depends solely on maxGroups.
function makeProject(rooms: any[]): ProjectState {
  return {
    version: '1.0.0',
    school: { id: 's1', name: 'Test', address: '' },
    academicYears: [],
    teachers: [
      { id: 't1', name: 'Teacher A', subjects: ['pe'] },
      { id: 't2', name: 'Teacher B', subjects: ['pe'] },
    ],
    subjects: [{ id: 'pe', name: 'PE', shortName: 'PE' }],
    rooms,
    groups: [
      { id: 'g1', name: '7-A', grade: 7, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
      { id: 'g2', name: '7-B', grade: 7, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
    ],
    curriculum: [
      { id: 'c1', groupId: 'g1', subjectId: 'pe', hoursPerWeek: 8, teacherId: 't1', roomId: 'gym' },
      { id: 'c2', groupId: 'g2', subjectId: 'pe', hoursPerWeek: 8, teacherId: 't2', roomId: 'gym' },
    ],
    loadDistribution: [],
    constraints: [
      ...busyEverywhereButMonday('t1', 'b1'),
      ...busyEverywhereButMonday('t2', 'b2'),
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

// Groups co-located in a room = two different groupIds at the same day+period.
function coLocatedSlots(schedule: any[]): number {
  const bySlot = new Map<string, Set<string>>();
  for (const l of schedule) {
    const key = `${l.day}|${l.period}`;
    if (!bySlot.has(key)) bySlot.set(key, new Set());
    bySlot.get(key)!.add(l.groupId);
  }
  return [...bySlot.values()].filter((g) => g.size > 1).length;
}

describe('room maxGroups (shared facilities such as a gym or PE hall)', () => {
  it('lets two groups share the same slot when maxGroups=2', async () => {
    const rooms = [{ id: 'gym', name: 'Gymnasium', maxGroups: 2, types: ['gym'] }];

    const result = await runSemester(makeProject(rooms), { attempts: 1 });

    // Both groups are forced to Monday and fit together because the gym holds 2.
    expect(coLocatedSlots(result.schedule)).toBeGreaterThan(0);
    // No slot ever exceeds the configured 2-group cap.
    const bySlot = new Map<string, Set<string>>();
    for (const l of result.schedule) {
      const key = `${l.day}|${l.period}`;
      if (!bySlot.has(key)) bySlot.set(key, new Set());
      bySlot.get(key)!.add(l.groupId);
    }
    for (const groups of bySlot.values()) expect(groups.size).toBeLessThanOrEqual(2);
  });

  it('keeps two groups apart (no shared slot) when maxGroups=1', async () => {
    const rooms = [{ id: 'gym', name: 'Gymnasium', maxGroups: 1, types: ['gym'] }];

    const result = await runSemester(makeProject(rooms), { attempts: 1 });

    // A single-group room never co-locates two groups in the same slot.
    expect(coLocatedSlots(result.schedule)).toBe(0);
  });

  it('defaults to one group per room when maxGroups is unset', async () => {
    const rooms = [{ id: 'gym', name: 'Gymnasium', types: ['gym'] }];

    const result = await runSemester(makeProject(rooms), { attempts: 1 });

    expect(coLocatedSlots(result.schedule)).toBe(0);
  });
});
