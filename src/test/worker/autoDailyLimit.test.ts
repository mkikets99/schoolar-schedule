import { describe, it, expect } from 'vitest';
import { ProjectState, CurriculumRule } from '../../shared/types';
import { generateSemesterSchedules } from '../../worker/generator';

function makeProject(curriculum: CurriculumRule[], loadDistribution: { teacherId: string; subjectId: string; groupId: string; hours: number }[], constraints: any[] = []): ProjectState {
  return {
    version: '1.0.0',
    school: { id: 's1', name: 'Test', address: '' },
    academicYears: [],
    teachers: [{ id: 't1', name: 'Teacher A', subjects: ['subj-math'] }],
    subjects: [{ id: 'subj-math', name: 'Math', shortName: 'M' }],
    rooms: [],
    groups: [{ id: 'g1', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 12, maxDailyLessons: 8 }],
    curriculum,
    loadDistribution,
    constraints,
  };
}

async function generate(project: ProjectState) {
  const messages: { type: string; payload?: any }[] = [];
  await generateSemesterSchedules(project, (msg) => messages.push(msg), { attempts: 1 });
  return messages.find((m) => m.type === 'RESULT')!.payload;
}

function maxPerDay(lessons: any[], subjectId: string): number {
  const perDay = new Map<string, number>();
  for (const l of lessons) {
    if (l.subjectId !== subjectId) continue;
    perDay.set(l.day, (perDay.get(l.day) || 0) + 1);
  }
  return Math.max(0, ...perDay.values());
}

describe('auto daily limit from load distribution (generator)', () => {
  it('does not place a >5h weekly subject more than 2 times per day', async () => {
    const project = makeProject(
      [{ id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 24, teacherId: 't1' }],
      [{ teacherId: 't1', subjectId: 'subj-math', groupId: 'g1', hours: 24 }]
    );
    const payload = await generate(project);
    expect(maxPerDay(payload.schedules.semester1.schedule, 'subj-math')).toBeLessThanOrEqual(2);
    expect(maxPerDay(payload.schedules.semester2.schedule, 'subj-math')).toBeLessThanOrEqual(2);
  });

  it('caps a heavy subject but still places all weekly lessons when they fit', async () => {
    const project = makeProject(
      [{ id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 10, teacherId: 't1' }],
      [{ teacherId: 't1', subjectId: 'subj-math', groupId: 'g1', hours: 10 }]
    );
    const payload = await generate(project);
    for (const sem of [payload.schedules.semester1, payload.schedules.semester2]) {
      expect(sem.schedule.filter((l: any) => l.subjectId === 'subj-math')).toHaveLength(10);
      expect(maxPerDay(sem.schedule, 'subj-math')).toBe(2);
    }
  });

  it('spreads a ≤5h weekly subject across days (max 1 per day)', async () => {
    const project = makeProject(
      [{ id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 4, teacherId: 't1' }],
      [{ teacherId: 't1', subjectId: 'subj-math', groupId: 'g1', hours: 4 }]
    );
    const payload = await generate(project);
    for (const sem of [payload.schedules.semester1, payload.schedules.semester2]) {
      expect(sem.schedule.filter((l: any) => l.subjectId === 'subj-math')).toHaveLength(4);
      expect(maxPerDay(sem.schedule, 'subj-math')).toBe(1);
    }
  });

  it('lets an explicit MAX_DAILY_LESSONS constraint override the auto limit', async () => {
    const project = makeProject(
      [{ id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 8, teacherId: 't1' }],
      [{ teacherId: 't1', subjectId: 'subj-math', groupId: 'g1', hours: 8 }],
      [{ id: 'x1', kind: 'MAX_DAILY_LESSONS', ruleId: 'c1', maxPerDay: 1 }]
    );
    const payload = await generate(project);
    for (const sem of [payload.schedules.semester1, payload.schedules.semester2]) {
      expect(sem.schedule.filter((l: any) => l.subjectId === 'subj-math')).toHaveLength(5);
      expect(maxPerDay(sem.schedule, 'subj-math')).toBe(1);
      const unassigned = (sem.conflicts || []).filter((c: any) => c.type === 'UNASSIGNED_HOURS' && c.ruleId === 'c1')
        .reduce((sum: number, c: any) => sum + (c.missing ?? 1), 0);
      expect(unassigned).toBeGreaterThan(0);
    }
  });
});