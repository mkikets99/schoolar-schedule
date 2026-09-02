import { CurriculumRule, ProjectState, SemesterSchedules, SemesterSplit, ScheduleScore } from '../shared/types';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const BAD_TEACHER_GAP_HOURS = 5;

// Scalar weights used ONLY to turn the lexicographic vector into a single
// display number (`bestQuality` / the per-attempt numeric report). The vector
// itself (compareScores) is the single canonical decision rule; the scalar is a
// monotone projection that preserves its ordering for the cases the UI shows.
const SCALAR_LESSON = 1000;
const SCALAR_PINNED = 500;
const SCALAR_GAP_HOUR = 10;
const SCALAR_BAD_TEACHER = 500;

export function countUnassigned<
  T extends { conflicts?: any[] },
>(result: T): number {
  return (result.conflicts || [])
    .filter((c) => c?.type === 'UNASSIGNED_HOURS')
    .reduce((sum, c) => sum + (c.missing ?? 1), 0);
}

function dayPeriodsOf(schedule: any[], teacherId: string, day: string): number[] {
  const out: number[] = [];
  for (const lesson of schedule) {
    if (lesson.teacherId === teacherId && lesson.day === day) out.push(lesson.period);
  }
  out.sort((a, b) => a - b);
  return out;
}

/** Free periods strictly between the first and last lesson of a day. */
function gapOfPeriods(periods: number[]): number {
  let gap = 0;
  for (let i = 1; i < periods.length; i++) gap += Math.max(0, periods[i] - periods[i - 1] - 1);
  return gap;
}

function teacherWeekGap(schedule: any[], teacherId: string): number {
  let total = 0;
  for (const day of DAYS) total += gapOfPeriods(dayPeriodsOf(schedule, teacherId, day));
  return total;
}

interface TeacherDay {
  gap: number;
  count: number;
}

function teacherDayStats(schedule: any[], teacherId: string, day: string): TeacherDay {
  const periods = dayPeriodsOf(schedule, teacherId, day);
  return { gap: gapOfPeriods(periods), count: periods.length };
}

/** Per-semester lesson load per teacher and per group (half an annual hour each). */
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

/**
 * Build the canonical lexicographic score vector for a generated result
 * (worker v0.3 spec §23). Every field is a penalty (smaller is better); the
 * ordering in `compareScores` prioritises completeness (spec §4/§36) before any
 * soft objective.
 */
export function buildScheduleScore(
  schedules: SemesterSchedules,
  splits: SemesterSplit[],
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

  const allLessonIds = new Set<string>();
  for (const lesson of [...schedules.semester1.schedule, ...schedules.semester2.schedule]) {
    if (lesson.teacherId) allLessonIds.add(lesson.teacherId);
  }

  let teacherTotalGapLength = 0;
  let teacherLongGapCount = 0;
  let sparseTeacherDayCount = 0;
  for (const teacherId of allLessonIds) {
    const week1 = teacherWeekGap(schedules.semester1.schedule, teacherId);
    const week2 = teacherWeekGap(schedules.semester2.schedule, teacherId);
    teacherTotalGapLength += week1 + week2;
    if (week1 > BAD_TEACHER_GAP_HOURS) teacherLongGapCount++;
    if (week2 > BAD_TEACHER_GAP_HOURS) teacherLongGapCount++;
    for (const sem of [schedules.semester1.schedule, schedules.semester2.schedule]) {
      for (const day of DAYS) {
        const stats = teacherDayStats(sem, teacherId, day);
        if (stats.count === 1) sparseTeacherDayCount++;
      }
    }
  }

  const intended = intendedLoads(project, splits);
  const actualTeacher = new Map<string, { s1: number; s2: number }>();
  const actualGroup = new Map<string, { s1: number; s2: number }>();
  const tally = (sem: any[], isSem1: boolean) => {
    for (const lesson of sem) {
      if (lesson.teacherId) {
        const t = actualTeacher.get(lesson.teacherId) || { s1: 0, s2: 0 };
        if (isSem1) t.s1++;
        else t.s2++;
        actualTeacher.set(lesson.teacherId, t);
      }
      const g = actualGroup.get(lesson.groupId) || { s1: 0, s2: 0 };
      if (isSem1) g.s1++;
      else g.s2++;
      actualGroup.set(lesson.groupId, g);
    }
  };
  tally(schedules.semester1.schedule, true);
  tally(schedules.semester2.schedule, false);
  let distributionPenalty = 0;
  for (const [id, t] of intended.teacher) {
    const a = actualTeacher.get(id) || { s1: 0, s2: 0 };
    distributionPenalty += Math.abs(t.s1 - a.s1) + Math.abs(t.s2 - a.s2);
  }
  for (const [id, g] of intended.group) {
    const a = actualGroup.get(id) || { s1: 0, s2: 0 };
    distributionPenalty += Math.abs(g.s1 - a.s1) + Math.abs(g.s2 - a.s2);
  }

  return {
    unscheduledLessons,
    pinnedUnassigned,
    teacherTotalGapLength,
    teacherLongGapCount,
    sparseTeacherDayCount,
    distributionPenalty,
    scheduledLessons,
  };
}

/**
 * The single canonical lexicographic score comparison (worker v0.3 spec §24).
 * Returns a positive number when `a` is strictly better than `b`, negative when
 * worse, and 0 when equal. Completeness is the first objective, then teacher gap
 * totals, then long-gap counts, sparse days, and finally distribution penalty.
 */
export function compareScores(a: ScheduleScore, b: ScheduleScore): number {
  const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const fields: (keyof ScheduleScore)[] = [
    'unscheduledLessons',
    'pinnedUnassigned',
    'teacherTotalGapLength',
    'teacherLongGapCount',
    'sparseTeacherDayCount',
    'distributionPenalty',
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
 * ordinary completeness-then-gap cases the UI reports.
 */
export function scoreVectorToNumber(score: ScheduleScore): number {
  return (
    score.scheduledLessons * SCALAR_LESSON -
    score.unscheduledLessons -
    score.pinnedUnassigned * SCALAR_PINNED -
    score.teacherTotalGapLength * SCALAR_GAP_HOUR -
    score.teacherLongGapCount * SCALAR_BAD_TEACHER -
    score.sparseTeacherDayCount -
    score.distributionPenalty * 0.01
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