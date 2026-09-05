import {
  CurriculumRule,
  GroupScheduleConfig,
  Lesson,
  ProjectState,
  RearrangeBlockReason,
  RearrangeMove,
  RearrangeSuggestion,
  SemesterSchedules,
  Teacher,
  buildMaxDailyByRule,
  computeGroupScheduleConfig,
} from '../shared/types';
import { eligibleTeachers } from '../shared/eligibility';
import { buildScheduleScore } from './score';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

interface BusyRule {
  teacherId: string;
  day: string;
  periods: Set<number>;
}

interface SlotOccupancy {
  teacher: Map<string, Map<string, Set<string>>>; // teacherId -> "day|period" -> groupIds
  room: Map<string, Map<string, Set<string>>>; // roomId -> "day|period" -> groupIds
  group: Map<string, Set<string>>; // groupId -> "day|period"
  groupDayCount: Map<string, Map<string, number>>; // groupId -> day -> count
  ruleDayCount: Map<string, Map<string, number>>; // ruleId -> day -> count
}

const DAY_INDEX = (day: string) => Math.max(0, DAYS.indexOf(day));

/**
 * Default per-call rearrange search node ceiling for *interactive* edit-mode
 * calls (`suggestRearrange` / `suggestRearrangeChoices`) that have no explicit
 * budget. This is a *work* budget, not a depth limit: correctness never depends
 * on a fixed rearrangement depth (spec §9). It only stops pathological blow-ups
 * on dense boards. Generation-time auto-resolve intentionally treats a missing
 * budget as *unbounded* (spec §22: `null` means no count limit), so the effective
 * guard there is the node budget the caller supplies or the time deadline.
 */
export const DEFAULT_NODE_BUDGET = 12000;

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
  lockedSlots: Set<string>;
  isBusy: (teacherId: string, day: string, period: number) => boolean;
  mainTeacherIdOf: (l: PlacableLesson) => string | undefined;
  buildOccupancy: (schedule: Lesson[], excludeIds: Set<string>) => SlotOccupancy;
  slotFree: (occ: SlotOccupancy, l: PlacableLesson, day: string, period: number, teacherId?: string, excludeId?: string) => boolean;
  bestFreeSlot: (occ: SlotOccupancy, l: Lesson) => { day: string; period: number } | null;
  isSplitOrDoublePartner: (schedule: Lesson[], l: Lesson) => boolean;
  roomHasCapacity: (occ: SlotOccupancy, roomId: string, groupId: string, day: string, period: number) => boolean;
  maxGroupsByTeacher: Map<string, number>;
  /** The originating project, retained so edit/generation-time rearrange can
   *  score the resulting schedule through `buildScheduleScore` (v4-32) instead
   *  of returning the first feasible cascade. */
  project: ProjectState;
}

export function createRearrangeContext(project: ProjectState, semester?: 'semester1' | 'semester2'): RearrangeContext {
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

  // How many groups may share a room in the same slot. Undefined defaults to 1.
  const maxGroupsByRoom = new Map<string, number>();
  for (const room of project.rooms || []) {
    maxGroupsByRoom.set(room.id, Math.max(1, room.maxGroups ?? 1));
  }

  // How many groups a teacher may work with in the same slot. Undefined = 1.
  const maxGroupsByTeacher = new Map<string, number>();
  for (const teacher of project.teachers || []) {
    maxGroupsByTeacher.set(teacher.id, Math.max(1, teacher.maxGroups ?? 1));
  }

  // Lessons pinned against movement: identified by rule + slot (semester-scoped
  // when the context knows the semester). The relocation cascade never moves one.
  const lockedSlots = new Set<string>();
  for (const lock of project.lockedLessons || []) {
    if (semester && lock.semester && lock.semester !== semester) continue;
    lockedSlots.add(`${lock.ruleId}|${lock.day}|${lock.period}`);
  }

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
    const pushGroup = (m: Map<string, Map<string, Set<string>>>, id: string, key: string, groupId: string) => {
      if (!m.has(id)) m.set(id, new Map());
      if (!m.get(id)!.has(key)) m.get(id)!.set(key, new Set());
      m.get(id)!.get(key)!.add(groupId);
    };
    for (const l of schedule) {
      if (excludeIds.has(l.id)) continue;
      const key = `${l.day}|${l.period}`;
      if (l.teacherId) pushGroup(occ.teacher, l.teacherId, key, l.groupId);
      if (l.roomId) pushGroup(occ.room, l.roomId, key, l.groupId);
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

  // True when a room can host another lesson of `groupId` at the slot: either
  // the room has not yet reached its simultaneous-group cap, or the group is
  // already in the room there (a split/double partner re-using the room).
  const roomHasCapacity = (occ: SlotOccupancy, roomId: string, groupId: string, day: string, period: number): boolean => {
    const occupants = occ.room.get(roomId)?.get(`${day}|${period}`);
    if (!occupants) return true;
    const cap = maxGroupsByRoom.get(roomId) ?? 1;
    return occupants.has(groupId) || occupants.size < cap;
  };

  const slotFree = (occ: SlotOccupancy, l: PlacableLesson, day: string, period: number, teacherId?: string, excludeId?: string): boolean => {
    const cfg = groupConfig.get(l.groupId);
    const start = cfg?.periodStart ?? 1;
    const end = cfg?.periodEnd ?? 8;
    if (period < start || period > end) return false;
    const teacher = teacherId || l.teacherId || mainTeacherIdOf(l);
    if (occ.group.get(l.groupId)?.has(`${day}|${period}`)) return false;
    if (teacher) {
      const teacherOccupants = occ.teacher.get(teacher)?.get(`${day}|${period}`);
      if (teacherOccupants && teacherOccupants.size >= (maxGroupsByTeacher.get(teacher) ?? 1) && !teacherOccupants.has(l.groupId)) {
        return false;
      }
    }
    if (l.roomId && !roomHasCapacity(occ, l.roomId, l.groupId, day, period)) return false;
    if (teacher && isBusy(teacher, day, period)) return false;
    if (
      period === start &&
      noFirstRules.some((r) => r.subjectId === l.subjectId && (!r.groupId || r.groupId === l.groupId))
    )
      return false;
    const cap = maxDailyByRule.get(l.ruleId);
    if (cap !== undefined) {
      const count = occ.ruleDayCount.get(l.ruleId)?.get(day) || 0;
      const own = excludeId != null && excludeId === l.id && occ.ruleDayCount.get(l.ruleId)?.has(day) ? 1 : 0;
      if (count - own >= cap) return false;
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
    lockedSlots,
    isBusy,
    mainTeacherIdOf,
    buildOccupancy,
    slotFree,
    bestFreeSlot,
    isSplitOrDoublePartner,
    roomHasCapacity,
    maxGroupsByTeacher,
    project,
  };
}

function resolvePlacement(
  ctx: RearrangeContext,
  schedule: Lesson[],
  lesson: PlacableLesson,
  target: { day: string; period: number },
  allowSubstitutes: boolean,
  nodeBudget = DEFAULT_NODE_BUDGET
): RearrangeSuggestion[] {
  const {
    noFirstRules,
    maxDailyByRule,
    groupConfig,
    isBusy,
    mainTeacherIdOf,
    buildOccupancy,
    slotFree,
    roomHasCapacity,
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

  // Locked lessons are immutable: a placed lesson sitting exactly on its locked
  // slot must never be moved by the edit engine (the UI also blocks its drag).
  // Unplaced lessons carry the rule's id but are absent from `schedule`, so a
  // lock-slot ghost never blocks auto-resolve or pool placement of a fresh unit.
  if (
    ctx.lockedSlots.has(`${lesson.ruleId}|${lesson.day}|${lesson.period}`) &&
    schedule.some((s) => s.id === lesson.id)
  ) {
    return [infeasible('LOCKED')];
  }

  const mainMove = (teacherId: string): RearrangeMove => ({
    lessonId: lesson.id,
    toDay: moveTarget.day,
    toPeriod: moveTarget.period,
    teacherId: teacherId !== originalTeacher ? teacherId : undefined,
  });

  // Recursive relocation: move `o` to a valid slot, displacing the colliding
  // teacher/room occupants when the slot is taken, and repeat until a free slot
  // is reached. There is deliberately NO fixed depth cap (worker v0.3 spec §9):
  // a branch may cascade as deep as the number of distinct lessons because
  // `excluded` guarantees each lesson is moved at most once per branch. Practical
  // termination is the shared `nodeBudget` (a work ceiling, not a depth limit)
  // plus cycle prevention: `excluded` prevents moving the same lesson (and
  // therefore returning to the same slot) twice inside one search branch (§11).
  // `claimed` reserves the target slots those moves occupy so no two moves end
  // in the same slot. Returns the move list plus the final excluded set, or null
  // when no cascade fits within the budget.
  let searchNodes = 0;
  const relocate = (
    o: Lesson,
    excluded: Set<string>,
    claimed: Set<string>
  ): { moves: RearrangeMove[]; excluded: Set<string> } | null => {
    if (searchNodes > nodeBudget) return null;
    searchNodes++;
    if (ctx.lockedSlots.has(`${o.ruleId}|${o.day}|${o.period}`)) return null;
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
      // A slot may have been claimed by a sub-cascade while this precomputed
      // ranked list was being built; never double-claim it (fixes multi-lesson
      // piles when a relocation chain overlaps its own targets).
      if (claimed.has(`${slot.day}|${slot.period}`)) continue;
      if (slotFree(occBase, o, slot.day, slot.period)) {
        const next = new Set(excluded);
        next.add(o.id);
        claimed.add(`${slot.day}|${slot.period}`);
        return { moves: [{ lessonId: o.id, toDay: slot.day, toPeriod: slot.period }], excluded: next };
      }
      const nextExcluded = new Set(excluded);
      nextExcluded.add(o.id);
      const colliders = schedule.filter(
        (c) =>
          c.id !== o.id &&
          !nextExcluded.has(c.id) &&
          c.day === slot.day &&
          c.period === slot.period &&
          ((o.teacherId && c.teacherId === o.teacherId) ||
            (o.roomId && c.roomId === o.roomId && !roomHasCapacity(occBase, o.roomId, o.groupId, slot.day, slot.period)))
      );
      if (colliders.length === 0) continue;
      const displaced: RearrangeMove[] = [];
      let ok = true;
      for (const c of colliders) {
        if (isSplitOrDoublePartner(schedule, c)) {
          ok = false;
          break;
        }
        const sub = relocate(c, nextExcluded, claimed);
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
      if (claimed.has(`${slot.day}|${slot.period}`)) continue;
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
  // any extra lesson cannot be relocated (via a cascade within the node budget)
  // or the target still isn't free.
  const buildSuggestion = (teacherId: string, extraLessons: Lesson[]): RearrangeSuggestion | null => {
    const excluded = new Set<string>([lesson.id]);
    const claimed = new Set<string>([`${moveTarget.day}|${moveTarget.period}`]);
    const extras: RearrangeMove[] = [];
    for (const o of extraLessons) {
      if (isSplitOrDoublePartner(schedule, o)) return null;
      const res = relocate(o, excluded, claimed);
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
          ((teacherId && o.teacherId === teacherId) ||
            (lesson.roomId && o.roomId === lesson.roomId && !roomHasCapacity(occ0, lesson.roomId, lesson.groupId, moveTarget.day, moveTarget.period)))
      );
      for (const blocker of blockers) {
        const sol = buildSuggestion(teacherId, [blocker]);
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
            const sol = buildSuggestion(teacherId, [victim]);
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
        ((originalTeacher && o.teacherId === originalTeacher) ||
          (lesson.roomId && o.roomId === lesson.roomId && !roomHasCapacity(occC, lesson.roomId, lesson.groupId, moveTarget.day, moveTarget.period))) &&
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

function scoreVectorForSort(score: ReturnType<typeof buildScheduleScore>): number[] {
  return [
    score.unscheduledLessons,
    score.pinnedUnassigned,
    score.dailyCompactness,
    score.longGapPenalty,
    score.sparseDayPenalty,
    score.subjectDistributionPenalty,
    score.parallelizationPenalty,
    score.ageShiftPenalty,
    score.roomStabilityPenalty,
    score.assignmentMovementPenalty,
    score.minorPreferencePenalty,
  ];
}

/**
 * Build a SemesterSchedules wrapper for scoring one candidate editing pass. The
 * edited semester gets the post-move schedule; the paired semester is left as a
 * copy (candidates share identical completeness there, so ranking is driven by
 * the affected semester's soft metrics - v4-32).
 */
function wrappedSchedule(schedule: Lesson[], candidate: RearrangeSuggestion): SemesterSchedules {
  const next = schedule.map((l) => ({ ...l }));
  const byId = new Map(next.map((l) => [l.id, l]));
  for (const m of candidate.moves) {
    const lesson = byId.get(m.lessonId);
    if (!lesson) continue;
    lesson.day = m.toDay;
    lesson.period = m.toPeriod;
    if (m.teacherId) lesson.teacherId = m.teacherId;
  }
  return {
    semester1: { schedule: next, conflicts: [], score: 1 },
    semester2: { schedule: [...schedule], conflicts: [], score: 1 },
  };
}

/**
 * Rank a set of candidate resolutions by the resulting full-schedule score.
 * Smaller score vector wins (fewer/no conflicts first, then daily compactness,
 * then the rest). When scores tie, the original engine order is kept (stable).
 */
function rankCandidates(
  project: ProjectState,
  schedule: Lesson[],
  candidates: RearrangeSuggestion[]
): RearrangeSuggestion[] {
  return candidates.slice().sort((a, b) => {
    const va = scoreVectorForSort(buildScheduleScore(wrappedSchedule(schedule, a), [], project));
    const vb = scoreVectorForSort(buildScheduleScore(wrappedSchedule(schedule, b), [], project));
    for (let i = 0; i < va.length; i++) {
      if (va[i] !== vb[i]) return va[i] - vb[i];
    }
    return 0;
  });
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
  target: { day: string; period: number },
  semester?: 'semester1' | 'semester2'
): RearrangeSuggestion[] {
  const lesson = schedule.find((l) => l.id === lessonId);
  if (!lesson) return [{ feasible: false, moves: [], reason: 'NO_SPACE' }];
  return rankCandidates(
    project,
    schedule,
    resolvePlacement(createRearrangeContext(project, semester), schedule, lesson, target, true, DEFAULT_NODE_BUDGET)
  );
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
 *     opens up; relocations may themselves displace occupants in an arbitrary-
 *     depth cascade bounded by the node budget. Rearrangement depth is never a
 *     correctness limit or a measure of quality (spec §9/§33).
 */
export function suggestRearrange(
  project: ProjectState,
  schedule: Lesson[],
  lessonId: string,
  target: { day: string; period: number },
  reassignTeacherId?: string,
  semester?: 'semester1' | 'semester2'
): RearrangeSuggestion {
  const lesson = schedule.find((l) => l.id === lessonId);
  if (!lesson) return { feasible: false, moves: [], reason: 'NO_SPACE' };

  // A reassignTeacherId request disables the substitute search (the caller
  // already picked the teacher); otherwise the engine tries substitutes.
  const choices = resolvePlacement(
    createRearrangeContext(project, semester),
    schedule,
    lesson,
    target,
    !reassignTeacherId,
    DEFAULT_NODE_BUDGET
  );
  // Return the best cascade by the resulting ScheduleScore, never just the
  // first feasible one (v4-30/v4-32).
  const ranked = rankCandidates(project, schedule, choices);
  return ranked[0] ?? { feasible: false, moves: [], reason: 'NO_SPACE' };
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
  target: { day: string; period: number },
  nodeBudget?: number
): RearrangeSuggestion {
  // Generation-time auto-resolve: a missing budget means "no explicit count
  // limit" (spec §22) - unbounded search, bounded only by the caller deadline.
  const choices = resolvePlacement(ctx, schedule, lesson, target, false, nodeBudget ?? Infinity);
  // Rank by the resulting schedule score (v4-32): the main lesson is added to
  // the affected semester and moves are applied before scoring.
  const project = ctx.project;
  if (choices.length === 0) return { feasible: false, moves: [], reason: 'NO_SPACE' };
  const main = choices.find((c) => c.feasible);
  if (!main) return choices[0] ?? { feasible: false, moves: [], reason: 'NO_SPACE' };
  const addLesson = (s: Lesson[], m: RearrangeMove): Lesson[] => {
    const exists = s.find((l) => l.id === m.lessonId);
    if (exists) return s;
    return [
      ...s,
      {
        id: m.lessonId,
        ruleId: lesson.ruleId,
        groupId: lesson.groupId,
        subjectId: lesson.subjectId,
        teacherId: m.teacherId ?? lesson.teacherId,
        roomId: lesson.roomId,
        day: m.toDay,
        period: m.toPeriod,
      },
    ];
  };
  const wrap = (candidate: RearrangeSuggestion): Lesson[] => {
    let next = [...schedule];
    for (const mv of candidate.moves) {
      const idx = next.findIndex((l) => l.id === mv.lessonId);
      if (idx >= 0) {
        next = next.map((l) => (l.id === mv.lessonId ? { ...l, day: mv.toDay, period: mv.toPeriod } : l));
      } else {
        next = addLesson(next, mv);
      }
    }
    return next;
  };
  const ranked = choices.slice().sort((a, b) => {
    const schedules1: SemesterSchedules = { semester1: { schedule: wrap(a), conflicts: [], score: 1 }, semester2: { schedule: [], conflicts: [], score: 1 } };
    const schedules2: SemesterSchedules = { semester1: { schedule: wrap(b), conflicts: [], score: 1 }, semester2: { schedule: [], conflicts: [], score: 1 } };
    const va = scoreVectorForSort(buildScheduleScore(schedules1, [], project));
    const vb = scoreVectorForSort(buildScheduleScore(schedules2, [], project));
    for (let i = 0; i < va.length; i++) {
      if (va[i] !== vb[i]) return va[i] - vb[i];
    }
    return 0;
  });
  const best = ranked.find((c) => c.feasible) ?? ranked[0];
  return best ?? { feasible: false, moves: [], reason: 'NO_SPACE' };
}