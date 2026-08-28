import { Lesson, ProjectState, CurriculumRule, computeGroupScheduleConfig } from '../../shared/types';

export const CONFLICT_REASON = {
  TEACHER_SLOT: 'conflict_teacher_slot',
  GROUP_SLOT: 'conflict_group_slot',
  ROOM_SLOT: 'conflict_room_slot',
  TEACHER_BUSY: 'conflict_teacher_busy_constraint',
  NO_FIRST: 'conflict_no_first_period',
  OUT_OF_RANGE: 'conflict_out_of_range',
  DAILY_OVERLOAD: 'conflict_daily_overload',
} as const;

export const EMPTY_SLOT_REASON = {
  CURRICULUM_DONE: 'empty_slot_curriculum_done',
  DAILY_CAP: 'empty_slot_daily_cap',
  TEACHER_BUSY: 'empty_slot_teacher_busy',
  ROOM_BUSY: 'empty_slot_room_busy',
  NO_FIRST: 'empty_slot_no_first',
  DAY_BALANCE: 'empty_slot_day_balance',
} as const;

const DEFAULT_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export interface ScheduleAnalysis {
  byLesson: Map<string, string[]>;
  causesByLesson: Map<string, Lesson[]>;
  unassignedByRule: Map<string, number>;
  assignedCount: number;
  neededCount: number;
  conflictCount: number;
}

export interface LessonCounts {
  assigned: number;
  unassigned: number;
  needed: number;
}

export function countLessons(grid: Lesson[], pool: Lesson[], project: ProjectState): LessonCounts {
  const assignedSlots = new Set<string>();
  for (const lesson of grid) {
    assignedSlots.add(`${lesson.groupId}|${lesson.subjectId}|${lesson.day}|${lesson.period}`);
  }

  const splitSize = new Map<string, number>();
  const seen = new Map<string, Set<string>>();
  for (const rule of project.curriculum || []) {
    const key = `${rule.groupId}|${rule.subjectId}`;
    if (!seen.has(key)) seen.set(key, new Set());
    seen.get(key)!.add(rule.id);
  }
  for (const ruleIds of seen.values()) {
    for (const ruleId of ruleIds) splitSize.set(ruleId, ruleIds.size);
  }

  const byRule = new Map<string, number>();
  for (const lesson of pool) {
    byRule.set(lesson.ruleId, (byRule.get(lesson.ruleId) || 0) + 1);
  }
  let unassigned = 0;
  for (const [ruleId, count] of byRule) {
    unassigned += count / (splitSize.get(ruleId) || 1);
  }
  unassigned = Math.round(unassigned);

  const assigned = assignedSlots.size;
  return { assigned, unassigned, needed: assigned + unassigned };
}

export function buildPendingByRule(placed: Lesson[], pool: Lesson[]): Map<string, number> {
  const poolCount = new Map<string, number>();
  for (const lesson of pool) {
    poolCount.set(lesson.ruleId, (poolCount.get(lesson.ruleId) || 0) + 1);
  }
  const placedCount = new Map<string, number>();
  for (const lesson of placed) {
    placedCount.set(lesson.ruleId, (placedCount.get(lesson.ruleId) || 0) + 1);
  }
  const pending = new Map<string, number>();
  for (const [ruleId, count] of poolCount) {
    const remaining = count - (placedCount.get(ruleId) || 0);
    if (remaining > 0) pending.set(ruleId, remaining);
  }
  return pending;
}

export function analyzeEmptySlots(
  placed: Lesson[],
  project: ProjectState,
  pendingByRule: Map<string, number>,
  days: string[] = DEFAULT_DAYS
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const add = (key: string, reason: string) => {
    if (!result.has(key)) result.set(key, []);
    if (!result.get(key)!.includes(reason)) result.get(key)!.push(reason);
  };

  const teacherSlot = new Set<string>();
  const roomSlot = new Set<string>();
  const groupDayCount = new Map<string, number>();
  for (const lesson of placed) {
    if (lesson.teacherId) teacherSlot.add(`${lesson.teacherId}|${lesson.day}|${lesson.period}`);
    if (lesson.roomId) roomSlot.add(`${lesson.roomId}|${lesson.day}|${lesson.period}`);
    const dayKey = `${lesson.groupId}|${lesson.day}`;
    groupDayCount.set(dayKey, (groupDayCount.get(dayKey) || 0) + 1);
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

  const ruleById = new Map((project.curriculum || []).map(r => [r.id, r]));

  for (const group of project.groups || []) {
    const { periodStart, periodEnd, maxDaily } = computeGroupScheduleConfig(group);
    const start = periodStart;
    const end = periodEnd;

    const groupRules: CurriculumRule[] = [];
    for (const ruleId of pendingByRule.keys()) {
      const rule = ruleById.get(ruleId);
      if (rule && rule.groupId === group.id) groupRules.push(rule);
    }

    for (const day of days) {
      const dayCount = groupDayCount.get(`${group.id}|${day}`) || 0;
      for (let period = start; period <= end; period++) {
        const occupied = placed.some(l => l.groupId === group.id && l.day === day && l.period === period);
        if (occupied) continue;

        const key = `${group.id}|${day}|${period}`;

        if (groupRules.length === 0) {
          add(key, EMPTY_SLOT_REASON.CURRICULUM_DONE);
          continue;
        }

        const atCap = dayCount >= maxDaily;
        const blockers = { teacher: false, room: false, noFirst: false };
        let openRule = false;

        for (const rule of groupRules) {
          const teacherBusy = !!(rule.teacherId && (
            teacherSlot.has(`${rule.teacherId}|${day}|${period}`)
            || teacherBusyRules.some(r =>
              r.teacherId === rule.teacherId && (r.day === '*' || r.day === day) && r.periods.has(period)
            )
          ));
          const roomBusy = !!(rule.roomId && roomSlot.has(`${rule.roomId}|${day}|${period}`));
          const noFirst = period === start && noFirstRules.some(r =>
            r.subjectId === rule.subjectId && (!r.groupId || r.groupId === group.id)
          );

          if (!teacherBusy && !roomBusy && !noFirst && !atCap) {
            openRule = true;
          } else {
            if (teacherBusy) blockers.teacher = true;
            if (roomBusy) blockers.room = true;
            if (noFirst) blockers.noFirst = true;
          }
        }

        if (atCap) add(key, EMPTY_SLOT_REASON.DAILY_CAP);
        if (!openRule) {
          if (blockers.teacher) add(key, EMPTY_SLOT_REASON.TEACHER_BUSY);
          if (blockers.room) add(key, EMPTY_SLOT_REASON.ROOM_BUSY);
          if (blockers.noFirst) add(key, EMPTY_SLOT_REASON.NO_FIRST);
        }
        if (openRule || result.get(key) === undefined) {
          add(key, EMPTY_SLOT_REASON.DAY_BALANCE);
        }
      }
    }
  }

  return result;
}

export function analyzeSchedule(placed: Lesson[], pool: Lesson[], project: ProjectState): ScheduleAnalysis {
  const reasons = new Map<string, string[]>();
  const add = (id: string, reason: string) => {
    if (!reasons.has(id)) reasons.set(id, []);
    if (!reasons.get(id)!.includes(reason)) reasons.get(id)!.push(reason);
  };

  const causesByLesson = new Map<string, Lesson[]>();
  const lessonById = new Map(placed.map(l => [l.id, l]));
  const addCause = (id: string, otherId: string) => {
    if (id === otherId) return;
    const cause = lessonById.get(otherId);
    if (!cause) return;
    if (!causesByLesson.has(id)) causesByLesson.set(id, []);
    if (!causesByLesson.get(id)!.some(c => c.id === cause.id)) causesByLesson.get(id)!.push(cause);
  };

  const teacherSlot = new Map<string, Map<string, string[]>>();
  const groupSlot = new Map<string, Map<string, string[]>>();
  const roomSlot = new Map<string, Map<string, string[]>>();

  for (const lesson of placed) {
    const slotKey = `${lesson.day}-${lesson.period}`;

    if (lesson.teacherId) {
      if (!teacherSlot.has(lesson.teacherId)) teacherSlot.set(lesson.teacherId, new Map());
      const m = teacherSlot.get(lesson.teacherId)!;
      if (!m.has(slotKey)) m.set(slotKey, []);
      m.get(slotKey)!.push(lesson.id);
    }

    if (!groupSlot.has(lesson.groupId)) groupSlot.set(lesson.groupId, new Map());
    const gm = groupSlot.get(lesson.groupId)!;
    if (!gm.has(slotKey)) gm.set(slotKey, []);
    gm.get(slotKey)!.push(lesson.id);

    if (lesson.roomId) {
      if (!roomSlot.has(lesson.roomId)) roomSlot.set(lesson.roomId, new Map());
      const rm = roomSlot.get(lesson.roomId)!;
      if (!rm.has(slotKey)) rm.set(slotKey, []);
      rm.get(slotKey)!.push(lesson.id);
    }
  }

  for (const m of teacherSlot.values()) {
    for (const ids of m.values()) {
      if (ids.length <= 1) continue;
      for (const id of ids) {
        add(id, CONFLICT_REASON.TEACHER_SLOT);
        for (const other of ids) addCause(id, other);
      }
    }
  }

  for (const m of roomSlot.values()) {
    for (const ids of m.values()) {
      if (ids.length <= 1) continue;
      const slotLessons = ids.map(id => lessonById.get(id)).filter((x): x is Lesson => !!x);
      const sameSplit = slotLessons.length > 1
        && new Set(slotLessons.map(l => l.groupId)).size === 1
        && new Set(slotLessons.map(l => l.subjectId)).size === 1;
      if (sameSplit) continue;
      for (const id of ids) {
        add(id, CONFLICT_REASON.ROOM_SLOT);
        for (const other of ids) addCause(id, other);
      }
    }
  }

  for (const m of groupSlot.values()) {
    for (const ids of m.values()) {
      if (ids.length <= 1) continue;
      const subjects = new Set(ids.map(id => lessonById.get(id)?.subjectId));
      if (subjects.size <= 1) continue;
      for (const id of ids) {
        add(id, CONFLICT_REASON.GROUP_SLOT);
        for (const other of ids) addCause(id, other);
      }
    }
  }

  const groupMap = new Map(project.groups.map(g => [g.id, g]));
  const teacherBusyRules: { teacherId: string; day: string; periods: Set<number> }[] = [];
  const noFirstRules: { subjectId: string; groupId?: string }[] = [];
  for (const c of project.constraints || []) {
    if (c.kind === 'TEACHER_BUSY' && c.teacherId && c.periods && c.periods.length > 0) {
      teacherBusyRules.push({ teacherId: c.teacherId, day: c.day || '*', periods: new Set(c.periods) });
    } else if (c.kind === 'NO_FIRST_PERIOD' && c.subjectId) {
      noFirstRules.push({ subjectId: c.subjectId, groupId: c.groupId });
    }
  }

  const dailySlots = new Map<string, Set<string>>();
  for (const lesson of placed) {
    const group = groupMap.get(lesson.groupId);
    if (!group) continue;

    const { periodStart, periodEnd } = computeGroupScheduleConfig(group);
    const start = periodStart;
    const end = periodEnd;
    if (lesson.period < start) add(lesson.id, CONFLICT_REASON.OUT_OF_RANGE);
    if (lesson.period > end) add(lesson.id, CONFLICT_REASON.OUT_OF_RANGE);

    if (lesson.period === start && noFirstRules.some(r =>
      r.subjectId === lesson.subjectId && (!r.groupId || r.groupId === lesson.groupId)
    )) {
      add(lesson.id, CONFLICT_REASON.NO_FIRST);
    }

    if (lesson.teacherId && teacherBusyRules.some(r =>
      r.teacherId === lesson.teacherId && (r.day === '*' || r.day === lesson.day) && r.periods.has(lesson.period)
    )) {
      add(lesson.id, CONFLICT_REASON.TEACHER_BUSY);
    }

    if (!dailySlots.has(lesson.groupId)) dailySlots.set(lesson.groupId, new Set());
    dailySlots.get(lesson.groupId)!.add(`${lesson.day}|${lesson.period}`);
  }

  for (const [groupId, slots] of dailySlots) {
    const maxDaily = computeGroupScheduleConfig(groupMap.get(groupId)).maxDaily;
    const perDay = new Map<string, number>();
    for (const key of slots) {
      const day = key.slice(0, key.indexOf('|'));
      perDay.set(day, (perDay.get(day) || 0) + 1);
    }
    for (const [day, count] of perDay) {
      if (count <= maxDaily) continue;
      for (const lesson of placed) {
        if (lesson.groupId === groupId && lesson.day === day) add(lesson.id, CONFLICT_REASON.DAILY_OVERLOAD);
      }
    }
  }

  const unassignedByRule = new Map<string, number>();
  for (const lesson of pool) {
    unassignedByRule.set(lesson.ruleId, (unassignedByRule.get(lesson.ruleId) || 0) + 1);
  }

  const counts = countLessons(placed, pool, project);

  return {
    byLesson: reasons,
    causesByLesson,
    unassignedByRule,
    assignedCount: counts.assigned,
    neededCount: counts.needed,
    conflictCount: reasons.size,
  };
}

export function buildConflicts(placed: Lesson[], pool: Lesson[], project: ProjectState): any[] {
  const analysis = analyzeSchedule(placed, pool, project);
  const conflicts: any[] = [];
  for (const [ruleId, missing] of analysis.unassignedByRule) {
    conflicts.push({ type: 'UNASSIGNED_HOURS', ruleId, missing });
  }
  for (const [lessonId, reasons] of analysis.byLesson) {
    conflicts.push({ type: 'MANUAL_CONFLICT', lessonId, reasons });
  }
  return conflicts;
}

export function computeScore(placed: Lesson[], pool: Lesson[], project: ProjectState): number {
  const analysis = analyzeSchedule(placed, pool, project);
  if (analysis.neededCount === 0) return 1;
  const assignedRatio = analysis.assignedCount / analysis.neededCount;
  const conflictPenalty = analysis.conflictCount === 0 ? 1 : 0.8;
  return Math.max(0, assignedRatio) * conflictPenalty;
}
