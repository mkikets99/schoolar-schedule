import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CurriculumRule, Lesson, ProjectState, ScheduleResult, SemesterSplit } from '../../shared/types';
import { analyzeSchedule, buildConflicts, computeScore, countLessons } from '../services/scheduleAnalyzer';
import { SearchableSelect } from './SearchableSelect';
import { Modal } from './Modal';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const ALL_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

interface InlineEditorProps {
  project: ProjectState;
  activeSemester: 'semester1' | 'semester2';
  onSave: (result: ScheduleResult, splits?: SemesterSplit[]) => void;
}

interface HistoryEntry {
  grid: Lesson[];
  pool: Lesson[];
  poolSource: Record<string, 'semester1' | 'semester2'>;
  splits: SemesterSplit[];
}

export const InlineEditor = ({ project, activeSemester, onSave }: InlineEditorProps) => {
  const { t } = useTranslation();
  const [gridLessons, setGridLessons] = useState<Lesson[]>([]);
  const [poolLessons, setPoolLessons] = useState<Lesson[]>([]);
  const [poolSource, setPoolSource] = useState<Record<string, 'semester1' | 'semester2'>>({});
  const [workingSplits, setWorkingSplits] = useState<SemesterSplit[]>([]);
  const [hover, setHover] = useState<{ day: string; period: number } | null>(null);
  const [curriculumOpen, setCurriculumOpen] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(project.groups[0]?.id || '');
  const historyRef = useRef<HistoryEntry[]>([]);
  const dragRef = useRef<string | null>(null);

  const groups = project.groups || [];
  const teachers = project.teachers || [];
  const subjects = project.subjects || [];

  const getSubject = (id: string) => subjects.find(s => s.id === id);
  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name || '';
  const getTeacherName = (id?: string) => teachers.find(t => t.id === id)?.shortName || teachers.find(t => t.id === id)?.name || '';

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
    seed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSemester]);

  const commit = (next: { grid: Lesson[]; pool: Lesson[]; poolSource: Record<string, 'semester1' | 'semester2'>; splits: SemesterSplit[] }) => {
    historyRef.current.push({ grid: gridLessons, pool: poolLessons, poolSource: { ...poolSource }, splits: workingSplits });
    if (historyRef.current.length > 50) historyRef.current.shift();
    setGridLessons(next.grid);
    setPoolLessons(next.pool);
    setPoolSource(next.poolSource);
    setWorkingSplits(next.splits);
  };

  const moveLesson = (id: string, day: string, period: number) => {
    const poolLesson = poolLessons.find(l => l.id === id);
    const src = poolSource[id];
    if (!poolLesson && !gridLessons.some(l => l.id === id)) return;

    let grid: Lesson[];
    let pool: Lesson[];
    if (poolLesson) {
      grid = [...gridLessons, { ...poolLesson, day, period }];
      pool = poolLessons.filter(l => l.id !== id);
    } else {
      grid = gridLessons.map(l => (l.id === id ? { ...l, day, period } : l));
      pool = poolLessons;
    }

    // Placing a lesson that was unassigned in the OTHER semester shifts one hour
    // from that semester to the one being edited.
    const nextSplits = poolLesson && src && src !== activeSemester
      ? adjustSplits(workingSplits, poolLesson.ruleId, src, activeSemester, 1)
      : workingSplits;

    commit({ grid, pool, poolSource, splits: nextSplits });
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
    () => gridLessons.filter(l => l.groupId === selectedGroupId),
    [gridLessons, selectedGroupId]
  );
  const visiblePool = useMemo(
    () => poolLessons.filter(l => l.groupId === selectedGroupId),
    [poolLessons, selectedGroupId]
  );
  const visibleConflictCount = useMemo(
    () => new Set(
      visibleGrid
        .filter(l => (analysis.byLesson.get(l.id) || []).length > 0)
        .map(l => `${l.groupId}|${l.subjectId}|${l.day}|${l.period}`)
    ).size,
    [visibleGrid, analysis]
  );

  const counts = useMemo(
    () => countLessons(visibleGrid, activePool, project),
    [visibleGrid, activePool, project]
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
    const rows = (project.curriculum || []).map(rule => {
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
  }, [project, workingSplits, activeSemester, gridLessons, activePool, getGroupName, getSubject, getTeacherName]);

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
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
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
        <label className="editor-class-label">{t('group')}:</label>
        <SearchableSelect
          className="table-filter"
          value={selectedGroupId}
          onChange={setSelectedGroupId}
          options={groups.map(g => ({ value: g.id, label: g.name }))}
        />
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

      <p className="editor-hint">{t('editor_hint')}</p>

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
            {t('editor_unassigned')} — {getGroupName(selectedGroupId)} ({counts.unassigned})
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
    </div>
  );
};
