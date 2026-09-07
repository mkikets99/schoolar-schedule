import { AllowedConflict, AllowedConflictReason } from './types';

/**
 * Wildcard reason that waives every conflict kind between the recorded parties.
 */
export const ALL_CONFLICT_REASON: AllowedConflictReason = '*';

/** True when a record covers the given reason (`*` waives everything). */
export function reasonCovers(record: AllowedConflict, reason: AllowedConflictReason): boolean {
  return record.reason === ALL_CONFLICT_REASON || record.reason === reason;
}

/** True when the record's set entities all match the lesson's entity fields. */
export function recordAppliesToLesson(
  record: AllowedConflict,
  lesson: { teacherId?: string; groupId: string; roomId?: string }
): boolean {
  if (record.teacherId && record.teacherId !== lesson.teacherId) return false;
  if (record.groupId && record.groupId !== lesson.groupId) return false;
  if (record.roomId && record.roomId !== lesson.roomId) return false;
  return true;
}

/**
 * True when an analyzer atom for `lesson` carrying `reason` is expressly
 * allowed by the project. Used by the UI analyzer to suppress approved
 * conflicts; the generator uses the consent sets instead (it deals with raw
 * overlap facts, not analyzer atoms).
 */
export function isAllowedConflict(
  allowedConflicts: AllowedConflict[] | undefined,
  lesson: { teacherId?: string; groupId: string; roomId?: string },
  reason: AllowedConflictReason
): boolean {
  if (!allowedConflicts) return false;
  return allowedConflicts.some((a) => reasonCovers(a, reason) && recordAppliesToLesson(a, lesson));
}

/**
 * Consent key sets for the generator / rearrange engines. An overlap on a
 * teacher or room slot is tolerated ONLY when every group involved - the new
 * lesson and every group already occupying the slot - has a recorded agreement
 * with the resource holder. Unapproved overlaps remain hard constraints.
 */
export interface AllowedConsentSets {
  teacher: Set<string>; // `${teacherId}|${groupId}`
  room: Set<string>; // `${roomId}|${groupId}`
}

export function buildAllowedConsentSets(allowedConflicts: AllowedConflict[] | undefined): AllowedConsentSets {
  const teacher = new Set<string>();
  const room = new Set<string>();
  for (const a of allowedConflicts || []) {
    if (a.teacherId && a.groupId && (a.reason === ALL_CONFLICT_REASON || a.reason === 'TEACHER_SLOT')) {
      teacher.add(`${a.teacherId}|${a.groupId}`);
    }
    if (a.roomId && a.groupId && (a.reason === ALL_CONFLICT_REASON || a.reason === 'ROOM_SLOT')) {
      room.add(`${a.roomId}|${a.groupId}`);
    }
  }
  return { teacher, room };
}

/** Field-scope signature used to dedupe records and detect "the same allowance". */
export function allowedConflictSignature(a: AllowedConflict): string {
  if (a.kind === 'pair') {
    return `pair|${a.semester ?? ''}|${[a.ruleIdA, a.ruleIdB].sort().join('|')}`;
  }
  return `${a.kind}|${a.reason}|${a.teacherId ?? ''}|${a.groupId ?? ''}|${a.roomId ?? ''}`;
}

/**
 * The set of curriculum rule ids that a pair binding forces to be placed for a
 * given semester. A binding with no `semester` applies to both semesters.
 */
export function boundRuleIdsForSemester(
  allowedConflicts: AllowedConflict[] | undefined,
  semester?: 'semester1' | 'semester2'
): Set<string> {
  const rules = new Set<string>();
  for (const a of allowedConflicts || []) {
    if (a.kind !== 'pair') continue;
    if (a.semester && a.semester !== semester) continue;
    if (a.ruleIdA) rules.add(a.ruleIdA);
    if (a.ruleIdB) rules.add(a.ruleIdB);
  }
  return rules;
}

/**
 * True when a lesson (by ruleId) participates in a pair binding for the given
 * semester. Used by the analyzer and views to suppress the bound pair's
 * conflict (it is allowed by agreement, not an error). Binds to a lesson's
 * ruleId because a pair is a rule-to-rule contract that outlives regenerated
 * lesson ids.
 */
export function isLessonInBoundPair(
  allowedConflicts: AllowedConflict[] | undefined,
  ruleId: string,
  semester?: 'semester1' | 'semester2'
): boolean {
  if (!allowedConflicts) return false;
  return allowedConflicts.some(
    (a) => a.kind === 'pair' &&
      (!a.semester || a.semester === semester) &&
      (a.ruleIdA === ruleId || a.ruleIdB === ruleId)
  );
}

function involvedGroups(
  lesson: { teacherId?: string; groupId: string; roomId?: string },
  causes: Array<{ teacherId?: string; groupId: string; roomId?: string }>
): string[] {
  const groups = new Set<string>([lesson.groupId]);
  for (const cause of causes) groups.add(cause.groupId);
  return [...groups];
}

/**
 * Build the deduped pair-binding records for a clicked lesson against its
 * conflicting partner lessons. Each distinct partner gets its own
 * `kind: 'pair'` record tying `lesson.ruleId` to the partner's ruleId, scoped to
 * `semester` (or both when undefined). This is the "allow these 2 lessons that
 * conflict right now" action: it is NOT whole-class - only the two bound rules
 * are required to be placed together on future generations.
 */
export function buildPairBindingRecords(
  lesson: { ruleId: string; day: string; period: number; teacherId?: string; groupId: string },
  causes: Array<{ ruleId: string; day: string; period: number; teacherId?: string; groupId: string }>,
  semester?: 'semester1' | 'semester2',
  reason: AllowedConflictReason = 'TEACHER_SLOT'
): AllowedConflict[] {
  const out: AllowedConflict[] = [];
  const seen = new Set<string>();
  for (const cause of causes) {
    if (cause.ruleId === lesson.ruleId) continue;
    const pairKey = `${[lesson.ruleId, cause.ruleId].sort().join('|')}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    out.push({
      id: crypto.randomUUID(),
      kind: 'pair',
      ruleIdA: lesson.ruleId,
      ruleIdB: cause.ruleId,
      semester,
      reason,
    });
  }
  return out;
}

/**
 * The legacy consensus records writer (teacher/group/room entity consent). Kept
 * for back-compat; new pair bindings go through {@link buildPairBindingRecords}.
 */
export function recordsToAllowLesson(
  lesson: { teacherId?: string; groupId: string; roomId?: string },
  causes: Array<{ teacherId?: string; groupId: string; roomId?: string }>,
  reasons: AllowedConflictReason[]
): AllowedConflict[] {
  const out: AllowedConflict[] = [];
  const seen = new Set<string>();
  const push = (a: AllowedConflict) => {
    const sig = allowedConflictSignature(a);
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push(a);
  };
  for (const reason of reasons) {
    if (reason === ALL_CONFLICT_REASON) continue;
    if (reason === 'TEACHER_SLOT' && lesson.teacherId) {
      for (const groupId of involvedGroups(lesson, causes)) {
        push({ id: crypto.randomUUID(), kind: 'teacher', teacherId: lesson.teacherId, groupId, reason });
      }
    } else if (reason === 'ROOM_SLOT' && lesson.roomId) {
      for (const groupId of involvedGroups(lesson, causes)) {
        push({ id: crypto.randomUUID(), kind: 'room', roomId: lesson.roomId, groupId, reason });
      }
    } else if (reason === 'TEACHER_BUSY' && lesson.teacherId) {
      push({ id: crypto.randomUUID(), kind: 'teacher', teacherId: lesson.teacherId, groupId: lesson.groupId, reason });
    } else {
      push({ id: crypto.randomUUID(), kind: 'group', groupId: lesson.groupId, reason });
    }
  }
  return out;
}