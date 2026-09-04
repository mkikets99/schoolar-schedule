import {
  CurriculumRule,
  ProjectState,
  SemesterSchedules,
  SemesterSplit,
  ScheduleScore,
  AgeGroupPolicy,
} from '../shared/types';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Default soft thresholds (worker v0.4 spec §7). A gap is "long" when it spans at
// least this many free periods; a day is "sparse" when an entity has exactly one
// lesson. These are soft configuration defaults only, overridable via
// `project.schedulePolicy`.
const DEFAULT_LONG_GAP_THRESHOLD = 2;

// Scalar weights used ONLY to turn the lexicographic vector into a single
// display number (`bestQuality` / the per-attempt numeric report). The vector
// itself (compareScores) is the single canonical decision rule; the scalar is a
// monotone projection that preserves its ordering for the cases the UI shows.
// Weights are chosen so completeness and the primary level groups dominate in
// the display projection the same way they do in the lexicographic order.
const SCALAR_LESSON = 1000;
const SCALAR_PINNED = 500;
const SCALAR_COMPACT = 50;
const SCALAR_LONG_GAP = 25;
const SCALAR_SPARSE = 5;
const SCALAR_DISTRIBUTION = 2;
const SCALAR_PARALLEL = 1;
const SCALAR_AGE = 0.5;
const SCALAR_ROOM = 0.25;
const SCALAR_MOVE = 0.1;
const SCALAR_MINOR = 0.01;

export function countUnassigned<
  T extends { conflicts?: any[] },
>(result: T): number {
  return (result.conflicts || [])
    .filter((c) => c?.type === 'UNASSIGNED_HOURS')
    .reduce((sum, c) => sum + (c.missing ?? 1), 0);
}

function dayPeriodsOf(schedule: any[], byId: (l: any) => string | undefined, id: string, day: string): number[] {
  const out: number[] = [];
  for (const lesson of schedule) {
    if (byId(lesson) === id && lesson.day === day) out.push(lesson.period);
  }
  out.sort((a, b) => a - b);
  return out;
}

function teacherDayPeriods(schedule: any[], teacherId: string, day: string): number[] {
  return dayPeriodsOf(schedule, (l) => l.teacherId, teacherId, day);
}

function classDayPeriods(schedule: any[], groupId: string, day: string): number[] {
  return dayPeriodsOf(schedule, (l) => l.groupId, groupId, day);
}

/** Free periods strictly between the first and last lesson of a day. */
function gapOfPeriods(periods: number[]): number {
  let gap = 0;
  for (let i = 1; i < periods.length; i++) gap += Math.max(0, periods[i] - periods[i - 1] - 1);
  return gap;
}

/** Long gaps: free runs of length >= threshold inside a day. */
function longGapCount(periods: number[], threshold: number): number {
  let count = 0;
  for (let i = 1; i < periods.length; i++) {
    const gap = periods[i] - periods[i - 1] - 1;
    if (gap >= threshold && gap > 0) count++;
  }
  return count;
}

function dayStats(schedule: any[], byId: (l: any) => string | undefined, id: string, day: string) {
  const periods = dayPeriodsOf(schedule, byId, id, day);
  if (periods.length === 0) return null;
  return {
    first: periods[0],
    last: periods[periods.length - 1],
    gap: gapOfPeriods(periods),
    count: periods.length,
  };
}

interface DailyCompact {
  /** Penalty from gaps (normalized rates summed). Smaller is better. */
  gapBurden: number;
  /** Number of long gaps (teacher + class). */
  longGaps: number;
  /** Number of sparse days (teacher + class). */
  sparseDays: number;
  /** Raw counts for reporting. */
  teacherGaps: number;
  classGaps: number;
}

/**
 * LEVEL 2 metric family (worker v0.4 spec §5-§8). Combines teacher + class daily
 * compactness into ONE structural block: normalized gap burden, then long gaps,
 * then sparse days. `dailyCompactness` is the normalized sum of teacher-gap rate,
 * class-gap rate, and early/late rate (each normalized to the entity's own lesson
 * count) so a big school does not inherently score worse than a small one (§6).
 */
function computeDailyCompactness(
  schedules: SemesterSchedules,
  project: ProjectState
): DailyCompact {
  const teacherIds = new Set<string>();
  const classIds = new Set<string>();
  for (const sem of [schedules.semester1.schedule, schedules.semester2.schedule]) {
    for (const lesson of sem) {
      if (lesson.teacherId) teacherIds.add(lesson.teacherId);
      classIds.add(lesson.groupId);
    }
  }

  const policy = project.schedulePolicy;
  const longGapThreshold = policy?.longGapThreshold ?? DEFAULT_LONG_GAP_THRESHOLD;
  const teacherEarly = policy?.earlyLate?.teacher?.preferredStartPeriod ?? 1;
  const teacherLate = policy?.earlyLate?.teacher?.preferredEndPeriod ?? 8;
  const classEarly = policy?.earlyLate?.class?.preferredStartPeriod ?? 1;
  const classLate = policy?.earlyLate?.class?.preferredEndPeriod ?? 8;

  let teacherGaps = 0;
  let classGaps = 0;
  let teacherPeriods = 0;
  let classPeriods = 0;
  let longGaps = 0;
  let sparseDays = 0;
  let earlyLate = 0;

  for (const sem of [schedules.semester1.schedule, schedules.semester2.schedule]) {
    for (const day of DAYS) {
      for (const id of teacherIds) {
        const stats = dayStats(sem, (l) => l.teacherId, id, day);
        if (!stats) continue;
        teacherGaps += stats.gap;
        teacherPeriods += stats.count;
        const periods = teacherDayPeriods(sem, id, day);
        longGaps += longGapCount(periods, longGapThreshold);
        if (stats.count === 1) sparseDays++;
        if (stats.first < teacherEarly) earlyLate += teacherEarly - stats.first;
        if (stats.last > teacherLate) earlyLate += stats.last - teacherLate;
      }
      for (const id of classIds) {
        const stats = dayStats(sem, (l) => l.groupId, id, day);
        if (!stats) continue;
        classGaps += stats.gap;
        classPeriods += stats.count;
        const periods = classDayPeriods(sem, id, day);
        longGaps += longGapCount(periods, longGapThreshold);
        if (stats.count === 1) sparseDays++;
        if (stats.first < classEarly) earlyLate += classEarly - stats.first;
        if (stats.last > classLate) earlyLate += stats.last - classLate;
      }
    }
  }

  const teacherGapRate = teacherPeriods > 0 ? teacherGaps / teacherPeriods : 0;
  const classGapRate = classPeriods > 0 ? classGaps / classPeriods : 0;
  const totalPeriods = teacherPeriods + classPeriods;
  const earlyLateRate = totalPeriods > 0 ? earlyLate / totalPeriods : 0;

  return {
    gapBurden: teacherGapRate + classGapRate + earlyLateRate,
    longGaps,
    sparseDays,
    teacherGaps,
    classGaps,
  };
}

/**
 * LEVEL 3: weekly subject distribution (spec §9). For each (class, subject) pair
 * with `weeklyCount` lessons on `occupiedDays` days, penalize concentration onto
 * too few / adjacent days. A double lesson is treated as a single block, not as
 * two independent singles.
 */
function computeSubjectDistributionPenalty(schedules: SemesterSchedules): number {
  let penalty = 0;

  const accounting = (sem: any[]) => {
    // groupId|subjectId -> { day -> count }
    const map = new Map<string, Map<string, number>>();
    for (const lesson of sem) {
      const key = `${lesson.groupId}|${lesson.subjectId}`;
      if (!map.has(key)) map.set(key, new Map());
      const dayCount = map.get(key)!;
      dayCount.set(lesson.day, (dayCount.get(lesson.day) || 0) + 1);
    }
    for (const dayCount of map.values()) {
      const weeklyCount = [...dayCount.values()].reduce((s, c) => s + c, 0);
      const occupiedDays = dayCount.size;
      const daysArr = [...dayCount.keys()];
      if (occupiedDays <= 1 || weeklyCount <= 1) continue;
      // Ideal spread: one lesson per occupied day, spaced apart. Penalize
      // adjacency: each adjacent pair of occupied days adds a small penalty.
      const dayIndex = daysArr.map((d) => DAYS.indexOf(d)).sort((a, b) => a - b);
      let adjacency = 0;
      for (let i = 1; i < dayIndex.length; i++) {
        adjacency += Math.max(0, 2 - (dayIndex[i] - dayIndex[i - 1]));
      }
      // Penalty grows when lessons are crammed onto too few days relative to
      // what the weekly count could support.
      const underSpread = Math.max(0, Math.min(weeklyCount, 5) - occupiedDays);
      penalty += adjacency + underSpread;
    }
  };

  accounting(schedules.semester1.schedule);
  accounting(schedules.semester2.schedule);
  return penalty;
}

/**
 * LEVEL 4: parallelization (spec §10-§14). For each parallel group, compare the
 * subject→day structure of sibling classes by Jaccard-style similarity. Only
 * subjects that both classes share (comparable) count; the penalty is higher for
 * exact parallels and lower for adjacent grades absent an explicit parallel list.
 */
function computeParallelizationPenalty(
  schedules: SemesterSchedules,
  project: ProjectState
): number {
  const parallelGroups = project.parallelGroups;
  const groupGrade = new Map((project.groups || []).map((g) => [g.id, g.grade ?? 0]));
  const explicit = parallelGroups && parallelGroups.length > 0;

  // classId -> subjectId -> Set<day>
  const subjectDays = (sem: any[]): Map<string, Map<string, Set<string>>> => {
    const map = new Map<string, Map<string, Set<string>>>();
    for (const lesson of sem) {
      if (!map.has(lesson.groupId)) map.set(lesson.groupId, new Map());
      const sm = map.get(lesson.groupId)!;
      if (!sm.has(lesson.subjectId)) sm.set(lesson.subjectId, new Set());
      sm.get(lesson.subjectId)!.add(lesson.day);
    }
    return map;
  };

  const s1 = subjectDays(schedules.semester1.schedule);
  const s2 = subjectDays(schedules.semester2.schedule);
  const combine = (a: Map<string, Map<string, Set<string>>>, b: Map<string, Map<string, Set<string>>>) => {
    const out = new Map<string, Map<string, Set<string>>>();
    for (const [gid, smap] of a) {
      const merged = new Map(smap);
      const other = b.get(gid);
      if (other) {
        for (const [sid, days] of other) {
          if (!merged.has(sid)) merged.set(sid, new Set());
          const dd = merged.get(sid)!;
          for (const d of days) dd.add(d);
        }
      }
      out.set(gid, merged);
    }
    return out;
  };
  const all = combine(s1, s2);

  // Gather comparable pairs: explicit parallels first, then adjacent grades.
  const pairs: { a: string; b: string; weight: number }[] = [];
  const seen = new Set<string>();
  const add = (a: string, b: string, w: number) => {
    const key = [a, b].sort().join('|');
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ a, b, weight: w });
  };

  if (explicit) {
    for (const pg of parallelGroups) {
      const list = pg.groupIds;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          add(list[i], list[j], 1.0);
        }
      }
    }
    // Adjacent-grade pairs still get a weaker link even when explicit parallels exist.
    const grades = [...new Set((project.groups || []).map((g) => g.grade ?? 0))].sort((a, b) => a - b);
    for (const [gid, grade] of groupGrade) {
      if (!grades.includes(grade + 1)) continue;
      for (const oid of groupGrade.keys()) {
        if (groupGrade.get(oid) === grade + 1) add(gid, oid, 0.25);
      }
      if (!grades.includes(grade - 1)) continue;
      for (const oid of groupGrade.keys()) {
        if (groupGrade.get(oid) === grade - 1) add(gid, oid, 0.25);
      }
    }
  } else {
    // Back-compat: derive parallels from grade (v4-01 fallback).
    const groupIds = [...groupGrade.keys()];
    for (let i = 0; i < groupIds.length; i++) {
      for (let j = i + 1; j < groupIds.length; j++) {
        if (groupGrade.get(groupIds[i]) === groupGrade.get(groupIds[j])) {
          add(groupIds[i], groupIds[j], 1.0);
        } else if (Math.abs(groupGrade.get(groupIds[i])! - groupGrade.get(groupIds[j])!) === 1) {
          add(groupIds[i], groupIds[j], 0.25);
        }
      }
    }
  }

  let penalty = 0;
  for (const { a, b, weight } of pairs) {
    const ma = all.get(a);
    const mb = all.get(b);
    if (!ma || !mb) continue;
    let common = 0;
    let comparable = 0;
    for (const sid of new Set([...ma.keys(), ...mb.keys()])) {
      const da = ma.get(sid);
      const db = mb.get(sid);
      if (da && db) {
        comparable += Math.max(da.size, db.size);
        for (const d of da) if (db.has(d)) common++;
      }
    }
    if (comparable > 0) {
      const similarity = common / comparable;
      penalty += (1 - similarity) * weight;
    }
  }
  return penalty;
}

/**
 * LEVEL 5: age / shift structure (spec §15-§17). Penalize classes whose lessons
 * fall outside their band's preferred time zone, and anomalous mixing. Soft only.
 */
function computeAgeShiftPenalty(schedules: SemesterSchedules, project: ProjectState): number {
  const policy = project.schedulePolicy;
  const bands: AgeGroupPolicy[] = policy?.ageGroups ?? [];
  if (bands.length === 0) return 0;

  const gradeOf = new Map((project.groups || []).map((g) => [g.id, g.grade ?? 0]));
  const bandFor = (grade: number): AgeGroupPolicy | undefined =>
    bands.find((b) => b.grades.includes(grade));

  let penalty = 0;
  for (const sem of [schedules.semester1.schedule, schedules.semester2.schedule]) {
    for (const lesson of sem) {
      const band = bandFor(gradeOf.get(lesson.groupId) ?? -1);
      if (!band) continue;
      const { min, max } = band.preferredPeriods;
      if (lesson.period < min) penalty += min - lesson.period;
      if (lesson.period > max) penalty += lesson.period - max;
    }
    // Anomalous age mixing within a day: count each lesson whose neighbours on
    // the same day come from a different band than its own. Weighted lightly.
    const classBands = new Map<string, { day: string; period: number; band: number }[]>();
    for (const lesson of sem) {
      const band = bandFor(gradeOf.get(lesson.groupId) ?? -1);
      if (!band) continue;
      if (!classBands.has(lesson.day)) classBands.set(lesson.day, []);
      classBands.get(lesson.day)!.push({ day: lesson.day, period: lesson.period, band: band.preferredPeriods.min });
    }
    for (const list of classBands.values()) {
      list.sort((a, b) => a.period - b.period);
      for (let i = 1; i < list.length; i++) {
        if (Math.abs(list[i].band - list[i - 1].band) > 2) penalty += 0.5;
      }
    }
  }
  return penalty;
}

/**
 * LEVEL 6: room stability (spec §20) + assignment movement (spec §21).
 * `roomStabilityPenalty` penalizes a lesson not using its preferred/current room
 * when one is available. `assignmentMovementPenalty` prefers moving freshly-
 * assigned lessons over long-lived ones (soft).
 */
function computeStabilityPenalties(
  schedules: SemesterSchedules,
  project: ProjectState
): { roomStabilityPenalty: number; assignmentMovementPenalty: number } {
  const ruleById = new Map((project.curriculum || []).map((r) => [r.id, r]));

  // Determine each lesson's preferred room order: the rule's layered policy first
  // (required > preferred > acceptable > fallback), then the legacy `roomId` as
  // the sole required room when no policy is present. Prepending the lesson's own
  // assigned room here would make the metric constant (a lesson always sits first
  // next to itself), so the order reflects the rule's intent, not the placement.
  const preferredRooms = (rule: CurriculumRule): string[] => {
    const order: string[] = [];
    const seen = new Set<string>();
    const push = (ids?: string[]) => {
      for (const id of ids || []) {
        if (id && !seen.has(id)) {
          seen.add(id);
          order.push(id);
        }
      }
    };
    const rp = rule.roomPolicy;
    if (rp) {
      push(rp.required);
      push(rp.preferred);
      push(rp.acceptable);
      push(rp.fallback);
    } else if (rule.roomId) {
      push([rule.roomId]);
    }
    return order;
  };

  let roomStability = 0;
  let movement = 0;
  let total = 0;
  for (const sem of [schedules.semester1.schedule, schedules.semester2.schedule]) {
    for (const lesson of sem) {
      total++;
      const rule = ruleById.get(lesson.ruleId);
      if (!rule) continue;
      const order = preferredRooms(rule);
      // A lesson in the top (required) room gets 0; further down the policy ladder
      // gets +1 per step; a room not in the policy at all (or no room assigned) is
      // the most stable-violating case and gets the full ladder length.
      if (order.length === 0) continue;
      const idx = lesson.roomId ? order.indexOf(lesson.roomId) : -1;
      roomStability += idx < 0 ? order.length : idx;
      // Movement: every assignment that differs from the rule's default room adds
      // a small stability penalty (prefer keeping assigned rooms).
      movement += lesson.roomId && rule.roomId && lesson.roomId !== rule.roomId ? 1 : 0;
    }
  }
  return {
    roomStabilityPenalty: total > 0 ? roomStability / Math.max(1, total) : 0,
    assignmentMovementPenalty: movement,
  };
}

/** LEVEL 7 (spec §22): minor residual preferences; never dominates. */
function computeMinorPreferencePenalty(
  schedules: SemesterSchedules,
  _project: ProjectState
): number {
  // Cheap deterministic minor signal: prefer using as few distinct rooms as
  // possible (predictable). A curriculum normally routes each subject to one
  // stable room, so spreading lessons across many rooms is a soft residue. An
  // empty schedule (0 distinct rooms) and a single-room schedule both score 0.
  const roomsUsed = new Set<string>();
  for (const sem of [schedules.semester1.schedule, schedules.semester2.schedule]) {
    for (const lesson of sem) {
      if (lesson.roomId) roomsUsed.add(lesson.roomId);
    }
  }
  return Math.max(0, roomsUsed.size - 1);
}

/**
 * Build the canonical lexicographic score vector for a generated result
 * (worker v0.4 spec §23/§44). Every field is a penalty (smaller is better); the
 * ordering in `compareScores` prioritises completeness (spec §4) before any soft
 * objective, then the LEVEL groups in strict order.
 *
 * `splits` is retained for signature stability with `buildScore`/`scoreAttempt`
 * and future per-semester metrics; it does not currently contribute a LEVEL.
 */
export function buildScheduleScore(
  schedules: SemesterSchedules,
  _splits: SemesterSplit[],
  project: ProjectState,
  pinnedRuleIds?: Set<string>
): ScheduleScore {
  const unscheduledLessons = countUnassigned(schedules.semester1) + countUnassigned(schedules.semester2);
  const scheduledLessons = schedules.semester1.schedule.length + schedules.semester2.schedule.length;

  const pinnedUnassigned =
    (schedules.semester1.conflicts || [])
      .filter((c) => c.type === 'UNASSIGNED_HOURS' && c.ruleId && pinnedRuleIds?.has(c.ruleId))
      .reduce((sum, c) => sum + (c.missing ?? 1), 0) +
    (schedules.semester2.conflicts || [])
      .filter((c) => c.type === 'UNASSIGNED_HOURS' && c.ruleId && pinnedRuleIds?.has(c.ruleId))
      .reduce((sum, c) => sum + (c.missing ?? 1), 0);

  const daily = computeDailyCompactness(schedules, project);

  return {
    unscheduledLessons,
    pinnedUnassigned,
    dailyCompactness: daily.gapBurden,
    longGapPenalty: daily.longGaps,
    sparseDayPenalty: daily.sparseDays,
    subjectDistributionPenalty: computeSubjectDistributionPenalty(schedules),
    parallelizationPenalty: computeParallelizationPenalty(schedules, project),
    ageShiftPenalty: computeAgeShiftPenalty(schedules, project),
    ...computeStabilityPenalties(schedules, project),
    minorPreferencePenalty: computeMinorPreferencePenalty(schedules, project),
    scheduledLessons,
  };
}

/**
 * The single canonical lexicographic score comparison (worker v0.4 spec §44).
 * Returns a positive number when `a` is strictly better than `b`, negative when
 * worse, and 0 when equal. Completeness is the first objective, then the LEVEL
 * groups in strict order.
 */
export function compareScores(a: ScheduleScore, b: ScheduleScore): number {
  const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const fields: (keyof ScheduleScore)[] = [
    'unscheduledLessons',
    'pinnedUnassigned',
    'dailyCompactness',
    'longGapPenalty',
    'sparseDayPenalty',
    'subjectDistributionPenalty',
    'parallelizationPenalty',
    'ageShiftPenalty',
    'roomStabilityPenalty',
    'assignmentMovementPenalty',
    'minorPreferencePenalty',
  ];
  for (const key of fields) {
    const diff = Number(b[key]) - Number(a[key]);
    if (diff !== 0) return sign(diff);
  }
  return 0;
}

/**
 * Scalar projection of the score vector for display and the legacy numeric
 * `scoreAttempt` API. Ordering is consistent with `compareScores` for the
 * ordinary completeness-then-quality cases the UI reports.
 */
export function scoreVectorToNumber(score: ScheduleScore): number {
  return (
    score.scheduledLessons * SCALAR_LESSON -
    score.unscheduledLessons -
    score.pinnedUnassigned * SCALAR_PINNED -
    score.dailyCompactness * SCALAR_COMPACT -
    score.longGapPenalty * SCALAR_LONG_GAP -
    score.sparseDayPenalty * SCALAR_SPARSE -
    score.subjectDistributionPenalty * SCALAR_DISTRIBUTION -
    score.parallelizationPenalty * SCALAR_PARALLEL -
    score.ageShiftPenalty * SCALAR_AGE -
    score.roomStabilityPenalty * SCALAR_ROOM -
    score.assignmentMovementPenalty * SCALAR_MOVE -
    score.minorPreferencePenalty * SCALAR_MINOR
  );
}

/**
 * Compare curriculum splits purely by the (non-)existence of a rule, mirroring
 * the analysis used across the engine. Retained here so score logic has a single
 * home for the fraction/load helpers used elsewhere.
 */
export function rulePath(rule: CurriculumRule): string {
  return `${rule.groupId}|${rule.subjectId}`;
}
