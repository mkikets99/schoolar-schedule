import { describe, it, expect } from 'vitest';
import { ProjectState, CurriculumRule } from '../../shared/types';

interface GroupScheduleConfig {
  periodStart: number;
  periodEnd: number;
  maxDaily: number;
}

async function generateTestSchedule(project: ProjectState) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

  const groupConfig = new Map<string, GroupScheduleConfig>();
  for (const group of project.groups || []) {
    groupConfig.set(group.id, {
      periodStart: group.periodStart ?? 1,
      periodEnd: group.periodEnd ?? 8,
      maxDaily: group.maxDailyLessons ?? 8,
    });
  }

  const teacherBusy = new Set<string>();
  const groupBusy = new Set<string>();
  const roomBusy = new Set<string>();

  const groupGrade = new Map<string, number>();
  for (const group of project.groups || []) {
    groupGrade.set(group.id, group.grade ?? 0);
  }

  const teacherBusyRules: { teacherId: string; day: string; periods: Set<number> }[] = [];
  const noFirstRules: { subjectId: string; groupId?: string }[] = [];
  for (const c of project.constraints || []) {
    if (c.kind === 'TEACHER_BUSY' && c.teacherId && c.periods && c.periods.length > 0) {
      teacherBusyRules.push({ teacherId: c.teacherId, day: c.day || '*', periods: new Set(c.periods) });
    } else if (c.kind === 'NO_FIRST_PERIOD' && c.subjectId) {
      noFirstRules.push({ subjectId: c.subjectId, groupId: c.groupId });
    }
  }

  const seen = new Map<string, CurriculumRule[]>();
  for (const rule of project.curriculum) {
    const key = `${rule.groupId}|${rule.subjectId}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(rule);
  }

  const splitKeys = new Set<string>();
  for (const [key, rules] of seen) {
    if (rules.length > 1) splitKeys.add(key);
  }

  interface LessonStub {
    id: string;
    ruleId: string;
    groupId: string;
    subjectId: string;
    teacherId?: string;
    roomId?: string;
  }

  interface SchedulingUnit {
    type: 'single' | 'split' | 'double';
    groupId: string;
    lessons: LessonStub[];
  }

  function unitSlotCount(unit: SchedulingUnit): number {
    return unit.type === 'double' ? 2 : 1;
  }

  const units: SchedulingUnit[] = [];
  for (const [key, rules] of seen) {
    const [groupId] = key.split('|');
    if (splitKeys.has(key)) {
      for (let h = 0; h < rules[0].hoursPerWeek; h++) {
        units.push({
          type: 'split',
          groupId,
          lessons: rules.map(rule => ({
            id: crypto.randomUUID(),
            ruleId: rule.id,
            groupId: rule.groupId,
            subjectId: rule.subjectId,
            teacherId: rule.teacherId,
            roomId: rule.roomId,
          })),
        });
      }
    } else {
      const rule = rules[0];
      if (rule.doubleLesson) {
        const totalLessons = Math.floor(rule.hoursPerWeek);
        const pairs = Math.floor(totalLessons / 2);
        const leftover = totalLessons % 2;
        for (let p = 0; p < pairs; p++) {
          units.push({
            type: 'double',
            groupId,
            lessons: [1, 2].map(() => ({
              id: crypto.randomUUID(),
              ruleId: rule.id,
              groupId: rule.groupId,
              subjectId: rule.subjectId,
              teacherId: rule.teacherId,
              roomId: rule.roomId,
            })),
          });
        }
        for (let h = 0; h < leftover; h++) {
          units.push({
            type: 'single',
            groupId,
            lessons: [{
              id: crypto.randomUUID(),
              ruleId: rule.id,
              groupId: rule.groupId,
              subjectId: rule.subjectId,
              teacherId: rule.teacherId,
              roomId: rule.roomId,
            }],
          });
        }
      } else {
        for (let h = 0; h < rule.hoursPerWeek; h++) {
          units.push({
            type: 'single',
            groupId,
            lessons: [{
              id: crypto.randomUUID(),
              ruleId: rule.id,
              groupId: rule.groupId,
              subjectId: rule.subjectId,
              teacherId: rule.teacherId,
              roomId: rule.roomId,
            }],
          });
        }
      }
    }
  }

  const groupLessonTotals = new Map<string, number>();
  for (const unit of units) {
    groupLessonTotals.set(unit.groupId, (groupLessonTotals.get(unit.groupId) || 0) + unitSlotCount(unit));
  }

  const dailyTargets = new Map<string, number[]>();
  for (const [gid, total] of groupLessonTotals) {
    const cfg = groupConfig.get(gid);
    const maxDaily = cfg?.maxDaily ?? 8;
    const raw = days.map(() => 0);
    for (let h = 0; h < total; h++) raw[h % 5]++;
    const capped = raw.map(v => Math.min(v, maxDaily));
    let overflow = raw.reduce((s, v) => s + Math.max(0, v - maxDaily), 0);
    let idx = 0;
    while (overflow > 0 && idx < 100) {
      if (capped[idx % 5] < maxDaily) { capped[idx % 5]++; overflow--; }
      idx++;
    }
    dailyTargets.set(gid, capped);
  }

  const dailyCounts = new Map<string, number[]>();
  for (const gid of groupLessonTotals.keys()) {
    dailyCounts.set(gid, days.map(() => 0));
  }

  const teacherDailyCounts = new Map<string, number[]>();
  for (const t of project.teachers || []) {
    teacherDailyCounts.set(t.id, days.map(() => 0));
  }

  units.sort((a, b) => {
    const da = a.type === 'double' ? 0 : 1;
    const db = b.type === 'double' ? 0 : 1;
    if (da !== db) return da - db;
    const ta = groupLessonTotals.get(a.groupId) || 0;
    const tb = groupLessonTotals.get(b.groupId) || 0;
    if (ta !== tb) return tb - ta;
    const aa = a.lessons[0]?.teacherId || '';
    const ab = b.lessons[0]?.teacherId || '';
    if (aa !== ab) return aa.localeCompare(ab);
    return Math.random() - 0.5;
  });

  const schedule: any[] = [];
  const conflicts: any[] = [];

  function isTeacherBusyRule(teacherId: string, day: string, period: number): boolean {
    for (const rule of teacherBusyRules) {
      if (rule.teacherId !== teacherId) continue;
      if (rule.day !== '*' && rule.day !== day) continue;
      if (rule.periods.has(period)) return true;
    }
    return false;
  }

  function isForbiddenFirstPeriod(lesson: LessonStub, period: number, periodStart: number): boolean {
    if (period !== periodStart) return false;
    return noFirstRules.some(r =>
      r.subjectId === lesson.subjectId && (!r.groupId || r.groupId === lesson.groupId)
    );
  }

  // A room assigned to a rule is forced: if it is taken at this slot the
  // placement must look elsewhere - never silently substitute another room.
  function canPlace(lesson: LessonStub, day: string, period: number, skipGroupCheck: boolean): boolean {
    const slotKey = `${day}-${period}`;
    if (!skipGroupCheck && groupBusy.has(`${lesson.groupId}-${slotKey}`)) return false;
    if (lesson.teacherId && teacherBusy.has(`${lesson.teacherId}-${slotKey}`)) return false;
    if (lesson.teacherId && isTeacherBusyRule(lesson.teacherId, day, period)) return false;
    const cfg = groupConfig.get(lesson.groupId);
    if (isForbiddenFirstPeriod(lesson, period, cfg?.periodStart ?? 1)) return false;
    if (lesson.roomId && roomBusy.has(`${lesson.roomId}-${slotKey}`)) return false;
    return true;
  }

  function placeLesson(lesson: LessonStub, day: string, period: number) {
    const slotKey = `${day}-${period}`;
    const roomId = lesson.roomId;

    schedule.push({
      id: lesson.id,
      ruleId: lesson.ruleId,
      groupId: lesson.groupId,
      subjectId: lesson.subjectId,
      teacherId: lesson.teacherId,
      roomId,
      day,
      period,
    });

    const groupSlotKey = `${lesson.groupId}-${slotKey}`;
    const firstInSlot = !groupBusy.has(groupSlotKey);
    groupBusy.add(groupSlotKey);
    if (lesson.teacherId) teacherBusy.add(`${lesson.teacherId}-${slotKey}`);
    if (roomId) roomBusy.add(`${roomId}-${slotKey}`);

    const di = days.indexOf(day);
    if (di >= 0) {
      if (firstInSlot) {
        const counts = dailyCounts.get(lesson.groupId);
        if (counts) counts[di]++;
      }
      if (lesson.teacherId) {
        const tcounts = teacherDailyCounts.get(lesson.teacherId);
        if (tcounts) tcounts[di]++;
      }
    }
  }

  function tryPlaceDouble(unit: SchedulingUnit, day: string, period: number): boolean {
    const lesson = unit.lessons[0];
    const cfg = groupConfig.get(unit.groupId);
    const pEnd = cfg?.periodEnd ?? 8;
    if (period + 1 > pEnd) return false;
    if (!canPlace(lesson, day, period, false)) return false;
    if (!canPlace(lesson, day, period + 1, false)) return false;
    placeLesson(lesson, day, period);
    placeLesson(unit.lessons[1], day, period + 1);
    return true;
  }

  function placeAsSingles(unit: SchedulingUnit) {
    for (const lesson of unit.lessons) {
      let placed = false;
      for (const day of days) {
        if (placed) break;
        const counts = dailyCounts.get(unit.groupId);
        const maxDaily = groupConfig.get(unit.groupId)?.maxDaily ?? 8;
        if ((counts?.[days.indexOf(day)] ?? 0) >= maxDaily) continue;
        const ordered = getPeriodsForGroup(unit.groupId);
        for (const p of ordered) {
          if (canPlace(lesson, day, p, false)) {
            placeLesson(lesson, day, p);
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        conflicts.push({ type: 'UNASSIGNED_HOURS', ruleId: lesson.ruleId, missing: 1 });
      }
    }
  }

  function tryPlaceUnit(unit: SchedulingUnit, day: string, period: number): boolean {
    if (unit.type === 'single') {
      if (!canPlace(unit.lessons[0], day, period, false)) return false;
      placeLesson(unit.lessons[0], day, period);
      return true;
    }

    if (unit.type === 'double') {
      return tryPlaceDouble(unit, day, period);
    }

    const first = unit.lessons[0];
    if (groupBusy.has(`${first.groupId}-${day}-${period}`)) return false;

    const counts = dailyCounts.get(unit.groupId);
    const maxDaily = groupConfig.get(unit.groupId)?.maxDaily ?? 8;
    if (counts && counts[days.indexOf(day)] + unitSlotCount(unit) > maxDaily) return false;

    for (const lesson of unit.lessons) {
      if (!canPlace(lesson, day, period, true)) return false;
    }

    for (const lesson of unit.lessons) {
      placeLesson(lesson, day, period);
    }
    return true;
  }

  function getPeriodsForGroup(groupId: string): number[] {
    const cfg = groupConfig.get(groupId);
    const start = cfg?.periodStart ?? 1;
    const end = cfg?.periodEnd ?? 8;
    const result: number[] = [];
    for (let p = start; p <= end; p++) result.push(p);
    return result;
  }

  function gradeAdjacencyScore(unit: SchedulingUnit, day: string, period: number): number {
    const grade = groupGrade.get(unit.groupId);
    if (grade === undefined) return 0;
    const near = unit.type === 'double' ? [period - 1, period + 2] : [period - 1, period + 1];
    let score = 0;
    for (const s of schedule) {
      if (s.groupId === unit.groupId) continue;
      if (s.day !== day) continue;
      if (!near.includes(s.period)) continue;
      if (groupGrade.get(s.groupId) === grade) score++;
    }
    return score;
  }

  function teacherDayBonus(unit: SchedulingUnit, di: number): number {
    let bonus = 0;
    for (const lesson of unit.lessons) {
      if (!lesson.teacherId) continue;
      const counts = teacherDailyCounts.get(lesson.teacherId);
      if (counts && counts[di] === 1) bonus = 2;
    }
    return bonus;
  }

  function teacherCompactnessFor(teacherId: string, day: string, period: number): number {
    const periods: number[] = [];
    for (const s of schedule) {
      if (s.teacherId === teacherId && s.day === day) periods.push(s.period);
    }
    if (periods.length === 0) return 0;
    periods.push(period);
    periods.sort((a, b) => a - b);
    let maxGap = 0;
    for (let i = 1; i < periods.length; i++) {
      maxGap = Math.max(maxGap, periods[i] - periods[i - 1] - 1);
    }
    return maxGap <= 2 ? 4 - maxGap : -3;
  }

  function teacherCompactnessScore(unit: SchedulingUnit, day: string, period: number): number {
    let score = 0;
    const seen = new Set<string>();
    for (const lesson of unit.lessons) {
      if (!lesson.teacherId || seen.has(lesson.teacherId)) continue;
      seen.add(lesson.teacherId);
      const s = teacherCompactnessFor(lesson.teacherId, day, period);
      score = seen.size === 1 ? s : Math.min(score, s);
    }
    return score;
  }

  function getOrderedPeriods(unit: SchedulingUnit, day: string): number[] {
    const base = getPeriodsForGroup(unit.groupId);
    return base.slice().sort((a, b) => {
      const ca = teacherCompactnessScore(unit, day, a);
      const cb = teacherCompactnessScore(unit, day, b);
      if (ca !== cb) return cb - ca;
      const sa = gradeAdjacencyScore(unit, day, a);
      const sb = gradeAdjacencyScore(unit, day, b);
      if (sa !== sb) return sb - sa;
      return a - b;
    });
  }

  let unitsAssigned = 0;
  for (const unit of units) {
    const targets = dailyTargets.get(unit.groupId)!;
    const counts = dailyCounts.get(unit.groupId)!;
    const cfg = groupConfig.get(unit.groupId);
    const maxDaily = cfg?.maxDaily ?? 8;

    const dayScores = days.map((day, di) => {
      const extra = unitSlotCount(unit);
      const fits = counts[di] + extra <= maxDaily;
      return {
        day, index: di,
        need: counts[di] >= maxDaily || !fits ? -999 : (targets[di] - counts[di]) + teacherDayBonus(unit, di),
      };
    });
    dayScores.sort((a, b) => b.need - a.need);

    let placed = false;

    for (const ds of dayScores) {
      if (placed) break;
      if (ds.need === -999) continue;
      const ordered = getOrderedPeriods(unit, ds.day);
      for (const p of ordered) {
        if (tryPlaceUnit(unit, ds.day, p)) { placed = true; break; }
      }
    }

    if (!placed) {
      for (const day of days) {
        if (placed) break;
        const di = days.indexOf(day);
        const extra = unitSlotCount(unit);
        if (counts[di] >= maxDaily) continue;
        if (counts[di] + extra > maxDaily) continue;
        const ordered = getOrderedPeriods(unit, day);
        for (const p of ordered) {
          if (tryPlaceUnit(unit, day, p)) { placed = true; break; }
        }
      }
    }

    if (!placed && unit.type === 'double') {
      placeAsSingles(unit);
      placed = true;
    }

    if (placed) {
      unitsAssigned++;
    } else {
      for (const lesson of unit.lessons) {
        conflicts.push({ type: 'UNASSIGNED_HOURS', ruleId: lesson.ruleId, missing: 1 });
      }
    }
  }

  return { schedule, conflicts, units, unitsAssigned };
}

function makeProject(overrides: Partial<ProjectState> = {}): ProjectState {
  return {
    version: '1.0.0',
    school: { id: 's1', name: 'Test', address: '' },
    academicYears: [],
    teachers: [],
    subjects: [
      { id: 'subj-math', name: 'Math', shortName: 'M' },
      { id: 'subj-info', name: 'Informatics', shortName: 'INFO' },
    ],
    rooms: [
      { id: 'r1', name: 'Room 1', maxGroups: 1, types: ['classroom'] },
      { id: 'r2', name: 'Room 2', maxGroups: 1, types: ['classroom'] },
      { id: 'r3', name: 'Room 3', maxGroups: 1, types: ['classroom'] },
      { id: 'r4', name: 'Room 4', maxGroups: 1, types: ['classroom'] },
      { id: 'r5', name: 'Room 5', maxGroups: 1, types: ['classroom'] },
    ],
    groups: [{ id: 'g1', name: '10-A', grade: 10, subgroups: [] }],
    curriculum: [],
    loadDistribution: [],
    constraints: [],
    ...overrides,
  };
}

describe('Worker scheduling algorithm', () => {
  it('assigns all lessons for a simple single-group project', async () => {
    const project = makeProject({
      groups: [{ id: 'g1', name: '10-A', grade: 10, subgroups: [] }],
      teachers: [{ id: 't1', name: 'Teacher A', subjects: ['subj-math'] }],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1', roomId: 'r1' },
      ],
    });

    const result = await generateTestSchedule(project);

    expect(result.schedule).toHaveLength(5);
    expect(result.conflicts).toHaveLength(0);
    expect(result.schedule.every(l => l.day && l.period)).toBe(true);
  });

  it('distributes lessons across days (at most 1 per group per slot)', async () => {
    const project = makeProject({
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 5, teacherId: 't1', roomId: 'r2' },
      ],
    });

    const result = await generateTestSchedule(project);
    const slotMap = new Map<string, number>();
    for (const lesson of result.schedule) {
      const key = `${lesson.groupId}-${lesson.day}-${lesson.period}`;
      slotMap.set(key, (slotMap.get(key) || 0) + 1);
    }

    for (const [, count] of slotMap) {
      expect(count).toBeLessThanOrEqual(1);
    }
  });

  it('produces at least one lesson per day for groups with ≥5 hours', async () => {
    const project = makeProject({
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 10, teacherId: 't1', roomId: 'r1' },
      ],
    });

    const result = await generateTestSchedule(project);
    const dayCounts = new Map<string, number>();
    for (const lesson of result.schedule) {
      dayCounts.set(lesson.day, (dayCounts.get(lesson.day) || 0) + 1);
    }

    expect(dayCounts.size).toBe(5);
    for (const [, count] of dayCounts) {
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it('handles empty curriculum gracefully', async () => {
    const project = makeProject({ curriculum: [] });
    const result = await generateTestSchedule(project);

    expect(result.schedule).toHaveLength(0);
    expect(result.conflicts).toHaveLength(0);
  });

  it('schedules split lessons (same group+subject) at the same time slot', async () => {
    const project = makeProject({
      teachers: [
        { id: 't1', name: 'Teacher A', subjects: ['subj-info'] },
        { id: 't2', name: 'Teacher B', subjects: ['subj-info'] },
      ],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 2, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 2, teacherId: 't2', roomId: 'r2' },
      ],
    });

    const result = await generateTestSchedule(project);

    const slotGroups = new Map<string, string[]>();
    for (const lesson of result.schedule) {
      const key = `${lesson.day}-${lesson.period}`;
      if (!slotGroups.has(key)) slotGroups.set(key, []);
      slotGroups.get(key)!.push(lesson.subjectId);
    }

    for (const [, subjects] of slotGroups) {
      if (subjects.length === 2) {
        expect(subjects[0]).toBe(subjects[1]);
      }
    }

    expect(result.conflicts).toHaveLength(0);
  });

  it('counts a split lesson as 1 toward the group daily maximum', async () => {
    const project = makeProject({
      teachers: [
        { id: 't1', name: 'Teacher A', subjects: ['subj-info'] },
        { id: 't2', name: 'Teacher B', subjects: ['subj-info'] },
        { id: 't3', name: 'Teacher C', subjects: ['subj-math'] },
      ],
      groups: [{ id: 'g1', name: '10-A', grade: 10, subgroups: [], maxDailyLessons: 1 }],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 1, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 1, teacherId: 't2', roomId: 'r2' },
        { id: 'c3', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 1, teacherId: 't3', roomId: 'r3' },
      ],
    });

    const result = await generateTestSchedule(project);

    expect(result.conflicts).toHaveLength(0);
    expect(result.schedule).toHaveLength(3);

    const splitLessons = result.schedule.filter((l) => l.subjectId === 'subj-info');
    expect(splitLessons.length).toBe(2);
    expect(splitLessons[0].day).toBe(splitLessons[1].day);
    expect(splitLessons[0].period).toBe(splitLessons[1].period);
  });

  it('places double lessons in consecutive periods when doubleLesson is set', async () => {
    const project = makeProject({
      teachers: [{ id: 't1', name: 'Teacher A', subjects: ['subj-math'] }],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 6, teacherId: 't1', roomId: 'r1', doubleLesson: true },
      ],
    });

    const result = await generateTestSchedule(project);
    const lessons = result.schedule.filter((l: any) => l.ruleId === 'c1');

    expect(lessons).toHaveLength(6);
    expect(result.conflicts).toHaveLength(0);

    let adjacent = 0;
    for (const lesson of lessons) {
      const hasNeighbor = lessons.some(other =>
        other.id !== lesson.id &&
        other.day === lesson.day &&
        Math.abs(other.period - lesson.period) === 1
      );
      if (hasNeighbor) adjacent++;
    }
    expect(adjacent).toBeGreaterThanOrEqual(4);
  });

  it('respects teacher busy constraints (no lessons in blocked slots)', async () => {
    const project = makeProject({
      teachers: [{ id: 't1', name: 'Teacher A', subjects: ['subj-math'] }],
      groups: [
        { id: 'g1', name: '10-A', grade: 10, subgroups: [] },
        { id: 'g2', name: '10-B', grade: 10, subgroups: [] },
      ],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g2', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1', roomId: 'r2' },
      ],
      constraints: [
        { id: 'con1', kind: 'TEACHER_BUSY', teacherId: 't1', day: 'Monday', periods: [1, 2, 3] },
      ],
    });

    const result = await generateTestSchedule(project);

    expect(result.schedule).toHaveLength(10);
    expect(result.conflicts).toHaveLength(0);
    for (const lesson of result.schedule) {
      if (lesson.teacherId === 't1' && lesson.day === 'Monday') {
        expect(lesson.period).not.toBe(1);
        expect(lesson.period).not.toBe(2);
        expect(lesson.period).not.toBe(3);
      }
    }
  });

  it('does not schedule constrained subjects in the first period', async () => {
    const project = makeProject({
      teachers: [
        { id: 't1', name: 'Teacher A', subjects: ['subj-math'] },
        { id: 't2', name: 'Teacher B', subjects: ['subj-math'] },
      ],
      groups: [
        { id: 'g1', name: '10-A', grade: 10, subgroups: [] },
        { id: 'g2', name: '10-B', grade: 10, subgroups: [] },
      ],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g2', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't2', roomId: 'r2' },
      ],
      constraints: [
        { id: 'con1', kind: 'NO_FIRST_PERIOD', subjectId: 'subj-math' },
      ],
    });

    const result = await generateTestSchedule(project);

    expect(result.conflicts).toHaveLength(0);
    for (const lesson of result.schedule) {
      if (lesson.subjectId === 'subj-math') {
        expect(lesson.period).not.toBe(1);
      }
    }
  });

  it('generates conflict entries for unassignable lessons', async () => {
    const rooms = [{ id: 'r1', name: 'Only Room', maxGroups: 1, types: ['classroom'] }];
    const curriculum = Array.from({ length: 40 }, (_, i) => ({
      id: `c${i}`,
      groupId: i < 20 ? 'g1' : 'g2',
      subjectId: `subj-${i}`,
      hoursPerWeek: 5,
      teacherId: i < 20 ? 't1' : 't2',
      roomId: 'r1',
    }));
    curriculum.push({
      id: 'c-overflow',
      groupId: 'g3',
      subjectId: 'subj-extra',
      hoursPerWeek: 5,
      teacherId: 't3',
      roomId: 'r1',
    });

    const project = makeProject({
      rooms,
      groups: [
        { id: 'g1', name: '10-A', grade: 10, subgroups: [] },
        { id: 'g2', name: '10-B', grade: 10, subgroups: [] },
        { id: 'g3', name: '10-C', grade: 10, subgroups: [] },
      ],
      curriculum,
    });

    const result = await generateTestSchedule(project);

    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.conflicts[0].type).toBe('UNASSIGNED_HOURS');
  });

  it('schedules a group with 35 hours (full load) without conflicts', async () => {
    const rooms = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`,
      name: `Room ${i}`,
      maxGroups: 1,
      types: ['classroom'],
    }));
    const curriculum: CurriculumRule[] = [];
    for (let i = 0; i < 7; i++) {
      curriculum.push({
        id: `c${i}`,
        groupId: 'g1',
        subjectId: 'subj-math',
        hoursPerWeek: 5,
        teacherId: `t${i}`,
        roomId: `r${i}`,
      });
    }

    const project = makeProject({ rooms, curriculum });
    const result = await generateTestSchedule(project);

    expect(result.schedule).toHaveLength(35);
    expect(result.conflicts).toHaveLength(0);

    const dayCounts = new Map<string, number>();
    for (const lesson of result.schedule) {
      dayCounts.set(lesson.day, (dayCounts.get(lesson.day) || 0) + 1);
    }
    for (const [, count] of dayCounts) {
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });

  it('forces the exact room on a rule and never substitutes another', async () => {
    const project = makeProject({
      rooms: [
        { id: 'r1', name: 'Lab A', maxGroups: 1, types: ['computer-lab'] },
        { id: 'r2', name: 'Lab B', maxGroups: 1, types: ['computer-lab'] },
        { id: 'r3', name: 'Classroom', maxGroups: 1, types: ['classroom'] },
      ],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 8, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g2', subjectId: 'subj-math', hoursPerWeek: 8, teacherId: 't2', roomId: 'r3' },
      ],
      groups: [
        { id: 'g1', name: '10-A', grade: 10, subgroups: [] },
        { id: 'g2', name: '10-B', grade: 10, subgroups: [] },
      ],
    });

    const result = await generateTestSchedule(project);

    // r1 is only used by c1: it has enough free slots for the full 8 lessons,
    // so every lesson must land in exactly r1 (nothing silently moved to r2).
    const c1Lessons = result.schedule.filter((l: any) => l.ruleId === 'c1');
    const c2Lessons = result.schedule.filter((l: any) => l.ruleId === 'c2');
    expect(c1Lessons).toHaveLength(8);
    expect(c1Lessons.every((l: any) => l.roomId === 'r1')).toBe(true);
    expect(c2Lessons).toHaveLength(8);
    expect(c2Lessons.every((l: any) => l.roomId === 'r3')).toBe(true);
    expect(result.conflicts).toHaveLength(0);
  });

  it('reports unassigned lessons instead of substituting a busy forced room', async () => {
    // g1 only schedules periods 1-2 (10 slots/week). Three 5h rules all force
    // the single room r1: 15 lessons compete for r1's 10 weekly slots. r2/r3
    // exist as plausible substitutes, but the worker must never use them.
    const project = makeProject({
      rooms: [
        { id: 'r1', name: 'Only Lab', maxGroups: 1, types: ['computer-lab'] },
        { id: 'r2', name: 'Classroom A', maxGroups: 1, types: ['classroom'] },
        { id: 'r3', name: 'Classroom B', maxGroups: 1, types: ['classroom'] },
      ],
      groups: [
        { id: 'g1', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 2, maxDailyLessons: 2 },
      ],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 5, teacherId: 't2', roomId: 'r1' },
        { id: 'c3', groupId: 'g1', subjectId: 'subj-physics', hoursPerWeek: 5, teacherId: 't3', roomId: 'r1' },
      ],
    });

    const result = await generateTestSchedule(project);

    // Every placed lesson keeps the forced room - never a substitute.
    expect(result.schedule.length).toBeGreaterThan(0);
    for (const lesson of result.schedule) {
      expect(lesson.roomId).toBe('r1');
    }
    // Room r1 cannot cover 15 weekly slots while staying free of double booking,
    // so the overflow is left as UNASSIGNED_HOURS instead of spilling to r2/r3.
    const missing = (result.conflicts || [])
      .filter((c: any) => c.type === 'UNASSIGNED_HOURS')
      .reduce((s: number, c: any) => s + (c.missing ?? 1), 0);
    expect(missing).toBe(5);
    expect(result.schedule).toHaveLength(10);
  });

  it('respects per-group periodStart/periodEnd (shift scheduling)', async () => {
    const project = makeProject({
      groups: [
        { id: 'g1', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
        { id: 'g2', name: '6-A', grade: 6, subgroups: [], periodStart: 6, periodEnd: 12, maxDailyLessons: 7 },
      ],
      teachers: [
        { id: 't1', name: 'Teacher A', subjects: ['subj-math'] },
        { id: 't2', name: 'Teacher B', subjects: ['subj-math'] },
      ],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 8, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g2', subjectId: 'subj-math', hoursPerWeek: 7, teacherId: 't2', roomId: 'r2' },
      ],
    });

    const result = await generateTestSchedule(project);

    for (const lesson of result.schedule) {
      if (lesson.groupId === 'g1') {
        expect(lesson.period).toBeGreaterThanOrEqual(1);
        expect(lesson.period).toBeLessThanOrEqual(8);
      }
      if (lesson.groupId === 'g2') {
        expect(lesson.period).toBeGreaterThanOrEqual(6);
        expect(lesson.period).toBeLessThanOrEqual(12);
      }
    }
    expect(result.conflicts).toHaveLength(0);
  });

  it('enforces maxDailyLessons cap', async () => {
    const project = makeProject({
      groups: [
        { id: 'g1', name: '1-A', grade: 1, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 3 },
      ],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 15, teacherId: 't1', roomId: 'r1' },
      ],
    });

    const result = await generateTestSchedule(project);
    const dayCounts = new Map<string, number>();
    for (const lesson of result.schedule) {
      dayCounts.set(lesson.day, (dayCounts.get(lesson.day) || 0) + 1);
    }
    for (const [, count] of dayCounts) {
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  it('packs lessons contiguously from the first period (no empty first lesson)', async () => {
    const project = makeProject({
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 20, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g1', subjectId: 'subj-info', hoursPerWeek: 5, teacherId: 't2', roomId: 'r2' },
      ],
    });

    const result = await generateTestSchedule(project);

    for (const day of ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']) {
      const dayLessons = result.schedule
        .filter((l: any) => l.groupId === 'g1' && l.day === day)
        .sort((a: any, b: any) => a.period - b.period);

      if (dayLessons.length > 0) {
        expect(dayLessons[0].period).toBe(1);
      }
      for (let i = 1; i < dayLessons.length; i++) {
        expect(dayLessons[i].period - dayLessons[i - 1].period).toBe(1);
      }
    }
  });

  it('creates an empty first period only when forced by a constraint', async () => {
    const project = makeProject({
      teachers: [{ id: 't1', name: 'Teacher A', subjects: ['subj-math'] }],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1', roomId: 'r1' },
      ],
      constraints: [
        { id: 'con1', kind: 'TEACHER_BUSY', teacherId: 't1', day: '*', periods: [1] },
      ],
    });

    const result = await generateTestSchedule(project);

    expect(result.schedule).toHaveLength(5);
    expect(result.conflicts).toHaveLength(0);
    for (const lesson of result.schedule) {
      expect(lesson.period).not.toBe(1);
    }

    const dayCounts = new Map<string, number>();
    for (const lesson of result.schedule) {
      dayCounts.set(lesson.day, (dayCounts.get(lesson.day) || 0) + 1);
    }
    expect(dayCounts.size).toBeGreaterThanOrEqual(2);
    expect(dayCounts.size).toBeLessThan(5);
    expect(Math.max(...dayCounts.values())).toBeGreaterThanOrEqual(2);
  });

  it('does not schedule a teacher at two slots simultaneously', async () => {
    const project = makeProject({
      groups: [
        { id: 'g1', name: '10-A', grade: 10, subgroups: [] },
        { id: 'g2', name: '10-B', grade: 10, subgroups: [] },
      ],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g2', subjectId: 'subj-math', hoursPerWeek: 5, teacherId: 't1', roomId: 'r2' },
      ],
    });

    const result = await generateTestSchedule(project);

    const teacherSlots = new Set<string>();
    for (const lesson of result.schedule) {
      const key = `${lesson.teacherId}-${lesson.day}-${lesson.period}`;
      expect(teacherSlots.has(key)).toBe(false);
      teacherSlots.add(key);
    }
  });

  it('prefers placing lessons of same-grade classes in adjacent periods', async () => {
    const project = makeProject({
      teachers: [
        { id: 't1', name: 'Teacher A', subjects: ['subj-math'] },
        { id: 't2', name: 'Teacher B', subjects: ['subj-math'] },
      ],
      groups: [
        { id: 'g1', name: '6-A', grade: 6, subgroups: [] },
        { id: 'g2', name: '6-B', grade: 6, subgroups: [] },
      ],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 1, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g2', subjectId: 'subj-math', hoursPerWeek: 1, teacherId: 't2', roomId: 'r2' },
      ],
    });

    const result = await generateTestSchedule(project);

    expect(result.schedule).toHaveLength(2);
    expect(result.conflicts).toHaveLength(0);
    expect(result.schedule[0].day).toBe(result.schedule[1].day);
    expect(Math.abs(result.schedule[0].period - result.schedule[1].period)).toBe(1);
  });

  it('clusters a teachers lessons into 2-3 per day instead of isolated singles', async () => {
    const project = makeProject({
      teachers: [{ id: 't1', name: 'Teacher A', subjects: ['subj-math'] }],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 6, teacherId: 't1', roomId: 'r1' },
      ],
    });

    const result = await generateTestSchedule(project);

    expect(result.schedule).toHaveLength(6);
    expect(result.conflicts).toHaveLength(0);

    const dayCounts = new Map<string, number>();
    for (const lesson of result.schedule) {
      expect(lesson.teacherId).toBe('t1');
      dayCounts.set(lesson.day, (dayCounts.get(lesson.day) || 0) + 1);
    }

    for (const count of dayCounts.values()) {
      expect(count).toBeGreaterThanOrEqual(2);
      expect(count).toBeLessThanOrEqual(3);
    }
  });

  it('keeps each teachers daily lesson gaps at most 2 empty periods', async () => {
    const project = makeProject({
      teachers: [{ id: 't1', name: 'Teacher A', subjects: ['subj-math'] }],
      groups: [
        { id: 'g1', name: '10-A', grade: 10, subgroups: [] },
        { id: 'g2', name: '10-B', grade: 10, subgroups: [] },
      ],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj-math', hoursPerWeek: 3, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g2', subjectId: 'subj-math', hoursPerWeek: 3, teacherId: 't1', roomId: 'r2' },
      ],
    });

    const result = await generateTestSchedule(project);

    expect(result.schedule).toHaveLength(6);
    expect(result.conflicts).toHaveLength(0);

    const dayPeriods = new Map<string, number[]>();
    for (const lesson of result.schedule) {
      expect(lesson.teacherId).toBe('t1');
      if (!dayPeriods.has(lesson.day)) dayPeriods.set(lesson.day, []);
      dayPeriods.get(lesson.day)!.push(lesson.period);
    }

    for (const periods of dayPeriods.values()) {
      const sorted = periods.sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i] - sorted[i - 1] - 1).toBeLessThanOrEqual(2);
      }
    }
  });
});
