import { ProjectState, CurriculumRule, WorkerMessage, SemesterSplit, SemesterSchedules, ScheduleResult, computeGroupScheduleConfig, GroupScheduleConfig, GenerateSettings, buildMaxDailyByRule, RearrangeMove, LockedLesson, ScheduleScore, GenerationLogEntry } from '../shared/types';
import { RearrangeContext, createRearrangeContext, resolveUnplacedPlacement } from './rearrange';
import { buildScheduleScore, compareScores, scoreVectorToNumber } from './score';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

// Monotonic counter for the generation log entries. Process-wide so ids stay
// unique even if a worker ticks many entries during one run.
let logSeq = 0;

/**
 * Emit a human-readable action line (like an installer step) so the UI log
 * modal can show *what* the generator is doing, not only a percent. These are
 * plain English strings produced on the worker (no i18n here); the UI renders
 * them verbatim in the log list.
 */
function emitLog(
  emit: (msg: WorkerMessage) => void,
  level: GenerationLogEntry['level'],
  message: string,
  extra: Partial<Omit<GenerationLogEntry, 'id' | 'time' | 'level' | 'message'>> = {}
): void {
  emit({
    type: 'LOG',
    payload: {
      id: ++logSeq,
      time: Date.now(),
      level,
      message,
      ...extra,
    } as GenerationLogEntry,
  });
}

// ---------------------------------------------------------------------------
// Gap-optimization model (worker v0.2)
//
// The primary quality goal is teacher compactness: a teacher's weekly schedule
// should have as few free (empty) periods between their first and last lesson
// of a day as possible - ideally zero. Gaps are only acceptable when they are
// unavoidable (a teacher, class, or room collision forces them), and the
// generator aims for the least total free hours. Any teacher left with more
// than BAD_TEACHER_GAP_HOURS free hours in a week makes the whole schedule a
// "bad solution": it is only kept when every alternative is worse (i.e. it is
// a forced solution).
// ---------------------------------------------------------------------------

const BAD_TEACHER_GAP_HOURS = 5; // weekly free hours that turn a teacher "bad"
const DEFAULT_OPTIMIZE_PASSES = 8; // local-search rounds after greedy placement

interface LessonStub {
  id: string;
  ruleId: string;
  groupId: string;
  subjectId: string;
  teacherId?: string;
  roomId?: string;
}

interface SchedulingUnit {
  type: 'single' | 'split' | 'double';
  groupId: string;
  lessons: LessonStub[];
}

function unitSlotCount(unit: SchedulingUnit): number {
  return unit.type === 'double' ? 2 : 1;
}

// Small deterministic PRNG so each generation attempt explores a different
// placement order while remaining reproducible for a given seed.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

// ---------------------------------------------------------------------------
// Post-placement auto-resolve: reuse the rearrange engine at generation time to
// recover lessons the greedy pass left unassigned. A lesson whose every direct
// slot failed is retried through resolveUnplacedPlacement, which may relocate a
// same-teacher or same-room occupant of a target slot while keeping every
// placed lesson constraint-valid. Runs only when a schedule has UNASSIGNED_HOURS.
// ---------------------------------------------------------------------------

function applyMoveList(schedule: any[], moves: RearrangeMove[]): void {
  for (const move of moves) {
    const lesson = schedule.find((l: any) => l.id === move.lessonId);
    if (!lesson) continue;
    lesson.day = move.toDay;
    lesson.period = move.toPeriod;
    if (move.teacherId) lesson.teacherId = move.teacherId;
  }
}

function tryPlaceUnassignedOne(
  ctx: RearrangeContext,
  schedule: any[],
  rule: CurriculumRule,
  start: number,
  end: number,
  nodeBudget?: number
): boolean {
  for (const day of DAYS) {
    for (let period = start; period <= end; period++) {
      const suggestion = resolveUnplacedPlacement(
        ctx,
        schedule,
        {
          id: crypto.randomUUID(),
          ruleId: rule.id,
          groupId: rule.groupId,
          subjectId: rule.subjectId,
          teacherId: rule.teacherId,
          roomId: rule.roomId,
          day: 'Monday',
          period: 1,
        },
        { day, period },
        nodeBudget
      );
      if (!suggestion.feasible || suggestion.moves.length === 0) continue;
      const main = suggestion.moves[0];
      applyMoveList(schedule, suggestion.moves);
      schedule.push({
        id: main.lessonId,
        ruleId: rule.id,
        groupId: rule.groupId,
        subjectId: rule.subjectId,
        teacherId: rule.teacherId,
        roomId: rule.roomId,
        day: main.toDay,
        period: main.toPeriod,
      });
      return true;
    }
  }
  return false;
}

/**
 * Post-pass for one generated semester: try to turn every UNASSIGNED_HOURS
 * conflict into a placed lesson by relocating colliding lessons. The conflict
 * list is rewritten in place, `missing` reduced by one per recovered lesson.
 * A no-op when there is nothing to resolve.
 */
export function autoResolveUnassigned(project: ProjectState, schedule: any[], conflicts: any[], nodeBudget?: number): void {
  if (!(conflicts || []).some((c) => c?.type === 'UNASSIGNED_HOURS')) return;

  const ctx = createRearrangeContext(project);
  const ruleById = new Map(project.curriculum.map((r) => [r.id, r]));
  const windows = new Map<string, { start: number; end: number }>();
  for (const g of project.groups || []) {
    const cfg = computeGroupScheduleConfig(g);
    windows.set(g.id, { start: cfg.periodStart, end: cfg.periodEnd });
  }

  const kept: any[] = [];
  for (const conflict of conflicts) {
    // Conflicts marked `locked` come from unhonorable locks: the lesson is
    // pinned to its slot and must never be auto-resolved somewhere else.
    if (conflict?.type !== 'UNASSIGNED_HOURS' || !conflict.ruleId || conflict.locked) {
      kept.push(conflict);
      continue;
    }
    const rule = ruleById.get(conflict.ruleId);
    if (!rule) {
      kept.push(conflict);
      continue;
    }
    const window = windows.get(rule.groupId) || { start: 1, end: 8 };
    let missing = conflict.missing ?? 1;
    let guard = 0;
    while (missing > 0 && guard < 25) {
      guard++;
      if (!tryPlaceUnassignedOne(ctx, schedule, rule, window.start, window.end, nodeBudget)) break;
      missing--;
    }
    if (missing > 0) kept.push({ ...conflict, missing });
  }
  conflicts.length = 0;
  conflicts.push(...kept);
}

// ---------------------------------------------------------------------------
// Teacher gap accounting
// ---------------------------------------------------------------------------

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

function teacherDayGap(schedule: any[], teacherId: string, day: string): number {
  return gapOfPeriods(dayPeriodsOf(schedule, teacherId, day));
}

function teacherWeekGap(schedule: any[], teacherId: string): number {
  let total = 0;
  for (const day of DAYS) total += teacherDayGap(schedule, teacherId, day);
  return total;
}

/** How much adding extra periods on `day` changes the teacher's free-hour count. */
function extraPeriodsGapDelta(schedule: any[], teacherId: string, day: string, extra: number[]): number {
  if (!teacherId) return 0;
  const current = dayPeriodsOf(schedule, teacherId, day);
  const merged = [...new Set([...current, ...extra])].sort((a, b) => a - b);
  return gapOfPeriods(merged) - gapOfPeriods(current);
}

function teacherGapReport(schedule: any[]): { totalGapHours: number; badTeachers: string[]; teachers: { id: string; weekGap: number }[] } {
  const ids = [...new Set(schedule.map((l) => l.teacherId).filter(Boolean))];
  const teachers = ids
    .map((id) => ({ id, weekGap: teacherWeekGap(schedule, id) }))
    .sort((a, b) => b.weekGap - a.weekGap || a.id.localeCompare(b.id));
  const totalGapHours = teachers.reduce((s, t) => s + t.weekGap, 0);
  const badTeachers = teachers.filter((t) => t.weekGap > BAD_TEACHER_GAP_HOURS).map((t) => t.id);
  return { totalGapHours, badTeachers, teachers };
}

/**
 * Build the canonical lexicographic score vector for a candidate. Selection uses
 * {@link compareScores}; this also exposes the vector for tests/UI.
 */
export function buildScore(
  schedules: SemesterSchedules,
  splits: SemesterSplit[],
  project: ProjectState,
  pinnedRuleIds?: Set<string>
): ScheduleScore {
  return buildScheduleScore(schedules, splits, project, pinnedRuleIds);
}

/**
 * Scalar projection of the lexicographic vector, retained for display
 * (`bestQuality`) and the existing numeric-assertion tests. The ordering of this
 * scalar matches `compareScores` for the completeness-then-gap cases the engine
 * reports, but the canonical decision rule is always {@link compareScores}.
 */
export function scoreAttempt(schedules: SemesterSchedules, splits: SemesterSplit[], project: ProjectState, pinnedRuleIds?: Set<string>): number {
  return scoreVectorToNumber(buildScheduleScore(schedules, splits, project, pinnedRuleIds));
}

export async function generateSchedule(project: ProjectState, emit: (msg: WorkerMessage) => void) {
  const result = await runGenerate(project, emit);
  emit({
    type: 'RESULT',
    payload: { ...result, teacherGapStats: teacherGapReport(result.schedule) },
  });
}

// Perturbation profiles (worker v0.4 spec §36): each full attempt runs with a
// different tie-break bias so the search explores distinct regions while every
// candidate is still compared by the same canonical ScheduleScore.
export type AttemptProfile = 'conservative' | 'parallel' | 'compact' | 'age' | 'random';

export const ATTEMPT_PROFILES: AttemptProfile[] = ['conservative', 'parallel', 'compact', 'age', 'random'];

async function runGenerate(
  project: ProjectState,
  emit: (msg: WorkerMessage) => void,
  rng?: () => number,
  pinnedRuleIds?: Set<string>,
  optimizePasses = DEFAULT_OPTIMIZE_PASSES,
  nodeBudget?: number,
  profile: AttemptProfile = 'conservative'
): Promise<{ schedule: any[]; conflicts: any[]; score: number }> {
  const days = DAYS;

  const groupConfig = new Map<string, GroupScheduleConfig>();
  for (const group of project.groups || []) {
    groupConfig.set(group.id, computeGroupScheduleConfig(group));
  }

  const groupGrade = new Map<string, number>();
  for (const group of project.groups || []) {
    groupGrade.set(group.id, group.grade ?? 0);
  }

  emit({ type: 'PROGRESS', payload: { progress: 2 } });

  const teacherBusyRules: { teacherId: string; day: string; periods: Set<number> }[] = [];
  const noFirstRules: { subjectId: string; groupId?: string }[] = [];
  for (const c of project.constraints || []) {
    if (c.kind === 'TEACHER_BUSY' && c.teacherId && c.periods && c.periods.length > 0) {
      teacherBusyRules.push({ teacherId: c.teacherId, day: c.day || '*', periods: new Set(c.periods) });
    } else if (c.kind === 'NO_FIRST_PERIOD' && c.subjectId) {
      noFirstRules.push({ subjectId: c.subjectId, groupId: c.groupId });
    }
  }

  // Per-rule daily lesson limits: explicit MAX_DAILY_LESSONS constraints win,
  // otherwise the limit is derived automatically from the load distribution
  // (>5 weekly hours -> 2 lessons/day, otherwise 1/day, doubles keep a pair).
  const maxDailyByRule = buildMaxDailyByRule(project);

  // Locked lessons reserve their exact rule + slot for the whole generation: no
  // other unit of that rule may be placed there (greedy or auto-resolve), and a
  // lock that does not fit stays locked - the lesson is reported unassigned
  // instead of silently moving elsewhere.
  const lockedSlotsByRule = new Map<string, Set<string>>();
  for (const lock of project.lockedLessons || []) {
    if (!DAYS.includes(lock.day) || !(lock.period >= 1 && lock.period <= 12)) continue;
    if (!lockedSlotsByRule.has(lock.ruleId)) lockedSlotsByRule.set(lock.ruleId, new Set());
    lockedSlotsByRule.get(lock.ruleId)!.add(`${lock.day}-${lock.period}`);
  }

  // A room may host several groups in the same slot simultaneously (e.g. PE in
  // a gymnasium). maxGroups defaults to 1 when unset, matching the historical
  // strict one-group-per-room-per-slot behaviour.
  const maxGroupsByRoom = new Map<string, number>();
  for (const room of project.rooms || []) {
    maxGroupsByRoom.set(room.id, Math.max(1, room.maxGroups ?? 1));
  }

  // A teacher may also supervise several groups in one slot (e.g. a co-teacher).
  // maxGroups defaults to 1 when unset, matching the historical strict
  // one-group-per-teacher-per-slot behaviour.
  const maxGroupsByTeacher = new Map<string, number>();
  for (const teacher of project.teachers || []) {
    maxGroupsByTeacher.set(teacher.id, Math.max(1, teacher.maxGroups ?? 1));
  }

  const groupBusy = new Set<string>();
  // roomId-slotKey -> set of groupIds currently in that room at that slot.
  const roomBusy = new Map<string, Set<string>>();
  // teacherId-slotKey -> set of groupIds this teacher teaches at that slot.
  const teacherOccupancy = new Map<string, Set<string>>();

  const splitKeys = new Set<string>();
  const seen = new Map<string, CurriculumRule[]>();
  for (const rule of project.curriculum) {
    const key = `${rule.groupId}|${rule.subjectId}`;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key)!.push(rule);
    if (seen.get(key)!.length > 1) splitKeys.add(key);
  }

  let units: SchedulingUnit[] = [];

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
      if (rule.doubleLesson) {
        const totalLessons = Math.floor(rule.hoursPerWeek);
        const pairs = Math.floor(totalLessons / 2);
        const leftover = totalLessons % 2;
        for (let p = 0; p < pairs; p++) {
          units.push({
            type: 'double',
            groupId,
            lessons: [1, 2].map(() => ({
              id: crypto.randomUUID(),
              ruleId: rule.id,
              groupId: rule.groupId,
              subjectId: rule.subjectId,
              teacherId: rule.teacherId,
              roomId: rule.roomId,
            })),
          });
        }
        for (let h = 0; h < leftover; h++) {
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
      } else {
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
  }

  const groupLessonTotals = new Map<string, number>();
  for (const unit of units) {
    groupLessonTotals.set(unit.groupId, (groupLessonTotals.get(unit.groupId) || 0) + unitSlotCount(unit));
  }

  const dailyTargets = new Map<string, number[]>();
  for (const [gid, total] of groupLessonTotals) {
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
  for (const gid of groupLessonTotals.keys()) {
    dailyCounts.set(gid, days.map(() => 0));
  }

  const ruleDailyCounts = new Map<string, number[]>();
  for (const ruleId of maxDailyByRule.keys()) {
    ruleDailyCounts.set(ruleId, days.map(() => 0));
  }

  const teacherDailyCounts = new Map<string, number[]>();
  for (const t of project.teachers || []) {
    teacherDailyCounts.set(t.id, days.map(() => 0));
  }

  // v4-34: most-constrained-first heuristic ordering. Signals are static (computed
  // once per generation run, not per attempt): fewer feasible slots, fewer room
  // options, a teacher shared across many rules, higher weekly frequency, doubles
  // and locked-slot rules all place earlier so the greedy engine builds around the
  // tightest items first. This is a heuristic only - placement still validates hard
  // invariants, and final choice stays lexicographic on ScheduleScore.
  const teacherRuleCounts = new Map<string, number>();
  for (const rule of project.curriculum || []) {
    if (!rule.teacherId) continue;
    teacherRuleCounts.set(rule.teacherId, (teacherRuleCounts.get(rule.teacherId) || 0) + 1);
  }
  const ruleLockCounts = new Map<string, number>();
  for (const lock of project.lockedLessons || []) {
    if (!lock.ruleId || !DAYS.includes(lock.day) || !(lock.period >= 1 && lock.period <= 12)) continue;
    ruleLockCounts.set(lock.ruleId, (ruleLockCounts.get(lock.ruleId) || 0) + 1);
  }
  const constraintOf = new Map<string, { slots: number; rooms: number; share: number; freq: number; locks: number }>();
  for (const unit of units) {
    const cfg = groupConfig.get(unit.groupId);
    const periodStart = cfg?.periodStart ?? 1;
    const hi = (cfg?.periodEnd ?? 12) - (unit.type === 'double' ? 1 : 0);
    let slots = 0;
    for (const day of DAYS) {
      for (let p = periodStart; p <= hi; p++) {
        if (
          p === periodStart &&
          unit.lessons.some((l) => noFirstRules.some((r) => r.subjectId === l.subjectId && (!r.groupId || r.groupId === unit.groupId)))
        ) {
          continue;
        }
        if (unit.lessons.some((l) => l.teacherId && isBusyRule(teacherBusyRules, l.teacherId, day, p))) continue;
        if (unit.type === 'double' && unit.lessons.some((l) => l.teacherId && isBusyRule(teacherBusyRules, l.teacherId, day, p + 1))) continue;
        slots++;
      }
    }
    const rooms = new Set<string>();
    for (const lesson of unit.lessons) {
      for (const r of roomCandidatesFor(lesson, DAYS[0], periodStart)) rooms.add(r);
      if (lesson.roomId) rooms.add(lesson.roomId);
    }
    const share = Math.max(...unit.lessons.map((l) => (l.teacherId ? teacherRuleCounts.get(l.teacherId) || 0 : 0)));
    const locks = Math.max(...unit.lessons.map((l) => ruleLockCounts.get(l.ruleId) || 0));
    constraintOf.set(unit.lessons[0].id, { slots, rooms: rooms.size, share, freq: unit.lessons.length, locks });
  }

  units.sort((a, b) => {
    // v4-34 uses *genuinely* tight units first (few feasible slots, few room
    // options, many locked slots). Soft signals (shared teacher, weekly frequency)
    // stay below the legacy grade->daily-limit->double chain so pre-existing
    // grade-ordering behaviour is preserved for otherwise-unconstrained boards.
    const ca = constraintOf.get(a.lessons[0].id);
    const cb = constraintOf.get(b.lessons[0].id);
    if (ca && cb) {
      if (ca.slots !== cb.slots) return ca.slots - cb.slots;
      if (ca.rooms !== cb.rooms) return ca.rooms - cb.rooms;
      if (ca.locks !== cb.locks) return cb.locks - ca.locks;
    }
    const ga = groupGrade.get(a.groupId) ?? 0;
    const gb = groupGrade.get(b.groupId) ?? 0;
    if (ga !== gb) return ga - gb;
    const la = groupConfig.get(a.groupId)?.maxDaily ?? 8;
    const lb = groupConfig.get(b.groupId)?.maxDaily ?? 8;
    if (la !== lb) return la - lb;
    const da = a.type === 'double' ? 0 : 1;
    const db = b.type === 'double' ? 0 : 1;
    if (da !== db) return da - db;
    const ta = groupLessonTotals.get(a.groupId) || 0;
    const tb = groupLessonTotals.get(b.groupId) || 0;
    if (ta !== tb) return tb - ta;
    const aa = a.lessons[0]?.teacherId || '';
    const ab = b.lessons[0]?.teacherId || '';
    if (aa !== ab) return aa.localeCompare(ab);
    // v4-34 soft tie-breaks: a teacher shared across many rules and higher weekly
    // frequency place first within an otherwise-identical bucket.
    if (ca && cb) {
      if (ca.share !== cb.share) return cb.share - ca.share;
      if (ca.freq !== cb.freq) return cb.freq - ca.freq;
    }
    return a.lessons[0]?.id.localeCompare(b.lessons[0]?.id || '') || 0;
  });

  // Units are processed by the priority chain above; the per-attempt shuffle only
  // scrambles the order *within* a fully-tied bucket so every attempt still
  // satisfies those priorities.
  const shuffleTieBuckets = (arr: SchedulingUnit[], rngFn: () => number): SchedulingUnit[] => {
    const out: SchedulingUnit[] = [];
    let run: SchedulingUnit[] = [];
    let lastKey = '';
    for (const u of arr) {
      const c = constraintOf.get(u.lessons[0].id);
      const key = `${c ? `${c.slots}|${c.rooms}|${c.locks}|${c.share}|${c.freq}` : ''}|${groupGrade.get(u.groupId) ?? 0}|${groupConfig.get(u.groupId)?.maxDaily ?? 8}|${u.type === 'double' ? 0 : 1}|${groupLessonTotals.get(u.groupId) || 0}|${u.lessons[0]?.teacherId || ''}`;
      if (key !== lastKey && run.length > 0) {
        shuffleInPlace(run, rngFn);
        out.push(...run);
        run = [];
      }
      lastKey = key;
      run.push(u);
    }
    if (run.length > 0) {
      shuffleInPlace(run, rngFn);
      out.push(...run);
    }
    return out;
  };

  if (rng && pinnedRuleIds && pinnedRuleIds.size > 0) {
    const pinned: SchedulingUnit[] = [];
    const rest: SchedulingUnit[] = [];
    for (const u of units) {
      (pinnedRuleIds.has(u.lessons[0].ruleId) ? pinned : rest).push(u);
    }
    shuffleInPlace(pinned, rng);
    units = pinned.concat(shuffleTieBuckets(rest, rng));
  } else if (rng) {
    units = shuffleTieBuckets(units, rng);
  }

  const schedule: any[] = [];
  const conflicts: any[] = [];
  let totalUnits = units.length;
  let unitsAssigned = 0;

  emit({ type: 'PROGRESS', payload: { progress: 5 } });

  function isTeacherBusyRule(teacherId: string, day: string, period: number): boolean {
    for (const rule of teacherBusyRules) {
      if (rule.teacherId !== teacherId) continue;
      if (rule.day !== '*' && rule.day !== day) continue;
      if (rule.periods.has(period)) return true;
    }
    return false;
  }

  // Ordered room candidates for a lesson in a given slot, respecting the
  // layered room policy (worker v0.4 §18-§19): required > preferred >
  // acceptable > fallback > the rule's legacy roomId. A candidate room only
  // counts when it still has capacity for the group at the slot (or the group is
  // already in it - a split/double partner re-using the room).
  function roomCandidatesFor(lesson: LessonStub, day: string, period: number): string[] {
    const slotKey = `${day}-${period}`;
    const capOk = (roomId: string) => {
      const occupants = roomBusy.get(`${roomId}-${slotKey}`);
      if (!occupants) return true;
      return occupants.has(lesson.groupId) || occupants.size < (maxGroupsByRoom.get(roomId) ?? 1);
    };
    const out: string[] = [];
    const seen = new Set<string>();
    const push = (id?: string) => {
      if (id && !seen.has(id)) {
        seen.add(id);
        if (capOk(id)) out.push(id);
      }
    };
    const pushAll = (ids?: string[]) => {
      for (const id of ids || []) push(id);
    };

    const lessonRule = project.curriculum.find((r) => r.id === lesson.ruleId);
    const rp = lessonRule?.roomPolicy;
    if (rp) {
      pushAll(rp.required);
      pushAll(rp.preferred);
      pushAll(rp.acceptable);
      pushAll(rp.fallback);
    }
    push(lesson.roomId); // legacy required room always remains a candidate
    return out;
  }

  function isForbiddenFirstPeriod(lesson: LessonStub, period: number, periodStart: number): boolean {
    if (period !== periodStart) return false;
    return noFirstRules.some(r =>
      r.subjectId === lesson.subjectId && (!r.groupId || r.groupId === lesson.groupId)
    );
  }

  function canPlace(lesson: LessonStub, day: string, period: number, skipGroupCheck: boolean, allowLockedRuleSlot = false): boolean {
    const slotKey = `${day}-${period}`;
    const lockedRuleSlot = lockedSlotsByRule.get(lesson.ruleId);
    if (lockedRuleSlot && lockedRuleSlot.has(slotKey) && !allowLockedRuleSlot) return false;
    if (!skipGroupCheck && groupBusy.has(`${lesson.groupId}-${slotKey}`)) return false;
    // A teacher may teach up to maxGroups groups in the same slot. Its own
    // group already occupying the slot (e.g. a split/double partner) is always
    // allowed; a new group needs spare capacity.
    if (lesson.teacherId) {
      const occupants = teacherOccupancy.get(`${lesson.teacherId}-${slotKey}`);
      if (occupants && occupants.size >= (maxGroupsByTeacher.get(lesson.teacherId) ?? 1) && !occupants.has(lesson.groupId)) {
        return false;
      }
    }
    if (lesson.teacherId && isTeacherBusyRule(lesson.teacherId, day, period)) return false;
    const cfg = groupConfig.get(lesson.groupId);
    if (isForbiddenFirstPeriod(lesson, period, cfg?.periodStart ?? 1)) return false;
    const cap = maxDailyByRule.get(lesson.ruleId);
    if (cap !== undefined) {
      const di = days.indexOf(day);
      const counts = ruleDailyCounts.get(lesson.ruleId)!;
      if (counts[di] >= cap) return false;
    }
    // Room policy (worker v0.4 §19): if ANY room in the layered policy (or the
    // legacy forced room) is free in this slot, the placement is valid - do not
    // rebuild the schedule just because the preferred room is occupied. A room
    // that only lacks capacity rejects; the same group re-entering a room it
    // already occupies (a split partner) is always allowed.
    if (roomCandidatesFor(lesson, day, period).length === 0) {
      // No room candidate at all only when the rule has no room AND policy is
      // empty, which is a valid "no room" placement.
      const lessonRule = project.curriculum.find((r) => r.id === lesson.ruleId);
      const hasRoomSetup = !!lesson.roomId || !!lessonRule?.roomPolicy;
      if (hasRoomSetup) return false;
    }
    return true;
  }

  function placeLesson(lesson: LessonStub, day: string, period: number) {
    const slotKey = `${day}-${period}`;
    // Choose the best available room for this slot per the layered policy.
    const roomId = roomCandidatesFor(lesson, day, period)[0] ?? lesson.roomId;

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

    const groupSlotKey = `${lesson.groupId}-${slotKey}`;
    const firstInSlot = !groupBusy.has(groupSlotKey);
    groupBusy.add(groupSlotKey);
    if (lesson.teacherId) {
      const tk = `${lesson.teacherId}-${slotKey}`;
      if (!teacherOccupancy.has(tk)) teacherOccupancy.set(tk, new Set());
      teacherOccupancy.get(tk)!.add(lesson.groupId);
    }
    if (roomId) {
      const rk = `${roomId}-${slotKey}`;
      if (!roomBusy.has(rk)) roomBusy.set(rk, new Set());
      roomBusy.get(rk)!.add(lesson.groupId);
    }

    const di = days.indexOf(day);
    if (di >= 0) {
      if (firstInSlot) {
        const counts = dailyCounts.get(lesson.groupId);
        if (counts) counts[di]++;
      }
      if (lesson.teacherId) {
        const tcounts = teacherDailyCounts.get(lesson.teacherId);
        if (tcounts) tcounts[di]++;
      }
      const rcounts = ruleDailyCounts.get(lesson.ruleId);
      if (rcounts) rcounts[di]++;
    }
  }

  function tryPlaceDouble(unit: SchedulingUnit, day: string, period: number, allowLockedRuleSlot = false): boolean {
    const lesson = unit.lessons[0];
    const cfg = groupConfig.get(unit.groupId);
    const pEnd = cfg?.periodEnd ?? 8;
    if (period + 1 > pEnd) return false;
    const cap = maxDailyByRule.get(lesson.ruleId);
    if (cap !== undefined) {
      const di = days.indexOf(day);
      const counts = ruleDailyCounts.get(lesson.ruleId)!;
      if (counts[di] + 2 > cap) return false;
    }
    if (!canPlace(lesson, day, period, false, allowLockedRuleSlot)) return false;
    if (!canPlace(lesson, day, period + 1, false, allowLockedRuleSlot)) return false;
    placeLesson(lesson, day, period);
    placeLesson(unit.lessons[1], day, period + 1);
    return true;
  }

  function placeAsSingles(unit: SchedulingUnit) {
    for (const lesson of unit.lessons) {
      let placed = false;
      for (const day of days) {
        if (placed) break;
        const counts = dailyCounts.get(unit.groupId);
        const maxDaily = groupConfig.get(unit.groupId)?.maxDaily ?? 8;
        if ((counts?.[days.indexOf(day)] ?? 0) >= maxDaily) continue;
        const ordered = getPeriodsForGroup(unit.groupId);
        for (const p of ordered) {
          if (canPlace(lesson, day, p, false)) {
            placeLesson(lesson, day, p);
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        conflicts.push({ type: 'UNASSIGNED_HOURS', ruleId: lesson.ruleId, missing: 1 });
      }
    }
  }

  function tryPlaceUnit(unit: SchedulingUnit, day: string, period: number, allowLockedRuleSlot = false): boolean {
    if (unit.type === 'single') {
      if (!canPlace(unit.lessons[0], day, period, false, allowLockedRuleSlot)) return false;
      placeLesson(unit.lessons[0], day, period);
      return true;
    }

    if (unit.type === 'double') {
      return tryPlaceDouble(unit, day, period, allowLockedRuleSlot);
    }

    const first = unit.lessons[0];
    if (groupBusy.has(`${first.groupId}-${day}-${period}`)) return false;

    const counts = dailyCounts.get(unit.groupId);
    const maxDaily = groupConfig.get(unit.groupId)?.maxDaily ?? 8;
    if (counts && counts[days.indexOf(day)] + unitSlotCount(unit) > maxDaily) return false;

    for (const lesson of unit.lessons) {
      if (!canPlace(lesson, day, period, true, allowLockedRuleSlot)) return false;
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

  function classDayPeriods(groupId: string, day: string): number[] {
    const out: number[] = [];
    for (const lesson of schedule) {
      if (lesson.groupId === groupId && lesson.day === day) out.push(lesson.period);
    }
    out.sort((a, b) => a - b);
    return out;
  }

  function gradeAdjacencyScore(unit: SchedulingUnit, day: string, period: number): number {
    const grade = groupGrade.get(unit.groupId);
    if (grade === undefined) return 0;
    const near = unit.type === 'double' ? [period - 1, period + 2] : [period - 1, period + 1];
    let score = 0;
    for (const s of schedule) {
      if (s.groupId === unit.groupId) continue;
      if (s.day !== day) continue;
      if (!near.includes(s.period)) continue;
      if (groupGrade.get(s.groupId) === grade) score++;
    }
    return score;
  }

  function teacherDayBonus(unit: SchedulingUnit, di: number): number {
    let bonus = 0;
    for (const lesson of unit.lessons) {
      if (!lesson.teacherId) continue;
      const counts = teacherDailyCounts.get(lesson.teacherId);
      if (counts && counts[di] === 1) bonus = 2;
    }
    return bonus;
  }

  // How much a candidate slot would change the teacher's free-hour count. A
  // negative value means the placement fills an existing gap; zero keeps the
  // teacher gap-free (or starts a new day); a positive value creates new free
  // hours and is the last option.
  function placementGapDelta(unit: SchedulingUnit, day: string, period: number): number {
    const extra = unit.type === 'double' ? [period, period + 1] : [period];
    const seen = new Set<string>();
    let delta = 0;
    for (const lesson of unit.lessons) {
      if (!lesson.teacherId || seen.has(lesson.teacherId)) continue;
      seen.add(lesson.teacherId);
      delta += extraPeriodsGapDelta(schedule, lesson.teacherId, day, extra);
    }
    return delta;
  }

  // Class-side analogue of placementGapDelta: how much a candidate slot changes
  // the *group's* daily free-hour count (worker v0.4 §5.2). Same-day class gaps
  // finally become a real objective during slot ordering.
  function classGapDelta(unit: SchedulingUnit, day: string, period: number): number {
    const current = classDayPeriods(unit.groupId, day);
    const extra = unit.type === 'double' ? [period, period + 1] : [period];
    const merged = [...new Set([...current, ...extra])].sort((a, b) => a - b);
    return gapOfPeriods(merged) - gapOfPeriods(current);
  }

  // Subject-spread preference (worker v0.4 §9): prefer a slot on a day where the
  // rule already has lessons (spreads out) over a day where it does not yet
  // have lessons that would cram the week.
  function subjectSpreadScore(unit: SchedulingUnit, day: string): number {
    const today = days.indexOf(day);
    let score = 0;
    for (const lesson of schedule) {
      if (lesson.ruleId === unit.lessons[0]?.ruleId) {
        score += today === days.indexOf(lesson.day) ? 2 : -1;
      }
    }
    return score;
  }

  function getOrderedPeriods(unit: SchedulingUnit, day: string): number[] {
    const base = getPeriodsForGroup(unit.groupId);
    return base.slice().sort((a, b) => {
      const ga = placementGapDelta(unit, day, a);
      const gb = placementGapDelta(unit, day, b);
      if (ga !== gb) return ga - gb;
      const ca = classGapDelta(unit, day, a);
      const cb = classGapDelta(unit, day, b);
      if (ca !== cb) return ca - cb;
      const sa = gradeAdjacencyScore(unit, day, a);
      const sb = gradeAdjacencyScore(unit, day, b);
      if (sa !== sb) return sb - sa;
      // Profile-driven tie-break (v4-38): parallel prefers to mirror the day a
      // sibling parallel set already uses; compact leans toward period 1 (early);
      // age leans toward the band's preferred window; random just jitters.
      if (profile === 'parallel') {
        const pa = parallelMirrorScore(unit, day, a);
        const pb = parallelMirrorScore(unit, day, b);
        if (pa !== pb) return pb - pa;
      }
      if (profile === 'age') {
        const aa = agePreferenceScore(unit, a);
        const ab = agePreferenceScore(unit, b);
        if (aa !== ab) return ab - aa;
      }
      if (profile === 'compact') {
        const esA = Math.abs(a - (groupConfig.get(unit.groupId)?.periodStart ?? 1));
        const esB = Math.abs(b - (groupConfig.get(unit.groupId)?.periodStart ?? 1));
        if (esA !== esB) return esA - esB;
      }
      if (profile === 'random') return (rng ? rng() - 0.5 : 0);
      return (a - b) + (rng ? rng() - 0.5 : 0);
    });
  }

  // How well a slot aligns with the age/shift band for the unit's grade
  // (v4-38 'age' profile; soft heuristic only, never a hard rule).
  function agePreferenceScore(unit: SchedulingUnit, period: number): number {
    const policy = project.schedulePolicy?.ageGroups;
    if (!policy || policy.length === 0) return 0;
    const grade = groupGrade.get(unit.groupId);
    if (grade === undefined) return 0;
    for (const band of policy) {
      if (!band.grades.includes(grade)) continue;
      const { min, max } = band.preferredPeriods;
      return period >= min && period <= max ? 1 : 0;
    }
    return 0;
  }

  // Parallel mirroring (v4-38 'parallel' profile): a slot scores higher when a
  // sibling parallel group already has the same subject that day (soft).
  function parallelMirrorScore(unit: SchedulingUnit, day: string, period: number): number {
    const pg = (project.parallelGroups || []).find((p) => p.groupIds.includes(unit.groupId));
    if (!pg) return 0;
    const siblings = pg.groupIds.filter((g) => g !== unit.groupId).map((g) => new Set(
      schedule.filter((l) => l.groupId === g && l.day === day && l.period === period).map((l) => l.subjectId)
    ));
    let score = 0;
    for (const lesson of unit.lessons) {
      if (siblings.some((s) => s.has(lesson.subjectId))) score++;
    }
    return score;
  }

  // Locked lessons are pinned before greedy placement: each lock consumes one
  // matching unit placed at its exact slot (so every other lesson avoids the
  // group/teacher/room there). A lock that cannot be honored stays LOCKED - the
  // lesson is reported unassigned (conflict) instead of being moved elsewhere,
  // and its slot stays reserved for the rule.
  const lockedSlots = new Set<string>();
  if (project.lockedLessons && project.lockedLessons.length > 0) {
    const lockByRule = new Map<string, LockedLesson[]>();
    for (const lock of project.lockedLessons) {
      if (!DAYS.includes(lock.day) || !(lock.period >= 1 && lock.period <= 12)) continue;
      if (!lockByRule.has(lock.ruleId)) lockByRule.set(lock.ruleId, []);
      lockByRule.get(lock.ruleId)!.push(lock);
    }
    const placedUnits = new Set<SchedulingUnit>();
    for (const [ruleId, locks] of lockByRule) {
      for (const lock of locks) {
        // Match a unit that carries this rule among its lessons. For split
        // subjects a unit contains one lesson per sub-rule (teachers rotate), so
        // `lessons[0]` only ever matches the *first* sub-rule; a lock on a later
        // sub-rule must still pin that split unit or it is silently dropped.
        const unit = units.find(
          (u) => !placedUnits.has(u) && u.lessons.some((l) => l.ruleId === ruleId)
        );
        if (!unit) continue;
        // A locked slot outside the group's lesson window cannot be honored.
        const lockCfg = groupConfig.get(unit.groupId);
        if (lock.period < (lockCfg?.periodStart ?? 1) || lock.period > (lockCfg?.periodEnd ?? 8)) {
          placedUnits.add(unit);
          conflicts.push({ type: 'UNASSIGNED_HOURS', ruleId, missing: 1, locked: true });
          continue;
        }
        // allowLockedRuleSlot=true lets the lock claim its own reserved slot; the
        // greedy loop below is barred from it via canPlace.
        if (tryPlaceUnit(unit, lock.day, lock.period, true)) {
          placedUnits.add(unit);
          unitsAssigned++;
          lockedSlots.add(`${ruleId}|${lock.day}|${lock.period}`);
        } else {
          placedUnits.add(unit);
          conflicts.push({ type: 'UNASSIGNED_HOURS', ruleId, missing: 1, locked: true });
        }
      }
    }
    if (placedUnits.size > 0) {
      units = units.filter((u) => !placedUnits.has(u));
      totalUnits = units.length;
    }
  }

  for (const unit of units) {
    const targets = dailyTargets.get(unit.groupId)!;
    const counts = dailyCounts.get(unit.groupId)!;
    const cfg = groupConfig.get(unit.groupId);
    const maxDaily = cfg?.maxDaily ?? 8;

    const dayScores = days.map((day, di) => {
      const extra = unitSlotCount(unit);
      const fits = counts[di] + extra <= maxDaily;
      if (!fits || counts[di] >= maxDaily) {
        return { day, index: di, need: -999 };
      }
      let bestDelta = 0;
      for (const p of getOrderedPeriods(unit, day)) {
        const d = placementGapDelta(unit, day, p);
        if (d < bestDelta) bestDelta = d;
      }
      return {
        day, index: di,
        need: (targets[di] - counts[di]) + bestDelta + teacherDayBonus(unit, di) + subjectSpreadScore(unit, day),
      };
    });
    dayScores.sort((a, b) => (b.need - a.need) || ((rng ? rng() : 0) - 0.5));

    let placed = false;

    for (const ds of dayScores) {
      if (placed) break;
      if (ds.need === -999) continue;

      const ordered = getOrderedPeriods(unit, ds.day);
      for (const p of ordered) {
        if (tryPlaceUnit(unit, ds.day, p)) { placed = true; break; }
      }
    }

    if (!placed) {
      for (const day of days) {
        if (placed) break;
        const di = days.indexOf(day);
        const extra = unitSlotCount(unit);
        if (counts[di] >= maxDaily) continue;
        if (counts[di] + extra > maxDaily) continue;
        const ordered = getOrderedPeriods(unit, day);
        for (const p of ordered) {
          if (tryPlaceUnit(unit, day, p)) { placed = true; break; }
        }
      }
    }

    if (!placed && unit.type === 'double') {
      placeAsSingles(unit);
      placed = true;
    }

    if (placed) {
      unitsAssigned++;
    } else {
      for (const lesson of unit.lessons) {
        conflicts.push({ type: 'UNASSIGNED_HOURS', ruleId: lesson.ruleId, missing: 1 });
      }
    }

    if (unitsAssigned % 5 === 0 || unitsAssigned === totalUnits || !placed) {
      const progress = 5 + Math.floor((unitsAssigned / totalUnits) * 90);
      emit({ type: 'PROGRESS', payload: { progress } });
    }
  }

  const unassignedCount = conflicts.filter((c) => c.type === 'UNASSIGNED_HOURS').length;
  emitLog(emit, 'info', `Initial placement: ${unitsAssigned}/${totalUnits} lessons placed${unassignedCount ? `, ${unassignedCount} unassigned` : '.'}`);

  autoResolveUnassigned(project, schedule, conflicts, nodeBudget);

  emitLog(emit, 'info', 'Optimizing teacher gap distribution…');
  optimizeGaps(schedule, teacherBusyRules, noFirstRules, groupConfig, maxGroupsByRoom, maxGroupsByTeacher, rng, optimizePasses, lockedSlots);
  // Cheap direct fill: move a gapped teacher's own lesson into a gap cell without
  // forcing the unrelated occupant out (worker v0.3). Runs per attempt - it is
  // O(schedule) per pass, so it stays invisible next to the single-swap search.
  directFillGaps(schedule, project, optimizePasses);

  const totalBatches = units.length;
  return {
    schedule,
    conflicts,
    score: totalBatches > 0 ? unitsAssigned / totalBatches : 0,
  };
}

// ---------------------------------------------------------------------------
// Local search: shrink teacher free gaps by swapping same-day lessons without
// breaking any invariant (teacher/class/room slots, busy constraints, doubles,
// split-slot simultaneity). Each accepted swap strictly reduces total free hours.
// ---------------------------------------------------------------------------

function slotFreeForSwap(
  schedule: any[],
  lesson: any,
  day: string,
  period: number,
  excludeId: string,
  teacherBusyRules: { teacherId: string; day: string; periods: Set<number> }[],
  noFirstRules: { subjectId: string; groupId?: string }[],
  groupConfig: Map<string, GroupScheduleConfig>,
  maxGroupsByRoom: Map<string, number>,
  maxGroupsByTeacher: Map<string, number>
): boolean {
  const roomOccupants = new Set<string>();
  const teacherOccupantsByGroup = new Set<string>();
  for (const other of schedule) {
    if (other.id === excludeId) continue;
    if (other.day !== day || other.period !== period) continue;
    if (other.groupId === lesson.groupId) return false;
    if (lesson.teacherId && other.teacherId === lesson.teacherId) teacherOccupantsByGroup.add(other.groupId);
    if (lesson.roomId && other.roomId === lesson.roomId) roomOccupants.add(other.groupId);
  }
  if (lesson.roomId && roomOccupants.size >= (maxGroupsByRoom.get(lesson.roomId) ?? 1)) return false;
  if (
    lesson.teacherId &&
    teacherOccupantsByGroup.size >= (maxGroupsByTeacher.get(lesson.teacherId) ?? 1) &&
    !teacherOccupantsByGroup.has(lesson.groupId)
  ) {
    return false;
  }
  if (lesson.teacherId && isBusyRule(teacherBusyRules, lesson.teacherId, day, period)) return false;
  const cfg = groupConfig.get(lesson.groupId);
  if (cfg) {
    if (period < cfg.periodStart || period > cfg.periodEnd) return false;
    if (period === cfg.periodStart) {
      if (noFirstRules.some(r => r.subjectId === lesson.subjectId && (!r.groupId || r.groupId === lesson.groupId))) return false;
    }
  }
  return true;
}

function isBusyRule(teacherBusyRules: { teacherId: string; day: string; periods: Set<number> }[], teacherId: string, day: string, period: number): boolean {
  for (const rule of teacherBusyRules) {
    if (rule.teacherId !== teacherId) continue;
    if (rule.day !== '*' && rule.day !== day) continue;
    if (rule.periods.has(period)) return true;
  }
  return false;
}

function hasDoublePartner(schedule: any[], lesson: any): boolean {
  return schedule.some(o =>
    o.id !== lesson.id
    && o.teacherId && o.teacherId === lesson.teacherId
    && o.ruleId === lesson.ruleId
    && o.day === lesson.day
    && Math.abs(o.period - lesson.period) === 1
  );
}

function hasSplitPartner(schedule: any[], lesson: any): boolean {
  return schedule.some(o =>
    o.id !== lesson.id
    && o.day === lesson.day
    && o.period === lesson.period
    && o.groupId === lesson.groupId
    && o.subjectId === lesson.subjectId
  );
}

function canSameDaySwap(
  schedule: any[],
  a: any,
  b: any,
  teacherBusyRules: { teacherId: string; day: string; periods: Set<number> }[],
  noFirstRules: { subjectId: string; groupId?: string }[],
  groupConfig: Map<string, GroupScheduleConfig>,
  maxGroupsByRoom: Map<string, number>,
  maxGroupsByTeacher: Map<string, number>
): boolean {
  if (a.day !== b.day || a.period === b.period) return false;
  if (hasDoublePartner(schedule, a) || hasDoublePartner(schedule, b)) return false;
  if (hasSplitPartner(schedule, a) || hasSplitPartner(schedule, b)) return false;
  // a -> b's slot, b -> a's slot (same day, group/room/teacher slots checked).
  if (!slotFreeForSwap(schedule, a, a.day, b.period, b.id, teacherBusyRules, noFirstRules, groupConfig, maxGroupsByRoom, maxGroupsByTeacher)) return false;
  if (!slotFreeForSwap(schedule, b, a.day, a.period, a.id, teacherBusyRules, noFirstRules, groupConfig, maxGroupsByRoom, maxGroupsByTeacher)) return false;
  return true;
}

function swapGapDelta(schedule: any[], a: any, b: any): number {
  const day = a.day;
  const tOld = teacherDayGap(schedule, a.teacherId, day);
  const xOld = teacherDayGap(schedule, b.teacherId, day);
  const tp = dayPeriodsOf(schedule, a.teacherId, day).filter(p => p !== a.period);
  tp.push(b.period);
  tp.sort((m, n) => m - n);
  const xp = dayPeriodsOf(schedule, b.teacherId, day).filter(p => p !== b.period);
  xp.push(a.period);
  xp.sort((m, n) => m - n);
  return (gapOfPeriods(tp) + gapOfPeriods(xp)) - (tOld + xOld);
}

function optimizeGaps(
  schedule: any[],
  teacherBusyRules: { teacherId: string; day: string; periods: Set<number> }[],
  noFirstRules: { subjectId: string; groupId?: string }[],
  groupConfig: Map<string, GroupScheduleConfig>,
  maxGroupsByRoom: Map<string, number>,
  maxGroupsByTeacher: Map<string, number>,
  rng: (() => number) | undefined,
  maxPasses: number,
  lockedSlots: Set<string> = new Set()
): void {
  if (schedule.length === 0) return;

  const isLocked = (lesson: any) => lockedSlots.has(`${lesson.ruleId}|${lesson.day}|${lesson.period}`);

  const dayMap = new Map<string, number[]>();
  for (const lesson of schedule) {
    if (!lesson.teacherId) continue;
    const key = `${lesson.teacherId}|${lesson.day}`;
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key)!.push(lesson.period);
  }

  const gapped: { tid: string; day: string; periods: number[] }[] = [];
  for (const [key, periods] of dayMap) {
    periods.sort((a, b) => a - b);
    if (gapOfPeriods(periods) > 0) {
      const sep = key.indexOf('|');
      gapped.push({ tid: key.slice(0, sep), day: key.slice(sep + 1), periods });
    }
  }
  if (gapped.length === 0) return;

  for (let pass = 0; pass < maxPasses; pass++) {
    if (rng) shuffleInPlace(gapped, rng);
    let improved = false;

    for (const entry of gapped) {
      // Entry state may be stale after a swap; recompute its periods cheaply.
      const periods = dayPeriodsOf(schedule, entry.tid, entry.day);
      if (periods.length < 2 || gapOfPeriods(periods) <= 0) continue;

      outer:
      for (let i = 1; i < periods.length; i++) {
        const pPrev = periods[i - 1];
        const pCur = periods[i];
        // Consider every free cell strictly inside this gap and pick the best swap.
        let bestSwap: { a: any; b: any; delta: number } | null = null;
        for (let cell = pPrev + 1; cell < pCur; cell++) {
          const bLesson = schedule.find(l => l.day === entry.day && l.period === cell);
          if (!bLesson || bLesson.teacherId === entry.tid || isLocked(bLesson)) continue;
          for (const target of [pPrev, pCur]) {
            const aLesson = schedule.find(l => l.teacherId === entry.tid && l.day === entry.day && l.period === target);
            if (!aLesson || isLocked(aLesson) || !canSameDaySwap(schedule, aLesson, bLesson, teacherBusyRules, noFirstRules, groupConfig, maxGroupsByRoom, maxGroupsByTeacher)) continue;
            const delta = swapGapDelta(schedule, aLesson, bLesson);
            if (bestSwap === null || delta < bestSwap.delta) {
              bestSwap = { a: aLesson, b: bLesson, delta };
            }
          }
        }
        if (bestSwap && bestSwap.delta < 0) {
          const bp = bestSwap.b.period;
          bestSwap.b.period = bestSwap.a.period;
          bestSwap.a.period = bp;
          improved = true;
          break outer;
        }
      }
    }

    if (!improved) break;
  }
}

// ---------------------------------------------------------------------------
// Gap fill via single-lesson moves (worker v0.3 "parallel replacement").
//
// The single same-day pair-swap above (optimizeGaps) demands a strict TWO-way
// swap: it only fills a gap cell by moving the gapped teacher's lesson in AND
// swapping the unrelated occupant out. An "unplaceable gap" is exactly the case
// where that swap is impossible even though the gap cell is genuinely placeable:
// the gapped teacher's own lesson can simply be *moved into* the free-for-it
// cell while the unrelated occupant stays put (different group, teacher, room).
// This pass does exactly that cheap direct fill for every teacher-day gap. Every
// accepted change moves the lesson within the same day (so rule day-counts are
// unchanged) and is validated against the shared occupancy, so completeness is
// never harmed - only gaps can go down.
//
// Termination: it is O(gap cells x same-day lessons) per teacher-day with no
// search, so "-1 Unlimited" optimize passes cannot hang here.
// ---------------------------------------------------------------------------

function isLockedGapLesson(lesson: any, ctx: RearrangeContext): boolean {
  return ctx.lockedSlots.has(`${lesson.ruleId}|${lesson.day}|${lesson.period}`);
}

export function directFillGaps(
  schedule: any[],
  project: ProjectState,
  maxPasses: number
): void {
  if (schedule.length === 0) return;

  const ctx = createRearrangeContext(project);
  // Hard caps so even "-1 Unlimited" optimize passes terminate promptly.
  const maxPassesHere = Math.min(maxPasses, 16);
  const maxImprovements = Math.max(4, schedule.length);
  let improvements = 0;

  const teacherIds = [...new Set(schedule.map((l: any) => l.teacherId).filter(Boolean))] as string[];

  // Build ONE occupancy per pass and reuse it for every teacher-day (a same-day
  // move keeps the rule's day-count constant, so the shared occupancy correctly
  // validates every direct fill). Rebuild when the schedule changes.
  for (let pass = 0; pass < maxPassesHere; pass++) {
    const occ = ctx.buildOccupancy(schedule, new Set());
    let passImproved = false;
    for (const tid of teacherIds) {
      for (const day of DAYS) {
        if (directFillDay(schedule, ctx, occ, tid, day)) {
          passImproved = true;
          improvements++;
          if (improvements >= maxImprovements) return;
          // The shared occupancy is stale once a lesson has moved; rebuild it
          // before the next candidate so slotFree() never validates against a
          // pre-move picture (one move per pass keeps it correct).
          break;
        }
      }
      if (passImproved) break;
    }
    if (!passImproved) break;
  }
}

/**
 * v4-36 / v4-37: score-gated local search over the whole semester pair. Guided
 * operators run in strict ScheduleScore LEVEL order (completeness, teacher+class
 * compactness, long gaps, sparse days, subject distribution, parallelization,
 * age/shift, room/movement stability). Every candidate is validated against the
 * hard invariants first, then accepted only when the canonical lexicographic
 * score strictly improves *up to the operator's own level* - so a step can never
 * worsen a higher level, while lower levels are free to move (spec §38-f). The
 * operator list repeats for a few rounds, making the step a bounded multi-step
 * search that escapes placement-time local optima (spec §39).
 */
export function localSearch(
  project: ProjectState,
  schedules: SemesterSchedules,
  splits: SemesterSplit[],
  pinnedRuleIds?: Set<string>,
  rng?: () => number,
  budget: number = 150
): void {
  if (budget <= 0) return;
  const all = [...schedules.semester1.schedule, ...schedules.semester2.schedule];
  if (all.length === 0) return;

  const teacherBusyRules: { teacherId: string; day: string; periods: Set<number> }[] = [];
  const noFirstRules: { subjectId: string; groupId?: string }[] = [];
  for (const c of project.constraints || []) {
    if (c.kind === 'TEACHER_BUSY' && c.teacherId && c.periods && c.periods.length > 0) {
      teacherBusyRules.push({ teacherId: c.teacherId, day: c.day || '*', periods: new Set(c.periods) });
    } else if (c.kind === 'NO_FIRST_PERIOD' && c.subjectId) {
      noFirstRules.push({ subjectId: c.subjectId, groupId: c.groupId });
    }
  }

  const groupConfig = new Map<string, GroupScheduleConfig>();
  for (const group of project.groups || []) groupConfig.set(group.id, computeGroupScheduleConfig(group));
  const groupGrade = new Map<string, number>();
  for (const group of project.groups || []) groupGrade.set(group.id, group.grade ?? 0);

  const maxGroupsByRoom = new Map<string, number>();
  for (const room of project.rooms || []) maxGroupsByRoom.set(room.id, Math.max(1, room.maxGroups ?? 1));
  const maxGroupsByTeacher = new Map<string, number>();
  for (const teacher of project.teachers || []) maxGroupsByTeacher.set(teacher.id, Math.max(1, teacher.maxGroups ?? 1));

  const ruleMaxDaily = buildMaxDailyByRule(project);
  const maxDailyByGroup = new Map<string, number>();
  for (const group of project.groups || []) maxDailyByGroup.set(group.id, groupConfig.get(group.id)?.maxDaily ?? 8);

  const lockedSlotsByRule = new Map<string, Set<string>>();
  const lockedLessonIds = new Set<string>();
  for (const lock of project.lockedLessons || []) {
    if (!lock.ruleId || !DAYS.includes(lock.day) || !(lock.period >= 1 && lock.period <= 12)) continue;
    if (!lockedSlotsByRule.has(lock.ruleId)) lockedSlotsByRule.set(lock.ruleId, new Set());
    lockedSlotsByRule.get(lock.ruleId)!.add(`${lock.day}-${lock.period}`);
    for (const l of all) {
      if (l.ruleId === lock.ruleId && l.day === lock.day && l.period === lock.period) lockedLessonIds.add(l.id);
    }
  }

  // Stable room per rule (most preferred policy room, else legacy roomId) that the
  // room/movement operator tries to restore.
  const stableRoomByRule = new Map<string, string>();
  for (const rule of project.curriculum || []) {
    const rp = rule.roomPolicy;
    stableRoomByRule.set(rule.id, rp?.required?.[0] || rp?.preferred?.[0] || rule.roomId || '');
  }

  const ageBands = (project.schedulePolicy?.ageGroups || []).map((b) => {
    const grades = new Set(b.grades);
    return { grades, min: b.preferredPeriods.min, max: b.preferredPeriods.max };
  });

  let current = buildScore(schedules, splits, project, pinnedRuleIds);
  const fields = [
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
  ] as (keyof ScheduleScore)[];

  /** True when `s` is strictly better over fields 0..upto (ties on lower levels
   *  allowed to drift freely). */
  const betterUpTo = (s: ScheduleScore, upto: number): boolean => {
    for (let j = 0; j <= upto; j++) {
      const diff = Number(current[fields[j]]) - Number(s[fields[j]]);
      if (diff !== 0) return diff > 0;
    }
    return false;
  };

  const periodsOf = (keyField: 'teacherId' | 'groupId', keyValue: string, day: string): number[] => {
    const out: number[] = [];
    for (const l of all) if ((l as any)[keyField] === keyValue && l.day === day) out.push(l.period);
    out.sort((a, b) => a - b);
    return out;
  };

  /** Hard-invariant check for moving `lesson` to (day, period). */
  const canMove = (lesson: any, day: string, period: number): boolean => {
    if (lockedLessonIds.has(lesson.id)) return false;
    const lockedSlots = lockedSlotsByRule.get(lesson.ruleId);
    if (lockedSlots && lockedSlots.has(`${day}-${period}`)) return false;
    const cfg = groupConfig.get(lesson.groupId);
    if (cfg) {
      if (period < cfg.periodStart || period > cfg.periodEnd) return false;
      if (
        period === cfg.periodStart &&
        noFirstRules.some((r) => r.subjectId === lesson.subjectId && (!r.groupId || r.groupId === lesson.groupId))
      ) {
        return false;
      }
    }
    if (lesson.teacherId && isBusyRule(teacherBusyRules, lesson.teacherId, day, period)) return false;
    let groupAtSlot = false;
    let teacherGroups = 0;
    let roomGroups = 0;
    for (const other of all) {
      if (other === lesson) continue;
      if (other.day === day && other.period === period) {
        if (other.groupId === lesson.groupId) {
          groupAtSlot = true;
          break;
        }
        if (lesson.teacherId && other.teacherId === lesson.teacherId) teacherGroups++;
        if (lesson.roomId && other.roomId === lesson.roomId) roomGroups++;
      }
    }
    if (groupAtSlot) return false;
    if (lesson.teacherId && teacherGroups >= (maxGroupsByTeacher.get(lesson.teacherId) ?? 1)) return false;
    if (lesson.roomId && roomGroups >= (maxGroupsByRoom.get(lesson.roomId) ?? 1)) return false;
    let groupDay = 0;
    let ruleDay = 0;
    for (const other of all) {
      if (other === lesson || other.day !== day) continue;
      if (other.groupId === lesson.groupId) groupDay++;
      if (other.ruleId === lesson.ruleId) ruleDay++;
    }
    if (groupDay >= (maxDailyByGroup.get(lesson.groupId) ?? 8)) return false;
    const rl = ruleMaxDaily.get(lesson.ruleId);
    if (rl != null && ruleDay >= rl) return false;
    return true;
  };

  let evals = 0;
  let stopped = false;
  /** Apply a validated move; returns true when accepted (or the budget is spent). */
  const tryMove = (lesson: any, day: string, period: number, upto: number): boolean => {
    if (stopped) return true;
    if (day === lesson.day && period === lesson.period) return false;
    if (!canMove(lesson, day, period)) return false;
    if (evals >= budget) {
      stopped = true;
      return true;
    }
    const oDay = lesson.day;
    const oPeriod = lesson.period;
    lesson.day = day;
    lesson.period = period;
    evals++;
    const s = buildScore(schedules, splits, project, pinnedRuleIds);
    if (betterUpTo(s, upto)) {
      current = s;
      return true;
    }
    lesson.day = oDay;
    lesson.period = oPeriod;
    return false;
  };

  const jittered = <T,>(arr: T[]): T[] => {
    if (rng) {
      const copy = [...arr];
      shuffleInPlace(copy, rng);
      return copy;
    }
    return arr;
  };

  const dayLessonCounts = new Map<string, number>();
  const recountDays = () => {
    dayLessonCounts.clear();
    for (const l of all) dayLessonCounts.set(`${l.groupId}|${l.day}`, (dayLessonCounts.get(`${l.groupId}|${l.day}`) || 0) + 1);
  };
  recountDays();

  const ops: { upto: number; label: string; run: () => void }[] = [
    {
      // Teacher + class compactness: move a same-key movable lesson into a gap cell.
      label: 'compactness',
      upto: 2,
      run: () => {
        for (const keyField of ['teacherId', 'groupId'] as const) {
          const keys = [...new Set(all.map((l) => (l as any)[keyField]).filter(Boolean))] as string[];
          for (const key of keys) {
            for (const day of DAYS) {
              if (stopped) return;
              const periods = periodsOf(keyField, key, day);
              if (periods.length < 2 || gapOfPeriods(periods) <= 0) continue;
              const movable = jittered(all.filter((l) => (l as any)[keyField] === key && l.day === day));
              for (let i = 1; i < periods.length && !stopped; i++) {
                if (periods[i] - periods[i - 1] <= 1) continue;
                for (let cell = periods[i - 1] + 1; cell < periods[i] && !stopped; cell++) {
                  for (const l of movable) {
                    if (l.period === cell) continue;
                    if (tryMove(l, day, cell, 2)) break;
                  }
                }
              }
            }
          }
        }
      },
    },
    {
      // Long-gap removal: same as above but only targets gaps of 2+ free periods.
      label: 'long-gaps',
      upto: 3,
      run: () => {
        for (const keyField of ['teacherId', 'groupId'] as const) {
          const keys = [...new Set(all.map((l) => (l as any)[keyField]).filter(Boolean))] as string[];
          for (const key of keys) {
            for (const day of DAYS) {
              if (stopped) return;
              const periods = periodsOf(keyField, key, day);
              if (periods.length < 2) continue;
              let hasLong = false;
              for (let i = 1; i < periods.length; i++) {
                if (periods[i] - periods[i - 1] - 1 >= 2) {
                  hasLong = true;
                  break;
                }
              }
              if (!hasLong) continue;
              const movable = jittered(all.filter((l) => (l as any)[keyField] === key && l.day === day));
              for (let i = 1; i < periods.length && !stopped; i++) {
                if (periods[i] - periods[i - 1] - 1 < 2) continue;
                for (let cell = periods[i - 1] + 1; cell < periods[i] && !stopped; cell++) {
                  for (const l of movable) {
                    if (tryMove(l, day, cell, 3)) break;
                  }
                }
              }
            }
          }
        }
      },
    },
    {
      // Sparse days: give a one-lesson day a second lesson of the same group.
      label: 'sparse-days',
      upto: 4,
      run: () => {
        const sparse = [...dayLessonCounts.entries()].filter(([, n]) => n === 1);
        for (const [gk, count] of sparse) {
          if (stopped || count !== 1) return;
          const [groupId, day] = gk.split('|');
          const cfg = groupConfig.get(groupId);
          const lo = cfg?.periodStart ?? 1;
          const hi = cfg?.periodEnd ?? 12;
          const movable = jittered(all.filter((l) => l.groupId === groupId && l.day !== day));
          for (const l of movable) {
            if (stopped) return;
            for (let period = lo; period <= hi && !stopped; period++) {
              if (tryMove(l, day, period, 4)) break;
            }
          }
        }
      },
    },
    {
      // Subject distribution: pull a subject lesson off a stacked day onto a day
      // where that (class, subject) is absent.
      label: 'distribution',
      upto: 5,
      run: () => {
        const byKey = new Map<string, { days: Set<string>; lessons: any[] }>();
        for (const l of all) {
          const key = `${l.groupId}|${l.subjectId}`;
          if (!byKey.has(key)) byKey.set(key, { days: new Set(), lessons: [] });
          const entry = byKey.get(key)!;
          entry.days.add(l.day);
          entry.lessons.push(l);
        }
        for (const [key, entry] of byKey) {
          if (stopped) return;
          const [, subjectId] = key.split('|');
          const target = Math.min(3, entry.lessons.length);
          if (entry.days.size >= target) continue;
          const candidates = jittered(entry.lessons);
          for (const day of DAYS) {
            if (entry.days.has(day)) continue;
            for (const l of candidates) {
              if (stopped) return;
              const cfg = groupConfig.get(l.groupId);
              const lo = cfg?.periodStart ?? 1;
              const hi = cfg?.periodEnd ?? 12;
              for (let period = lo; period <= hi && !stopped; period++) {
                if (tryMove(l, day, period, 5)) break;
              }
              void subjectId;
            }
          }
        }
      },
    },
    {
      // Parallelization: mirror a subject day across explicit parallel groups.
      label: 'parallelization',
      upto: 6,
      run: () => {
        const byKey = new Map<string, Set<string>>();
        for (const l of all) {
          const key = `${l.groupId}|${l.subjectId}`;
          if (!byKey.has(key)) byKey.set(key, new Set());
          byKey.get(key)!.add(l.day);
        }
        for (const pg of project.parallelGroups || []) {
          if (stopped) return;
          const groups = pg.groupIds.filter((gid) => all.some((l) => l.groupId === gid));
          if (groups.length < 2) continue;
          const subjects = new Set<string>();
          for (const gid of groups) {
            for (const l of all) if (l.groupId === gid) subjects.add(l.subjectId);
          }
          for (const subjectId of subjects) {
            if (stopped) return;
            const dayFreq = new Map<string, number>();
            for (const gid of groups) {
              for (const d of byKey.get(`${gid}|${subjectId}`) || []) dayFreq.set(d, (dayFreq.get(d) || 0) + 1);
            }
            if (dayFreq.size < 1) continue;
            const targetDay = [...dayFreq.entries()].sort((a, b) => b[1] - a[1])[0][0];
            for (const gid of groups) {
              const gDays = byKey.get(`${gid}|${subjectId}`) || new Set();
              if (gDays.has(targetDay)) continue;
              const lessons = jittered(all.filter((l) => l.groupId === gid && l.subjectId === subjectId));
              for (const l of lessons) {
                if (stopped) return;
                const cfg = groupConfig.get(l.groupId);
                const lo = cfg?.periodStart ?? 1;
                const hi = cfg?.periodEnd ?? 12;
                for (let period = lo; period <= hi && !stopped; period++) {
                  if (tryMove(l, targetDay, period, 6)) break;
                }
              }
            }
          }
        }
      },
    },
    {
      // Age/shift: pull lessons of a band back inside its preferred period window.
      label: 'age-shift',
      upto: 7,
      run: () => {
        if (ageBands.length === 0) return;
        for (const l of jittered(all)) {
          if (stopped) return;
          const band = ageBands.find((b) => b.grades.has(groupGrade.get(l.groupId) ?? -1));
          if (!band) continue;
          const lo = Math.max(band.min, groupConfig.get(l.groupId)?.periodStart ?? 1);
          const hi = Math.min(band.max, groupConfig.get(l.groupId)?.periodEnd ?? 12);
          if (l.period >= lo && l.period <= hi) continue;
          for (let period = lo; period <= hi && !stopped; period++) {
            if (tryMove(l, l.day, period, 7)) break;
          }
        }
      },
    },
    {
      // Room/movement stability: restore the rule's preferred room when it is free
      // at the lesson's slot (room-only change, no slot conflict).
      label: 'room-stability',
      upto: 9,
      run: () => {
        for (const l of jittered(all)) {
          if (stopped) return;
          const stable = stableRoomByRule.get(l.ruleId);
          if (!stable || l.roomId === stable) continue;
          let otherGroupsAtRoom = 0;
          let sameGroupThere = false;
          for (const other of all) {
            if (other === l) continue;
            if (other.day === l.day && other.period === l.period && other.roomId === stable) {
              if (other.groupId === l.groupId) sameGroupThere = true;
              else otherGroupsAtRoom++;
            }
          }
          if (sameGroupThere || otherGroupsAtRoom >= (maxGroupsByRoom.get(stable) ?? 1)) continue;
          const originalRoom = l.roomId;
          l.roomId = stable;
          evals++;
          const s = buildScore(schedules, splits, project, pinnedRuleIds);
          if (betterUpTo(s, 9)) {
            current = s;
          } else {
            l.roomId = originalRoom;
          }
          if (evals >= budget) {
            stopped = true;
            return;
          }
        }
      },
    },
  ];

  for (let round = 0; round < 3 && !stopped; round++) {
    for (const op of ops) {
      op.run();
      if (stopped) break;
    }
  }
}

/**
 * Try to remove one teacher-day gap by moving one of the teacher's own same-day
 * lessons straight into a gap cell, leaving the unrelated occupant in place.
 * Uses the prebuilt shared occupancy. Accepts one strict improvement.
 */
function directFillDay(schedule: any[], ctx: RearrangeContext, occ: any, tid: string, day: string): boolean {
  const periods = dayPeriodsOf(schedule, tid, day).sort((a, b) => a - b);
  if (periods.length < 2 || gapOfPeriods(periods) <= 0) return false;

  // Small list of this teacher's same-day movable lessons (no full-schedule scan
  // in the inner loop - that would dominate on large boards).
  const movable: any[] = [];
  for (const l of schedule) {
    if (l.teacherId !== tid || l.day !== day) continue;
    if (isLockedGapLesson(l, ctx)) continue;
    if (hasSplitPartner(schedule, l) || hasDoublePartner(schedule, l)) continue;
    movable.push(l);
  }
  if (movable.length === 0) return false;

  for (let i = 1; i < periods.length; i++) {
    for (let cell = periods[i - 1] + 1; cell < periods[i]; cell++) {
      for (const lesson of movable) {
        if (lesson.period === cell) continue;
        const next = periods.filter((p) => p !== lesson.period);
        next.push(cell);
        next.sort((a, b) => a - b);
        if (gapOfPeriods(next) - gapOfPeriods(periods) >= 0) continue;
        if (!ctx.slotFree(occ, lesson, day, cell, lesson.teacherId, lesson.id)) continue;
        lesson.day = day;
        lesson.period = cell;
        return true;
      }
    }
  }
  return false;
}

export function computeSemesterSplits(project: ProjectState): SemesterSplit[] {
  const teacherLoad = new Map<string, { s1: number; s2: number }>();
  const getLoad = (teacherId: string) => {
    if (!teacherLoad.has(teacherId)) teacherLoad.set(teacherId, { s1: 0, s2: 0 });
    return teacherLoad.get(teacherId)!;
  };

  const splits: SemesterSplit[] = [];
  const fractionalByTeacher = new Map<string, CurriculumRule[]>();

  for (const rule of project.curriculum) {
    if (Number.isInteger(rule.hoursPerWeek)) {
      const h = rule.hoursPerWeek;
      splits.push({ ruleId: rule.id, hoursPerWeek: h, first: h, second: h });
      if (rule.teacherId) {
        const load = getLoad(rule.teacherId);
        load.s1 += h;
        load.s2 += h;
      }
    } else {
      const teacherId = rule.teacherId || '';
      if (!fractionalByTeacher.has(teacherId)) fractionalByTeacher.set(teacherId, []);
      fractionalByTeacher.get(teacherId)!.push(rule);
    }
  }

  for (const [teacherId, rules] of fractionalByTeacher) {
    rules.sort((a, b) => b.hoursPerWeek - a.hoursPerWeek);
    for (const rule of rules) {
      const ceil = Math.ceil(rule.hoursPerWeek);
      const floor = Math.floor(rule.hoursPerWeek);
      const load = getLoad(teacherId);
      const first = load.s1 <= load.s2 ? ceil : floor;
      const second = first === ceil ? floor : ceil;
      load.s1 += first;
      load.s2 += second;
      splits.push({ ruleId: rule.id, hoursPerWeek: rule.hoursPerWeek, first, second });
    }
  }

  // FORBID_LESSON constraints fix the per-semester hour distribution for a rule
  // (hours === 0 forbids it in that semester). This overrides the automatic split.
  const forbid = new Map<string, { semester: 1 | 2; hours: number }>();
  for (const c of project.constraints || []) {
    if (c.kind === 'FORBID_LESSON' && c.ruleId) {
      forbid.set(c.ruleId, { semester: c.semester === 2 ? 2 : 1, hours: c.hours ?? 0 });
    }
  }
  if (forbid.size > 0) {
    for (const s of splits) {
      const f = forbid.get(s.ruleId);
      if (!f) continue;
      const annual = s.first + s.second;
      const h = Math.max(0, Math.min(Math.round(f.hours), annual));
      if (f.semester === 1) {
        s.first = h;
        s.second = annual - h;
      } else {
        s.second = h;
        s.first = annual - h;
      }
    }
  }

  return splits;
}

export function buildSemesterProject(
  project: ProjectState,
  semester: 1 | 2,
  splits: SemesterSplit[]
): ProjectState {
  const splitMap = new Map(splits.map((s) => [s.ruleId, s]));
  const curriculum = project.curriculum
    .map((rule) => {
      const split = splitMap.get(rule.id);
      const hours = split ? (semester === 1 ? split.first : split.second) : rule.hoursPerWeek;
      if (hours <= 0) return null;
      return { ...rule, hoursPerWeek: hours };
    })
    .filter((rule): rule is CurriculumRule => rule !== null);
  const semesterKey = semester === 1 ? 'semester1' : 'semester2';
  const lockedLessons = (project.lockedLessons || []).filter(
    (l) => !l.semester || l.semester === semesterKey
  );
  return { ...project, curriculum, lockedLessons };
}

function collectUnassigned(result: ScheduleResult): Map<string, number> {
  const map = new Map<string, number>();
  for (const conflict of result.conflicts || []) {
    if (conflict?.type === 'UNASSIGNED_HOURS' && conflict.ruleId) {
      map.set(conflict.ruleId, (map.get(conflict.ruleId) || 0) + (conflict.missing ?? 1));
    }
  }
  return map;
}

export async function generateSemesterSchedules(
  project: ProjectState,
  emit: (msg: WorkerMessage) => void,
  settings?: Partial<GenerateSettings>,
  isCancelled?: () => boolean
) {
  // Generate many candidate schedules and keep the one that places the most
  // lessons while producing the tightest teacher free-hour distribution.
  // Budgets are configurable and intentionally NOT capped at the top (worker v0.3
  // spec §22): a user may raise them arbitrarily for deeper/stronger searches. A
  // floor is kept only to reject nonsensical values, never an upper bound.
  //
  // Every budget accepts -1 as "Unlimited": attempts/optimizePasses and
  // maxSpillPasses want this to keep searching until convergence or the user
  // cancels, while maxRearrangeNodes simply drops its count ceiling. A helper
  // maps -1 to a sentinel (MAX_SAFE_INTEGER) so the many existing `for` loops
  // keep their shape and only need a user-cancel check bolted on top.
  const unlimited = (v: number | undefined, floor: number, fallback: number) =>
    v === -1 ? Number.MAX_SAFE_INTEGER : Math.max(floor, Math.trunc(v ?? fallback) || floor);
  const attemptsUnlimited = settings?.attempts === -1;
  const attempts = attemptsUnlimited ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.trunc(settings?.attempts ?? 20) || 1);
  const maxSpillPasses = unlimited(settings?.maxSpillPasses, 0, 4);
  const optimizePasses = unlimited(settings?.optimizePasses, 0, DEFAULT_OPTIMIZE_PASSES);

  emitLog(emit, 'info', 'Preparing generation…');
  emitLog(emit, 'step', `Mode: ${settings?.mode ?? 'runs'}, ${attemptsUnlimited ? 'unlimited' : attempts} attempt${attemptsUnlimited ? 's' : (attempts === 1 ? '' : 's')}, ${maxSpillPasses === Number.MAX_SAFE_INTEGER ? 'unlimited' : maxSpillPasses} spill passe${maxSpillPasses === 1 ? '' : 's'}, ${optimizePasses === Number.MAX_SAFE_INTEGER ? 'unlimited' : optimizePasses} optimize passe${optimizePasses === 1 ? '' : 's'}.`);

  // Rules with a FORBID_LESSON constraint have a fixed per-semester split that
  // the spillover must not move lessons across (respecting the forbid).
  const fixedRules = new Set(
    (project.constraints || [])
      .filter((c) => c.kind === 'FORBID_LESSON' && c.ruleId)
      .map((c) => c.ruleId!)
  );

  // Rules with integer hours have a canonical balanced split (e.g. 4/4, 1/1).
  // The spillover may only shift lessons for fractional rules, so an integer rule
  // keeps its split even if a lesson has to stay unassigned - never drifting to a
  // skewed 3/5 or 0/2 just to place a whole lesson somewhere.
  const splitLock = new Set(
    project.curriculum
      .filter((r) => Number.isInteger(r.hoursPerWeek) && !fixedRules.has(r.id))
      .map((r) => r.id)
  );

  async function generateAttempt(seed: number, progressBase: number, progressSpan: number, profile: AttemptProfile = 'conservative') {
    const rng = mulberry32(seed);
    const runScaled = async (semesterProject: ProjectState) => {
      return runGenerate(semesterProject, (msg) => {
        if (msg.type === 'PROGRESS') {
          const p = typeof msg.payload?.progress === 'number' ? msg.payload.progress : 0;
          emit({ type: 'PROGRESS', payload: { progress: Math.round(progressBase + (p / 100) * progressSpan) } });
        } else if (msg.type === 'LOG') {
          emit(msg);
        }
      }, rng, fixedRules, optimizePasses, maxRearrangeNodes, profile);
    };

    let splits = computeSemesterSplits(project);
    let cursor = progressBase;
    const take = (portion: number) => {
      cursor += portion * progressSpan;
    };

    take(0.45);
    emitLog(emit, 'step', 'Placing semester 1 lessons…');
    let semester1 = await runScaled(buildSemesterProject(project, 1, splits));
    take(0.45);
    emitLog(emit, 'step', 'Placing semester 2 lessons…');
    let semester2 = await runScaled(buildSemesterProject(project, 2, splits));

    // Lessons that cannot be placed in one semester are moved to the other by
    // adjusting the per-rule split (the annual hour total is preserved). Only
    // fractional rules move; integer and pinned-forbid rules keep their split.
    // We iterate so a lesson can cascade to whichever semester actually has room.
    for (let iter = 0; iter < maxSpillPasses; iter++) {
      const out1 = collectUnassigned(semester1);
      const out2 = collectUnassigned(semester2);
      if (out1.size === 0 && out2.size === 0) break;

      const nextSplits = splits.map((s) => {
        if (fixedRules.has(s.ruleId) || splitLock.has(s.ruleId)) return s; // keep canonical split
        const movedFrom1 = out1.get(s.ruleId) || 0;
        const movedFrom2 = out2.get(s.ruleId) || 0;
        return {
          ...s,
          first: Math.max(0, s.first - movedFrom1 + movedFrom2),
          second: Math.max(0, s.second - movedFrom2 + movedFrom1),
        };
      });

      const changed = nextSplits.some(
        (s, i) => s.first !== splits[i].first || s.second !== splits[i].second
      );
      if (!changed) break;
      splits = nextSplits;

      take(0.05);
      emitLog(emit, 'step', `Spill pass ${iter + 1}: redistributing unplaced lessons across semesters…`);
      semester1 = await runScaled(buildSemesterProject(project, 1, splits));
      take(0.05);
      semester2 = await runScaled(buildSemesterProject(project, 2, splits));
    }

    // v4-36: bounded, score-gated local search across the finished semester pair
    // (each operator in strict ScheduleScore LEVEL order; higher levels can never
    // be worsened). gated by the per-attempt budget setting.
    const localSearchBudget = settings?.localSearchEvals ?? 150;
    if (localSearchBudget > 0 && collectUnassigned(semester1).size + collectUnassigned(semester2).size === 0) {
      localSearch(project, { semester1, semester2 } as SemesterSchedules, splits, fixedRules, rng, localSearchBudget);
    }

    return { schedules: { semester1, semester2 } as SemesterSchedules, splits };
  }

  const mode: 'runs' | 'time' = settings?.mode ?? 'runs';
  // maxRearrangeNodes: undefined/null and -1 both mean "no count ceiling" (§22);
  // resolveUnplacedPlacement/autoResolveUnassigned treat a missing budget as
  // unbounded (time/deadline bounded only), so -1 is collapsed to null here.
  const maxRearrangeNodes = settings?.maxRearrangeNodes === -1 ? undefined : settings?.maxRearrangeNodes;

  // Best-known state plus its canonical score for lexicographic comparison.
  let best: {
    schedules: SemesterSchedules;
    splits: SemesterSplit[];
    quality: number;
    score: ScheduleScore;
  } | null = null;

  const consider = (candidate: { schedules: SemesterSchedules; splits: SemesterSplit[] }): boolean => {
    const score = buildScore(candidate.schedules, candidate.splits, project, fixedRules);
    if (!best || compareScores(score, best.score) > 0) {
      best = {
        ...candidate,
        quality: scoreVectorToNumber(score),
        score,
      };
      return true;
    }
    return false;
  };

  if (mode === 'time') {
    // Anytime mode (worker v0.3): keep improving candidates against a marching
    // deadline and always return the best valid result found so far. The number
    // of attempts is not fixed; the loop stops when the deadline fires, or runs
    // until the user cancels when generationTimeMs is -1 (Unlimited).
    const unlimitedTime = settings?.generationTimeMs === -1;
    const budgetMs = Math.max(250, Math.trunc(settings?.generationTimeMs ?? 20000) || 20000);
    const deadline = Date.now() + (unlimitedTime ? Number.MAX_SAFE_INTEGER : budgetMs);
    let attempt = 0;
    let reported = 0;
    while (!(isCancelled?.() ?? false) && Date.now() < deadline) {
      // Unlimited time needs the event loop freed between attempts too, so a
      // CANCEL can land; the bounded path keeps chewing through the deadline.
      if (unlimitedTime) await new Promise((r) => setTimeout(r, 0));
      const profile = ATTEMPT_PROFILES[attempt % ATTEMPT_PROFILES.length];
      const candidate = await generateAttempt(0x9e3779b1 + ++attempt * 0x9e3779b1, 5, 85, profile);
      const improved = consider(candidate);
      if (improved) {
        emitLog(emit, 'success', `Attempt ${attempt} complete — new best (quality ${Math.round(best!.quality)}).`, { attempt, attempts: attempt, pct: Math.min(95, 5 + Math.floor((attempt / 20) * 90)) });
        const pct = Math.min(95, 5 + Math.floor((attempt / 20) * 90));
        emit({ type: 'PROGRESS', payload: { progress: pct, mode, bestQuality: Math.round(best!.quality) } });
        reported = pct;
      }
      if (attempt - reported > 40) {
        emit({ type: 'PROGRESS', payload: { progress: reported, mode, bestQuality: Math.round(best!.quality) } });
        reported = attempt;
      }
    }
    emitLog(emit, 'success', (isCancelled?.() ?? false) && unlimitedTime
      ? 'Stopped by user — returning best schedule found.'
      : `Generation complete — best schedule selected after ${attempt} attempt${attempt === 1 ? '' : 's'} (quality ${Math.round(best!.quality)}).`, { attempt, attempts: attempt });
    emit({ type: 'PROGRESS', payload: { progress: 100, mode, bestQuality: Math.round(best!.quality) } });
    emit({
      type: 'RESULT',
      payload: {
        mode,
        schedules: best!.schedules,
        splits: best!.splits,
        attempts: attempt,
        generationTimeMs: unlimitedTime ? 0 : budgetMs,
        cancelled: (isCancelled?.() ?? false) && unlimitedTime,
        bestQuality: best!.quality,
        gapReport: {
          semester1: teacherGapReport(best!.schedules.semester1.schedule),
          semester2: teacherGapReport(best!.schedules.semester2.schedule),
        },
      },
    });
    return;
  }

  // Mode `runs` (backward compatible): a bounded number of full candidates, best
  // kept. This is the deterministic path used by the existing tests and callers.
  // A -1 (Unlimited) attempt count keeps running until the user cancels.
  let completed = 0;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (isCancelled?.()) break;
    const progressBase = Math.floor((attempt / attempts) * 95);
    const progressSpan = attemptsUnlimited ? 95 / (attempt + 1) : 95 / attempts;
    // In Unlimited mode there is no natural stop, so hand the event loop back
    // between attempts to let a CANCEL message / external flag actually be
    // observed; otherwise a fully-synchronous schedule build would starve it.
    if (attemptsUnlimited) await new Promise((r) => setTimeout(r, 0));
    const candidate = await generateAttempt((attempt + 1) * 0x9e3779b1, progressBase, progressSpan);
    consider(candidate);
    completed = attempt + 1;
    emitLog(emit, 'success', `Attempt ${attempt + 1} of ${attemptsUnlimited ? attempt + 1 : attempts} complete — current best quality ${Math.round(best!.quality)}.`, { attempt: attempt + 1, attempts: attemptsUnlimited ? attempt + 1 : attempts });
    emit({
      type: 'PROGRESS',
      payload: {
        progress: Math.floor(((attempt + 1) / attempts) * 95),
        attempt: attempt + 1,
        attempts: attemptsUnlimited ? attempt + 1 : attempts,
        bestQuality: Math.round(best!.quality),
        mode,
      },
    });
  }

  emitLog(emit, 'success', attemptsUnlimited && (isCancelled?.() ?? false)
    ? 'Stopped by user — returning best schedule found.'
    : `Generation complete — best schedule selected after ${completed} attempt${completed === 1 ? '' : 's'} (quality ${Math.round(best!.quality)}).`, { attempt: completed, attempts: completed });

  emit({ type: 'PROGRESS', payload: { progress: 100, attempt: completed, attempts: completed, bestQuality: Math.round(best!.quality), mode } });

  emit({
    type: 'RESULT',
    payload: {
      mode,
      schedules: best!.schedules,
      splits: best!.splits,
      attempts: completed,
      cancelled: isCancelled?.(),
      bestQuality: best!.quality,
      gapReport: {
        semester1: teacherGapReport(best!.schedules.semester1.schedule),
        semester2: teacherGapReport(best!.schedules.semester2.schedule),
      },
    },
  });
}