import { ProjectState, CurriculumRule } from '../shared/types';

self.onmessage = (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT':
      self.postMessage({ type: 'READY' });
      break;

    case 'GENERATE_SCHEDULE':
      generateSchedule(payload as ProjectState);
      break;

    default:
      console.warn('Worker: Unknown message type', type);
  }
};

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

interface GroupScheduleConfig {
  periodStart: number;
  periodEnd: number;
  maxDaily: number;
}

async function generateSchedule(project: ProjectState) {
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

  self.postMessage({ type: 'PROGRESS', payload: { progress: 2 } });

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

  units.sort((a, b) => {
    const ta = batchCounts.get(a.groupId) || 0;
    const tb = batchCounts.get(b.groupId) || 0;
    if (ta !== tb) return tb - ta;
    const aa = a.lessons[0]?.teacherId || '';
    const ab = b.lessons[0]?.teacherId || '';
    return aa.localeCompare(ab);
  });

  const schedule: any[] = [];
  const conflicts: any[] = [];
  const totalUnits = units.length;
  let unitsAssigned = 0;

  self.postMessage({ type: 'PROGRESS', payload: { progress: 5 } });

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
    const groupPeriods = getPeriodsForGroup(unit.groupId);

    for (const ds of dayScores) {
      if (placed) break;
      if (ds.need <= 0) {
        for (const p of groupPeriods) {
          if (tryPlaceUnit(unit, ds.day, p)) { placed = true; break; }
        }
      } else {
        const tId = unit.lessons[0]?.teacherId;
        for (const p of groupPeriods) {
          if (tId) {
            const prev = teacherBusy.has(`${tId}-${ds.day}-${p - 1}`);
            const next = teacherBusy.has(`${tId}-${ds.day}-${p + 1}`);
            if (prev || next) {
              if (tryPlaceUnit(unit, ds.day, p)) { placed = true; break; }
            }
          }
        }
        if (!placed) {
          for (const p of groupPeriods) {
            if (tryPlaceUnit(unit, ds.day, p)) { placed = true; break; }
          }
        }
      }
    }

    if (!placed) {
      for (const day of days) {
        if (placed) break;
        for (const p of groupPeriods) {
          if (tryPlaceUnit(unit, day, p)) { placed = true; break; }
        }
      }
    }

    if (placed) {
      const di = days.indexOf(schedule[schedule.length - 1].day);
      if (di >= 0) counts[di]++;
      unitsAssigned++;
    } else {
      for (const lesson of unit.lessons) {
        conflicts.push({ type: 'UNASSIGNED_HOURS', ruleId: lesson.ruleId, missing: 1 });
      }
    }

    if (unitsAssigned % 5 === 0 || unitsAssigned === totalUnits || !placed) {
      const progress = 5 + Math.floor((unitsAssigned / totalUnits) * 90);
      self.postMessage({ type: 'PROGRESS', payload: { progress } });
    }
  }

  await sleep(200);

  const totalBatches = units.length;
  self.postMessage({
    type: 'RESULT',
    payload: {
      schedule,
      conflicts,
      score: totalBatches > 0 ? unitsAssigned / totalBatches : 0,
    },
  });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
