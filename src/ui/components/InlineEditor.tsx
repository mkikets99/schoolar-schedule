import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CurriculumRule, Lesson, ProjectState, RearrangeBlockReason, RearrangeSuggestion, ScheduleResult, SemesterSplit } from '../../shared/types';
import { analyzeSchedule, buildConflicts, computeScore, countLessons } from '../services/scheduleAnalyzer';
import { suggestRearrangeChoices } from '../../worker/rearrange';
import { SearchableSelect } from './SearchableSelect';
import { Modal } from './Modal';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const ALL_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

interface InlineEditorProps {
  project: ProjectState;
  activeSemester: 'semester1' | 'semester2';
  onSave: (result: ScheduleResult, splits?: SemesterSplit[]) => void;
  editMode?: 'group' | 'teacher';
  active?: boolean;
  sessionKey?: number;
}

interface HistoryEntry {
  grid: Lesson[];
  pool: Lesson[];
  poolSource: Record<string, 'semester1' | 'semester2'>;
  splits: SemesterSplit[];
}

export const InlineEditor = ({ project, activeSemester, onSave, editMode = 'group', active = true, sessionKey }: InlineEditorProps) => {
  const { t } = useTranslation();
  const [gridLessons, setGridLessons] = useState<Lesson[]>([]);
  const [poolLessons, setPoolLessons] = useState<Lesson[]>([]);
  const [poolSource, setPoolSource] = useState<Record<string, 'semester1' | 'semester2'>>({});
  const [workingSplits, setWorkingSplits] = useState<SemesterSplit[]>([]);
  const [hover, setHover] = useState<{ day: string; period: number } | null>(null);
  const [curriculumOpen, setCurriculumOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(project.groups[0]?.id || '');
  const [selectedTeacherId, setSelectedTeacherId] = useState<string>(project.teachers[0]?.id || '');
  const [pendingSuggestion, setPendingSuggestion] = useState<{
    lessonId: string;
    day: string;
    period: number;
    suggestion: RearrangeSuggestion;
  } | null>(null);
  const [pendingChoices, setPendingChoices] = useState<{
    lessonId: string;
    day: string;
    period: number;
    choices: RearrangeSuggestion[];
  } | null>(null);
  const [blockedLesson, setBlockedLesson] = useState<{ name: string; day: string; period: number; reason?: RearrangeBlockReason } | null>(null);
  const historyRef = useRef<HistoryEntry[]>([]);
  const dragRef = useRef<string | null>(null);
  const lastSourceRef = useRef<{ semester: 'semester1' | 'semester2'; session: number | undefined } | null>(null);
  const pendingSourceRef = useRef<{ semester: 'semester1' | 'semester2'; session: number | undefined } | null>(null);

  const groups = project.groups || [];
  const teachers = project.teachers || [];
  const subjects = project.subjects || [];

  const getSubject = (id: string) => subjects.find(s => s.id === id);
  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name || '';
  const getTeacherName = (id?: string) => teachers.find(t => t.id === id)?.shortName || teachers.find(t => t.id === id)?.name || '';

  const blockReasonKey = (reason: RearrangeBlockReason): string => {
    const keyMap: Record<RearrangeBlockReason, string> = {
      GROUP_SLOT: 'rearrange_block_group_slot',
      NO_FIRST_PERIOD: 'rearrange_block_no_first',
      DAILY_OVERLOAD: 'rearrange_block_daily_overload',
      DAILY_RULE: 'rearrange_block_daily_rule',
      TEACHER_BUSY: 'rearrange_block_teacher_busy',
      SPLIT_PARTNER: 'rearrange_block_split_partner',
      NO_SPACE: 'rearrange_block_no_space',
    };
    return keyMap[reason];
  };

  const ruleById = useMemo(() => new Map((project.curriculum || []).map(r => [r.id, r])), [project.curriculum]);
  const lessonTeacherId = (lesson: Lesson) => lesson.teacherId || ruleById.get(lesson.ruleId)?.teacherId;
  const belongsToTeacher = (lesson: Lesson, teacherId: string) => lessonTeacherId(lesson) === teacherId;

  const makePending = (rule: CurriculumRule, id: string): Lesson => ({
    id,
    ruleId: rule.id,
    groupId: rule.groupId,
    subjectId: rule.subjectId,
    teacherId: rule.teacherId,
    roomId: rule.roomId,
    day: '',
    period: 0,
  });

  const needFor = (rule: CurriculumRule, sem: 'semester1' | 'semester2', splits: SemesterSplit[]): number => {
    const split = splits.find(s => s.ruleId === rule.id);
    if (split) return sem === 'semester1' ? split.first : split.second;
    return Math.ceil(rule.hoursPerWeek);
  };

  // Pure helper: move `delta` hours of a rule from one semester to the other while
  // keeping the annual total (first + second) constant.
  const adjustSplits = (
    splits: SemesterSplit[],
    ruleId: string,
    fromSem: 'semester1' | 'semester2',
    toSem: 'semester1' | 'semester2',
    delta: number,
  ): SemesterSplit[] => {
    if (fromSem === toSem || delta === 0) return splits;
    const next = splits.map(s => ({ ...s }));
    const s = next.find(x => x.ruleId === ruleId);
    if (!s) return splits;
    const fromKey = fromSem === 'semester1' ? 'first' : 'second';
    const toKey = toSem === 'semester1' ? 'first' : 'second';
    s[fromKey] = Math.max(0, (s[fromKey] ?? 0) - delta);
    s[toKey] = (s[toKey] ?? 0) + delta;
    return next;
  };

  const seed = () => {
    const twoSemester = !!project.generatedSchedules;
    const splits = twoSemester ? (project.generatedSplits || []).map(s => ({ ...s })) : [];

    if (!twoSemester) {
      // Legacy single-schedule project: one semester's worth of lessons, no splits.
      const placed = (project.generatedSchedule?.schedule || []).map(l => ({ ...l }));
      const placedCount = new Map<string, number>();
      for (const l of placed) placedCount.set(l.ruleId, (placedCount.get(l.ruleId) || 0) + 1);
      const pool: Lesson[] = [];
      const source: Record<string, 'semester1' | 'semester2'> = {};
      for (const rule of project.curriculum) {
        const miss = Math.max(0, Math.ceil(rule.hoursPerWeek) - (placedCount.get(rule.id) || 0));
        for (let i = 0; i < miss; i++) {
          const id = `pending-${rule.id}-${i}`;
          pool.push(makePending(rule, id));
          source[id] = activeSemester;
        }
      }
      setGridLessons(placed);
      setPoolLessons(pool);
      setPoolSource(source);
      setWorkingSplits(splits);
      historyRef.current = [];
      return;
    }

    const s1 = project.generatedSchedules!.semester1;
    const s2 = project.generatedSchedules!.semester2;
    const placed1 = (s1.schedule || []).map(l => ({ ...l }));
    const placed2 = (s2.schedule || []).map(l => ({ ...l }));

    const placedBySem = (sem: 'semester1' | 'semester2', ruleId: string) =>
      (sem === 'semester1' ? placed1 : placed2).filter(l => l.ruleId === ruleId).length;

    // The unassigned pool aggregates lessons missing from BOTH semesters so the
    // user can drag any of them into whichever semester is being edited.
    const pool: Lesson[] = [];
    const source: Record<string, 'semester1' | 'semester2'> = {};
    for (const rule of project.curriculum) {
      const miss1 = Math.max(0, needFor(rule, 'semester1', splits) - placedBySem('semester1', rule.id));
      const miss2 = Math.max(0, needFor(rule, 'semester2', splits) - placedBySem('semester2', rule.id));
      for (let i = 0; i < miss1; i++) {
        const id = `pending-${rule.id}-s1-${i}`;
        pool.push(makePending(rule, id));
        source[id] = 'semester1';
      }
      for (let i = 0; i < miss2; i++) {
        const id = `pending-${rule.id}-s2-${i}`;
        pool.push(makePending(rule, id));
        source[id] = 'semester2';
      }
    }
    setGridLessons(activeSemester === 'semester1' ? placed1 : placed2);
    setPoolLessons(pool);
    setPoolSource(source);
    setWorkingSplits(splits);
    historyRef.current = [];
  };

  useEffect(() => {
    // The editor keeps its in-progress draft while hidden (view mode) so
    // toggling view/edit never discards edits. The draft is reseeded only when
    // its source changed while hidden (semester switch or a new generation
    // session) or when the user switches semester / regenerates while editing.
    const source = { semester: activeSemester, session: sessionKey };
    if (!active) {
      pendingSourceRef.current = source;
      return;
    }
    const pending = pendingSourceRef.current;
    const last = lastSourceRef.current;
    if (pending && last && pending.semester === last.semester && pending.session === last.session) {
      pendingSourceRef.current = null;
      return;
    }
    seed();
    lastSourceRef.current = source;
    pendingSourceRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, activeSemester, sessionKey]);

  const commit = (next: { grid: Lesson[]; pool: Lesson[]; poolSource: Record<string, 'semester1' | 'semester2'>; splits: SemesterSplit[] }) => {
    historyRef.current.push({ grid: gridLessons, pool: poolLessons, poolSource: { ...poolSource }, splits: workingSplits });
    if (historyRef.current.length > 50) historyRef.current.shift();
    setGridLessons(next.grid);
    setPoolLessons(next.pool);
    setPoolSource(next.poolSource);
    setWorkingSplits(next.splits);
  };

  const mainTeacherOf = (lesson: Lesson): string | undefined =>
    lesson.teacherId || ruleById.get(lesson.ruleId)?.teacherId;

  const commitFromMoves = (
    id: string,
    day: string,
    period: number,
    suggestion: RearrangeSuggestion | null
  ) => {
    const poolLesson = poolLessons.find(l => l.id === id);
    const src = poolSource[id];

    if (!suggestion || suggestion.moves.length === 0) {
      return;
    }

    const teacher = suggestion.teacherIdForMain ??
      mainTeacherOf(poolLesson || gridLessons.find(l => l.id === id)!);

    // Relocate all extra-move lessons first (they live on the grid).
    let grid = gridLessons.map(l => ({ ...l }));
    for (const m of suggestion.moves.slice(1)) {
      grid = grid.map(l => (l.id === m.lessonId ? { ...l, day: m.toDay, period: m.toPeriod } : l));
    }

    // Apply the main move.
    let pool: Lesson[];
    let splits = workingSplits;
    if (poolLesson) {
      grid = [...grid, { ...poolLesson, day, period, teacherId: teacher }];
      pool = poolLessons.filter(l => l.id !== id);
      // Placing a lesson unassigned in the OTHER semester shifts one hour from
      // that semester to the one being edited.
      if (src && src !== activeSemester) {
        splits = adjustSplits(workingSplits, poolLesson.ruleId, src, activeSemester, 1);
      }
    } else {
      grid = grid.map(l => (l.id === id ? { ...l, day, period, teacherId: teacher } : l));
      pool = poolLessons;
    }

    commit({ grid, pool, poolSource, splits });
  };

  const moveLesson = (id: string, day: string, period: number) => {
    const poolLesson = poolLessons.find(l => l.id === id);
    const existing = gridLessons.find(l => l.id === id);
    if (!poolLesson && !existing) return;

    // The rearrange engine expects the moved lesson to be part of the schedule;
    // for a pool placement we include it at the target so validation sees it.
    const baseSchedule = existing
      ? gridLessons
      : [...gridLessons, { ...poolLesson!, day, period }];

    const choices = suggestRearrangeChoices(project, baseSchedule, id, { day, period });
    const movedTeacherId = poolLesson ? lessonTeacherId(poolLesson) : lessonTeacherId(existing!);

    // In teacher edit mode a solution must NOT reassign the lesson to another
    // teacher - drops that would do so are treated as blocked.
    const feasible = choices.filter(c => c.feasible &&
      (editMode !== 'teacher' || !c.teacherIdForMain || c.teacherIdForMain === movedTeacherId));

    const suggestion = feasible[0] ?? choices[0] ?? { feasible: false, moves: [], reason: 'NO_SPACE' as const };

    if (feasible.length === 0 || !suggestion.feasible) {
      const name = editMode === 'teacher'
        ? getTeacherName(selectedTeacherId) || getTeacherName(movedTeacherId) || ''
        : poolLesson
          ? getGroupName(poolLesson.groupId)
          : getGroupName(existing!.groupId);
      setBlockedLesson({ name, day, period, reason: suggestion.reason });
      return;
    }

    // Multiple distinct AI solutions: let the user choose which to apply.
    if (feasible.length > 1) {
      setPendingChoices({ lessonId: id, day, period, choices: feasible });
      return;
    }

    const isDirect = suggestion.moves.length === 1 && !suggestion.teacherIdForMain;
    if (isDirect) {
      commitFromMoves(id, day, period, suggestion);
    } else {
      setPendingSuggestion({ lessonId: id, day, period, suggestion });
    }
  };

  const confirmSuggestion = () => {
    if (!pendingSuggestion) return;
    commitFromMoves(pendingSuggestion.lessonId, pendingSuggestion.day, pendingSuggestion.period, pendingSuggestion.suggestion);
    setPendingSuggestion(null);
  };

  const confirmChoice = (suggestion: RearrangeSuggestion) => {
    if (!pendingChoices) return;
    commitFromMoves(pendingChoices.lessonId, pendingChoices.day, pendingChoices.period, suggestion);
    setPendingChoices(null);
  };

  const unassignLesson = (id: string) => {
    const existing = gridLessons.find(l => l.id === id);
    if (!existing) return;
    const src = poolSource[id];

    // Returning a cross-semester lesson to the pool reverts the hour shift.
    const nextSplits = src && src !== activeSemester
      ? adjustSplits(workingSplits, existing.ruleId, activeSemester, src, 1)
      : workingSplits;

    commit({
      grid: gridLessons.filter(l => l.id !== id),
      pool: [...poolLessons, { ...existing, day: '', period: 0 }],
      poolSource,
      splits: nextSplits,
    });
  };

  const undo = () => {
    const last = historyRef.current.pop();
    if (!last) return;
    setGridLessons(last.grid);
    setPoolLessons(last.pool);
    setPoolSource(last.poolSource);
    setWorkingSplits(last.splits);
  };

  // Unassigned lessons that belong to the active semester drive this view's
  // counts/conflicts; the rest are still draggable from the shared pool.
  const activePool = useMemo(
    () => poolLessons.filter(l => (poolSource[l.id] || activeSemester) === activeSemester),
    [poolLessons, poolSource, activeSemester]
  );

  const analysis = useMemo(
    () => analyzeSchedule(gridLessons, activePool, project),
    [gridLessons, activePool, project]
  );

  const visibleGrid = useMemo(
    () => gridLessons.filter(l =>
      editMode === 'teacher' ? belongsToTeacher(l, selectedTeacherId) : l.groupId === selectedGroupId
    ),
    [gridLessons, selectedGroupId, selectedTeacherId, editMode, ruleById]
  );
  const visiblePool = useMemo(
    () => poolLessons.filter(l =>
      editMode === 'teacher' ? belongsToTeacher(l, selectedTeacherId) : l.groupId === selectedGroupId
    ),
    [poolLessons, selectedGroupId, selectedTeacherId, editMode, ruleById]
  );
  const visibleConflictCount = useMemo(
    () => new Set(
      visibleGrid
        .filter(l => (analysis.byLesson.get(l.id) || []).length > 0)
        .map(l => `${editMode === 'teacher' ? lessonTeacherId(l) : l.groupId}|${l.subjectId}|${l.day}|${l.period}`)
    ).size,
    [visibleGrid, analysis, editMode, lessonTeacherId]
  );

  const counts = useMemo(
    () => countLessons(visibleGrid, visiblePool, project),
    [visibleGrid, visiblePool, project]
  );

  // Needed curriculum distribution: for every entered curriculum rule, how many
  // lessons each semester requires (from the working splits) and how many of the
  // active semester's are already placed / still in the unassigned pool.
  const distributionRows = useMemo(() => {
    const placedByRule = new Map<string, number>();
    for (const lesson of gridLessons) {
      placedByRule.set(lesson.ruleId, (placedByRule.get(lesson.ruleId) || 0) + 1);
    }
    const unassignedByRule = new Map<string, number>();
    for (const lesson of activePool) {
      unassignedByRule.set(lesson.ruleId, (unassignedByRule.get(lesson.ruleId) || 0) + 1);
    }
    const rules = editMode === 'teacher'
      ? (project.curriculum || []).filter(r => r.teacherId === selectedTeacherId)
      : (project.curriculum || []);
    const rows = rules.map(rule => {
      const split = workingSplits.find(s => s.ruleId === rule.id);
      const first = split?.first ?? Math.ceil(rule.hoursPerWeek);
      const second = split?.second ?? Math.ceil(rule.hoursPerWeek);
      return {
        ruleId: rule.id,
        groupName: getGroupName(rule.groupId),
        subjectName: getSubject(rule.subjectId)?.name || '???',
        teacherName: getTeacherName(rule.teacherId),
        hours: rule.hoursPerWeek,
        first,
        second,
        activeNeeded: activeSemester === 'semester1' ? first : second,
        placed: placedByRule.get(rule.id) || 0,
        unassigned: unassignedByRule.get(rule.id) || 0,
      };
    });
    rows.sort((a, b) => a.groupName.localeCompare(b.groupName) || a.subjectName.localeCompare(b.subjectName));
    return rows;
  }, [project, workingSplits, activeSemester, gridLessons, activePool, getGroupName, getSubject, getTeacherName, editMode, selectedTeacherId]);

  const lessonsBySlot = useMemo(() => {
    const map = new Map<string, Lesson[]>();
    for (const lesson of visibleGrid) {
      const key = `${lesson.day}|${lesson.period}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(lesson);
    }
    return map;
  }, [visibleGrid]);

  const handleDragStart = (e: DragEvent, id: string) => {
    dragRef.current = id;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  };

  const periodFromEvent = (e: DragEvent): number => {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const ratio = ((e.clientX ?? 0) - (rect.left ?? 0)) / Math.max(1, rect.width || 1);
    const clamped = Number.isFinite(ratio) ? ratio : 0;
    return Math.min(ALL_PERIODS.length, Math.max(1, Math.floor(clamped * ALL_PERIODS.length) + 1));
  };

  const handleTrackDragOver = (e: DragEvent, day: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setHover({ day, period: periodFromEvent(e) });
  };

  const handleTrackDrop = (e: DragEvent, day: string) => {
    e.preventDefault();
    const id = dragRef.current || e.dataTransfer.getData('text/plain');
    if (id) moveLesson(id, day, periodFromEvent(e));
    setHover(null);
    dragRef.current = null;
  };

  const handlePoolDrop = (e: DragEvent) => {
    e.preventDefault();
    const id = dragRef.current || e.dataTransfer.getData('text/plain');
    if (id) unassignLesson(id);
    setHover(null);
    dragRef.current = null;
  };

  const handleApply = () => {
    onSave({
      schedule: gridLessons,
      conflicts: buildConflicts(gridLessons, activePool, project),
      score: computeScore(gridLessons, activePool, project),
    }, project.generatedSchedules ? workingSplits : undefined);
  };

  const handleReset = () => {
    if (confirm(t('editor_confirm_reset'))) seed();
  };

  const formatLesson = (l: Lesson) => {
    const subject = getSubject(l.subjectId);
    const parts = [getGroupName(l.groupId), subject?.shortName || subject?.name || '?'];
    const teacher = getTeacherName(l.teacherId);
    if (teacher) parts.push(teacher);
    return `${parts.join(' • ')} — ${t(l.day.toLowerCase())}, ${t('period')} ${l.period}`;
  };

  const lessonTitle = (lesson: Lesson, reasons: string[]) => {
    if (reasons.length === 0) return `${getGroupName(lesson.groupId)} • ${getTeacherName(lesson.teacherId)}`;
    const lines = reasons.map(r => t(r));
    for (const cause of analysis.causesByLesson.get(lesson.id) || []) {
      lines.push(`${t('conflict_caused_by')}: ${formatLesson(cause)}`);
    }
    return lines.join('\n');
  };

  const renderMoveSummary = (suggestion: RearrangeSuggestion): ReactNode => {
    const first = suggestion.moves[0];
    const moved = gridLessons.find(x => x.id === first?.lessonId)
      ?? poolLessons.find(x => x.id === first?.lessonId);
    const subj = moved ? getSubject(moved.subjectId) : undefined;
    const gname = moved ? getGroupName(moved.groupId) : '';
    const extraCount = Math.max(0, suggestion.moves.length - 1);
    const teacherChanged = suggestion.teacherIdForMain;
    const label = `${subj?.shortName || subj?.name || '?'} — ${gname} → ${first ? `${t(first.toDay.toLowerCase())}, ${t('period')} ${first.toPeriod}` : ''}`;
    return (
      <>
        <span>
          {label}
          {teacherChanged && (
            <span className="rearrange-swap">
              {` ${t('rearrange_swap')}: ${moved ? getTeacherName(mainTeacherOf(moved)) : ''} → ${getTeacherName(teacherChanged)}`}
            </span>
          )}
        </span>
        {extraCount > 0 && <span className="choose-extra">{t('rearrange_choose_extra', { count: extraCount })}</span>}
      </>
    );
  };

  const renderMoveList = (suggestion: RearrangeSuggestion) => (
    <div className="detail-list">
      {suggestion.moves.map((m, i) => {
        const l = gridLessons.find(x => x.id === m.lessonId)
          ?? poolLessons.find(x => x.id === m.lessonId);
        const subj = l ? getSubject(l.subjectId) : undefined;
        const gname = l ? getGroupName(l.groupId) : '';
        const teacherChanged = i === 0 && suggestion.teacherIdForMain;
        const teacherName = teacherChanged
          ? getTeacherName(suggestion.teacherIdForMain)
          : l ? getTeacherName(mainTeacherOf(l)) : '';
        return (
          <div key={`${m.lessonId}-${i}`} className="detail-row">
            <span className="detail-main">
              {subj?.shortName || subj?.name || '?'} — {gname}
              {teacherChanged ? (
                <span className="rearrange-swap">
                  {t('rearrange_swap')}: {l ? getTeacherName(mainTeacherOf(l)) : ''} → {getTeacherName(suggestion.teacherIdForMain)}
                </span>
              ) : teacherName ? (
                <span> ({teacherName})</span>
              ) : null}
            </span>
            <span className="detail-meta">
              {t('period')} {l?.period ?? '-'} → {m.toPeriod} • {t(m.toDay.toLowerCase())}
            </span>
          </div>
        );
      })}
    </div>
  );

  const renderLesson = (lesson: Lesson) => {
    const reasons = analysis.byLesson.get(lesson.id) || [];
    const subject = getSubject(lesson.subjectId);
    const conflicted = reasons.length > 0;
    return (
      <div
        key={lesson.id}
        className={`timeline-lesson ${conflicted ? 'conflict' : ''}`}
        draggable
        onDragStart={(e) => handleDragStart(e, lesson.id)}
        style={{ borderLeftColor: subject?.color || undefined }}
        title={lessonTitle(lesson, reasons)}
      >
        <span className="timeline-lesson-subject">{subject?.shortName || subject?.name || '?'}</span>
        <span className="timeline-lesson-group">{getGroupName(lesson.groupId)}</span>
        {conflicted && <span className="timeline-lesson-conflict-badge">!</span>}
        <button
          className="timeline-lesson-remove"
          draggable={false}
          onClick={() => unassignLesson(lesson.id)}
          title={t('editor_remove')}
        >
          &times;
        </button>
      </div>
    );
  };

  return (
    <div className="inline-editor">
      <div className="inline-editor-toolbar">
        {editMode === 'teacher' ? (
          <>
            <label className="editor-class-label">{t('teacher')}:</label>
            <SearchableSelect
              className="table-filter"
              value={selectedTeacherId}
              onChange={setSelectedTeacherId}
              options={teachers.map(tc => ({ value: tc.id, label: tc.name || tc.shortName || tc.id }))}
            />
          </>
        ) : (
          <>
            <label className="editor-class-label">{t('group')}:</label>
            <SearchableSelect
              className="table-filter"
              value={selectedGroupId}
              onChange={setSelectedGroupId}
              options={groups.map(g => ({ value: g.id, label: g.name }))}
            />
          </>
        )}
        <button className="export-btn" onClick={() => setCurriculumOpen(true)}>{t('editor_curriculum_distribution')}</button>
        <button className="export-btn" onClick={undo} disabled={historyRef.current.length === 0}>{t('editor_undo')}</button>
        <button className="export-btn" onClick={handleApply}>{t('editor_apply')}</button>
        <button className="export-btn" onClick={handleReset}>{t('editor_reset')}</button>
        <span className="summary-badge">
          {t('editor_assigned_count', { assigned: counts.assigned, needed: counts.needed })}
        </span>
        <span className={`summary-badge ${visibleConflictCount > 0 ? 'conflict-count' : ''}`}>
          {visibleConflictCount} {t('conflicts').toLowerCase()}
        </span>
      </div>

      <p className="editor-hint">{t(editMode === 'teacher' ? 'editor_hint_teacher' : 'editor_hint')}</p>

      <div className="inline-editor-body">
        <div className="timeline">
          <div className="timeline-header">
            <div className="timeline-header-spacer" />
            {ALL_PERIODS.map(p => (
              <div key={p} className="timeline-header-period">{p}</div>
            ))}
          </div>

          {DAYS.map(day => {
            const hasHover = hover?.day === day;
            return (
              <div
                key={day}
                className="timeline-day"
                onDragOver={(e) => handleTrackDragOver(e, day)}
                onDragLeave={(e) => {
                  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setHover(null);
                }}
                onDrop={(e) => handleTrackDrop(e, day)}
              >
                <div className="timeline-day-name">{t(day.toLowerCase())}</div>
                <div className="timeline-track">
                  {ALL_PERIODS.map(p => {
                    const key = `${day}|${p}`;
                    const slotLessons = lessonsBySlot.get(key) || [];
                    const hasConflict = slotLessons.some(l => (analysis.byLesson.get(l.id) || []).length > 0);
                    return (
                      <div
                        key={p}
                        className={`timeline-slot ${hasHover && hover?.period === p ? 'hover' : ''} ${hasConflict ? 'has-conflict' : ''}`}
                      >
                        {slotLessons.map(renderLesson)}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div className="checker-zone" onDragOver={(e) => e.preventDefault()} onDrop={handlePoolDrop}>
          <h4 className="checker-zone-title">
            {t('editor_unassigned')} — {editMode === 'teacher' ? getTeacherName(selectedTeacherId) : getGroupName(selectedGroupId)} ({counts.unassigned})
          </h4>
          <p className="checker-zone-hint">{t('editor_checker_hint')}</p>
          {visiblePool.length === 0 ? (
            <div className="checker-empty">{t('no_unassigned')}</div>
          ) : (
            <div className="checker-list">
              {visiblePool.map(lesson => {
                const subject = getSubject(lesson.subjectId);
                const src = poolSource[lesson.id] || activeSemester;
                return (
                  <div
                    key={lesson.id}
                    className={`checker-chip ${src !== activeSemester ? 'other-semester' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, lesson.id)}
                    style={{ borderLeftColor: subject?.color || undefined }}
                    title={`${getGroupName(lesson.groupId)} • ${getTeacherName(lesson.teacherId)}`}
                  >
                    <span className="checker-chip-subject">{subject?.shortName || subject?.name || '?'}</span>
                    <span className="checker-chip-group">{getGroupName(lesson.groupId)}</span>
                    <span className="checker-chip-teacher">{getTeacherName(lesson.teacherId)}</span>
                    <span className="checker-chip-sem">{t(src === 'semester2' ? 'semester_2' : 'semester_1')}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Modal isOpen={curriculumOpen} onClose={() => setCurriculumOpen(false)} title={t('editor_curriculum_distribution')}>
        <p className="editor-hint">{t('needed_distribution_hint')}</p>
        {distributionRows.length === 0 ? (
          <div className="detail-empty">{t('no_rules')}</div>
        ) : (
          <div className="detail-list">
            {distributionRows.map(row => (
              <div key={row.ruleId} className={`detail-row${row.placed !== row.activeNeeded ? ' detail-mismatch' : ''}`}>
                <span className="detail-main">
                  {row.subjectName} — {row.groupName}
                  {row.teacherName && <span> ({row.teacherName})</span>}
                </span>
                <span className="detail-meta">
                  {t('semester_1')}: {row.first} • {t('semester_2')}: {row.second} • {t('hrs_wk')}: {row.hours}
                </span>
                <div className="detail-sub">
                  {t('editor_assigned_count', { assigned: row.placed, needed: row.activeNeeded })}
                  {row.unassigned > 0 && ` • ${t('editor_unassigned')}: ${row.unassigned}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal isOpen={!!pendingSuggestion} onClose={() => setPendingSuggestion(null)} title={t('rearrange_confirm_title')}>
        <p className="editor-hint">{t('rearrange_confirm_desc')}</p>
        {pendingSuggestion && renderMoveList(pendingSuggestion.suggestion)}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button onClick={() => setPendingSuggestion(null)} className="secondary-btn">{t('rearrange_confirm_cancel')}</button>
          <button onClick={confirmSuggestion} className="primary-btn">{t('rearrange_confirm_accept')}</button>
        </div>
      </Modal>

      <Modal isOpen={!!pendingChoices} onClose={() => setPendingChoices(null)} title={t('rearrange_choose_title')}>
        <p className="editor-hint">{t('rearrange_choose_desc')}</p>
        {pendingChoices && (
          <div className="detail-list">
            {pendingChoices.choices.map((choice, idx) => (
              <div key={idx} className="detail-row choose-row" onClick={() => confirmChoice(choice)} role="button" tabIndex={0}>
                <span className="detail-main">
                  {renderMoveSummary(choice)}
                </span>
                <button
                  className="primary-btn choose-apply"
                  onClick={(e) => { e.stopPropagation(); confirmChoice(choice); }}
                >
                  {t('rearrange_choose_apply')}
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button onClick={() => setPendingChoices(null)} className="secondary-btn">{t('rearrange_confirm_cancel')}</button>
        </div>
      </Modal>

      <Modal isOpen={!!blockedLesson} onClose={() => setBlockedLesson(null)} title={t('rearrange_blocked_title')}>
        <p className="editor-hint">
          {t('rearrange_blocked_desc', { group: blockedLesson?.name, day: blockedLesson ? t(blockedLesson.day.toLowerCase()) : '', period: blockedLesson?.period })}
        </p>
        {blockedLesson?.reason && (
          <p className="editor-hint rearrange-block-reason">
            {t(blockReasonKey(blockedLesson.reason))}
          </p>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
          <button onClick={() => setBlockedLesson(null)} className="primary-btn">{t('ok')}</button>
        </div>
      </Modal>
    </div>
  );
};
