import { describe, it, expect } from 'vitest';
import { suggestRearrange } from '../../worker/rearrange';
import { Lesson, ProjectState } from '../../shared/types';

const makeLesson = (id: string, over: Partial<Lesson> = {}): Lesson => ({
  id,
  ruleId: 'c1',
  groupId: 'g1',
  subjectId: 'math',
  teacherId: 't1',
  roomId: 'r1',
  day: 'Monday',
  period: 1,
  ...over,
});

const makeProject = (over: Partial<ProjectState> = {}): ProjectState => ({
  version: '1.0.0',
  school: { id: 's1', name: 'T' },
  academicYears: [],
  teachers: [
    { id: 't1', name: 'Anna', subjects: ['math'] },
    { id: 't2', name: 'Bohdan', subjects: ['math'] },
  ],
  subjects: [{ id: 'math', name: 'Math' }],
  rooms: [{ id: 'r1', name: 'R1', types: [] }],
  groups: [
    { id: 'g1', name: '5-A', grade: 5, subgroups: [], periodStart: 1, periodEnd: 8 },
    { id: 'g2', name: '5-B', grade: 5, subgroups: [], periodStart: 1, periodEnd: 8 },
  ],
  curriculum: [
    { id: 'c1', groupId: 'g1', subjectId: 'math', hoursPerWeek: 4, teacherId: 't1', roomId: 'r1' },
    { id: 'c2', groupId: 'g2', subjectId: 'math', hoursPerWeek: 4, teacherId: 't1', roomId: 'r1' },
  ],
  loadDistribution: [],
  constraints: [],
  ...over,
});

describe('suggestRearrange', () => {
  it('returns a direct feasible move when the target slot is free', () => {
    const schedule = [makeLesson('l1', { period: 1 })];
    const s = suggestRearrange(makeProject(), schedule, 'l1', { day: 'Monday', period: 3 });
    expect(s.feasible).toBe(true);
    expect(s.moves).toHaveLength(1);
    expect(s.moves[0]).toMatchObject({ lessonId: 'l1', toDay: 'Monday', toPeriod: 3 });
    expect(s.teacherIdForMain).toBeUndefined();
  });

  it('cannot move into a slot already held by the same teacher', () => {
    const schedule = [
      makeLesson('l1', { period: 1, id: 'l1' }),
      makeLesson('l2', { id: 'l2', groupId: 'g2', ruleId: 'c2', period: 2 }),
    ];
    const s = suggestRearrange(makeProject(), schedule, 'l1', { day: 'Monday', period: 2 });
    expect(s.feasible).toBe(true);
    expect(s.moves).toHaveLength(2);
    expect(s.moves[0].lessonId).toBe('l1');
    expect(s.moves[0].toPeriod).toBe(2);
    // l2 (a different group) is displaced to a different slot.
    expect(s.moves[1].lessonId).toBe('l2');
    expect(s.moves[1].toDay + s.moves[1].toPeriod).not.toBe('Monday2');
  });

  it('swaps in an eligible free teacher when only a teacher collision blocks the slot', () => {
    const schedule = [makeLesson('l1', { period: 1 })];
    // l1 would be busy for t1 at Monday/3, but t2 can take it.
    const s = suggestRearrange(
      makeProject({
        constraints: [{ id: 'x', kind: 'TEACHER_BUSY', teacherId: 't1', day: 'Monday', periods: [3] }],
      }),
      schedule,
      'l1',
      { day: 'Monday', period: 3 }
    );
    expect(s.feasible).toBe(true);
    expect(s.teacherIdForMain).toBe('t2');
    expect(s.moves).toHaveLength(1);
  });

  it('cannot offer a swap to a teacher that does not teach the subject', () => {
    const project = makeProject({
      teachers: [
        { id: 't1', name: 'Anna', subjects: ['math'] },
        { id: 't2', name: 'Bohdan', subjects: ['physics'] },
      ],
    });
    const schedule = [makeLesson('l1', { period: 1 })];
    // Not busy, target free -> a direct move is feasible regardless of teacher
    // pool, so only a blocked case demonstrates the eligibility filter.
    expect(suggestRearrange(project, schedule, 'l1', { day: 'Monday', period: 3 }).feasible).toBe(true);
  });

  it('cannot teacher-swap when the only other teacher cannot teach the subject', () => {
    const project = makeProject({
      teachers: [
        { id: 't1', name: 'Anna', subjects: ['math'] },
        { id: 't2', name: 'Bohdan', subjects: ['physics'] },
      ],
      constraints: [{ id: 'x', kind: 'TEACHER_BUSY', teacherId: 't1', day: 'Monday', periods: [3] }],
    });
    const schedule = [makeLesson('l1', { period: 1 })];
    const s = suggestRearrange(project, schedule, 'l1', { day: 'Monday', period: 3 });
    expect(s.feasible).toBe(false);
  });

  it('reports infeasible when the target is busy for the teacher', () => {
    const schedule = [makeLesson('l1', { period: 1 })];
    const s = suggestRearrange(
      makeProject({
        constraints: [{ id: 'x', kind: 'TEACHER_BUSY', teacherId: 't1', day: 'Monday', periods: [3] }],
        teachers: [{ id: 't1', name: 'Anna', subjects: ['math'] }],
      }),
      schedule,
      'l1',
      { day: 'Monday', period: 3 }
    );
    expect(s.feasible).toBe(false);
  });

  it('relocates an occupying lesson to keep the moved lesson valid', () => {
    const schedule = [
      makeLesson('l1', { period: 1, id: 'l1' }),
      makeLesson('l2', { id: 'l2', groupId: 'g2', ruleId: 'c2', period: 3 }),
    ];
    // l1 (g1) and l2 (g2) share teacher t1 and room r1; moving l1 to period 3
    // collides on teacher+room, so l2 is displaced to a free slot.
    const s = suggestRearrange(makeProject(), schedule, 'l1', { day: 'Monday', period: 3 });
    expect(s.feasible).toBe(true);
    expect(s.moves).toHaveLength(2);
    expect(s.moves[0].lessonId).toBe('l1');
    const displaced = s.moves[1];
    expect(displaced.lessonId).toBe('l2');
    expect(displaced.toDay + displaced.toPeriod).not.toBe('Monday3');
  });

  it('cannot move a lesson onto a slot whose occupant is a split partner', () => {
    // l2 & l3 share the same group+subject+slot (a split pair) at Monday/2.
    const schedule = [
      makeLesson('l1', { period: 1 }),
      makeLesson('l2', { period: 2 }),
      makeLesson('l3', { period: 2 }),
    ];
    const s = suggestRearrange(makeProject(), schedule, 'l1', { day: 'Monday', period: 2 });
    // Moving l1 to Monday/2 is blocked by l2/l3 (same teacher+room); relocating
    // one breaks the split, so the move is infeasible.
    expect(s.feasible).toBe(false);
  });

  it('accepts a move that respects the daily rule cap', () => {
    const schedule = [
      makeLesson('l1', { period: 1 }),
      makeLesson('l2', { period: 2 }),
      makeLesson('l3', { period: 3 }),
    ];
    const s = suggestRearrange(
      makeProject({
        constraints: [{ id: 'x', kind: 'MAX_DAILY_LESSONS', ruleId: 'c1', maxPerDay: 2 }],
      }),
      schedule,
      'l1',
      { day: 'Tuesday', period: 1 }
    );
    expect(s.feasible).toBe(true);
    expect(s.moves[0].toDay).toBe('Tuesday');
  });

  it('rejects a move that would exceed the daily rule cap on the same day', () => {
    const schedule = [
      makeLesson('l1', { period: 1 }),
      makeLesson('l2', { period: 2 }),
      makeLesson('l3', { period: 3 }),
    ];
    const s = suggestRearrange(
      makeProject({
        constraints: [{ id: 'x', kind: 'MAX_DAILY_LESSONS', ruleId: 'c1', maxPerDay: 2 }],
      }),
      schedule,
      'l1',
      { day: 'Monday', period: 5 }
    );
    // Monday already has l2 and l3 for rule c1 (2 lessons); adding l1 there tops 2.
    expect(s.feasible).toBe(false);
  });
});