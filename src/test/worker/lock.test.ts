import { describe, it, expect } from 'vitest';
import { ProjectState, CurriculumRule, LockedLesson } from '../../shared/types';
import { generateSemesterSchedules, buildSemesterProject } from '../../worker/generator';

function makeProject(groups: any[], curriculum: CurriculumRule[], lockedLessons: LockedLesson[] = []): ProjectState {
  return {
    version: '1.0.0',
    school: { id: 's1', name: 'Test', address: '' },
    academicYears: [],
    teachers: [
      { id: 't1', name: 'Teacher A', subjects: ['subj-1', 'subj-2'] },
      { id: 't2', name: 'Teacher B', subjects: ['subj-1', 'subj-2'] },
    ],
    subjects: [
      { id: 'subj-1', name: 'Subject 1', shortName: 'S1' },
      { id: 'subj-2', name: 'Subject 2', shortName: 'S2' },
    ],
    rooms: [],
    groups,
    curriculum,
    loadDistribution: [],
    constraints: [],
    lockedLessons,
  };
}

async function runSemester(project: ProjectState, semester: 'semester1' | 'semester2', settings?: any) {
  const messages: { type: string; payload?: any }[] = [];
  await generateSemesterSchedules(project, (msg) => messages.push(msg), settings);
  return messages.find((m) => m.type === 'RESULT')!.payload.schedules[semester];
}

describe('locked lessons in generation', () => {
  it('pins a locked lesson to its exact slot and keeps other lessons off it', async () => {
    const groups = [
      { id: 'g1', name: '1-A', grade: 1, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
    ];
    const curriculum: CurriculumRule[] = [
      { id: 'r0', groupId: 'g1', subjectId: 'subj-1', hoursPerWeek: 1, teacherId: 't1', roomId: undefined },
      { id: 'r1', groupId: 'g1', subjectId: 'subj-2', hoursPerWeek: 1, teacherId: 't2', roomId: undefined },
    ];
    const lock: LockedLesson = { ruleId: 'r0', day: 'Monday', period: 1 };

    const result = await runSemester(makeProject(groups, curriculum, [lock]), 'semester1', { attempts: 1 });

    const locked = result.schedule.find((l: any) => l.ruleId === 'r0');
    const other = result.schedule.find((l: any) => l.ruleId === 'r1');
    expect(locked).toMatchObject({ day: 'Monday', period: 1 });
    expect(other).not.toMatchObject({ day: 'Monday', period: 1 });
  });

  it('keeps the lock on the winning attempt of a multi-attempt sweep', async () => {
    const groups = [
      { id: 'g1', name: '1-A', grade: 1, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
    ];
    const curriculum: CurriculumRule[] = [
      { id: 'r0', groupId: 'g1', subjectId: 'subj-1', hoursPerWeek: 1, teacherId: 't1', roomId: undefined },
      { id: 'r1', groupId: 'g1', subjectId: 'subj-2', hoursPerWeek: 1, teacherId: 't2', roomId: undefined },
    ];
    const lock: LockedLesson = { ruleId: 'r0', day: 'Monday', period: 1 };

    const result = await runSemester(makeProject(groups, curriculum, [lock]), 'semester1', { attempts: 4 });

    const locked = result.schedule.find((l: any) => l.ruleId === 'r0');
    expect(locked).toMatchObject({ day: 'Monday', period: 1 });
  });

  it('uses the locked lesson against the rule daily limit (it consumes capacity)', async () => {
    const groups = [
      { id: 'g1', name: '1-A', grade: 1, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
    ];
    const curriculum: CurriculumRule[] = [
      // 2 hours of the same rule + an explicit 1-per-day limit.
      { id: 'r0', groupId: 'g1', subjectId: 'subj-1', hoursPerWeek: 2, teacherId: 't1', roomId: undefined },
    ];
    const constraints = [{ id: 'x1', kind: 'MAX_DAILY_LESSONS' as const, ruleId: 'r0', maxPerDay: 1 }];
    // Lock one hour, so its single daily budget slot is gone on Monday.
    const lock: LockedLesson = { ruleId: 'r0', day: 'Monday', period: 1 };

    const project = makeProject(groups, curriculum, [lock]);
    project.constraints = constraints;
    const result = await runSemester(project, 'semester1', { attempts: 1 });

    const monday = result.schedule.filter((l: any) => l.day === 'Monday');
    expect(monday.some((l: any) => l.period === 1)).toBe(true);
    // The second hour cannot share Monday - the locked lesson already used it.
    expect(monday.filter((l: any) => l.ruleId === 'r0').length).toBe(1);
    expect(result.schedule).toHaveLength(2);
  });

  it('keeps an unhonorable lock locked: reports unassigned instead of moving it', async () => {
    const groups = [
      // The group cannot hold a lesson in period 1, so the lock is impossible.
      { id: 'g1', name: '1-A', grade: 1, subgroups: [], periodStart: 2, periodEnd: 8, maxDailyLessons: 8 },
    ];
    const curriculum: CurriculumRule[] = [
      { id: 'r0', groupId: 'g1', subjectId: 'subj-1', hoursPerWeek: 1, teacherId: 't1', roomId: undefined },
    ];
    const lock: LockedLesson = { ruleId: 'r0', day: 'Monday', period: 1 };

    const project = makeProject(groups, curriculum, [lock]);
    // Add another rule/hour that can be placed, so the schedule would not be empty.
    project.curriculum.push({ id: 'r1', groupId: 'g1', subjectId: 'subj-2', hoursPerWeek: 1, teacherId: 't2', roomId: undefined });
    const result = await runSemester(project, 'semester1', { attempts: 1 });

    // The locked rule is absent from the schedule (never moved elsewhere)...
    expect(result.schedule.filter((l: any) => l.ruleId === 'r0')).toHaveLength(0);
    // ...its slot stays reserved for the rule...
    expect(result.schedule.some((l: any) => l.ruleId === 'r0' && l.day === 'Monday' && l.period === 1)).toBe(false);
    // ...and it surfaces as a visible unassigned conflict.
    expect(result.conflicts).toContainEqual({ type: 'UNASSIGNED_HOURS', ruleId: 'r0', missing: 1, locked: true });
  });
});

describe('buildSemesterProject lock scoping', () => {
  it('keeps only the semester-scoped or semester-agnostic locks for each semester', () => {
    const project = makeProject(
      [{ id: 'g1', name: '1-A', grade: 1, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 }],
      [{ id: 'r0', groupId: 'g1', subjectId: 'subj-1', hoursPerWeek: 1, teacherId: 't1', roomId: undefined }],
      [
        { ruleId: 'r0', day: 'Monday', period: 1, semester: 'semester1' },
        { ruleId: 'r0', day: 'Tuesday', period: 2 },
      ]
    );

    const s1 = buildSemesterProject(project, 1, []);
    const s2 = buildSemesterProject(project, 2, []);

    expect(s1.lockedLessons).toEqual([
      { ruleId: 'r0', day: 'Monday', period: 1, semester: 'semester1' },
      { ruleId: 'r0', day: 'Tuesday', period: 2 },
    ]);
    expect(s2.lockedLessons).toEqual([{ ruleId: 'r0', day: 'Tuesday', period: 2 }]);
  });
});