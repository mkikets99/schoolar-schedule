import { describe, it, expect } from 'vitest';
import { ProjectState, CurriculumRule, SemesterSchedules, ScheduleResult } from '../../shared/types';
import { generateSemesterSchedules, scoreAttempt } from '../../worker/generator';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

function makeProject(curriculum: CurriculumRule[], groups: any[] = [{ id: 'g1', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 }]): ProjectState {
  return {
    version: '1.0.0',
    school: { id: 's1', name: 'Test', address: '' },
    academicYears: [],
    teachers: [
      { id: 't1', name: 'Teacher A', subjects: ['subj-math', 'subj-info', 'subj-hist'] },
      { id: 't2', name: 'Teacher B', subjects: ['subj-math', 'subj-info', 'subj-hist'] },
    ],
    subjects: [
      { id: 'subj-math', name: 'Math', shortName: 'M' },
      { id: 'subj-info', name: 'Informatics', shortName: 'INFO' },
      { id: 'subj-hist', name: 'History', shortName: 'H' },
    ],
    rooms: [],
    groups,
    curriculum,
    loadDistribution: [],
    constraints: [],
  };
}

interface GapReport {
  totalGapHours: number;
  badTeachers: string[];
  teachers: { id: string; weekGap: number }[];
}

async function run(project: ProjectState, settings?: any) {
  const messages: { type: string; payload?: any }[] = [];
  await generateSemesterSchedules(project, (msg) => messages.push(msg), settings);
  const payload = messages.find((m) => m.type === 'RESULT')!.payload;
  return payload;
}

function teacherFreePeriods(schedule: any[], teacherId: string, day: string): number {
  const periods = schedule
    .filter((l: any) => l.teacherId === teacherId && l.day === day)
    .map((l: any) => l.period)
    .sort((a: number, b: number) => a - b);
  let gap = 0;
  for (let i = 1; i < periods.length; i++) gap += Math.max(0, periods[i] - periods[i - 1] - 1);
  return gap;
}

function teacherWeekFreePeriods(schedule: any[], teacherId: string): number {
  let total = 0;
  for (const day of DAYS) total += teacherFreePeriods(schedule, teacherId, day);
  return total;
}

describe('Worker v0.2 gap optimization', () => {
  it('fits a teachers lessons with zero free space when the load allows it', async () => {
    // One teacher, two groups with 5h each: 10 lessons. Sufficient room for a
    // fully contiguous 2-lesson-a-day schedule -> 0 free hours.
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1' },
      { id: 'c2', groupId: 'g2', subjectId: 'subj-info', hoursPerWeek: 5, teacherId: 't1' },
    ], [
      { id: 'g1', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
      { id: 'g2', name: '10-B', grade: 10, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
    ]);

    const payload = await run(project, { attempts: 10, optimizePasses: 12 });

    const report: GapReport = payload.gapReport.semester1;
    expect(report.totalGapHours).toBe(0);
    expect(report.badTeachers).toHaveLength(0);
    const t1 = report.teachers.find((t) => t.id === 't1');
    expect(t1!).toBeDefined();
    expect(t1!.weekGap).toBe(0);

    // Every t1 lesson is placed and placed contiguously.
    const lessons = payload.schedules.semester1.schedule.filter((l: any) => l.teacherId === 't1');
    expect(lessons).toHaveLength(10);
    const dayCounts = new Map<string, number>();
    for (const l of lessons) dayCounts.set(l.day, (dayCounts.get(l.day) || 0) + 1);
    for (const [day, count] of dayCounts) {
      expect(teacherFreePeriods(lessons, 't1', day)).toBe(0);
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps forced free hours minimal when a busy slot splits a teachers day', async () => {
    // t1 must teach g1 10h/semester (two 5h rules). g1 caps the day at 2 lessons,
    // so t1 has exactly 2 lessons every day. Period 2 is blocked for t1 every
    // day, so the two lessons can never be adjacent: 1&3 is the tightest fit and
    // each day carries exactly one forced free hour (week total 5).
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1' },
      { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 5, teacherId: 't1' },
    ], [
      { id: 'g1', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 8 },
    ]);
    project.constraints = [{ id: 'busy', kind: 'TEACHER_BUSY', teacherId: 't1', day: '*', periods: [2] }];

    const payload = await run(project, { attempts: 10, optimizePasses: 12 });
    const lessons = payload.schedules.semester1.schedule;

    // Everything is placed.
    expect(lessons).toHaveLength(10);
    expect((payload.schedules.semester1.conflicts || []).filter((c: any) => c.type === 'UNASSIGNED_HOURS')).toHaveLength(0);

    // Two lessons every day, period 2 never used, gap is the minimal forced 1/day.
    for (const day of DAYS) {
      const dayLessons = lessons.filter((l: any) => l.teacherId === 't1' && l.day === day);
      expect(dayLessons).toHaveLength(2);
      expect(dayLessons.every((l: any) => l.period !== 2)).toBe(true);
      expect(teacherFreePeriods(lessons, 't1', day)).toBe(1);
    }
    const t1Gap = teacherWeekFreePeriods(lessons, 't1');
    expect(t1Gap).toBe(5);
    const report: GapReport = payload.gapReport.semester1;
    // Exactly 5 free hours is the boundary - not "bad" yet, but fully minimized.
    expect(report.badTeachers).not.toContain('t1');
  });

  it('avoids every conflict while compressing gaps, even on fully split days', async () => {
    const curriculum: CurriculumRule[] = [];
    for (let i = 0; i < 8; i++) {
      curriculum.push({ id: `c${i}`, groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: `t${i}` });
    }
    const project = makeProject(curriculum);
    const payload = await run(project, { attempts: 5, optimizePasses: 12 });

    for (const semester of ['semester1', 'semester2'] as const) {
      const lessons = payload.schedules[semester].schedule;
      const teacherSlot = new Set<string>();
      const groupSlotSubjects = new Map<string, Set<string>>();
      for (const lesson of lessons) {
        const slot = `${lesson.day}-${lesson.period}`;
        expect(teacherSlot.has(`${lesson.teacherId}-${slot}`)).toBe(false);
        teacherSlot.add(`${lesson.teacherId}-${slot}`);

        const gKey = `${lesson.groupId}-${slot}`;
        if (!groupSlotSubjects.has(gKey)) groupSlotSubjects.set(gKey, new Set());
        groupSlotSubjects.get(gKey)!.add(lesson.subjectId);
      }
      // A group slot may hold several lessons only when they are the same-subject
      // split group (here all 8 rules are the same subject), never a clash.
      for (const subjects of groupSlotSubjects.values()) {
        expect(subjects.size).toBeLessThanOrEqual(1);
      }
      // All lessons present (40 needed, group capacity fine).
      expect(lessons).toHaveLength(40);
    }
  });

  it('marks >5 free-hour weeks as a bad solution but still returns a schedule', async () => {
    // A single teacher must teach two groups at the far ends of the day on the
    // same days (groups have non-overlapping windows), forcing gaps: g1 in shift
    // 1-8 and g2 in shift 6-12. The teacher cannot teach both groups at the same
    // slot, so per day the two lessons are separated by at least the free middle.
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1' },
      { id: 'c2', groupId: 'g2', subjectId: 'subj-info', hoursPerWeek: 5, teacherId: 't1' },
    ], [
      { id: 'g1', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 5, maxDailyLessons: 1 },
      { id: 'g2', name: '7-B', grade: 7, subgroups: [], periodStart: 6, periodEnd: 12, maxDailyLessons: 1 },
    ]);

    const payload = await run(project, { attempts: 4, optimizePasses: 8 });
    const lessons = payload.schedules.semester1.schedule;
    expect(lessons).toHaveLength(10);

    // The two groups' lessons land on the same 5 days (one per group per day),
    // so the teacher necessarily has 5 free hours between the two lessons each
    // week and is reported as a bad / forced solution.
    const t1Gap = teacherWeekFreePeriods(lessons, 't1');
    expect(t1Gap).toBeGreaterThan(5);
    const report: GapReport = payload.gapReport.semester1;
    expect(report.badTeachers).toContain('t1');
  });

  it('ranks the best attempt by amount of unresolved lessons, not by percentage', () => {
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1' },
    ]);
    const lesson = (period: number, day: string, ruleId: string) => ({
      id: `${ruleId}-${day}-${period}`,
      ruleId,
      groupId: 'g1',
      subjectId: 'subj-math',
      teacherId: 't1',
      day,
      period,
    });
    const sem = (count: number, score: number, unassigned: number): ScheduleResult => ({
      schedule: Array.from({ length: count }, (_, i) => lesson(1 + Math.floor(i / 5), DAYS[i % 5], 'c1')),
      conflicts: unassigned > 0 ? [{ type: 'UNASSIGNED_HOURS', ruleId: 'c1', missing: unassigned }] : [],
      score,
    });

    // High percentage (1.0) but 2 lessons still missing.
    const highPercentageButGappy: SemesterSchedules = { semester1: sem(9, 1.0, 1), semester2: sem(9, 1.0, 1) };
    // Lower percentage (0.9) but everything is resolved (20/20) - must win.
    const fewerUnresolved: SemesterSchedules = { semester1: sem(10, 0.9, 0), semester2: sem(10, 0.9, 0) };

    expect(scoreAttempt(fewerUnresolved, [], project)).toBeGreaterThan(scoreAttempt(highPercentageButGappy, [], project));
  });

  it('still prefers the tighter schedule when unresolved counts are equal', () => {
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1' },
    ]);
    const build = (loose: boolean): SemesterSchedules => {
      const periods = loose
        ? [{ day: 'Monday', period: 1 }, { day: 'Monday', period: 5 }, { day: 'Tuesday', period: 1 }, { day: 'Wednesday', period: 1 }, { day: 'Thursday', period: 1 }]
        : [{ day: 'Monday', period: 1 }, { day: 'Tuesday', period: 1 }, { day: 'Wednesday', period: 1 }, { day: 'Thursday', period: 1 }, { day: 'Friday', period: 1 }];
      const schedule = periods.map((p, i) => ({
        id: `l${i}`, ruleId: 'c1', groupId: 'g1', subjectId: 'subj-math', teacherId: 't1', day: p.day, period: p.period,
      }));
      return { semester1: { schedule, conflicts: [], score: 1 }, semester2: { schedule, conflicts: [], score: 1 } };
    };

    // Both resolve 5 lessons with 0 unassigned. The gap-free version must outrank
    // the one where a Monday lesson sits at period 5 (3 free hours that day).
    const tight = build(false);
    const loose = build(true);
    expect(teacherWeekFreePeriods(tight.semester1.schedule, 't1')).toBe(0);
    expect(teacherWeekFreePeriods(loose.semester1.schedule, 't1')).toBe(3);
    expect(scoreAttempt(tight, [], project)).toBeGreaterThan(scoreAttempt(loose, [], project));
  });
});