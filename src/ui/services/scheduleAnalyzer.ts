import { Lesson, ProjectState } from '../../shared/types';

export const CONFLICT_REASON = {
  TEACHER_SLOT: 'conflict_teacher_slot',
  GROUP_SLOT: 'conflict_group_slot',
  ROOM_SLOT: 'conflict_room_slot',
  TEACHER_BUSY: 'conflict_teacher_busy_constraint',
  NO_FIRST: 'conflict_no_first_period',
  OUT_OF_RANGE: 'conflict_out_of_range',
  DAILY_OVERLOAD: 'conflict_daily_overload',
} as const;

export interface ScheduleAnalysis {
  byLesson: Map<string, string[]>;
  unassignedByRule: Map<string, number>;
  assignedCount: number;
  neededCount: number;
  conflictCount: number;
}

export function analyzeSchedule(placed: Lesson[], pool: Lesson[], project: ProjectState): ScheduleAnalysis {
  const reasons = new Map<string, string[]>();
  const add = (id: string, reason: string) => {
    if (!reasons.has(id)) reasons.set(id, []);
    if (!reasons.get(id)!.includes(reason)) reasons.get(id)!.push(reason);
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
      if (ids.length > 1) for (const id of ids) add(id, CONFLICT_REASON.TEACHER_SLOT);
    }
  }

  for (const m of roomSlot.values()) {
    for (const ids of m.values()) {
      if (ids.length <= 1) continue;
      const slotLessons = ids.map(id => placed.find(x => x.id === id)).filter((x): x is Lesson => !!x);
      const sameSplit = slotLessons.length > 1
        && new Set(slotLessons.map(l => l.groupId)).size === 1
        && new Set(slotLessons.map(l => l.subjectId)).size === 1;
      if (sameSplit) continue;
      for (const id of ids) add(id, CONFLICT_REASON.ROOM_SLOT);
    }
  }

  for (const m of groupSlot.values()) {
    for (const ids of m.values()) {
      if (ids.length <= 1) continue;
      const subjects = new Set(ids.map(id => placed.find(x => x.id === id)?.subjectId));
      if (subjects.size > 1) for (const id of ids) add(id, CONFLICT_REASON.GROUP_SLOT);
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

  const dailyCount = new Map<string, Map<string, number>>();
  for (const lesson of placed) {
    const group = groupMap.get(lesson.groupId);
    if (!group) continue;

    const start = group.periodStart ?? 1;
    const end = group.periodEnd ?? 8;
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

    if (!dailyCount.has(lesson.groupId)) dailyCount.set(lesson.groupId, new Map());
    const dm = dailyCount.get(lesson.groupId)!;
    dm.set(lesson.day, (dm.get(lesson.day) || 0) + 1);
  }

  for (const [groupId, dm] of dailyCount) {
    const maxDaily = groupMap.get(groupId)?.maxDailyLessons ?? 8;
    for (const [day, count] of dm) {
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

  return {
    byLesson: reasons,
    unassignedByRule,
    assignedCount: placed.length,
    neededCount: placed.length + pool.length,
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
