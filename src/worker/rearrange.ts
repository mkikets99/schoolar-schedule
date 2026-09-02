import {
  CurriculumRule,
  GroupScheduleConfig,
  Lesson,
  ProjectState,
  RearrangeBlockReason,
  RearrangeMove,
  RearrangeSuggestion,
  Teacher,
  buildMaxDailyByRule,
  computeGroupScheduleConfig,
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
 * A lesson that already lives in the schedule, or a not-yet-placed lesson being
 * resolved at generation time. Unplaced lessons carry their rule/subject/group
 * identity; `day`/`period` are informational and never read for them.
 */
export type PlacableLesson = Pick<Lesson, 'id' | 'ruleId' | 'groupId' | 'subjectId'> &
  Partial<Pick<Lesson, 'teacherId' | 'roomId' | 'day' | 'period'>>;

/**
 * Precomputed, pure engine state shared by every resolution call for one
 * project. Building it once lets the generator reuse the exact same occupancy,
 * busy-rule and daily-cap logic across many candidate slots.
 */
export interface RearrangeContext {
  teacherBusyRules: BusyRule[];
  noFirstRules: { subjectId: string; groupId?: string }[];
  maxDailyByRule: Map<string, number>;
  groupConfig: Map<string, GroupScheduleConfig>;
  ruleById: Map<string, CurriculumRule>;
  teachers: Teacher[];
  isBusy: (teacherId: string, day: string, period: number) => boolean;
  mainTeacherIdOf: (l: PlacableLesson) => string | undefined;
  buildOccupancy: (schedule: Lesson[], excludeIds: Set<string>) => SlotOccupancy;
  slotFree: (occ: SlotOccupancy, l: PlacableLesson, day: string, period: number, teacherId?: string) => boolean;
  bestFreeSlot: (occ: SlotOccupancy, l: Lesson) => { day: string; period: number } | null;
  isSplitOrDoublePartner: (schedule: Lesson[], l: Lesson) => boolean;
}

export function createRearrangeContext(project: ProjectState): RearrangeContext {
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

  const isBusy = (teacherId: string, day: string, period: number) =>
    teacherBusyRules.some(
      (r) => r.teacherId === teacherId && (r.day === '*' || r.day === day) && r.periods.has(period)
    );

  const buildOccupancy = (schedule: Lesson[], excludeIds: Set<string>): SlotOccupancy => {
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

  const mainTeacherIdOf = (l: PlacableLesson): string | undefined => {
    const rule = ruleById.get(l.ruleId);
    return rule ? rule.teacherId : undefined;
  };

  const isSplitOrDoublePartner = (schedule: Lesson[], l: Lesson): boolean =>
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

  const slotFree = (occ: SlotOccupancy, l: PlacableLesson, day: string, period: number, teacherId?: string): boolean => {
    const cfg = groupConfig.get(l.groupId);
    const start = cfg?.periodStart ?? 1;
    const end = cfg?.periodEnd ?? 8;
    if (period < start || period > end) return false;
    const teacher = teacherId || l.teacherId || mainTeacherIdOf(l);
    if (occ.group.get(l.groupId)?.has(`${day}|${period}`)) return false;
    if (teacher && occ.teacher.get(teacher)?.has(`${day}|${period}`)) return false;
    if (l.roomId && occ.room.get(l.roomId)?.has(`${day}|${period}`)) return false;
    if (teacher && isBusy(teacher, day, period)) return false;
    if (
      period === start &&
      noFirstRules.some((r) => r.subjectId === l.subjectId && (!r.groupId || r.groupId === l.groupId))
    )
      return false;
    const cap = maxDailyByRule.get(l.ruleId);
    if (cap !== undefined) {
      const count = occ.ruleDayCount.get(l.ruleId)?.get(day) || 0;
      if (count >= cap) return false;
    }
    return true;
  };

  const bestFreeSlot = (occ: SlotOccupancy, l: Lesson): { day: string; period: number } | null => {
    const cfg = groupConfig.get(l.groupId);
    const start = cfg?.periodStart ?? 1;
    const end = cfg?.periodEnd ?? 8;
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

  return {
    teacherBusyRules,
    noFirstRules,
    maxDailyByRule,
    groupConfig,
    ruleById,
    teachers: project.teachers || [],
    isBusy,
    mainTeacherIdOf,
    buildOccupancy,
    slotFree,
    bestFreeSlot,
    isSplitOrDoublePartner,
  };
}

function resolvePlacement(
  ctx: RearrangeContext,
  schedule: Lesson[],
  lesson: PlacableLesson,
  target: { day: string; period: number },
  allowSubstitutes: boolean,
  maxDepth = 1
): RearrangeSuggestion[] {
  const {
    noFirstRules,
    maxDailyByRule,
    groupConfig,
    isBusy,
    mainTeacherIdOf,
    buildOccupancy,
    slotFree,
    isSplitOrDoublePartner,
  } = ctx;
  const moveTarget = { day: target.day, period: target.period };

  const originalTeacher = lesson.teacherId || mainTeacherIdOf(lesson);
  const cfg = groupConfig.get(lesson.groupId);
  const start = cfg?.periodStart ?? 1;
  const cap = maxDailyByRule.get(lesson.ruleId);

  const isFirstBlocked = (period: number) =>
    period === start &&
    noFirstRules.some((r) => r.subjectId === lesson.subjectId && (!r.groupId || r.groupId === lesson.groupId));

  const infeasible = (reason: RearrangeBlockReason): RearrangeSuggestion =>
    ({ feasible: false, moves: [], reason });

  const mainMove = (teacherId: string): RearrangeMove => ({
    lessonId: lesson.id,
    toDay: moveTarget.day,
    toPeriod: moveTarget.period,
    teacherId: teacherId !== originalTeacher ? teacherId : undefined,
  });

  // Recursive relocation: move `o` to a valid slot, displacing the colliding
  // teacher/room occupants when the slot is taken and repeating until either a
  // free slot is reached or `depth` swaps are consumed. `excluded` carries the
  // lessons already placed (moved) so a chain never revisits them; `claimed`
  // reserves the target slots those moves occupy so no two moves end in the same
  // slot. Returns the move list plus the final excluded set, or null when no
  // cascade fits.
  let searchNodes = 0;
  const NODE_BUDGET = 12000;
  const relocate = (
    o: Lesson,
    excluded: Set<string>,
    depth: number,
    claimed: Set<string>
  ): { moves: RearrangeMove[]; excluded: Set<string> } | null => {
    if (searchNodes > NODE_BUDGET) return null;
    searchNodes++;
    const cfgO = groupConfig.get(o.groupId);
    const startO = cfgO?.periodStart ?? 1;
    const endO = cfgO?.periodEnd ?? 8;
    const occBase = buildOccupancy(schedule, excluded);
    const capO = maxDailyByRule.get(o.ruleId);
    const firstBlocked = (period: number) =>
      period === startO &&
      noFirstRules.some((r) => r.subjectId === o.subjectId && (!r.groupId || r.groupId === o.groupId));

    const scored: { day: string; period: number; score: number }[] = [];
    for (const day of DAYS) {
      for (let period = startO; period <= endO; period++) {
        if (claimed.has(`${day}|${period}`)) continue;
        if (occBase.group.get(o.groupId)?.has(`${day}|${period}`)) continue;
        if (o.teacherId && isBusy(o.teacherId, day, period)) continue;
        if (firstBlocked(period)) continue;
        if (capO !== undefined) {
          const count = occBase.ruleDayCount.get(o.ruleId)?.get(day) || 0;
          if (count >= capO) continue;
        }
        const sameDay = DAY_INDEX(day) === DAY_INDEX(o.day);
        const score = sameDay
          ? Math.abs(period - o.period)
          : 1000 + Math.abs(DAY_INDEX(day) - DAY_INDEX(o.day)) + Math.abs(period - o.period);
        scored.push({ day, period, score });
      }
    }
    scored.sort((a, b) => a.score - b.score);

    for (const slot of scored) {
      if (slotFree(occBase, o, slot.day, slot.period)) {
        const next = new Set(excluded);
        next.add(o.id);
        claimed.add(`${slot.day}|${slot.period}`);
        return { moves: [{ lessonId: o.id, toDay: slot.day, toPeriod: slot.period }], excluded: next };
      }
      if (depth <= 0) continue;
      const nextExcluded = new Set(excluded);
      nextExcluded.add(o.id);
      const colliders = schedule.filter(
        (c) =>
          c.id !== o.id &&
          !nextExcluded.has(c.id) &&
          c.day === slot.day &&
          c.period === slot.period &&
          ((o.teacherId && c.teacherId === o.teacherId) || (o.roomId && c.roomId === o.roomId))
      );
      if (colliders.length === 0) continue;
      const displaced: RearrangeMove[] = [];
      let ok = true;
      for (const c of colliders) {
        if (isSplitOrDoublePartner(schedule, c)) {
          ok = false;
          break;
        }
        const sub = relocate(c, nextExcluded, depth - 1, claimed);
        if (!sub) {
          ok = false;
          break;
        }
        displaced.push(...sub.moves);
        sub.excluded.forEach((id) => nextExcluded.add(id));
        nextExcluded.add(c.id);
      }
      if (!ok) continue;
      const occAfter = buildOccupancy(schedule, nextExcluded);
      if (!slotFree(occAfter, o, slot.day, slot.period)) continue;
      claimed.add(`${slot.day}|${slot.period}`);
      return {
        moves: [{ lessonId: o.id, toDay: slot.day, toPeriod: slot.period }, ...displaced],
        excluded: nextExcluded,
      };
    }
    return null;
  };

  // Build a complete suggestion given an ordered list of extra lessons that are
  // moved away first (teacher/room blockers, daily-cap victims). Returns null if
  // any extra lesson cannot be relocated (via a cascade up to `depth` swaps) or
  // the target still isn't free.
  const buildSuggestion = (teacherId: string, extraLessons: Lesson[], depth: number): RearrangeSuggestion | null => {
    const excluded = new Set<string>([lesson.id]);
    const claimed = new Set<string>([`${moveTarget.day}|${moveTarget.period}`]);
    const extras: RearrangeMove[] = [];
    for (const o of extraLessons) {
      if (isSplitOrDoublePartner(schedule, o)) return null;
      const res = relocate(o, excluded, depth, claimed);
      if (!res) return null;
      extras.push(...res.moves);
      res.excluded.forEach((id) => excluded.add(id));
    }
    const occFinal = buildOccupancy(schedule, excluded);
    if (!slotFree(occFinal, lesson, moveTarget.day, moveTarget.period, teacherId)) return null;
    return {
      feasible: true,
      moves: [mainMove(teacherId), ...extras],
      teacherIdForMain: teacherId !== originalTeacher ? teacherId : undefined,
    };
  };

  // Collect every distinct resolution for one candidate teacher.
  const candidatesForTeacher = (teacherId: string): RearrangeSuggestion[] => {
    if (teacherId && isBusy(teacherId, moveTarget.day, moveTarget.period)) return [];
    const out: RearrangeSuggestion[] = [];

    const occ0 = buildOccupancy(schedule, new Set([lesson.id]));
    if (slotFree(occ0, lesson, moveTarget.day, moveTarget.period, teacherId)) {
      out.push({ feasible: true, moves: [mainMove(teacherId)], teacherIdForMain: teacherId !== originalTeacher ? teacherId : undefined });
    } else {
      // Blocker relocation: for each lesson colliding on teacher/room, a
      // candidate that moves just that lesson away.
      const blockers = schedule.filter(
        (o) =>
          o.id !== lesson.id &&
          o.day === moveTarget.day &&
          o.period === moveTarget.period &&
          ((teacherId && o.teacherId === teacherId) || (lesson.roomId && o.roomId === lesson.roomId))
      );
      for (const blocker of blockers) {
        const sol = buildSuggestion(teacherId, [blocker], maxDepth);
        if (sol) out.push(sol);
      }

      // Daily-cap: for each same-rule lesson on the overloaded day, a candidate
      // that relocates just that lesson so the cap opens.
      if (cap !== undefined) {
        const occC = buildOccupancy(schedule, new Set([lesson.id]));
        const ruleDaily = occC.ruleDayCount.get(lesson.ruleId)?.get(moveTarget.day) || 0;
        if (ruleDaily >= cap) {
          const victims = schedule.filter(
            (o) => o.ruleId === lesson.ruleId && o.day === moveTarget.day && o.id !== lesson.id
          );
          for (const victim of victims) {
            const sol = buildSuggestion(teacherId, [victim], maxDepth);
            if (sol) out.push(sol);
          }
        }
      }
    }
    return out;
  };

  // Hard constraints that no AI rearrangement can ever satisfy. The engine
  // reports the concrete rule being broken so the UI can explain the rejection.
  const occHard = buildOccupancy(schedule, new Set([lesson.id]));
  if (occHard.group.get(lesson.groupId)?.has(`${moveTarget.day}|${moveTarget.period}`)) {
    return [infeasible('GROUP_SLOT')];
  }
  if (isFirstBlocked(moveTarget.period)) {
    return [infeasible('NO_FIRST_PERIOD')];
  }
  const groupDaily = (occHard.groupDayCount.get(lesson.groupId)?.get(moveTarget.day) || 0) + 1;
  if (groupDaily > (cfg?.maxDaily ?? 8)) {
    return [infeasible('DAILY_OVERLOAD')];
  }

  // AI rearrange: collect candidates from the original teacher first, then any
  // eligible substitute. When no candidate exists at all, fall back to the
  // failsafe blocked reason so the UI can still explain the rejection.
  const candidates: RearrangeSuggestion[] = [];
  const seen = new Set<string>();
  const pushUnique = (list: RearrangeSuggestion[]) => {
    for (const c of list) {
      const sig = `${c.teacherIdForMain ?? ''}|${c.moves.map((m) => `${m.lessonId}@${m.toDay}${m.toPeriod}`).join(',')}`;
      if (seen.has(sig)) continue;
      seen.add(sig);
      candidates.push(c);
    }
  };

  if (originalTeacher) pushUnique(candidatesForTeacher(originalTeacher));

  if (allowSubstitutes) {
    const substitutes = eligibleTeachers(ctx.teachers, lesson.subjectId)
      .filter((tc) => tc.id !== originalTeacher)
      .map((tc) => tc.id);
    for (const subId of substitutes) {
      pushUnique(candidatesForTeacher(subId));
    }
  }

  if (candidates.length === 0) {
    // Work out the most likely reason: teacher busy wins, else split partner,
    // else daily rule, else generic no-space.
    let reason: RearrangeBlockReason = 'NO_SPACE';
    if (originalTeacher && isBusy(originalTeacher, moveTarget.day, moveTarget.period)) {
      reason = 'TEACHER_BUSY';
    }
    const occC = buildOccupancy(schedule, new Set([lesson.id]));
    const hasSplit = schedule.some(
      (o) =>
        o.id !== lesson.id &&
        o.day === moveTarget.day &&
        o.period === moveTarget.period &&
        ((originalTeacher && o.teacherId === originalTeacher) || (lesson.roomId && o.roomId === lesson.roomId)) &&
        isSplitOrDoublePartner(schedule, o)
    );
    if (hasSplit) reason = 'SPLIT_PARTNER';
    else if (cap !== undefined && (occC.ruleDayCount.get(lesson.ruleId)?.get(moveTarget.day) || 0) >= cap) {
      reason = 'DAILY_RULE';
    }
    return [infeasible(reason)];
  }

  return candidates;
}

/**
 * Return every distinct way the rearrange engine could place a lesson at the
 * target. Each entry is a complete, constraint-valid resolution (the main move
 * plus any relocations). The UI uses this to let the user pick between multiple
 * AI solutions; a well-formed single solution still flows through normally.
 */
export function suggestRearrangeChoices(
  project: ProjectState,
  schedule: Lesson[],
  lessonId: string,
  target: { day: string; period: number }
): RearrangeSuggestion[] {
  const lesson = schedule.find((l) => l.id === lessonId);
  if (!lesson) return [{ feasible: false, moves: [], reason: 'NO_SPACE' }];
  return resolvePlacement(createRearrangeContext(project), schedule, lesson, target, true, 15);
}

/**
 * Worker-side AI rearrangement engine. Given the current schedule and a lesson
 * the user is trying to move on the edit grid, it returns the smallest set of
 * extra moves (plus an optional teacher reassignment for the moved lesson) that
 * keeps every placed lesson constraint-valid. When no collision-free resolution
 * exists, it reports `feasible: false` with a `reason` explaining which fixed
 * rule is being broken.
 *
 * Resolution preferences, in order:
 *  1. move the lesson directly (target already free),
 *  2. relocate the lesson with an eligible substitute teacher (fixes a teacher
 *     busy/collision without touching any other lesson when the room is free),
 *  3. relocate the blocking / daily-cap lessons to free slots so the target
 *     opens up; relocations may themselves displace occupants, cascading up to
 *     15 swaps deep before the engine reports the move as infeasible.
 */
export function suggestRearrange(
  project: ProjectState,
  schedule: Lesson[],
  lessonId: string,
  target: { day: string; period: number },
  reassignTeacherId?: string
): RearrangeSuggestion {
  const lesson = schedule.find((l) => l.id === lessonId);
  if (!lesson) return { feasible: false, moves: [], reason: 'NO_SPACE' };

  // A reassignTeacherId request disables the substitute search (the caller
  // already picked the teacher); otherwise the engine tries substitutes.
  const choices = resolvePlacement(
    createRearrangeContext(project),
    schedule,
    lesson,
    target,
    !reassignTeacherId,
    15
  );
  return choices[0] ?? { feasible: false, moves: [], reason: 'NO_SPACE' };
}

/**
 * Generation-time variant of {@link suggestRearrange}: resolves a lesson that
 * has NOT been placed yet (it may already be present in `schedule` - the engine
 * treats `id`-excluded lessons as unplaced). Tries the original teacher only
 * and never substitutes, but may relocate blockers: a lesson that fails to fit
 * any direct slot often still fits one whose occupant (same teacher or room)
 * can be moved elsewhere. Returns the same `RearrangeSuggestion` contract.
 */
export function resolveUnplacedPlacement(
  ctx: RearrangeContext,
  schedule: Lesson[],
  lesson: PlacableLesson,
  target: { day: string; period: number }
): RearrangeSuggestion {
  const choices = resolvePlacement(ctx, schedule, lesson, target, false);
  return choices[0] ?? { feasible: false, moves: [], reason: 'NO_SPACE' };
}