import { ProjectState, CurriculumRule, WorkerMessage, SemesterSplit, SemesterSchedules, ScheduleResult, computeGroupScheduleConfig, GroupScheduleConfig, GenerateSettings } from '../shared/types';

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.trunc(value)));
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

// Small deterministic PRNG so each generation attempt explores a different
// placement order while remaining reproducible for a given seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

function countUnassigned(result: ScheduleResult): number {
  return (result.conflicts || [])
    .filter((c) => c?.type === 'UNASSIGNED_HOURS')
    .reduce((sum, c) => sum + (c.missing ?? 1), 0);
}

// Intended per-semester lesson load per teacher and per group. When an explicit
// loadDistribution input exists it is used (hours are treated as the annual weekly
// target, so each semester gets half); otherwise the curriculum splits are summed.
function intendedLoads(
  project: ProjectState,
  splits: SemesterSplit[]
): { teacher: Map<string, { s1: number; s2: number }>; group: Map<string, { s1: number; s2: number }> } {
  const teacher = new Map<string, { s1: number; s2: number }>();
  const group = new Map<string, { s1: number; s2: number }>();
  const add = (m: Map<string, { s1: number; s2: number }>, id: string, first: number, second: number) => {
    const cur = m.get(id) || { s1: 0, s2: 0 };
    cur.s1 += first;
    cur.s2 += second;
    m.set(id, cur);
  };

  const ld = project.loadDistribution || [];
  if (ld.length > 0) {
    for (const l of ld) {
      const half = l.hours / 2;
      if (l.teacherId) add(teacher, l.teacherId, half, half);
      if (l.groupId) add(group, l.groupId, half, half);
    }
  } else {
    const splitMap = new Map(splits.map((s) => [s.ruleId, s]));
    for (const rule of project.curriculum) {
      const split = splitMap.get(rule.id);
      if (!split) continue;
      if (rule.teacherId) add(teacher, rule.teacherId, split.first, split.second);
      add(group, rule.groupId, split.first, split.second);
    }
  }
  return { teacher, group };
}

// Higher is better. Placement completeness dominates; distribution quality and
// closeness to the intended load distribution only break ties between otherwise
// equally-complete schedules. Unplaced hours of rules with a fixed per-semester
// split (FORBID_LESSON) are penalized heavily so the chosen attempt prioritizes
// fulfilling the pinned load over raw completeness.
function scoreAttempt(schedules: SemesterSchedules, splits: SemesterSplit[], project: ProjectState, pinnedRuleIds?: Set<string>): number {
  const unassigned = countUnassigned(schedules.semester1) + countUnassigned(schedules.semester2);
  const placed = (schedules.semester1.score + schedules.semester2.score) / 2;
  const pinnedUnassigned = (schedules.semester1.conflicts || [])
    .filter((c) => c.type === 'UNASSIGNED_HOURS' && c.ruleId && pinnedRuleIds?.has(c.ruleId))
    .reduce((sum, c) => sum + (c.missing ?? 1), 0)
    + (schedules.semester2.conflicts || [])
      .filter((c) => c.type === 'UNASSIGNED_HOURS' && c.ruleId && pinnedRuleIds?.has(c.ruleId))
      .reduce((sum, c) => sum + (c.missing ?? 1), 0);

  const byTeacherDay = new Map<string, Map<string, number[]>>();
  for (const sem of [schedules.semester1.schedule, schedules.semester2.schedule]) {
    for (const lesson of sem as any[]) {
      if (!lesson.teacherId) continue;
      if (!byTeacherDay.has(lesson.teacherId)) byTeacherDay.set(lesson.teacherId, new Map());
      const dmap = byTeacherDay.get(lesson.teacherId)!;
      if (!dmap.has(lesson.day)) dmap.set(lesson.day, []);
      dmap.get(lesson.day)!.push(lesson.period);
    }
  }
  let distribution = 0;
  for (const dmap of byTeacherDay.values()) {
    for (const periods of dmap.values()) {
      periods.sort((a, b) => a - b);
      if (periods.length === 1) distribution -= 2;
      for (let i = 1; i < periods.length; i++) {
        const gap = periods[i] - periods[i - 1] - 1;
        if (gap > 0) distribution -= gap;
      }
    }
  }

  // Penalize deviation between the intended load distribution and the lessons that
  // were actually placed, so the best schedule is the one whose per-semester loads
  // are closest to the configured distribution.
  const intended = intendedLoads(project, splits);
  const actualTeacher = new Map<string, { s1: number; s2: number }>();
  const actualGroup = new Map<string, { s1: number; s2: number }>();
  const tally = (sem: any[], isSem1: boolean) => {
    for (const lesson of sem) {
      if (lesson.teacherId) {
        const t = actualTeacher.get(lesson.teacherId) || { s1: 0, s2: 0 };
        if (isSem1) t.s1++; else t.s2++;
        actualTeacher.set(lesson.teacherId, t);
      }
      const g = actualGroup.get(lesson.groupId) || { s1: 0, s2: 0 };
      if (isSem1) g.s1++; else g.s2++;
      actualGroup.set(lesson.groupId, g);
    }
  };
  tally(schedules.semester1.schedule as any[], true);
  tally(schedules.semester2.schedule as any[], false);
  let deviation = 0;
  for (const [id, t] of intended.teacher) {
    const a = actualTeacher.get(id) || { s1: 0, s2: 0 };
    deviation += Math.abs(t.s1 - a.s1) + Math.abs(t.s2 - a.s2);
  }
  for (const [id, g] of intended.group) {
    const a = actualGroup.get(id) || { s1: 0, s2: 0 };
    deviation += Math.abs(g.s1 - a.s1) + Math.abs(g.s2 - a.s2);
  }

  return placed * 1000 - unassigned - pinnedUnassigned * 500 + distribution * 0.01 - deviation * 0.01;
}

export async function generateSchedule(project: ProjectState, emit: (msg: WorkerMessage) => void) {
  const result = await runGenerate(project, emit);
  emit({ type: 'RESULT', payload: result });
}

async function runGenerate(project: ProjectState, emit: (msg: WorkerMessage) => void, rng?: () => number, pinnedRuleIds?: Set<string>): Promise<{ schedule: any[]; conflicts: any[]; score: number }> {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const allRooms = project.rooms || [];

  const groupConfig = new Map<string, GroupScheduleConfig>();
  for (const group of project.groups || []) {
    groupConfig.set(group.id, computeGroupScheduleConfig(group));
  }

  const groupGrade = new Map<string, number>();
  for (const group of project.groups || []) {
    groupGrade.set(group.id, group.grade ?? 0);
  }

  emit({ type: 'PROGRESS', payload: { progress: 2 } });

  const teacherBusyRules: { teacherId: string; day: string; periods: Set<number> }[] = [];
  const noFirstRules: { subjectId: string; groupId?: string }[] = [];
  const maxDailyByRule = new Map<string, number>();
  for (const c of project.constraints || []) {
    if (c.kind === 'TEACHER_BUSY' && c.teacherId && c.periods && c.periods.length > 0) {
      teacherBusyRules.push({ teacherId: c.teacherId, day: c.day || '*', periods: new Set(c.periods) });
    } else if (c.kind === 'NO_FIRST_PERIOD' && c.subjectId) {
      noFirstRules.push({ subjectId: c.subjectId, groupId: c.groupId });
    } else if (c.kind === 'MAX_DAILY_LESSONS' && c.ruleId && c.maxPerDay && c.maxPerDay > 0) {
      maxDailyByRule.set(c.ruleId, c.maxPerDay);
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

  let units: SchedulingUnit[] = [];

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

  const ruleDailyCounts = new Map<string, number[]>();
  for (const ruleId of maxDailyByRule.keys()) {
    ruleDailyCounts.set(ruleId, days.map(() => 0));
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
    return a.lessons[0]?.id.localeCompare(b.lessons[0]?.id || '') || 0;
  });

  if (rng && pinnedRuleIds && pinnedRuleIds.size > 0) {
    const pinned: SchedulingUnit[] = [];
    const rest: SchedulingUnit[] = [];
    for (const u of units) {
      (pinnedRuleIds.has(u.lessons[0].ruleId) ? pinned : rest).push(u);
    }
    shuffleInPlace(pinned, rng);
    shuffleInPlace(rest, rng);
    units = pinned.concat(rest);
  } else if (rng) {
    shuffleInPlace(units, rng);
  }

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
    const cap = maxDailyByRule.get(lesson.ruleId);
    if (cap !== undefined) {
      const di = days.indexOf(day);
      const counts = ruleDailyCounts.get(lesson.ruleId)!;
      if (counts[di] >= cap) return false;
    }
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
    if (di >= 0) {
      if (firstInSlot) {
        const counts = dailyCounts.get(lesson.groupId);
        if (counts) counts[di]++;
      }
      if (lesson.teacherId) {
        const tcounts = teacherDailyCounts.get(lesson.teacherId);
        if (tcounts) tcounts[di]++;
      }
      const rcounts = ruleDailyCounts.get(lesson.ruleId);
      if (rcounts) rcounts[di]++;
    }
  }

  function tryPlaceDouble(unit: SchedulingUnit, day: string, period: number): boolean {
    const lesson = unit.lessons[0];
    const cfg = groupConfig.get(unit.groupId);
    const pEnd = cfg?.periodEnd ?? 8;
    if (period + 1 > pEnd) return false;
    const cap = maxDailyByRule.get(lesson.ruleId);
    if (cap !== undefined) {
      const di = days.indexOf(day);
      const counts = ruleDailyCounts.get(lesson.ruleId)!;
      if (counts[di] + 2 > cap) return false;
    }
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
       return (a - b) + (rng ? rng() - 0.5 : 0);
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
        need: counts[di] >= maxDaily || !fits ? -999 : (targets[di] - counts[di]) + teacherDayBonus(unit, di),
      };
    });
    dayScores.sort((a, b) => (b.need - a.need) || ((rng ? rng() : 0) - 0.5));

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

  // FORBID_LESSON constraints fix the per-semester hour distribution for a rule
  // (hours === 0 forbids it in that semester). This overrides the automatic split.
  const forbid = new Map<string, { semester: 1 | 2; hours: number }>();
  for (const c of project.constraints || []) {
    if (c.kind === 'FORBID_LESSON' && c.ruleId) {
      forbid.set(c.ruleId, { semester: c.semester === 2 ? 2 : 1, hours: c.hours ?? 0 });
    }
  }
  if (forbid.size > 0) {
    for (const s of splits) {
      const f = forbid.get(s.ruleId);
      if (!f) continue;
      const annual = s.first + s.second;
      const h = Math.max(0, Math.min(Math.round(f.hours), annual));
      if (f.semester === 1) {
        s.first = h;
        s.second = annual - h;
      } else {
        s.second = h;
        s.first = annual - h;
      }
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

function collectUnassigned(result: ScheduleResult): Map<string, number> {
  const map = new Map<string, number>();
  for (const conflict of result.conflicts || []) {
    if (conflict?.type === 'UNASSIGNED_HOURS' && conflict.ruleId) {
      map.set(conflict.ruleId, (map.get(conflict.ruleId) || 0) + (conflict.missing ?? 1));
    }
  }
  return map;
}

export async function generateSemesterSchedules(project: ProjectState, emit: (msg: WorkerMessage) => void, settings?: Partial<GenerateSettings>) {
  // Generate many candidate schedules and keep the one that places the most
  // lessons while producing the tidyest teacher distribution.
  const attempts = clampInt(settings?.attempts ?? 20, 1, 200);
  const maxSpillPasses = clampInt(settings?.maxSpillPasses ?? 4, 0, 20);

  // Rules with a FORBID_LESSON constraint have a fixed per-semester split that
  // the spillover must not move lessons across (respecting the forbid).
  const fixedRules = new Set(
    (project.constraints || [])
      .filter((c) => c.kind === 'FORBID_LESSON' && c.ruleId)
      .map((c) => c.ruleId!)
  );

  // Rules with integer hours have a canonical balanced split (e.g. 4/4, 1/1).
  // The spillover may only shift lessons for fractional rules, so an integer rule
  // keeps its split even if a lesson has to stay unassigned - never drifting to a
  // skewed 3/5 or 0/2 just to place a whole lesson somewhere.
  const splitLock = new Set(
    project.curriculum
      .filter((r) => Number.isInteger(r.hoursPerWeek) && !fixedRules.has(r.id))
      .map((r) => r.id)
  );

  async function generateAttempt(seed: number, progressBase: number, progressSpan: number) {
    const rng = mulberry32(seed);
    const runScaled = async (semesterProject: ProjectState) => {
      return runGenerate(semesterProject, (msg) => {
        if (msg.type === 'PROGRESS') {
          const p = typeof msg.payload?.progress === 'number' ? msg.payload.progress : 0;
          emit({ type: 'PROGRESS', payload: { progress: Math.round(progressBase + (p / 100) * progressSpan) } });
        }
      }, rng, fixedRules);
    };

    let splits = computeSemesterSplits(project);
    let cursor = progressBase;
    const take = (portion: number) => {
      cursor += portion * progressSpan;
    };

    take(0.45);
    let semester1 = await runScaled(buildSemesterProject(project, 1, splits));
    take(0.45);
    let semester2 = await runScaled(buildSemesterProject(project, 2, splits));

    // Lessons that cannot be placed in one semester are moved to the other by
    // adjusting the per-rule split (the annual hour total is preserved). Only
    // fractional rules move; integer and pinned-forbid rules keep their split.
    // We iterate so a lesson can cascade to whichever semester actually has room.
    for (let iter = 0; iter < maxSpillPasses; iter++) {
      const out1 = collectUnassigned(semester1);
      const out2 = collectUnassigned(semester2);
      if (out1.size === 0 && out2.size === 0) break;

      const nextSplits = splits.map((s) => {
        if (fixedRules.has(s.ruleId) || splitLock.has(s.ruleId)) return s; // keep canonical split
        const movedFrom1 = out1.get(s.ruleId) || 0;
        const movedFrom2 = out2.get(s.ruleId) || 0;
        return {
          ...s,
          first: Math.max(0, s.first - movedFrom1 + movedFrom2),
          second: Math.max(0, s.second - movedFrom2 + movedFrom1),
        };
      });

      const changed = nextSplits.some(
        (s, i) => s.first !== splits[i].first || s.second !== splits[i].second
      );
      if (!changed) break;
      splits = nextSplits;

      take(0.05);
      semester1 = await runScaled(buildSemesterProject(project, 1, splits));
      take(0.05);
      semester2 = await runScaled(buildSemesterProject(project, 2, splits));
    }

    return { schedules: { semester1, semester2 } as SemesterSchedules, splits };
  }

  let best: { schedules: SemesterSchedules; splits: SemesterSplit[]; quality: number } | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const progressBase = Math.floor((attempt / attempts) * 95);
    const progressSpan = 95 / attempts;
    const candidate = await generateAttempt((attempt + 1) * 0x9e3779b1, progressBase, progressSpan);
    const quality = scoreAttempt(candidate.schedules, candidate.splits, project, fixedRules);
    if (!best || quality > best.quality) {
      best = { ...candidate, quality };
    }
    emit({ type: 'PROGRESS', payload: { progress: Math.floor(((attempt + 1) / attempts) * 95) } });
  }

  emit({ type: 'PROGRESS', payload: { progress: 100 } });

  emit({
    type: 'RESULT',
    payload: {
      schedules: best!.schedules,
      splits: best!.splits,
      attempts,
      bestQuality: best!.quality,
    },
  });
}
