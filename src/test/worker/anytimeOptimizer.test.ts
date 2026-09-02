import { describe, it, expect } from 'vitest';
import { ProjectState, SemesterSchedules, ScheduleScore, ScheduleResult } from '../../shared/types';
import { buildScheduleScore, compareScores } from '../../worker/score';
import { generateSemesterSchedules } from '../../worker/generator';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function makeProject(curriculum: any[] = []): ProjectState {
  return {
    version: '1.0.0',
    school: { id: 's1', name: 'Test', address: '' },
    academicYears: [],
    teachers: [
      { id: 't1', name: 'Teacher A', subjects: ['subj-math', 'subj-info'] },
      { id: 't2', name: 'Teacher B', subjects: ['subj-math'] },
    ],
    subjects: [
      { id: 'subj-math', name: 'Math', shortName: 'M' },
      { id: 'subj-info', name: 'Informatics', shortName: 'I' },
    ],
    rooms: [],
    groups: [{ id: 'g1', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 8 }],
    curriculum,
    loadDistribution: [],
    constraints: [],
  };
}

function lesson(period: number, day: string, ruleId: string, teacherId = 't1'): any {
  return { id: `${ruleId}-${day}-${period}`, ruleId, groupId: 'g1', subjectId: 'subj-math', teacherId, day, period };
}

function sem(count: number, unassigned: number, gappy = false): ScheduleResult {
  const schedule = Array.from({ length: count }, (_, i) => {
    const day = DAYS[i % 5];
    const p = gappy && day === 'Monday' && i === 4 ? 6 : 1 + Math.floor(i / 5);
    return lesson(p, day, 'c1');
  });
  return {
    schedule,
    conflicts: unassigned > 0 ? [{ type: 'UNASSIGNED_HOURS', ruleId: 'c1', missing: unassigned }] : [],
    score: 1,
  };
}

describe('lexicographic schedule score (worker v0.3)', () => {
  const project = makeProject([{ id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1' }]);

  it('Test 7: a complete schedule beats an incomplete one regardless of soft quality', () => {
    // Incomplete but ultra-compact: 8/10 placed, no gaps.
    const complete = { semester1: sem(10, 0), semester2: sem(10, 0) };
    const incompleteGappy = { semester1: sem(9, 1, false), semester2: sem(9, 1, false) };

    const a = buildScheduleScore(complete, [], project);
    const b = buildScheduleScore(incompleteGappy, [], project);
    expect(compareScores(a, b)).toBeGreaterThan(0);
  });

  it('Test 6: given equal completeness, fewer/shorter teacher gaps win', () => {
    // 5 lessons each, all on Monday, teacher t1: tight packs them contiguously
    // (periods 1-5, zero gaps); loose leaves a hole (1,2,3,5,6 => gap of 1).
    const mk = (periods: number[]): SemesterSchedules => ({
      semester1: { schedule: periods.map((p) => lesson(p, 'Monday', 'c1')), conflicts: [], score: 1 },
      semester2: { schedule: periods.map((p) => lesson(p, 'Monday', 'c1')), conflicts: [], score: 1 },
    });

    const tight = mk([1, 2, 3, 4, 5]);
    const loose = mk([1, 2, 3, 5, 6]);

    const t = buildScheduleScore(tight, [], project);
    const l = buildScheduleScore(loose, [], project);
    expect(t.unscheduledLessons).toBe(l.unscheduledLessons);
    expect(t.teacherTotalGapLength).toBeLessThan(l.teacherTotalGapLength);
    expect(compareScores(t, l)).toBeGreaterThan(0);
  });

  it('compareScores is symmetric and total', () => {
    const a: ScheduleScore = buildScheduleScore({ semester1: sem(10, 0), semester2: sem(10, 0) }, [], project);
    const b: ScheduleScore = buildScheduleScore({ semester1: sem(10, 0), semester2: sem(10, 0) }, [], project);
    expect(compareScores(a, b)).toBe(0);
    expect(compareScores(b, a)).toBe(0);
  });
});

describe('anytime generation (mode: time)', () => {
  it('Test 8: returns the best schedule near the deadline without hanging', async () => {
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1' },
    ]);

    const started = Date.now();
    const messages: { type: string; payload?: any }[] = [];
    await generateSemesterSchedules(project, (msg) => messages.push(msg), {
      mode: 'time',
      generationTimeMs: 300,
      maxSpillPasses: 0,
    });
    const elapsed = Date.now() - started;
    const result = messages.find((m) => m.type === 'RESULT');

    expect(result).toBeDefined();
    expect(result!.payload.mode).toBe('time');
    expect(result!.payload.schedules).toBeDefined();
    // Should have terminated around (not wildly past) the short deadline.
    expect(elapsed).toBeLessThan(3000);
  });

  it('Test 9: a longer budget never yields a worse best score than a short one', async () => {
    // Force work by using a few rules so a couple of attempts differ.
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1' },
      { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 5, teacherId: 't2' },
    ]);

    const run = async (ms: number) => {
      const messages: { type: string; payload?: any }[] = [];
      await generateSemesterSchedules(project, (msg) => messages.push(msg), {
        mode: 'time',
        generationTimeMs: ms,
        maxSpillPasses: 0,
      });
      const result = messages.find((m) => m.type === 'RESULT')!.payload;
      return {
        score: buildScheduleScore(result.schedules, result.splits ?? [], project),
        attempts: result.attempts,
      };
    };

    const short = await run(250);
    const long = await run(800);
    // A longer run must have run more attempts and never be worse.
    expect(long.attempts).toBeGreaterThanOrEqual(short.attempts);
    expect(compareScores(long.score, short.score)).toBeGreaterThanOrEqual(0);
  });
});