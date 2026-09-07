import { describe, it, expect } from 'vitest';
import { ProjectState, AllowedConflict } from '../../shared/types';
import { generateSemesterSchedules } from '../../worker/generator';

const PERIODS = [1, 2, 3, 4, 5, 6, 7, 8];

function busyEverywhereButMonday(teacherId: string, idPrefix: string) {
  return ['Tuesday', 'Wednesday', 'Thursday', 'Friday'].flatMap((day) =>
    PERIODS.map((p) => ({ id: `${idPrefix}-${day}-${p}`, kind: 'TEACHER_BUSY' as const, teacherId, day, periods: [p] }))
  );
}

// One teacher, one shared gym. Both lessons land in the same slot only when an
// approved overlap lets the teacher take a second group and the room host it.
// maxGroups is left unset (default 1) so nothing is allowed implicitly.
const teacherConsent: AllowedConflict[] = [
  { id: 'a1', kind: 'teacher', teacherId: 't1', groupId: 'g1', reason: 'TEACHER_SLOT' },
  { id: 'a2', kind: 'teacher', teacherId: 't1', groupId: 'g2', reason: 'TEACHER_SLOT' },
];
const roomConsent: AllowedConflict[] = [
  { id: 'a3', kind: 'room', roomId: 'gym', groupId: 'g1', reason: 'ROOM_SLOT' },
  { id: 'a4', kind: 'room', roomId: 'gym', groupId: 'g2', reason: 'ROOM_SLOT' },
];

function makeProject(allowedConflicts: AllowedConflict[] = []): ProjectState {
  return {
    version: '1.0.0',
    school: { id: 's1', name: 'Test', address: '' },
    academicYears: [],
    teachers: [{ id: 't1', name: 'Teacher A', subjects: ['pe'] }],
    subjects: [{ id: 'pe', name: 'PE', shortName: 'PE' }],
    rooms: [{ id: 'gym', name: 'Gymnasium', maxGroups: 1, types: ['gym'] }],
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
    allowedConflicts,
  };
}

async function runSemester(project: ProjectState, settings?: any) {
  const messages: { type: string; payload?: any }[] = [];
  await generateSemesterSchedules(project, (msg) => messages.push(msg), settings);
  return messages.find((m) => m.type === 'RESULT')!.payload.schedules.semester1;
}

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

function roomMultiGroupSlots(schedule: any[]): number {
  const bySlot = new Map<string, Set<string>>();
  for (const l of schedule) {
    if (!l.roomId) continue;
    const key = `${l.roomId}|${l.day}|${l.period}`;
    if (!bySlot.has(key)) bySlot.set(key, new Set());
    bySlot.get(key)!.add(l.groupId);
  }
  return [...bySlot.values()].filter((g) => g.size > 1).length;
}

function lessonCountByGroup(schedule: any[]): Map<string, number> {
  const byGroup = new Map<string, number>();
  for (const l of schedule) byGroup.set(l.groupId, (byGroup.get(l.groupId) || 0) + 1);
  return byGroup;
}

describe('allowed conflicts (approved overlaps open space for lessons)', () => {
  it('keeps an overlap hard when nothing is approved (16 hours, 8 slots -> 8 placed)', async () => {
    const result = await runSemester(makeProject([]), { attempts: 1 });

    // Both groups are forced into Monday (teacher busy elsewhere) and the room
    // accepts one class per slot: only 8 of 16 lessons fit, the rest unassigned.
    expect(result.schedule.length).toBe(8);
    expect(teacherMultiGroupSlots(result.schedule)).toBe(0);
  });

  it('lets the teacher overlap only when every involved class consents', async () => {
    const withConsent = await runSemester(makeProject(teacherConsent), { attempts: 1 });
    const without = await runSemester(makeProject([]), { attempts: 1 });

    expect(teacherMultiGroupSlots(withConsent.schedule)).toBe(0); // room still blocks
    expect(withConsent.schedule.length).toBe(without.schedule.length);
  });

  it('places every lesson once teacher AND room consent cover all classes', async () => {
    const result = await runSemester(makeProject([...teacherConsent, ...roomConsent]), { attempts: 1 });

    expect(result.schedule.length).toBe(16);
    expect(teacherMultiGroupSlots(result.schedule)).toBeGreaterThan(0);
    expect(roomMultiGroupSlots(result.schedule)).toBeGreaterThan(0);
  });

  it('reports the previously-unplaceable hours as placed (zero UNASSIGNED)', async () => {
    const result = await runSemester(makeProject([...teacherConsent, ...roomConsent]), { attempts: 1 });
    const unassigned = (result.conflicts || []).filter((c: any) => c.type === 'UNASSIGNED_HOURS')
      .reduce((s: number, c: any) => s + (c.missing ?? 1), 0);
    expect(unassigned).toBe(0);
  });

  it('emphasizes allowed-conflict groups in the placement order', async () => {
    // g1 consents to (teacher + room) overlap and is thus a priority group; g2
    // has no consent. Both compete for the same 8 Monday slots (teacher busy
    // elsewhere, one group per room/teacher slot). Because g1 is emphasized, it
    // is placed first and starves g2 of the scarce slots.
    const priorityConsent: AllowedConflict[] = [
      { id: 'p1', kind: 'teacher', teacherId: 't1', groupId: 'g1', reason: 'TEACHER_SLOT' },
      { id: 'p2', kind: 'room', roomId: 'gym', groupId: 'g1', reason: 'ROOM_SLOT' },
    ];
    const result = await runSemester(makeProject(priorityConsent), { attempts: 1 });

    const byGroup = lessonCountByGroup(result.schedule);
    expect(byGroup.get('g1')).toBe(result.schedule.length); // priority group took every slot it could
    expect(byGroup.get('g2') || 0).toBe(0); // non-consenting group starved by the priority emphasis
  });
});

// Two groups share one teacher (busy everywhere except Monday) and one gym.
// Each rule needs 5 lessons per semester but Monday has only 8 slots, so two
// lessons MUST overlap when both bound rules are guaranteed placement.
function makeOverloadedProject(allowedConflicts: AllowedConflict[] = []): ProjectState {
  return {
    version: '1.0.0',
    school: { id: 's1', name: 'Test', address: '' },
    academicYears: [],
    teachers: [{ id: 't1', name: 'Teacher A', subjects: ['pe'] }],
    subjects: [{ id: 'pe', name: 'PE', shortName: 'PE' }],
    rooms: [{ id: 'gym', name: 'Gymnasium', maxGroups: 1, types: ['gym'] }],
    groups: [
      { id: 'g1', name: '7-A', grade: 7, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
      { id: 'g2', name: '7-B', grade: 7, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
    ],
    curriculum: [
      { id: 'c1', groupId: 'g1', subjectId: 'pe', hoursPerWeek: 10, teacherId: 't1', roomId: 'gym' },
      { id: 'c2', groupId: 'g2', subjectId: 'pe', hoursPerWeek: 10, teacherId: 't1', roomId: 'gym' },
    ],
    loadDistribution: [],
    constraints: [
      ...busyEverywhereButMonday('t1', 'b1'),
      { id: 'cap1', kind: 'MAX_DAILY_LESSONS' as const, ruleId: 'c1', maxPerDay: 8 },
      { id: 'cap2', kind: 'MAX_DAILY_LESSONS' as const, ruleId: 'c2', maxPerDay: 8 },
    ],
    lockedLessons: [],
    allowedConflicts,
  };
}

describe('pair bindings (kind: pair force both bound rules to be placed)', () => {
  it('leaves bound lessons unplaced when no binding exists (20 lessons in semester1, 8 slots -> 8 placed)', async () => {
    const without = await runSemester(makeOverloadedProject([]), { attempts: 1 });
    expect(without.schedule.length).toBe(8);
  });

  it('guarantees every bound lesson is placed even when it forces an overlap', async () => {
    const binding: AllowedConflict[] = [
      { id: 'bp1', kind: 'pair', ruleIdA: 'c1', ruleIdB: 'c2', reason: 'TEACHER_SLOT' },
    ];
    const result = await runSemester(makeOverloadedProject(binding), { attempts: 1 });

    expect(result.schedule.length).toBe(20); // both bound rules fully placed
    const byGroup = lessonCountByGroup(result.schedule);
    expect(byGroup.get('g1')).toBe(10);
    expect(byGroup.get('g2')).toBe(10);
    // The guarantee required an overlap: some slot must hold both groups.
    const overlap = teacherMultiGroupSlots(result.schedule);
    expect(overlap).toBeGreaterThan(0);
  });

  it('survives regeneration: the bound rules are placed on every run', async () => {
    const binding: AllowedConflict[] = [
      { id: 'bp2', kind: 'pair', ruleIdA: 'c1', ruleIdB: 'c2', reason: 'TEACHER_SLOT' },
    ];
    for (let i = 0; i < 2; i++) {
      const result = await runSemester(makeOverloadedProject(binding), { attempts: 1 });
      expect(result.schedule.length).toBe(20);
    }
  });
});