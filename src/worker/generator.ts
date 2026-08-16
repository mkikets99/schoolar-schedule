import { ProjectState, CurriculumRule, WorkerMessage, SemesterSplit, SemesterSchedules } from '../shared/types';

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

interface GroupScheduleConfig {
  periodStart: number;
  periodEnd: number;
  maxDaily: number;
}

export async function generateSchedule(project: ProjectState, emit: (msg: WorkerMessage) => void) {
  const result = await runGenerate(project, emit);
  emit({ type: 'RESULT', payload: result });
}

async function runGenerate(project: ProjectState, emit: (msg: WorkerMessage) => void): Promise<{ schedule: any[]; conflicts: any[]; score: number }> {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const allRooms = project.rooms || [];

  const groupConfig = new Map<string, GroupScheduleConfig>();
  for (const group of project.groups || []) {
    const maxDaily = group.maxDailyLessons ?? 8;
    const availableSlots = (group.periodEnd ?? 8) - (group.periodStart ?? 1) + 1;
    groupConfig.set(group.id, {
      periodStart: group.periodStart ?? 1,
      periodEnd: group.periodEnd ?? 8,
      maxDaily: Math.min(maxDaily, availableSlots),
    });
  }

  const groupGrade = new Map<string, number>();
  for (const group of project.groups || []) {
    groupGrade.set(group.id, group.grade ?? 0);
  }

  emit({ type: 'PROGRESS', payload: { progress: 2 } });

  const teacherBusyRules: { teacherId: string; day: string; periods: Set<number> }[] = [];
  const noFirstRules: { subjectId: string; groupId?: string }[] = [];
  for (const c of project.constraints || []) {
    if (c.kind === 'TEACHER_BUSY' && c.teacherId && c.periods && c.periods.length > 0) {
      teacherBusyRules.push({ teacherId: c.teacherId, day: c.day || '*', periods: new Set(c.periods) });
    } else if (c.kind === 'NO_FIRST_PERIOD' && c.subjectId) {
      noFirstRules.push({ subjectId: c.subjectId, groupId: c.groupId });
    }
  }

  const teacherBusy = new Set<string>();
  const groupBusy = new Set<string>();
  const roomBusy = new Set<string>();

  const splitKeys = new Set<string>();
  const seen = new Map<string, CurriculumRule[]>();
  for (const rule of project.curriculum) {
    const key = `${rule.groupId}|${rule.subjectId}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(rule);
    if (seen.get(key)!.length > 1) splitKeys.add(key);
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
    return a.lessons[0]?.id.localeCompare(b.lessons[0]?.id || '') || 0;
  });

  const schedule: any[] = [];
  const conflicts: any[] = [];
  const totalUnits = units.length;
  let unitsAssigned = 0;

  emit({ type: 'PROGRESS', payload: { progress: 5 } });

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

  function canPlace(lesson: LessonStub, day: string, period: number, skipGroupCheck: boolean): boolean {
    const slotKey = `${day}-${period}`;
    if (!skipGroupCheck && groupBusy.has(`${lesson.groupId}-${slotKey}`)) return false;
    if (lesson.teacherId && teacherBusy.has(`${lesson.teacherId}-${slotKey}`)) return false;
    if (lesson.teacherId && isTeacherBusyRule(lesson.teacherId, day, period)) return false;
    const cfg = groupConfig.get(lesson.groupId);
    if (isForbiddenFirstPeriod(lesson, period, cfg?.periodStart ?? 1)) return false;
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

    const groupSlotKey = `${lesson.groupId}-${slotKey}`;
    const firstInSlot = !groupBusy.has(groupSlotKey);
    groupBusy.add(groupSlotKey);
    if (lesson.teacherId) teacherBusy.add(`${lesson.teacherId}-${slotKey}`);
    roomBusy.add(`${roomId || lesson.roomId}-${slotKey}`);

    const di = days.indexOf(day);
    if (di >= 0 && firstInSlot) {
      const counts = dailyCounts.get(lesson.groupId);
      if (counts) counts[di]++;
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

  function getOrderedPeriods(unit: SchedulingUnit, day: string): number[] {
    const base = getPeriodsForGroup(unit.groupId);
    return base.slice().sort((a, b) => {
      const sa = gradeAdjacencyScore(unit, day, a);
      const sb = gradeAdjacencyScore(unit, day, b);
      if (sa !== sb) return sb - sa;
      return a - b;
    });
  }

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
        need: counts[di] >= maxDaily || !fits ? -999 : targets[di] - counts[di],
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

    if (unitsAssigned % 5 === 0 || unitsAssigned === totalUnits || !placed) {
      const progress = 5 + Math.floor((unitsAssigned / totalUnits) * 90);
      emit({ type: 'PROGRESS', payload: { progress } });
    }
  }

  await sleep(200);

  const totalBatches = units.length;
  return {
    schedule,
    conflicts,
    score: totalBatches > 0 ? unitsAssigned / totalBatches : 0,
  };
}

export function computeSemesterSplits(project: ProjectState): SemesterSplit[] {
  const teacherLoad = new Map<string, { s1: number; s2: number }>();
  const getLoad = (teacherId: string) => {
    if (!teacherLoad.has(teacherId)) teacherLoad.set(teacherId, { s1: 0, s2: 0 });
    return teacherLoad.get(teacherId)!;
  };

  const splits: SemesterSplit[] = [];
  const fractionalByTeacher = new Map<string, CurriculumRule[]>();

  for (const rule of project.curriculum) {
    if (Number.isInteger(rule.hoursPerWeek)) {
      const h = rule.hoursPerWeek;
      splits.push({ ruleId: rule.id, hoursPerWeek: h, first: h, second: h });
      if (rule.teacherId) {
        const load = getLoad(rule.teacherId);
        load.s1 += h;
        load.s2 += h;
      }
    } else {
      const teacherId = rule.teacherId || '';
      if (!fractionalByTeacher.has(teacherId)) fractionalByTeacher.set(teacherId, []);
      fractionalByTeacher.get(teacherId)!.push(rule);
    }
  }

  for (const [teacherId, rules] of fractionalByTeacher) {
    rules.sort((a, b) => b.hoursPerWeek - a.hoursPerWeek);
    for (const rule of rules) {
      const ceil = Math.ceil(rule.hoursPerWeek);
      const floor = Math.floor(rule.hoursPerWeek);
      const load = getLoad(teacherId);
      const first = load.s1 <= load.s2 ? ceil : floor;
      const second = first === ceil ? floor : ceil;
      load.s1 += first;
      load.s2 += second;
      splits.push({ ruleId: rule.id, hoursPerWeek: rule.hoursPerWeek, first, second });
    }
  }

  return splits;
}

export function buildSemesterProject(
  project: ProjectState,
  semester: 1 | 2,
  splits: SemesterSplit[]
): ProjectState {
  const splitMap = new Map(splits.map((s) => [s.ruleId, s]));
  const curriculum = project.curriculum
    .map((rule) => {
      const split = splitMap.get(rule.id);
      const hours = split ? (semester === 1 ? split.first : split.second) : rule.hoursPerWeek;
      if (hours <= 0) return null;
      return { ...rule, hoursPerWeek: hours };
    })
    .filter((rule): rule is CurriculumRule => rule !== null);
  return { ...project, curriculum };
}

export async function generateSemesterSchedules(project: ProjectState, emit: (msg: WorkerMessage) => void) {
  const splits = computeSemesterSplits(project);

  const runScaled = async (semesterProject: ProjectState, from: number, to: number) => {
    return runGenerate(semesterProject, (msg) => {
      if (msg.type === 'PROGRESS') {
        const p = typeof msg.payload?.progress === 'number' ? msg.payload.progress : 0;
        emit({ type: 'PROGRESS', payload: { progress: from + Math.floor((p / 100) * (to - from)) } });
      }
    });
  };

  const semester1 = await runScaled(buildSemesterProject(project, 1, splits), 2, 48);
  emit({ type: 'PROGRESS', payload: { progress: 50 } });
  const semester2 = await runScaled(buildSemesterProject(project, 2, splits), 52, 95);
  emit({ type: 'PROGRESS', payload: { progress: 100 } });

  const schedules: SemesterSchedules = { semester1, semester2 };
  emit({ type: 'RESULT', payload: { schedules, splits } });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
