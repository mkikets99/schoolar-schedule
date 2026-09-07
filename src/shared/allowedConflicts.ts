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
  return `${a.kind}|${a.reason}|${a.teacherId ?? ''}|${a.groupId ?? ''}|${a.roomId ?? ''}`;
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
 * Build the deduped permission records that make every given reason for a
 * lesson allowed. For overlaps (TEACHER_SLOT / ROOM_SLOT) every involved class
 * gets its own consent record so both sides of the agreement are present.
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