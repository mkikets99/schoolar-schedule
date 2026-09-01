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
  capacity?: number;
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

export interface GenerateSettings {
  /** Number of candidate schedules to generate and keep the best of. */
  attempts: number;
  /** How many times unplaced lessons may be re-distributed between semesters. */
  maxSpillPasses: number;
  /** How many improvement passes run to shrink teacher free gaps after placement. */
  optimizePasses?: number;
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
}

/**
 * Automatic per-rule daily lesson limit derived from the load distribution.
 *
 * A lesson may appear at most once per day when its weekly load is 5 hours or
 * less, and at most twice per day when the load exceeds 5 hours. Rules marked
 * `doubleLesson` always keep their pair allowance (2 lessons per day). Returns
 * `undefined` when no load-distribution entry matches the rule, so only an
 * explicit MAX_DAILY_LESSONS constraint can limit it.
 */
export function autoMaxPerDay(rule: CurriculumRule, loadDistribution: LoadDistribution[]): number | undefined {
  if (!loadDistribution || loadDistribution.length === 0) return undefined;
  let matches = loadDistribution.filter(
    (l) => l.groupId === rule.groupId && l.subjectId === rule.subjectId
  );
  if (rule.teacherId) {
    const byTeacher = matches.filter((l) => l.teacherId === rule.teacherId);
    if (byTeacher.length > 0) matches = byTeacher;
  }
  if (matches.length === 0) return undefined;
  const hours = matches.reduce((sum, l) => sum + (l.hours || 0), 0);
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
  | 'RESULT' 
  | 'ERROR' 
  | 'UPDATE_CONSTRAINTS' 
  | 'CANCEL';

export interface WorkerMessage {
  type: WorkerMessageType;
  payload?: any;
}
