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

  it('applies a FORBID_LESSON constraint to fix the per-semester split', () => {
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1' },
    ]);
    project.constraints = [{ id: 'x', kind: 'FORBID_LESSON', ruleId: 'c1', semester: 2, hours: 3 }];
    const splits = computeSemesterSplits(project);
    // Annual total (10) is preserved; semester 2 gets the configured 3 hours.
    expect(splits[0].first).toBe(7);
    expect(splits[0].second).toBe(3);
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

  it('keeps a balanced integer split instead of shifting a whole lesson to the other semester', async () => {
    // g1 has 5 lesson slots per semester (periodStart 1, periodEnd 1, maxDaily 1).
    // c1 (4h) + c2 (2h) need 6 slots per semester but only 5 exist, so one hour
    // cannot be placed. Both rules have integer hours, so neither may shift a
    // whole lesson across semesters: the splits must stay canonical 4/4 and 2/2
    // while the shortfall is reported as unassigned instead of a skewed 3/5.
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 4, teacherId: 't1' },
      { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 2, teacherId: 't1' },
    ]);
    project.groups = [{ id: 'g1', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 1, maxDailyLessons: 1 }];

    const messages: { type: string; payload?: any }[] = [];
    await generateSemesterSchedules(project, (msg) => messages.push(msg));
    const payload = messages.find((m) => m.type === 'RESULT')!.payload;

    const c1 = payload.splits.find((s: any) => s.ruleId === 'c1');
    const c2 = payload.splits.find((s: any) => s.ruleId === 'c2');
    expect(c1.first).toBe(4);
    expect(c1.second).toBe(4);
    expect(c2.first).toBe(2);
    expect(c2.second).toBe(2);

    // The shortfall (2 hours, 1 per semester) is honestly unassigned, not hidden
    // by shifting whole lessons into the other semester.
    const c1Placed = ['semester1', 'semester2']
      .map((sem) => payload.schedules[sem].schedule.filter((l: any) => l.ruleId === 'c1').length)
      .reduce((a, b) => a + b, 0);
    const c2Placed = ['semester1', 'semester2']
      .map((sem) => payload.schedules[sem].schedule.filter((l: any) => l.ruleId === 'c2').length)
      .reduce((a, b) => a + b, 0);
    const missing = [
      ...payload.schedules.semester1.conflicts,
      ...payload.schedules.semester2.conflicts,
    ].filter((c: any) => c.type === 'UNASSIGNED_HOURS')
      .reduce((sum: number, c: any) => sum + (c.missing ?? 1), 0);

    expect(c1Placed + c2Placed).toBe(10); // 5 slots per semester x 2
    expect(missing).toBe(2); // 12 required - 10 placed
    expect(c1Placed + c2Placed + missing).toBe(12);
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

    // c1 (4.5h -> 9 lessons) and c2 (0.5h -> 1 lesson) both need room r1, which g1
    // can only host 5 times per semester (maxDaily 1 over 5 days). Semester1 alone
    // cannot hold all 6 r1 lessons, so the spillover must move some into semester2.
    // Which rule moves depends on the winning attempt, so assert both are fully
    // placed and nothing is left unassigned.
    const c1Placed = s1.filter((l: any) => l.ruleId === 'c1').length + s2.filter((l: any) => l.ruleId === 'c1').length;
    const c2Placed = s1.filter((l: any) => l.ruleId === 'c2').length + s2.filter((l: any) => l.ruleId === 'c2').length;
    expect(c1Placed).toBe(9); // 4.5h splits to 5 + 4 across semesters
    expect(c2Placed).toBe(1);

    // No lesson is left unplaced overall.
    const unassigned = [
      ...payload.schedules.semester1.conflicts,
      ...payload.schedules.semester2.conflicts,
    ].filter((c: any) => c.type === 'UNASSIGNED_HOURS');
    const missing = unassigned.reduce((sum: number, c: any) => sum + (c.missing ?? 1), 0);
    expect(missing).toBe(0);
  });

  it('respects a FORBID_LESSON constraint (rule absent from forbidden semester)', async () => {
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1' },
    ]);
    project.constraints = [{ id: 'x', kind: 'FORBID_LESSON', ruleId: 'c1', semester: 1, hours: 0 }];
    const messages: { type: string; payload?: any }[] = [];
    await generateSemesterSchedules(project, (msg) => messages.push(msg));
    const payload = messages.find((m) => m.type === 'RESULT')!.payload;

    // c1 is forbidden in semester 1, so it must never appear there.
    expect(payload.schedules.semester1.schedule.some((l: any) => l.ruleId === 'c1')).toBe(false);
    // It is allowed (and gets placed) in semester 2.
    expect(payload.schedules.semester2.schedule.some((l: any) => l.ruleId === 'c1')).toBe(true);
    // The returned split reflects the forbid (0 hours in semester 1).
    const split = payload.splits.find((s: any) => s.ruleId === 'c1');
    expect(split.first).toBe(0);
    expect(split.second).toBe(10);
  });

  it('never places a capped rule more than its per-day limit', async () => {
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1' },
    ]);
    project.constraints = [{ id: 'md', kind: 'MAX_DAILY_LESSONS', ruleId: 'c1', maxPerDay: 1 }];
    const messages: { type: string; payload?: any }[] = [];
    await generateSemesterSchedules(project, (msg) => messages.push(msg));
    const payload = messages.find((m) => m.type === 'RESULT')!.payload;

    for (const semester of ['semester1', 'semester2'] as const) {
      const lessons = payload.schedules[semester].schedule.filter((l: any) => l.ruleId === 'c1');
      expect(lessons).toHaveLength(5);
      const perDay = new Map<string, number>();
      for (const l of lessons) perDay.set(l.day, (perDay.get(l.day) || 0) + 1);
      for (const count of perDay.values()) expect(count).toBeLessThanOrEqual(1);
    }

    const unassigned = [
      ...payload.schedules.semester1.conflicts,
      ...payload.schedules.semester2.conflicts,
    ].filter((c: any) => c.type === 'UNASSIGNED_HOURS');
    expect(unassigned).toHaveLength(0);
  });

  it('splits a capped double-lesson rule into single days', async () => {
    // A 4h double-lesson rule is 2 double units in a week. Capped at 1/day, the
    // double rows cannot be placed together, so the generator falls back to
    // placing each hour on its own day.
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 4, teacherId: 't1', doubleLesson: true },
    ]);
    project.constraints = [{ id: 'md', kind: 'MAX_DAILY_LESSONS', ruleId: 'c1', maxPerDay: 1 }];
    const messages: { type: string; payload?: any }[] = [];
    await generateSemesterSchedules(project, (msg) => messages.push(msg));
    const payload = messages.find((m) => m.type === 'RESULT')!.payload;

    for (const semester of ['semester1', 'semester2'] as const) {
      const lessons = payload.schedules[semester].schedule.filter((l: any) => l.ruleId === 'c1');
      expect(lessons).toHaveLength(4);
      const perDay = new Map<string, number>();
      for (const l of lessons) perDay.set(l.day, (perDay.get(l.day) || 0) + 1);
      for (const count of perDay.values()) expect(count).toBeLessThanOrEqual(1);
      // No lesson shares a slot with another lesson of the same rule.
      const bySlot = new Map<string, number>();
      for (const l of lessons) bySlot.set(`${l.day}-${l.period}`, (bySlot.get(`${l.day}-${l.period}`) || 0) + 1);
      for (const count of bySlot.values()) expect(count).toBeLessThanOrEqual(1);
    }
  });

  it('places a pinned, capped rule 8/8 in both semesters inside a tight week', async () => {
    // g1 can host 15 lessons per semester (periodStart 1, periodEnd 5, maxDaily 3).
    // The week needs 19, so the schedule is over-subscribed and greedy placement
    // would otherwise let larger groups push the ukr rule out (a lesson left
    // unassigned means one semester ends up with fewer than its pinned 8 lessons).
    // The worker must prioritize the pinned rule so it is always fully placed.
    const project = makeProject([
      { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 8, teacherId: 't1' },
      { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 6, teacherId: 't2' },
      { id: 'c3', groupId: 'g1', subjectId: 'subj-hist', hoursPerWeek: 5, teacherId: 't1' },
    ]);
    project.groups = [{ id: 'g1', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 5, maxDailyLessons: 3 }];
    project.constraints = [
      { id: 'pin', kind: 'FORBID_LESSON', ruleId: 'c1', semester: 1, hours: 8 },
      { id: 'cap', kind: 'MAX_DAILY_LESSONS', ruleId: 'c1', maxPerDay: 2 },
    ];

    const messages: { type: string; payload?: any }[] = [];
    await generateSemesterSchedules(project, (msg) => messages.push(msg));
    const payload = messages.find((m) => m.type === 'RESULT')!.payload;

    const split = payload.splits.find((s: any) => s.ruleId === 'c1');
    expect(split.first).toBe(8);
    expect(split.second).toBe(8);

    for (const semester of ['semester1', 'semester2'] as const) {
      // Every one of the pinned 8 lessons is actually placed in this semester.
      const lessons = payload.schedules[semester].schedule.filter((l: any) => l.ruleId === 'c1');
      expect(lessons).toHaveLength(8);
      // And the per-day cap is still honored.
      const perDay = new Map<string, number>();
      for (const l of lessons) perDay.set(l.day, (perDay.get(l.day) || 0) + 1);
      for (const count of perDay.values()) expect(count).toBeLessThanOrEqual(2);
    }

    // No c1 lesson is left unassigned in either semester.
    const unassigned = [
      ...payload.schedules.semester1.conflicts,
      ...payload.schedules.semester2.conflicts,
    ].filter((c: any) => c.type === 'UNASSIGNED_HOURS' && c.ruleId === 'c1');
    expect(unassigned).toHaveLength(0);
  });
});
