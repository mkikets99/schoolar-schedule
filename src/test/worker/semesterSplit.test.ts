import { describe, it, expect } from 'vitest';
import { ProjectState, CurriculumRule } from '../../shared/types';
import { computeSemesterSplits, buildSemesterProject, generateSemesterSchedules } from '../../worker/generator';

function makeProject(curriculum: CurriculumRule[]): ProjectState {
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
    groups: [{ id: 'g1', name: '10-A', grade: 10, subgroups: [] }],
    curriculum,
    loadDistribution: [],
    constraints: [],
  };
}

describe('computeSemesterSplits', () => {
  it('keeps integer hours unchanged in both semesters', () => {
    const splits = computeSemesterSplits(makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1' },
    ]));
    expect(splits).toHaveLength(1);
    expect(splits[0].first).toBe(5);
    expect(splits[0].second).toBe(5);
  });

  it('splits fractional hours into whole numbers per semester summing to the annual total', () => {
    const splits = computeSemesterSplits(makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 1.5, teacherId: 't1' },
      { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 3.5, teacherId: 't2' },
      { id: 'c3', groupId: 'g1', subjectId: 'subj-hist', hoursPerWeek: 0.5, teacherId: 't1' },
    ]));

    for (const split of splits) {
      expect(Number.isInteger(split.first)).toBe(true);
      expect(Number.isInteger(split.second)).toBe(true);
      expect(split.first).toBeGreaterThanOrEqual(0);
      expect(split.second).toBeGreaterThanOrEqual(0);
      expect(split.first + split.second).toBe(
        Math.ceil(split.hoursPerWeek) + Math.floor(split.hoursPerWeek)
      );
    }
  });

  it('auto-balances a teachers semester load to at most 1 hour difference', () => {
    const splits = computeSemesterSplits(makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 1.5, teacherId: 't1' },
      { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 1.5, teacherId: 't1' },
      { id: 'c3', groupId: 'g1', subjectId: 'subj-hist', hoursPerWeek: 1.5, teacherId: 't1' },
      { id: 'c4', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 2, teacherId: 't1' },
      { id: 'c5', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 1, teacherId: 't1' },
    ]));

    const s1 = splits.reduce((sum, s) => sum + s.first, 0);
    const s2 = splits.reduce((sum, s) => sum + s.second, 0);
    expect(Math.abs(s1 - s2)).toBeLessThanOrEqual(1);
  });

  it('rounds a 0.5h rule to one semester with a single lesson', () => {
    const splits = computeSemesterSplits(makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 0.5, teacherId: 't1' },
    ]));
    expect(Math.max(splits[0].first, splits[0].second)).toBe(1);
    expect(Math.min(splits[0].first, splits[0].second)).toBe(0);
  });
});

describe('buildSemesterProject', () => {
  it('drops rules with zero hours in a semester and keeps the rest', () => {
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 1.5, teacherId: 't1' },
      { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 0.5, teacherId: 't2' },
      { id: 'c3', groupId: 'g1', subjectId: 'subj-hist', hoursPerWeek: 4, teacherId: 't1' },
    ]);
    const splits = computeSemesterSplits(project);
    const splitMap = new Map(splits.map(s => [s.ruleId, s]));
    const c1s = splitMap.get('c1')!;
    const c2s = splitMap.get('c2')!;
    const c3s = splitMap.get('c3')!;

    expect(c3s.first).toBe(4);
    expect(c3s.second).toBe(4);

    const s1 = buildSemesterProject(project, 1, splits);
    const s2 = buildSemesterProject(project, 2, splits);

    expect(s1.curriculum.find(r => r.id === 'c1')!.hoursPerWeek).toBe(c1s.first);
    expect(s1.curriculum.find(r => r.id === 'c3')!.hoursPerWeek).toBe(4);
    expect(s2.curriculum.find(r => r.id === 'c1')!.hoursPerWeek).toBe(c1s.second);
    expect(s2.curriculum.find(r => r.id === 'c3')!.hoursPerWeek).toBe(4);

    if (c2s.first === 0) {
      expect(s1.curriculum.some(r => r.id === 'c2')).toBe(false);
    } else {
      expect(s1.curriculum.find(r => r.id === 'c2')!.hoursPerWeek).toBe(c2s.first);
    }
    if (c2s.second === 0) {
      expect(s2.curriculum.some(r => r.id === 'c2')).toBe(false);
    } else {
      expect(s2.curriculum.find(r => r.id === 'c2')!.hoursPerWeek).toBe(c2s.second);
    }
  });
});

describe('generateSemesterSchedules', () => {
  it('returns a result with both semester schedules and splits', async () => {
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1' },
      { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 1.5, teacherId: 't2' },
    ]);
    const messages: { type: string; payload?: any }[] = [];
    await generateSemesterSchedules(project, (msg) => messages.push(msg));

    const result = messages.find(m => m.type === 'RESULT');
    expect(result).toBeDefined();
    const payload = result!.payload;
    expect(payload.schedules.semester1).toBeDefined();
    expect(payload.schedules.semester2).toBeDefined();
    expect(payload.splits).toHaveLength(2);

    const s1Count = payload.schedules.semester1.schedule.length;
    const s2Count = payload.schedules.semester2.schedule.length;
    expect(s1Count).toBe(7); // 5 + ceil(1.5)
    expect(s2Count).toBe(6); // 5 + floor(1.5)
  });

  it('moves lessons that do not fit in one semester into the other semester', async () => {
    // g1 holds 5 lessons/week. c1 (4.5h) needs room r1; c2 (0.5h) also needs r1.
    // Semester1 gets c1=5 + c2=1 = 6 lessons competing for 5 r1 slots, so c2
    // cannot be placed. Semester2 gets c1=4, leaving a free r1 slot, so c2 must
    // be moved into semester2 and placed there.
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 4.5, teacherId: 't1', roomId: 'r1' },
      { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 0.5, teacherId: 't2', roomId: 'r1' },
    ]);
    project.groups = [{ id: 'g1', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 5, maxDailyLessons: 1 }];
    project.rooms = [{ id: 'r1', name: 'Lab', types: ['lab'] }];

    const messages: { type: string; payload?: any }[] = [];
    await generateSemesterSchedules(project, (msg) => messages.push(msg));

    const payload = messages.find((m) => m.type === 'RESULT')!.payload;
    const s1 = payload.schedules.semester1.schedule;
    const s2 = payload.schedules.semester2.schedule;

    // c2 (0.5h) was moved out of semester1 and placed in semester2.
    expect(s1.some((l: any) => l.ruleId === 'c2')).toBe(false);
    expect(s2.some((l: any) => l.ruleId === 'c2')).toBe(true);

    // No lesson is left unplaced overall.
    const unassigned = [
      ...payload.schedules.semester1.conflicts,
      ...payload.schedules.semester2.conflicts,
    ].filter((c: any) => c.type === 'UNASSIGNED_HOURS');
    const missing = unassigned.reduce((sum: number, c: any) => sum + (c.missing ?? 1), 0);
    expect(missing).toBe(0);
  });
});
