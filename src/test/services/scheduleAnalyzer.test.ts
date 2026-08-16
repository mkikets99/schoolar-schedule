import { describe, it, expect } from 'vitest';
import { ProjectState, Lesson, Constraint } from '../../shared/types';
import { analyzeSchedule, buildConflicts, computeScore, countLessons, CONFLICT_REASON } from '../../ui/services/scheduleAnalyzer';

const makeProject = (overrides: Partial<ProjectState> = {}, constraints: Constraint[] = []): ProjectState => ({
  version: '1.0.0',
  school: { id: 's1', name: 'Test School' },
  academicYears: [],
  teachers: [
    { id: 't1', name: 'Anna', subjects: ['subj1'] },
    { id: 't2', name: 'Bohdan', subjects: ['subj2'] },
  ],
  subjects: [
    { id: 'subj1', name: 'Math' },
    { id: 'subj2', name: 'Physics' },
    { id: 'subj3', name: 'History' },
  ],
  rooms: [{ id: 'r1', name: 'Room 1', types: [] }],
  groups: [
    { id: 'g1', name: '5-A', grade: 5, subgroups: [], periodStart: 1, periodEnd: 6, maxDailyLessons: 3 },
    { id: 'g2', name: '5-B', grade: 5, subgroups: [] },
  ],
  curriculum: [],
  loadDistribution: [],
  constraints,
  ...overrides,
});

const lesson = (id: string, groupId: string, subjectId: string, day: string, period: number, extra: Partial<Lesson> = {}): Lesson => ({
  id,
  ruleId: `rule-${id}`,
  groupId,
  subjectId,
  teacherId: 't1',
  roomId: 'r1',
  day,
  period,
  ...extra,
});

describe('analyzeSchedule', () => {
  it('flags a teacher double-booked in the same slot', () => {
    const project = makeProject();
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1),
      lesson('l2', 'g2', 'subj2', 'Monday', 1, { teacherId: 't1' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toContain(CONFLICT_REASON.TEACHER_SLOT);
    expect(a.byLesson.get('l2')).toContain(CONFLICT_REASON.TEACHER_SLOT);
  });

  it('records the lesson blocks that cause a slot conflict', () => {
    const project = makeProject();
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1, { teacherId: 't1' }),
      lesson('l2', 'g2', 'subj2', 'Monday', 1, { teacherId: 't1' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.causesByLesson.get('l1')?.map(l => l.id)).toEqual(['l2']);
    expect(a.causesByLesson.get('l2')?.map(l => l.id)).toEqual(['l1']);
  });

  it('flags a group with two different subjects in the same slot', () => {
    const project = makeProject();
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1, { teacherId: 't1' }),
      lesson('l2', 'g1', 'subj2', 'Monday', 1, { teacherId: 't2' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toContain(CONFLICT_REASON.GROUP_SLOT);
    expect(a.byLesson.get('l2')).toContain(CONFLICT_REASON.GROUP_SLOT);
  });

  it('does not flag a split (same group, same subject) sharing a slot', () => {
    const project = makeProject();
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1, { teacherId: 't1' }),
      lesson('l2', 'g1', 'subj1', 'Monday', 1, { teacherId: 't2' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toBeUndefined();
    expect(a.byLesson.get('l2')).toBeUndefined();
  });

  it('flags a room double-booked in the same slot', () => {
    const project = makeProject();
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1),
      lesson('l2', 'g2', 'subj2', 'Monday', 1, { roomId: 'r1' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toContain(CONFLICT_REASON.ROOM_SLOT);
    expect(a.byLesson.get('l2')).toContain(CONFLICT_REASON.ROOM_SLOT);
  });

  it('flags a teacher-busy constraint violation', () => {
    const project = makeProject({}, [{ id: 'c1', kind: 'TEACHER_BUSY', teacherId: 't1', day: 'Monday', periods: [3] }]);
    const placed = [lesson('l1', 'g1', 'subj1', 'Monday', 3)];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toContain(CONFLICT_REASON.TEACHER_BUSY);
  });

  it('flags a no-first-period constraint violation', () => {
    const project = makeProject({}, [{ id: 'c2', kind: 'NO_FIRST_PERIOD', subjectId: 'subj1', groupId: 'g1' }]);
    const placed = [lesson('l1', 'g1', 'subj1', 'Monday', 1)];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toContain(CONFLICT_REASON.NO_FIRST);
  });

  it('does not flag no-first-period when not the first period', () => {
    const project = makeProject({}, [{ id: 'c2', kind: 'NO_FIRST_PERIOD', subjectId: 'subj1', groupId: 'g1' }]);
    const placed = [lesson('l1', 'g1', 'subj1', 'Monday', 2)];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toBeUndefined();
  });

  it('flags lessons outside the group period range', () => {
    const project = makeProject();
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 7),
      lesson('l2', 'g1', 'subj2', 'Monday', 3, { teacherId: 't2' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toContain(CONFLICT_REASON.OUT_OF_RANGE);
    expect(a.byLesson.get('l2')).toBeUndefined();
  });

  it('flags groups that exceed their daily lesson limit', () => {
    const project = makeProject();
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1),
      lesson('l2', 'g1', 'subj2', 'Monday', 2, { teacherId: 't2' }),
      lesson('l3', 'g1', 'subj3', 'Monday', 3, { teacherId: 't2' }),
      lesson('l4', 'g1', 'subj3', 'Monday', 4, { teacherId: 't2' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toContain(CONFLICT_REASON.DAILY_OVERLOAD);
    expect(a.byLesson.get('l4')).toContain(CONFLICT_REASON.DAILY_OVERLOAD);
  });

  it('does not flag a daily overload when split lessons stay within the daily lesson limit', () => {
    const project = makeProject({
      curriculum: [
        { id: 'r1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't1' },
        { id: 'r2', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't2' },
      ],
    });
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'r1', teacherId: 't1' }),
      lesson('l2', 'g1', 'subj1', 'Monday', 1, { ruleId: 'r2', teacherId: 't2' }),
      lesson('l3', 'g1', 'subj2', 'Monday', 2, { teacherId: 't2' }),
      lesson('l4', 'g1', 'subj3', 'Monday', 3, { teacherId: 't2' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toBeUndefined();
    expect(a.byLesson.get('l4')).toBeUndefined();
  });

  it('flags a daily overload when split lessons plus others exceed the daily lesson limit', () => {
    const project = makeProject({
      groups: [{ id: 'g1', name: '5-A', grade: 5, subgroups: [], periodStart: 1, periodEnd: 6, maxDailyLessons: 2 }],
      curriculum: [
        { id: 'r1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't1' },
        { id: 'r2', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't2' },
      ],
    });
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'r1', teacherId: 't1' }),
      lesson('l2', 'g1', 'subj1', 'Monday', 1, { ruleId: 'r2', teacherId: 't2' }),
      lesson('l3', 'g1', 'subj2', 'Monday', 2, { teacherId: 't2' }),
      lesson('l4', 'g1', 'subj3', 'Monday', 3, { teacherId: 't2' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toContain(CONFLICT_REASON.DAILY_OVERLOAD);
    expect(a.byLesson.get('l4')).toContain(CONFLICT_REASON.DAILY_OVERLOAD);
  });

  it('counts unassigned lessons per rule from the pool', () => {
    const project = makeProject();
    const pool = [
      lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' }),
      lesson('p2', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' }),
      lesson('p3', 'g2', 'subj2', '', 0, { ruleId: 'rule-b' }),
    ];
    const a = analyzeSchedule([], pool, project);
    expect(a.unassignedByRule.get('rule-a')).toBe(2);
    expect(a.unassignedByRule.get('rule-b')).toBe(1);
    expect(a.assignedCount).toBe(0);
    expect(a.neededCount).toBe(3);
  });

  it('counts a split lesson (same group+subject in one slot) as 1, not 2', () => {
    const project = makeProject({
      curriculum: [
        { id: 'r1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't1' },
        { id: 'r2', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't2' },
      ],
    });
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'r1', teacherId: 't1' }),
      lesson('l2', 'g1', 'subj1', 'Monday', 1, { ruleId: 'r2', teacherId: 't2' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.assignedCount).toBe(1);
    expect(a.neededCount).toBe(1);
  });

  it('counts a missing split lesson (both teacher parts) as 1 unassigned', () => {
    const project = makeProject({
      curriculum: [
        { id: 'r1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't1' },
        { id: 'r2', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't2' },
      ],
    });
    const pool = [
      lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'r1' }),
      lesson('p2', 'g1', 'subj1', '', 0, { ruleId: 'r2' }),
    ];
    const a = analyzeSchedule([], pool, project);
    expect(a.assignedCount).toBe(0);
    expect(a.neededCount).toBe(1);
  });

  it('keeps counting distinct subjects in the same slot as separate lessons', () => {
    const project = makeProject({
      curriculum: [
        { id: 'r1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't1' },
        { id: 'r2', groupId: 'g1', subjectId: 'subj2', hoursPerWeek: 2, teacherId: 't2' },
      ],
    });
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'r1' }),
      lesson('l2', 'g1', 'subj2', 'Monday', 1, { ruleId: 'r2', teacherId: 't2' }),
    ];
    expect(countLessons(placed, [], project).assigned).toBe(2);
  });
});

describe('buildConflicts', () => {
  it('emits UNASSIGNED_HOURS and MANUAL_CONFLICT entries', () => {
    const project = makeProject();
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1),
      lesson('l2', 'g2', 'subj2', 'Monday', 1),
    ];
    const pool = [lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' })];
    const conflicts = buildConflicts(placed, pool, project);
    expect(conflicts).toContainEqual({ type: 'UNASSIGNED_HOURS', ruleId: 'rule-a', missing: 1 });
    expect(conflicts).toContainEqual(
      expect.objectContaining({ type: 'MANUAL_CONFLICT', lessonId: 'l1', reasons: expect.arrayContaining([CONFLICT_REASON.TEACHER_SLOT]) })
    );
  });
});

describe('computeScore', () => {
  it('returns 1 for a full, conflict-free schedule', () => {
    const project = makeProject();
    const placed = [lesson('l1', 'g1', 'subj1', 'Monday', 1, { roomId: undefined })];
    expect(computeScore(placed, [], project)).toBe(1);
  });

  it('returns less than 1 when lessons are missing', () => {
    const project = makeProject();
    const placed = [lesson('l1', 'g1', 'subj1', 'Monday', 1, { roomId: undefined })];
    const pool = [lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' })];
    expect(computeScore(placed, pool, project)).toBe(0.5);
  });

  it('returns less than 1 when conflicts exist', () => {
    const project = makeProject();
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1),
      lesson('l2', 'g2', 'subj2', 'Monday', 1),
    ];
    expect(computeScore(placed, [], project)).toBe(0.8);
  });

  it('returns 1 when there is nothing to schedule', () => {
    expect(computeScore([], [], makeProject())).toBe(1);
  });
});
