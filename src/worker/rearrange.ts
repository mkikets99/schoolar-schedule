import {
  Lesson,
  ProjectState,
  RearrangeMove,
  RearrangeSuggestion,
  computeGroupScheduleConfig,
  buildMaxDailyByRule,
} from '../shared/types';
import { eligibleTeachers } from '../shared/eligibility';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

interface BusyRule {
  teacherId: string;
  day: string;
  periods: Set<number>;
}

interface SlotOccupancy {
  teacher: Map<string, Set<string>>; // teacherId -> "day|period"
  room: Map<string, Set<string>>; // roomId -> "day|period"
  group: Map<string, Set<string>>; // groupId -> "day|period"
  groupDayCount: Map<string, Map<string, number>>; // groupId -> day -> count
  ruleDayCount: Map<string, Map<string, number>>; // ruleId -> day -> count
}

const DAY_INDEX = (day: string) => Math.max(0, DAYS.indexOf(day));

/**
 * Worker-side AI rearrangement engine. Given the current schedule and a lesson
 * the user is trying to move on the edit grid, it returns the smallest set of
 * extra moves (plus an optional teacher reassignment for the moved lesson) that
 * keeps every placed lesson constraint-valid. When no collision-free resolution
 * exists, it reports `feasible: false`.
 *
 * Resolution preferences, in order:
 *  1. move the lesson directly (target already free),
 *  2. relocate the lesson with an eligible substitute teacher (fixes a teacher
 *     busy/collision without touching any other lesson when the room is free),
 *  3. relocate the blockerd lessons to free slots so the target opens up.
 */
export function suggestRearrange(
  project: ProjectState,
  schedule: Lesson[],
  lessonId: string,
  target: { day: string; period: number },
  reassignTeacherId?: string
): RearrangeSuggestion {
  const moveTarget = { day: target.day, period: target.period };
  const lesson = schedule.find((l) => l.id === lessonId);
  if (!lesson) return { feasible: false, moves: [] };

  const teacherBusyRules: BusyRule[] = [];
  const noFirstRules: { subjectId: string; groupId?: string }[] = [];
  for (const c of project.constraints || []) {
    if (c.kind === 'TEACHER_BUSY' && c.teacherId && c.periods && c.periods.length > 0) {
      teacherBusyRules.push({ teacherId: c.teacherId, day: c.day || '*', periods: new Set(c.periods) });
    } else if (c.kind === 'NO_FIRST_PERIOD' && c.subjectId) {
      noFirstRules.push({ subjectId: c.subjectId, groupId: c.groupId });
    }
  }
  const maxDailyByRule = buildMaxDailyByRule(project);
  const groupConfig = new Map((project.groups || []).map((g) => [g.id, computeGroupScheduleConfig(g)]));
  const ruleById = new Map((project.curriculum || []).map((r) => [r.id, r]));

  const ruleFor = (l: Lesson) =>
    ruleById.get(l.ruleId) || { groupId: l.groupId, subjectId: l.subjectId, doubleLesson: false };
  const mainTeacherIdOf = (l: Lesson): string | undefined => {
    const rule = ruleFor(l);
    return 'teacherId' in rule ? rule.teacherId : undefined;
  };
  const originalTeacher = lesson.teacherId || mainTeacherIdOf(lesson);
  const cfg = groupConfig.get(lesson.groupId);
  const start = cfg?.periodStart ?? 1;
  const end = cfg?.periodEnd ?? 8;

  const isBusy = (teacherId: string, day: string, period: number) =>
    teacherBusyRules.some(
      (r) => r.teacherId === teacherId && (r.day === '*' || r.day === day) && r.periods.has(period)
    );
  const isFirstBlocked = (period: number) =>
    period === start &&
    noFirstRules.some((r) => r.subjectId === lesson.subjectId && (!r.groupId || r.groupId === lesson.groupId));

  const buildOccupancy = (excludeIds: Set<string>): SlotOccupancy => {
    const occ: SlotOccupancy = {
      teacher: new Map(),
      room: new Map(),
      group: new Map(),
      groupDayCount: new Map(),
      ruleDayCount: new Map(),
    };
    const push = (m: Map<string, Set<string>>, id: string, key: string) => {
      if (!m.has(id)) m.set(id, new Set());
      m.get(id)!.add(key);
    };
    for (const l of schedule) {
      if (excludeIds.has(l.id)) continue;
      const key = `${l.day}|${l.period}`;
      if (l.teacherId) push(occ.teacher, l.teacherId, key);
      if (l.roomId) push(occ.room, l.roomId, key);
      push(occ.group, l.groupId, key);
      if (!occ.groupDayCount.has(l.groupId)) occ.groupDayCount.set(l.groupId, new Map());
      const gd = occ.groupDayCount.get(l.groupId)!;
      gd.set(l.day, (gd.get(l.day) || 0) + 1);
      if (maxDailyByRule.has(l.ruleId)) {
        if (!occ.ruleDayCount.has(l.ruleId)) occ.ruleDayCount.set(l.ruleId, new Map());
        const rd = occ.ruleDayCount.get(l.ruleId)!;
        rd.set(l.day, (rd.get(l.day) || 0) + 1);
      }
    }
    return occ;
  };

  const slotFree = (occ: SlotOccupancy, l: Lesson, day: string, period: number, teacherId?: string): boolean => {
    if (period < start || period > end) return false;
    const teacher = teacherId || l.teacherId || mainTeacherIdOf(l);
    if (occ.group.get(l.groupId)?.has(`${day}|${period}`)) return false;
    if (teacher && occ.teacher.get(teacher)?.has(`${day}|${period}`)) return false;
    if (l.roomId && occ.room.get(l.roomId)?.has(`${day}|${period}`)) return false;
    if (teacher && isBusy(teacher, day, period)) return false;
    if (isFirstBlocked(period)) return false;
    const cap = maxDailyByRule.get(l.ruleId);
    if (cap !== undefined) {
      const count = occ.ruleDayCount.get(l.ruleId)?.get(day) || 0;
      if (count >= cap) return false;
    }
    return true;
  };

  const bestFreeSlot = (occ: SlotOccupancy, l: Lesson): { day: string; period: number } | null => {
    let best: { day: string; period: number } | null = null;
    let bestScore = Infinity;
    for (const day of DAYS) {
      for (let period = start; period <= end; period++) {
        if (!slotFree(occ, l, day, period)) continue;
        const sameDay = DAY_INDEX(day) === DAY_INDEX(l.day);
        const score = sameDay ? Math.abs(period - l.period) : 1000 + Math.abs(DAY_INDEX(day) - DAY_INDEX(l.day));
        if (score < bestScore) {
          bestScore = score;
          best = { day, period };
        }
      }
    }
    return best;
  };

  const rel = (l: Lesson, day: string, period: number): RearrangeMove => ({
    lessonId: l.id,
    toDay: day,
    toPeriod: period,
  });

  const isSplitOrDoublePartner = (l: Lesson): boolean =>
    schedule.some(
      (p) =>
        p.id !== l.id &&
        p.day === l.day &&
        p.period === l.period &&
        p.groupId === l.groupId &&
        p.subjectId === l.subjectId
    ) ||
    schedule.some(
      (p) =>
        p.id !== l.id &&
        p.teacherId &&
        p.teacherId === l.teacherId &&
        p.ruleId === l.ruleId &&
        p.day === l.day &&
        p.period !== l.period &&
        Math.abs(p.period - l.period) === 1
    );

  // Try to place the moved lesson at the target with `teacherId` as its
  // instructor, relocating any occupying lessons that collide with it.
  const resolveFor = (teacherId: string): RearrangeSuggestion | null => {
    if (teacherId && isBusy(teacherId, moveTarget.day, moveTarget.period)) return null;

    const occ0 = buildOccupancy(new Set([lesson.id]));
    if (slotFree(occ0, lesson, moveTarget.day, moveTarget.period, teacherId)) {
      return {
        feasible: true,
        moves: [
          {
            lessonId: lesson.id,
            toDay: moveTarget.day,
            toPeriod: moveTarget.period,
            teacherId: teacherId !== originalTeacher ? teacherId : undefined,
          },
        ],
        teacherIdForMain: teacherId !== originalTeacher ? teacherId : undefined,
      };
    }

    const needToMove = new Map<string, Lesson>();
    for (const o of schedule) {
      if (o.id === lesson.id || o.day !== moveTarget.day || o.period !== moveTarget.period) continue;
      const conflictTeacher = teacherId && o.teacherId === teacherId;
      const conflictRoom = lesson.roomId && o.roomId === lesson.roomId;
      if (conflictTeacher || conflictRoom) needToMove.set(o.id, o);
    }

    const excluded = new Set<string>([lesson.id]);
    const extras: RearrangeMove[] = [];
    for (const o of needToMove.values()) {
      if (isSplitOrDoublePartner(o)) return null;
      const occI = buildOccupancy(excluded);
      const slot = bestFreeSlot(occI, o);
      if (!slot) return null;
      excluded.add(o.id);
      extras.push(rel(o, slot.day, slot.period));
    }

    const occFinal = buildOccupancy(excluded);
    if (!slotFree(occFinal, lesson, moveTarget.day, moveTarget.period, teacherId)) return null;

    return {
      feasible: true,
      moves: [
        {
          lessonId: lesson.id,
          toDay: moveTarget.day,
          toPeriod: moveTarget.period,
          teacherId: teacherId !== originalTeacher ? teacherId : undefined,
        },
        ...extras,
      ],
      teacherIdForMain: teacherId !== originalTeacher ? teacherId : undefined,
    };
  };

  // Hard constraints on the target slot that no combination of relocations or a
  // substitute teacher can ever satisfy.
  const occHard = buildOccupancy(new Set([lesson.id]));
  if (occHard.group.get(lesson.groupId)?.has(`${moveTarget.day}|${moveTarget.period}`)) {
    return { feasible: false, moves: [] };
  }
  if (isFirstBlocked(moveTarget.period)) return { feasible: false, moves: [] };
  const groupDaily = (occHard.groupDayCount.get(lesson.groupId)?.get(moveTarget.day) || 0) + 1;
  if (groupDaily > (cfg?.maxDaily ?? 8)) return { feasible: false, moves: [] };
  const cap = maxDailyByRule.get(lesson.ruleId);
  if (cap !== undefined) {
    const ruleDaily = occHard.ruleDayCount.get(lesson.ruleId)?.get(moveTarget.day) || 0;
    if (ruleDaily >= cap) return { feasible: false, moves: [] };
  }

  // 1. Prefer keeping the original teacher.
  if (originalTeacher) {
    const direct = resolveFor(originalTeacher);
    if (direct) return direct;
  }

  // 2. Try an eligible substitute teacher that is free at the target.
  if (!reassignTeacherId) {
    const substitutes = eligibleTeachers(project.teachers || [], lesson.subjectId)
      .filter((tc) => tc.id !== originalTeacher)
      .map((tc) => tc.id);
    for (const subId of substitutes) {
      const r = resolveFor(subId);
      if (r) return r;
    }
  }

  return { feasible: false, moves: [] };
}