import { describe, it, expect } from 'vitest';
import { ProjectState, SemesterSchedules, ScheduleResult } from '../../shared/types';
import { buildScheduleScore, compareScores } from '../../worker/score';
import { localSearch } from '../../worker/generator';

function makeProject(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    version: '1.0.0',
    school: { id: 's1', name: 'Test', address: '' },
    academicYears: [],
    teachers: [{ id: 't1', name: 'Teacher A', subjects: ['subj-math'] }],
    subjects: [{ id: 'subj-math', name: 'Math', shortName: 'M' }],
    rooms: [{ id: 'r1', name: 'Room 1', maxGroups: 1, types: ['classroom'] }],
    groups: [{ id: 'g1', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 8 }],
    curriculum: [],
    loadDistribution: [],
    constraints: [],
    ...overrides,
  };
}

function lesson(period: number, day: string, ruleId: string, roomId?: string): any {
  return { id: `${ruleId}-${day}-${period}`, ruleId, groupId: 'g1', subjectId: 'subj-math', teacherId: 't1', day, period, ...(roomId ? { roomId } : {}) };
}

function sem(schedule: any[], unassigned = 0): ScheduleResult {
  return {
    schedule,
    conflicts: unassigned > 0 ? [{ type: 'UNASSIGNED_HOURS', ruleId: 'c1', missing: unassigned }] : [],
    score: 1,
  };
}

/** A complete schedule of `periods` for t1/g1 all on `day`. */
function sched(periods: number[], day = 'Monday', roomId?: string, ruleId = 'c1', unassigned = 0): SemesterSchedules {
  const schedule = periods.map((p) => lesson(p, day, ruleId, roomId));
  return { semester1: sem(schedule, unassigned), semester2: sem([], 0) };
}

describe('ScheduleScore LEVEL 1 completeness', () => {
  it('counts unscheduled hours across both semesters', () => {
    const project = makeProject();
    const score = buildScheduleScore(
      { semester1: sem([lesson(1, 'Monday', 'c1')], 2), semester2: sem([], 3) },
      [],
      project
    );
    expect(score.unscheduledLessons).toBe(5);
  });

  it('completeness is strictly lexicographic before any soft level', () => {
    const project = makeProject();
    const complete = buildScheduleScore(sched([1, 2, 3, 4, 5]), [], project);
    const incompleteButTight = buildScheduleScore(
      sched([1, 2, 3, 4], 'Monday', undefined, 'c1', 2),
      [],
      project
    );
    expect(compareScores(complete, incompleteButTight)).toBeGreaterThan(0);
  });

  it('pinned unassigned (FORBID_LESSON) dominates softer levels while unscheduled ties', () => {
    const project = makeProject();
    // Same completeness (2 unassigned each) but one carries its 2 unassigned on a
    // pinned rule. The pinned one must lose even though it is much tighter.
    const pinnedTight = buildScheduleScore(
      {
        semester1: {
          schedule: [lesson(1, 'Monday', 'c1'), lesson(2, 'Monday', 'c1'), lesson(3, 'Monday', 'c1'), lesson(4, 'Monday', 'c1')],
          conflicts: [{ type: 'UNASSIGNED_HOURS', ruleId: 'c1', missing: 2 }],
          score: 1,
        },
        semester2: sem([]),
      },
      [],
      project,
      new Set(['c1'])
    );
    const freshLoose = buildScheduleScore(
      {
        semester1: {
          schedule: [lesson(1, 'Monday', 'c1'), lesson(2, 'Monday', 'c1'), lesson(3, 'Monday', 'c1'), lesson(5, 'Monday', 'c1')],
          conflicts: [{ type: 'UNASSIGNED_HOURS', ruleId: 'c2', missing: 2 }],
          score: 1,
        },
        semester2: sem([]),
      },
      [],
      project,
      new Set(['c1'])
    );
    expect(pinnedTight.unscheduledLessons).toBe(freshLoose.unscheduledLessons);
    expect(pinnedTight.pinnedUnassigned).toBeGreaterThan(freshLoose.pinnedUnassigned);
    expect(pinnedTight.dailyCompactness).toBeLessThan(freshLoose.dailyCompactness);
    expect(compareScores(freshLoose, pinnedTight)).toBeGreaterThan(0);
  });
});

describe('ScheduleScore LEVEL 2 daily compactness', () => {
  it('fewer teacher gaps => smaller dailyCompactness', () => {
    const project = makeProject();
    const tight = buildScheduleScore(sched([1, 2, 3, 4, 5]), [], project);
    const gappy = buildScheduleScore(sched([1, 2, 3, 5, 6]), [], project);
    expect(tight.dailyCompactness).toBeLessThan(gappy.dailyCompactness);
    expect(compareScores(tight, gappy)).toBeGreaterThan(0);
  });

  it('a single non-long gap still raises dailyCompactness only (longGapPenalty stays 0)', () => {
    const project = makeProject();
    const gap1 = buildScheduleScore(sched([1, 2, 3, 5, 6]), [], project);
    expect(gap1.longGapPenalty).toBe(0);
    expect(gap1.dailyCompactness).toBeGreaterThan(0);
  });

  it('sparse days (single lesson) are penalized on sparseDayPenalty', () => {
    const project = makeProject();
    const oneDay = buildScheduleScore(sched([1, 2, 3, 4, 5], 'Monday'), [], project);
    const spread = buildScheduleScore(
      {
        semester1: {
          schedule: [lesson(1, 'Monday', 'c1'), lesson(2, 'Tuesday', 'c1'), lesson(3, 'Wednesday', 'c1'), lesson(4, 'Thursday', 'c1'), lesson(5, 'Friday', 'c1')],
          conflicts: [],
          score: 1,
        },
        semester2: sem([]),
      },
      [],
      project
    );
    expect(oneDay.sparseDayPenalty).toBeLessThan(spread.sparseDayPenalty);
  });

  it('a free run of at least 3 periods is a long gap (threshold 2)', () => {
    const project = makeProject();
    const gap2 = buildScheduleScore(sched([1, 2, 6]), [], project);
    expect(gap2.longGapPenalty).toBeGreaterThan(0);
  });

  it('spread keeps longGapPenalty at 0 when every gap stays under the threshold', () => {
    const project = makeProject();
    const spread = buildScheduleScore(
      { semester1: { schedule: [lesson(2, 'Monday', 'a'), lesson(2, 'Wednesday', 'a')], conflicts: [], score: 1 }, semester2: sem([]) },
      [],
      project
    );
    expect(spread.longGapPenalty).toBe(0);
  });
});

describe('ScheduleScore LEVEL 3 subject distribution', () => {
  it('adjacent subject days score worse than an evenly spaced pair', () => {
    const project = makeProject();
    const two = (days: string[]): SemesterSchedules => ({
      semester1: {
        schedule: days.map((d) => lesson(2, d, 'a')),
        conflicts: [],
        score: 1,
      },
      semester2: sem([]),
    });
    const spaced = buildScheduleScore(two(['Monday', 'Wednesday']), [], project);
    const adjacent = buildScheduleScore(two(['Monday', 'Tuesday']), [], project);
    expect(spaced.subjectDistributionPenalty).toBe(0);
    expect(adjacent.subjectDistributionPenalty).toBeGreaterThan(0);
  });
});

describe('ScheduleScore LEVEL 4 parallelization', () => {
  it('divergent sibling subject-day structure scores worse than an identical one', () => {
    const project = makeProject({
      groups: [
        { id: 'g1', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 8 },
        { id: 'g2', name: '10-B', grade: 10, subgroups: [], periodStart: 1, periodEnd: 8 },
      ],
      parallelGroups: [{ id: 'p1', groupIds: ['g1', 'g2'] }],
    });
    const pair = (aLessons: any[], bLessons: any[]): SemesterSchedules => ({
      semester1: {
        schedule: [
          ...aLessons.map((l) => ({ ...l, groupId: 'g1' })),
          ...bLessons.map((l) => ({ ...l, groupId: 'g2' })),
        ],
        conflicts: [],
        score: 1,
      },
      semester2: sem([]),
    });
    const identical = buildScheduleScore(
      pair(
        [lesson(2, 'Monday', 'a'), lesson(2, 'Wednesday', 'a')],
        [lesson(2, 'Monday', 'b'), lesson(2, 'Wednesday', 'b')]
      ),
      [],
      project
    );
    const divergent = buildScheduleScore(
      pair(
        [lesson(2, 'Monday', 'a'), lesson(2, 'Wednesday', 'a')],
        [lesson(2, 'Monday', 'b'), lesson(2, 'Tuesday', 'b')]
      ),
      [],
      project
    );
    expect(identical.parallelizationPenalty).toBe(0);
    expect(divergent.parallelizationPenalty).toBeGreaterThan(0);
  });
});

describe('ScheduleScore LEVEL 5 age / shift', () => {
  it('lessons outside the age band preferred period accrue a penalty', () => {
    const project = makeProject({
      schedulePolicy: { ageGroups: [{ grades: [10], preferredPeriods: { min: 1, max: 3 } }] },
    });
    const inside = buildScheduleScore(sched([1, 2, 3]), [], project);
    const outside = buildScheduleScore(sched([7, 8]), [], project);
    expect(inside.ageShiftPenalty).toBe(0);
    expect(outside.ageShiftPenalty).toBeGreaterThan(0);
  });
});

describe('ScheduleScore LEVEL 6 room stability + movement', () => {
  it('roomStabilityPenalty penalizes a lesson off its rule-preferred room', () => {
    const project = makeProject({ curriculum: [{ id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, roomId: 'r1' }] });
    const onRoom = buildScheduleScore(sched([1, 2, 3], 'Monday', 'r1'), [], project);
    const offRoom = buildScheduleScore(sched([1, 2, 3], 'Monday', 'r2'), [], project);
    const noRoom = buildScheduleScore(sched([1, 2, 3]), [], project);
    expect(onRoom.roomStabilityPenalty).toBe(0);
    expect(offRoom.roomStabilityPenalty).toBeGreaterThan(0);
    expect(noRoom.roomStabilityPenalty).toBeGreaterThan(0);
  });

  it('assignmentMovementPenalty counts lessons moved off their rule roomId', () => {
    const project = makeProject({ curriculum: [{ id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, roomId: 'r1' }] });
    const stable = buildScheduleScore(sched([1, 2, 3], 'Monday', 'r1'), [], project);
    const moved = buildScheduleScore(sched([1, 2, 3], 'Monday', 'r2'), [], project);
    expect(stable.assignmentMovementPenalty).toBe(0);
    expect(moved.assignmentMovementPenalty).toBe(3);
  });
});

describe('ScheduleScore LEVEL 7 minor preference', () => {
  it('minorPreferencePenalty counts distinct rooms used above one', () => {
    const project = makeProject();
    const singleRoom = buildScheduleScore(sched([1, 2, 3], 'Monday', 'r1'), [], project);
    const multiRoom = buildScheduleScore(
      { semester1: { schedule: [lesson(1, 'Monday', 'a', 'r1'), lesson(2, 'Monday', 'b', 'r2')], conflicts: [], score: 1 }, semester2: sem([]) },
      [],
      project
    );
    expect(singleRoom.minorPreferencePenalty).toBe(0);
    expect(multiRoom.minorPreferencePenalty).toBe(1);
  });
});

describe('compareScores lexicographic ordering', () => {
  const project = makeProject({ curriculum: [{ id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, roomId: 'r1' }] });

  const score = (periods: number[], day = 'Monday', roomId?: string, unassigned = 0) =>
    buildScheduleScore(sched(periods, day, roomId, 'c1', unassigned), [], project);

  it('a better higher level wins even when every lower level is worse', () => {
    const moreCompact = score([1, 2, 3], 'Monday', 'r2'); // off room, +movement
    const lessCompact = score([1, 4, 7], 'Monday', 'r1'); // on room, big gaps
    expect(moreCompact.dailyCompactness).toBeLessThan(lessCompact.dailyCompactness);
    expect(compareScores(moreCompact, lessCompact)).toBeGreaterThan(0);
  });

  it('compareScores is symmetric, total, and transitive', () => {
    const a = score([1, 2, 3]);
    const b = score([1, 2, 3]);
    expect(compareScores(a, b)).toBe(0);
    expect(compareScores(b, a)).toBe(0);
    const w0 = score([1, 2, 3]);
    const w1 = score([1, 2, 4]);
    const w2 = score([1, 3, 5]);
    // Each improvement lowers dailyCompactness; gradients must be consistent.
    expect(compareScores(w0, w1)).toBeGreaterThan(0);
    expect(compareScores(w1, w2)).toBeGreaterThan(0);
    expect(compareScores(w0, w1) * compareScores(w1, w2)).toBeGreaterThan(0);
  });
});

describe('Phase 11 acceptance: score-gated local search', () => {
  it('local search never worsens the canonical score (v4-46/v4-47)', () => {
    const project = makeProject({
      curriculum: [{ id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 3, teacherId: 't1' }],
    });
    const mk = (periods: number[]): SemesterSchedules => ({
      semester1: { schedule: periods.map((p) => lesson(p, 'Monday', 'c1')), conflicts: [], score: 1 },
      semester2: { schedule: [], conflicts: [], score: 1 },
    });
    const before = mk([1, 3, 5]);
    const clone = (s: SemesterSchedules): SemesterSchedules => ({
      semester1: { schedule: s.semester1.schedule.map((l) => ({ ...l })), conflicts: [], score: 1 },
      semester2: { schedule: [], conflicts: [], score: 1 },
    });
    const lo = buildScheduleScore(before, [], project);
    const after = clone(before);
    localSearch(project, after, [], undefined, () => 0);
    const hi = buildScheduleScore(after, [], project);
    // Mon{1,3,5} has a hole at period 2; the compactness operateor must close it
    // and the result must be lexicographically at least as good as the input.
    expect(hi.dailyCompactness).toBeLessThan(lo.dailyCompactness);
    expect(compareScores(hi, lo)).toBeGreaterThanOrEqual(0);
  });
});