import { describe, it, expect } from 'vitest';
import { ProjectState, Lesson, Constraint } from '../../shared/types';
import {
  analyzeSchedule,
  buildConflicts,
  computeScore,
  countLessons,
  CONFLICT_REASON,
  analyzeEmptySlots,
  buildPendingByRule,
  EMPTY_SLOT_REASON,
} from '../../ui/services/scheduleAnalyzer';

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

  it('flags a rule that exceeds its max lessons-per-day limit', () => {
    const project = makeProject({}, [
      { id: 'c3', kind: 'MAX_DAILY_LESSONS', ruleId: 'rule-l1', maxPerDay: 1 },
    ]);
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'rule-l1', teacherId: 't1' }),
      lesson('l2', 'g1', 'subj1', 'Monday', 2, { ruleId: 'rule-l1', teacherId: 't1' }),
      lesson('l3', 'g1', 'subj2', 'Tuesday', 1, { ruleId: 'rule-l2', teacherId: 't2' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toContain(CONFLICT_REASON.DAILY_RULE);
    expect(a.byLesson.get('l2')).toContain(CONFLICT_REASON.DAILY_RULE);
    expect(a.byLesson.get('l3')).toBeUndefined();
  });

  it('does not flag a rule that stays within its daily limit', () => {
    const project = makeProject({}, [
      { id: 'c3', kind: 'MAX_DAILY_LESSONS', ruleId: 'rule-l1', maxPerDay: 2 },
    ]);
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'rule-l1' }),
      lesson('l2', 'g1', 'subj1', 'Monday', 2, { ruleId: 'rule-l1' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toBeUndefined();
    expect(a.byLesson.get('l2')).toBeUndefined();
  });

  it('flags a rule that exceeds its load-distribution auto limit', () => {
    const project = makeProject({
      curriculum: [
        { id: 'rule-l1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 4, teacherId: 't1' },
      ],
      loadDistribution: [
        { teacherId: 't1', subjectId: 'subj1', groupId: 'g1', hours: 4 },
      ],
    });
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'rule-l1', teacherId: 't1' }),
      lesson('l2', 'g1', 'subj1', 'Monday', 2, { ruleId: 'rule-l1', teacherId: 't1' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toContain(CONFLICT_REASON.DAILY_RULE);
    expect(a.byLesson.get('l2')).toContain(CONFLICT_REASON.DAILY_RULE);
  });

  it('flags a >5h load auto-limited to 2 per day', () => {
    const project = makeProject({
      curriculum: [
        { id: 'rule-l1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 8, teacherId: 't1' },
      ],
      loadDistribution: [
        { teacherId: 't1', subjectId: 'subj1', groupId: 'g1', hours: 8 },
      ],
    });
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'rule-l1', teacherId: 't1' }),
      lesson('l2', 'g1', 'subj1', 'Monday', 2, { ruleId: 'rule-l1', teacherId: 't1' }),
      lesson('l3', 'g1', 'subj1', 'Monday', 3, { ruleId: 'rule-l1', teacherId: 't1' }),
    ];
    const a = analyzeSchedule(placed, [], project);
    expect(a.byLesson.get('l1')).toContain(CONFLICT_REASON.DAILY_RULE);
    expect(a.byLesson.get('l3')).toContain(CONFLICT_REASON.DAILY_RULE);
  });

  it('marks empty slots blocked by the load-distribution auto limit', () => {
    const project = makeProject({
      curriculum: [
        { id: 'rule-l1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 4, teacherId: 't1' },
      ],
      loadDistribution: [
        { teacherId: 't1', subjectId: 'subj1', groupId: 'g1', hours: 4 },
      ],
    });
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'rule-l1', teacherId: 't1' }),
    ];
    const pool = [
      lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-l1', teacherId: 't1' }),
      lesson('p2', 'g1', 'subj1', '', 0, { ruleId: 'rule-l1', teacherId: 't1' }),
    ];
    const pending = buildPendingByRule(placed, pool);
    const empty = analyzeEmptySlots(placed, project, pending);
    expect(empty.get('g1|Monday|2')).toContain(EMPTY_SLOT_REASON.DAILY_RULE);
    expect(empty.get('g1|Tuesday|1')).toContain(EMPTY_SLOT_REASON.DAY_BALANCE);
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

describe('buildPendingByRule', () => {
  it('computes remaining unassigned lessons per rule', () => {
    const placed = [lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'rule-a' })];
    const pool = [
      lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' }),
      lesson('p2', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' }),
      lesson('p3', 'g2', 'subj2', '', 0, { ruleId: 'rule-b' }),
    ];
    const pending = buildPendingByRule(placed, pool);
    expect(pending.get('rule-a')).toBe(1);
    expect(pending.get('rule-b')).toBe(1);
    expect(pending.size).toBe(2);
  });

  it('drops rules that are fully placed', () => {
    const placed = [lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'rule-a' })];
    const pool = [lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' })];
    expect(buildPendingByRule(placed, pool).size).toBe(0);
  });
});

describe('analyzeEmptySlots', () => {
  const ruleA = (overrides: Partial<ProjectState> = {}) => makeProject({
    curriculum: [
      { id: 'rule-a', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't1', roomId: 'r1' },
    ],
    ...overrides,
  });

  it('reports curriculum-done when the group has no pending lessons', () => {
    const project = ruleA();
    const placed = [lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'rule-a' })];
    const pool = [lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' })];
    const reasons = analyzeEmptySlots(placed, project, buildPendingByRule(placed, pool));
    expect(reasons.get('g1|Monday|3')).toContain(EMPTY_SLOT_REASON.CURRICULUM_DONE);
  });

  it('does not report slots outside the group period range', () => {
    const project = ruleA();
    const placed: Lesson[] = [];
    const pool = [lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' })];
    const reasons = analyzeEmptySlots(placed, project, buildPendingByRule(placed, pool));
    expect(reasons.get('g1|Monday|7')).toBeUndefined();
  });

  it('reports a teacher busy elsewhere in the same slot', () => {
    const project = ruleA();
    const placed = [lesson('l2', 'g2', 'subj2', 'Monday', 3, { teacherId: 't1', roomId: undefined })];
    const pool = [lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' })];
    const reasons = analyzeEmptySlots(placed, project, buildPendingByRule(placed, pool));
    expect(reasons.get('g1|Monday|3')).toContain(EMPTY_SLOT_REASON.TEACHER_BUSY);
    expect(reasons.get('g1|Monday|3')).not.toContain(EMPTY_SLOT_REASON.ROOM_BUSY);
  });

  it('reports a teacher-busy constraint blocking the slot', () => {
    const project = ruleA();
    const constraints: Constraint[] = [
      { id: 'c1', kind: 'TEACHER_BUSY', teacherId: 't1', day: 'Monday', periods: [2] },
    ];
    project.constraints = constraints;
    const placed: Lesson[] = [];
    const pool = [lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' })];
    const reasons = analyzeEmptySlots(placed, project, buildPendingByRule(placed, pool));
    expect(reasons.get('g1|Monday|2')).toContain(EMPTY_SLOT_REASON.TEACHER_BUSY);
  });

  it('reports a busy preferred room', () => {
    const project = ruleA({
      groups: [{ id: 'g1', name: '5-A', grade: 5, subgroups: [], periodStart: 1, periodEnd: 6, maxDailyLessons: 5 }],
    });
    const placed = [lesson('l2', 'g2', 'subj2', 'Monday', 4, { teacherId: 't2', roomId: 'r1' })];
    const pool = [lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' })];
    const reasons = analyzeEmptySlots(placed, project, buildPendingByRule(placed, pool));
    expect(reasons.get('g1|Monday|4')).toContain(EMPTY_SLOT_REASON.ROOM_BUSY);
    expect(reasons.get('g1|Monday|4')).not.toContain(EMPTY_SLOT_REASON.TEACHER_BUSY);
  });

  it('reports a no-first-period constraint at the first period', () => {
    const project = ruleA();
    project.constraints = [{ id: 'c2', kind: 'NO_FIRST_PERIOD', subjectId: 'subj1', groupId: 'g1' }];
    const placed: Lesson[] = [];
    const pool = [lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' })];
    const reasons = analyzeEmptySlots(placed, project, buildPendingByRule(placed, pool));
    expect(reasons.get('g1|Monday|1')).toContain(EMPTY_SLOT_REASON.NO_FIRST);
  });

  it('reports a rule that already hit its per-day limit as blocking the slot', () => {
    const project = ruleA();
    project.constraints = [{ id: 'c3', kind: 'MAX_DAILY_LESSONS', ruleId: 'rule-a', maxPerDay: 1 }];
    const placed = [lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'rule-a' })];
    const pool = [
      lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' }),
      lesson('p2', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' }),
    ];
    const reasons = analyzeEmptySlots(placed, project, buildPendingByRule(placed, pool));
    expect(reasons.get('g1|Monday|2')).toContain(EMPTY_SLOT_REASON.DAILY_RULE);
    expect(reasons.get('g1|Monday|2')).not.toContain(EMPTY_SLOT_REASON.DAY_BALANCE);
    // the same rule is still allowed on a fresh day
    expect(reasons.get('g1|Tuesday|1')).toContain(EMPTY_SLOT_REASON.DAY_BALANCE);
  });

  it('enforces the daily lesson limit via the scheduling window (no slot beyond maxDailyLessons)', () => {
    // maxDailyLessons=3 anchored at periodStart=1 -> window is periods 1..3
    const project = ruleA({
      groups: [{ id: 'g1', name: '5-A', grade: 5, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 3 }],
    });
    const placed = [
      lesson('l1', 'g1', 'subj1', 'Monday', 1, { ruleId: 'x1', teacherId: 't1', roomId: 'r1' }),
      lesson('l2', 'g1', 'subj2', 'Monday', 2, { ruleId: 'x2', teacherId: 't2', roomId: 'r1' }),
      lesson('l3', 'g1', 'subj3', 'Monday', 3, { ruleId: 'x3', teacherId: 't2', roomId: 'r1' }),
    ];
    const pool = [lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' })];
    const reasons = analyzeEmptySlots(placed, project, buildPendingByRule(placed, pool));
    // period 4 is outside the derived window [1..3], so it is not a reportable slot
    expect(reasons.get('g1|Monday|4')).toBeUndefined();
    // a still-free in-window slot is reported with the day-balance reason
    expect(reasons.get('g1|Tuesday|1')).toContain(EMPTY_SLOT_REASON.DAY_BALANCE);
  });

  it('reports day-balance when a free slot was skipped by the generator', () => {
    const project = ruleA();
    const placed: Lesson[] = [];
    const pool = [lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' })];
    const reasons = analyzeEmptySlots(placed, project, buildPendingByRule(placed, pool));
    expect(reasons.get('g1|Tuesday|3')).toContain(EMPTY_SLOT_REASON.DAY_BALANCE);
  });

  it('combines teacher-busy and room-busy blockers for the same slot', () => {
    const project = ruleA();
    const placed = [
      lesson('l1', 'g2', 'subj2', 'Monday', 2, { teacherId: 't1', roomId: 'r1' }),
    ];
    const pool = [lesson('p1', 'g1', 'subj1', '', 0, { ruleId: 'rule-a' })];
    const reasons = analyzeEmptySlots(placed, project, buildPendingByRule(placed, pool));
    expect(reasons.get('g1|Monday|2')).toContain(EMPTY_SLOT_REASON.TEACHER_BUSY);
    expect(reasons.get('g1|Monday|2')).toContain(EMPTY_SLOT_REASON.ROOM_BUSY);
  });
});
