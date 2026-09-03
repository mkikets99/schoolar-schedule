/**
 * Core Data Models for Schoolar Schedule
 */

export interface School {
  id: string;
  name: string;
  address?: string;
}

export interface AcademicYear {
  id: string;
  name: string; // e.g., "2023/2024"
  startDate: string;
  endDate: string;
}

export interface Teacher {
  id: string;
  name: string;
  shortName?: string;
  subjects: string[]; // Subject IDs
  color?: string;
  /**
   * How many groups this teacher may work with in the same time slot
   * simultaneously. A single teacher usually supervises one group at a time
   * (default), but a co-teacher or hall supervisor may handle several classes
   * at once. Undefined means 1.
   */
  maxGroups?: number;
}

export interface Subject {
  id: string;
  name: string;
  shortName?: string;
  color?: string;
}

export interface Room {
  id: string;
  name: string;
  /**
   * How many groups may occupy the room in the same slot simultaneously.
   * Most rooms fit one group (default), but shared facilities such as a
   * gymnasium or PE hall host several classes at once. Undefined means 1.
   */
  maxGroups?: number;
  types: string[]; // e.g., "lab", "classroom", "gym"
}

export interface Group {
  id: string;
  name: string;
  grade: number;
  subgroups: string[];
  parentGroupId?: string;
  periodStart?: number;
  periodEnd?: number;
  maxDailyLessons?: number;
}

export interface CurriculumRule {
  id: string;
  groupId: string;
  subjectId: string;
  hoursPerWeek: number;
  teacherId?: string; // Default teacher
  roomId?: string; // Default room
  doubleLesson?: boolean; // Prefer consecutive double lessons when scheduling
}

export interface LoadDistribution {
  teacherId: string;
  subjectId: string;
  groupId: string;
  hours: number;
}

export type ConstraintKind = 'TEACHER_BUSY' | 'NO_FIRST_PERIOD' | 'FORBID_LESSON' | 'MAX_DAILY_LESSONS';

export interface Constraint {
  id: string;
  kind: ConstraintKind;
  teacherId?: string; // TEACHER_BUSY: teacher that is unavailable
  day?: string; // TEACHER_BUSY: weekday key or '*' for every day
  periods?: number[]; // TEACHER_BUSY: blocked periods of the day
  subjectId?: string; // NO_FIRST_PERIOD: subject that cannot be the first lesson
  groupId?: string; // NO_FIRST_PERIOD: optional scope (all groups when empty)
  ruleId?: string; // FORBID_LESSON: the curriculum rule (lesson) this applies to
  semester?: 1 | 2; // FORBID_LESSON: the semester whose hour count is being set
  hours?: number; // FORBID_LESSON: hours distributed in that semester (0 = forbidden)
  maxPerDay?: number; // MAX_DAILY_LESSONS: max times this rule may appear in one day
}

export interface Lesson {
  id: string;
  ruleId: string;
  groupId: string;
  subjectId: string;
  teacherId?: string;
  roomId?: string;
  day: string;
  period: number;
}

export interface ScheduleResult {
  schedule: Lesson[];
  conflicts: any[];
  score: number;
}

export interface SemesterSplit {
  ruleId: string;
  hoursPerWeek: number; // annual weekly average
  first: number; // semester 1 weekly lessons
  second: number; // semester 2 weekly lessons
}

export interface SemesterSchedules {
  semester1: ScheduleResult;
  semester2: ScheduleResult;
}

/**
 * A lesson pinned in place for future generations. Identified by the curriculum
 * rule and the exact slot so it survives regeneration (lesson ids are re-rolled
 * every run). `semester` scopes the pin to one semester; a lock without a
 * semester applies to both (legacy single-schedule projects).
 */
export interface LockedLesson {
  ruleId: string;
  day: string;
  period: number;
  semester?: 'semester1' | 'semester2';
}

/** How the schedule grid filters lessons: an entity kind and its id. */
export interface ScheduleFilter {
  type: 'all' | 'group' | 'teacher' | 'subject';
  id: string;
}

export interface GroupScheduleConfig {
  periodStart: number;
  periodEnd: number;
  maxDaily: number;
}

/**
 * Resolve a group's effective scheduling window.
 *
 * `maxDailyLessons` is interpreted as the number of lessons per day, anchored at
 * the start of the shift. The latest lesson therefore ends at
 * `periodStart + maxDailyLessons - 1`. The shift's own `periodEnd` is the hard
 * upper bound and can only reduce the window.
 */
export function computeGroupScheduleConfig(group: Partial<Group> | undefined): GroupScheduleConfig {
  const periodStart = group?.periodStart ?? 1;
  const shiftEnd = group?.periodEnd ?? 8;
  const maxDaily = group?.maxDailyLessons ?? 8;
  const derivedEnd = periodStart + maxDaily - 1;
  const periodEnd = Math.min(shiftEnd, derivedEnd);
  const cappedMax = Math.min(maxDaily, periodEnd - periodStart + 1);
  return { periodStart, periodEnd, maxDaily: cappedMax };
}

/**
 * How the generator is driven. `runs` generates one candidate schedule per
 * `attempts` and keeps the best; `time` is the anytime mode from worker v0.3
 * that keeps improving against a marching `generationTimeMs` deadline and
 * returns the best schedule found before it fires. The default remains `runs`
 * so existing callers keep their deterministic attempt-count behaviour.
 */
export type GenerationMode = 'runs' | 'time';

export interface GenerateSettings {
  /**
   * Driver mode. `runs` uses `attempts`; `time` uses `generationTimeMs`.
   * Defaults to `runs` when unset for backward compatibility.
   */
  mode?: GenerationMode;
  /**
   * Number of candidate schedules to generate and keep the best of (mode `runs`).
   * `-1` means Unlimited: keep generating until the user cancels (a CANCEL is
   * issued to the worker) - there is no fixed denominator, so progress shows the
   * attempt count rather than a percent.
   */
  attempts: number;
  /**
   * Generation deadline in milliseconds (mode `time`). The anytime optimizer
   * builds the initial schedule, then repeatedly improves it and preserves the
   * best valid result until `generationTimeMs` elapses, at which point that
   * best schedule is returned. Defaults to 20000 when unset in time mode.
   * `-1` means Unlimited: improve until the user cancels.
   */
  generationTimeMs?: number;
  /**
   * How many times unplaced lessons may be re-distributed between semesters.
   * `-1` means Unlimited; the pass naturally stops when no lesson can be moved
   * any further.
   */
  maxSpillPasses: number;
  /**
   * Optional secondary rearrange search budget (mode `runs`). A per-call node
   * ceiling so interactive edit-mode rearrange stays responsive even when no
   * time budget is set. Omitted (or `null`) and `-1` mean the engine only
   * respects the time/deadline (or its own guard rails) exactly as the worker
   * v0.3 spec requires.
   */
  maxRearrangeNodes?: number;
  /**
   * How many improvement passes run to shrink teacher free gaps after placement.
   * `-1` means Unlimited; the pass stops on its own once no swap improves the
   * schedule.
   */
  optimizePasses?: number;
}

/**
 * A lexicographic schedule score vector (worker v0.3 spec §4/§23). Every field
 * is written so that a *smaller* value is *better*; the canonical ordering walks
 * them in priority order and higher is better by overall comparison. The first
 * field is completeness, so a complete but lower-quality timetable always beats
 * an incomplete one - never the reverse (spec §36 / acceptance Test 7).
 */
export interface ScheduleScore {
  /** Total unresolved lessons across both semesters (0 = complete). Smaller is better. */
  unscheduledLessons: number;
  /** Pending hours for FORBID_LESSON-pinned rules (heavily weighted tie-break). */
  pinnedUnassigned: number;
  /** Sum of every teacher's weekly free-hour gaps across both semesters. */
  teacherTotalGapLength: number;
  /** Number of teachers whose weekly gap exceeds the "bad" threshold. */
  teacherLongGapCount: number;
  /** Number of single-lesson teacher days (sparse-day penalty). */
  sparseTeacherDayCount: number;
  /** Penalty for deviation from the intended per-semester load distribution. */
  distributionPenalty: number;
  /** Total number of placed lessons (informational; kept last for display). */
  scheduledLessons: number;
}

/** Per-attempt generation progress report sent from the worker. */
export interface ProgressPayload {
  /** Overall completion in the 0-100 range. */
  progress: number;
  /** The attempt ordinal (1-based) this report belongs to (mode `runs`). */
  attempt?: number;
  /** Total number of attempts being run (mode `runs`). */
  attempts?: number;
  /** Best candidate quality achieved so far (informational scalar). */
  bestQuality?: number;
  /** The active generator driver mode, so the UI can label progress correctly. */
  mode?: GenerationMode;
}

/** A single additional lesson relocation suggested by the rearrangement engine. */
export interface RearrangeMove {
  lessonId: string;
  toDay: string;
  toPeriod: number;
  teacherId?: string;
}

/**
 * Why an edit-mode move was rejected. Mirrors the hard constraints that no
 * combination of relocations or a substitute teacher can satisfy. When
 * `feasible` is false and no reason is set, the engine gave up after trying
 * every resolution (usually a blocker lesson that could not be relocated).
 */
export type RearrangeBlockReason =
  | 'GROUP_SLOT' // the group already has a lesson in the target slot
  | 'NO_FIRST_PERIOD' // the subject cannot be the first lesson of the day
  | 'DAILY_OVERLOAD' // the group already has its max lessons for that day
  | 'DAILY_RULE' // the rule already has its max lessons for that day
  | 'TEACHER_BUSY' // the teacher is unavailable at that slot
  | 'SPLIT_PARTNER' // a colliding lesson is a split/double partner and can't move
  | 'NO_SPACE'; // no relocation or substitute could open the slot

/**
 * Outcome of an edit-mode lesson move request. `feasible` false means the target
 * slot cannot be reached without violating constraints; `moves` lists the extra
 * relocations the user must accept alongside the primary move, and
 * `teacherIdForMain` (when set) reassigns the moved lesson to another teacher.
 * `reason` explains the rejection so the UI can tell the user which fixed rule
 * is being broken.
 */
export interface RearrangeSuggestion {
  feasible: boolean;
  moves: RearrangeMove[];
  teacherIdForMain?: string;
  reason?: RearrangeBlockReason;
}

export interface ProjectState {
  version: string;
  school: School;
  academicYears: AcademicYear[];
  teachers: Teacher[];
  subjects: Subject[];
  rooms: Room[];
  groups: Group[];
  curriculum: CurriculumRule[];
  loadDistribution: LoadDistribution[];
  constraints: Constraint[];
  generatedSchedule?: ScheduleResult; // legacy single-schedule results (older exports)
  generatedSchedules?: SemesterSchedules;
  generatedSplits?: SemesterSplit[];
  lockedLessons?: LockedLesson[]; // lessons pinned against future generation
}

/**
 * Automatic per-rule daily lesson limit.
 *
 * A lesson may appear at most once per day when its weekly load is 5 hours or
 * less, and at most twice per day when the load exceeds 5 hours. Rules marked
 * `doubleLesson` always keep their pair allowance (2 lessons per day).
 *
 * The weekly load is read from the load distribution when it establishes one for
 * the rule (matched by group+subject, narrowed to its own teacher for split
 * rules). When the distribution is absent or establishes no load, the rule's own
 * `hoursPerWeek` is used as a fallback so heavy rules - including each subgroup
 * of a split subject - still get a sensible automatic daily cap. Returns
 * `undefined` only when nothing establishes a positive weekly load.
 */
export function autoMaxPerDay(rule: CurriculumRule, loadDistribution: LoadDistribution[]): number | undefined {
  let hours = 0;
  if (loadDistribution && loadDistribution.length > 0) {
    let matches = loadDistribution.filter(
      (l) => l.groupId === rule.groupId && l.subjectId === rule.subjectId
    );
    if (rule.teacherId) {
      const byTeacher = matches.filter((l) => l.teacherId === rule.teacherId);
      if (byTeacher.length > 0) matches = byTeacher;
    }
    hours = matches.reduce((sum, l) => sum + (l.hours || 0), 0);
  }
  // Fall back to the rule's own weekly hours so the cap still follows the rule.
  if (!(hours > 0) && (rule.hoursPerWeek || 0) > 0) hours = rule.hoursPerWeek;
  if (!(hours > 0)) return undefined;
  if (rule.doubleLesson) return 2;
  return hours > 5 ? 2 : 1;
}

/**
 * Resolve the effective per-rule daily lesson limit. Explicit
 * MAX_DAILY_LESSONS constraints win; otherwise the load-distribution-derived
 * automatic limit from {@link autoMaxPerDay} applies.
 */
export function buildMaxDailyByRule(
  project: Pick<ProjectState, 'curriculum' | 'constraints' | 'loadDistribution'>
): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of project.constraints || []) {
    if (c.kind === 'MAX_DAILY_LESSONS' && c.ruleId && c.maxPerDay && c.maxPerDay > 0) {
      map.set(c.ruleId, c.maxPerDay);
    }
  }
  for (const rule of project.curriculum || []) {
    if (map.has(rule.id)) continue;
    const auto = autoMaxPerDay(rule, project.loadDistribution || []);
    if (auto !== undefined) map.set(rule.id, auto);
  }
  return map;
}

export type WorkerMessageType = 
  | 'INIT' 
  | 'READY' 
  | 'GENERATE_SCHEDULE' 
  | 'PROGRESS' 
  | 'LOG' 
  | 'REARRANGE' 
  | 'REARRANGE_RESULT' 
  | 'RESULT' 
  | 'ERROR' 
  | 'UPDATE_CONSTRAINTS' 
  | 'CANCEL';

export interface WorkerMessage {
  type: WorkerMessageType;
  payload?: any;
}

/**
 * A single human-readable action line emitted by the generator while it works,
 * e.g. "Building semester 1…", "Gap optimization pass 3/8", "Attempt 5/20
 * complete (best quality 12)". Displayed in the generation log modal - much like
 * an installer's step list. `pct` (when present) snapshots progress at emit time.
 */
export interface GenerationLogEntry {
  id: number;
  /** Wall-clock time (ms since epoch) the entry was created on the worker. */
  time: number;
  /** Level drives the icon/badge colour in the log view (like an installer). */
  level: 'info' | 'step' | 'success' | 'warn';
  /** English, human-readable action text produced by the worker. */
  message: string;
  /** Optional snapshot of overall progress at emit time. */
  pct?: number;
  /** Optional "attempt x / y" context for easier scanning. */
  attempt?: number;
  attempts?: number;
}
