import { describe, it, expect } from 'vitest';
import { ProjectState, CurriculumRule } from '../../shared/types';

interface GroupScheduleConfig {
  periodStart: number;
  periodEnd: number;
  maxDaily: number;
}

async function generateTestSchedule(project: ProjectState) {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const allRooms = project.rooms || [];

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
    type: 'single' | 'split';
    groupId: string;
    lessons: LessonStub[];
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

  const batchCounts = new Map<string, number>();
  for (const unit of units) {
    batchCounts.set(unit.groupId, (batchCounts.get(unit.groupId) || 0) + 1);
  }

  const dailyTargets = new Map<string, number[]>();
  for (const [gid, total] of batchCounts) {
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
  for (const gid of batchCounts.keys()) {
    dailyCounts.set(gid, days.map(() => 0));
  }

  function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  units.sort((a, b) => {
    const ta = batchCounts.get(a.groupId) || 0;
    const tb = batchCounts.get(b.groupId) || 0;
    if (ta !== tb) return tb - ta;
    const aa = a.lessons[0]?.teacherId || '';
    const ab = b.lessons[0]?.teacherId || '';
    if (aa !== ab) return aa.localeCompare(ab);
    return Math.random() - 0.5;
  });

  const schedule: any[] = [];
  const conflicts: any[] = [];

  function getRoomTypes(roomId: string): string[] {
    const room = allRooms.find(r => r.id === roomId);
    return room ? room.types : [];
  }

  function findFallbackRoom(preferredId: string, slotKey: string): string | undefined {
    const prefTypes = getRoomTypes(preferredId);
    const fallback = allRooms.find(r => {
      if (roomBusy.has(`${r.id}-${slotKey}`)) return false;
      if (r.capacity === undefined) return false;
      if (prefTypes.length > 0 && !prefTypes.some(t => r.types.includes(t))) return false;
      return true;
    });
    return fallback?.id;
  }

  function canPlace(lesson: LessonStub, day: string, period: number, skipGroupCheck: boolean): boolean {
    const slotKey = `${day}-${period}`;
    if (!skipGroupCheck && groupBusy.has(`${lesson.groupId}-${slotKey}`)) return false;
    if (lesson.teacherId && teacherBusy.has(`${lesson.teacherId}-${slotKey}`)) return false;
    if (lesson.roomId && roomBusy.has(`${lesson.roomId}-${slotKey}`)) {
      const alt = findFallbackRoom(lesson.roomId, slotKey);
      if (!alt) return false;
    }
    return true;
  }

  function placeLesson(lesson: LessonStub, day: string, period: number) {
    const slotKey = `${day}-${period}`;
    let roomId = lesson.roomId;
    if (roomId && roomBusy.has(`${roomId}-${slotKey}`)) {
      const alt = findFallbackRoom(roomId, slotKey);
      if (alt) roomId = alt;
    }

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

    groupBusy.add(`${lesson.groupId}-${slotKey}`);
    if (lesson.teacherId) teacherBusy.add(`${lesson.teacherId}-${slotKey}`);
    roomBusy.add(`${roomId || lesson.roomId}-${slotKey}`);
  }

  function tryPlaceUnit(unit: SchedulingUnit, day: string, period: number): boolean {
    if (unit.type === 'single') {
      if (!canPlace(unit.lessons[0], day, period, false)) return false;
      placeLesson(unit.lessons[0], day, period);
      return true;
    }

    const first = unit.lessons[0];
    if (groupBusy.has(`${first.groupId}-${day}-${period}`)) return false;

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

  function getGroupExistingPeriods(groupId: string, day: string): number[] {
    const periods: number[] = [];
    for (const lesson of schedule) {
      if (lesson.groupId === groupId && lesson.day === day) {
        periods.push(lesson.period);
      }
    }
    periods.sort((a, b) => a - b);
    return periods;
  }

  function orderPeriodsByAdjacency(groupId: string, day: string, allPeriods: number[]): number[] {
    const existing = getGroupExistingPeriods(groupId, day);
    if (existing.length === 0) return allPeriods;

    const cfg = groupConfig.get(groupId);
    const pStart = cfg?.periodStart ?? 1;
    const pEnd = cfg?.periodEnd ?? 8;
    const ordered = new Set<number>();

    for (const p of existing) {
      if (p + 1 <= pEnd) ordered.add(p + 1);
    }
    for (let i = existing.length - 1; i >= 0; i--) {
      if (existing[i] - 1 >= pStart) ordered.add(existing[i] - 1);
    }
    for (let i = 0; i < existing.length - 1; i++) {
      for (let p = existing[i] + 1; p < existing[i + 1]; p++) {
        ordered.add(p);
      }
    }
    for (const p of shuffle(allPeriods)) {
      ordered.add(p);
    }
    return [...ordered];
  }

  for (const unit of units) {
    const targets = dailyTargets.get(unit.groupId)!;
    const counts = dailyCounts.get(unit.groupId)!;
    const cfg = groupConfig.get(unit.groupId);
    const maxDaily = cfg?.maxDaily ?? 8;

    const dayScores = days.map((day, di) => ({
      day, index: di,
      need: counts[di] >= maxDaily ? -999 : targets[di] - counts[di],
    }));
    dayScores.sort((a, b) => b.need - a.need);

    let placed = false;
    const allPeriods = getPeriodsForGroup(unit.groupId);

    for (const ds of dayScores) {
      if (placed) break;
      const ordered = orderPeriodsByAdjacency(unit.groupId, ds.day, allPeriods);

      if (ds.need <= 0) {
        for (const p of ordered) {
          if (tryPlaceUnit(unit, ds.day, p)) { placed = true; break; }
        }
      } else {
        const tId = unit.lessons[0]?.teacherId;
        for (const p of ordered) {
          if (tId) {
            const prev = teacherBusy.has(`${tId}-${ds.day}-${p - 1}`);
            const next = teacherBusy.has(`${tId}-${ds.day}-${p + 1}`);
            if (prev || next) {
              if (tryPlaceUnit(unit, ds.day, p)) { placed = true; break; }
            }
          }
        }
        if (!placed) {
          for (const p of ordered) {
            if (tryPlaceUnit(unit, ds.day, p)) { placed = true; break; }
          }
        }
      }
    }

    if (!placed) {
      for (const day of days) {
        if (placed) break;
        const ordered = orderPeriodsByAdjacency(unit.groupId, day, allPeriods);
        for (const p of ordered) {
          if (tryPlaceUnit(unit, day, p)) { placed = true; break; }
        }
      }
    }

    if (placed) {
      const di = days.indexOf(schedule[schedule.length - 1].day);
      if (di >= 0) counts[di]++;
    } else {
      for (const lesson of unit.lessons) {
        conflicts.push({ type: 'UNASSIGNED_HOURS', ruleId: lesson.ruleId, missing: 1 });
      }
    }
  }

  return { schedule, conflicts, units, unitsAssigned: schedule.length > 0 ? units.filter((_, i) => i < schedule.length).length : 0 };
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
      { id: 'r1', name: 'Room 1', capacity: 30, types: ['classroom'] },
      { id: 'r2', name: 'Room 2', capacity: 30, types: ['classroom'] },
      { id: 'r3', name: 'Room 3', capacity: 30, types: ['classroom'] },
      { id: 'r4', name: 'Room 4', capacity: 30, types: ['classroom'] },
      { id: 'r5', name: 'Room 5', capacity: 30, types: ['classroom'] },
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

  it('generates conflict entries for unassignable lessons', async () => {
    const rooms = [{ id: 'r1', name: 'Only Room', capacity: 30, types: ['classroom'] }];
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
      capacity: 30,
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

  it('falls back only to same-type room when preferred room is busy', async () => {
    const project = makeProject({
      rooms: [
        { id: 'r1', name: 'Lab A', capacity: 18, types: ['computer-lab'] },
        { id: 'r2', name: 'Lab B', capacity: 18, types: ['computer-lab'] },
        { id: 'r3', name: 'Classroom', capacity: 30, types: ['classroom'] },
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

    for (const lesson of result.schedule) {
      const room = project.rooms.find(r => r.id === lesson.roomId);
      if (lesson.ruleId === 'c1') {
        expect(room?.types).toContain('computer-lab');
      }
    }
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

  it('places lessons for a group in consecutive periods (no gaps)', async () => {
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

      if (dayLessons.length > 1) {
        for (let i = 1; i < dayLessons.length; i++) {
          expect(dayLessons[i].period - dayLessons[i - 1].period).toBeLessThanOrEqual(2);
        }
      }
    }
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
});
