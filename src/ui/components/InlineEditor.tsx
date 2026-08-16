import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { CurriculumRule, Lesson, ProjectState, ScheduleResult } from '../../shared/types';
import { analyzeSchedule, buildConflicts, computeScore, countLessons } from '../services/scheduleAnalyzer';
import { SearchableSelect } from './SearchableSelect';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const ALL_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

interface InlineEditorProps {
  project: ProjectState;
  activeSemester: 'semester1' | 'semester2';
  onSave: (result: ScheduleResult) => void;
}

interface HistoryEntry {
  grid: Lesson[];
  pool: Lesson[];
}

export const InlineEditor = ({ project, activeSemester, onSave }: InlineEditorProps) => {
  const { t } = useTranslation();
  const [gridLessons, setGridLessons] = useState<Lesson[]>([]);
  const [poolLessons, setPoolLessons] = useState<Lesson[]>([]);
  const [hover, setHover] = useState<{ day: string; period: number } | null>(null);
  const [selectedGroupId, setSelectedGroupId] = useState<string>(project.groups[0]?.id || '');
  const historyRef = useRef<HistoryEntry[]>([]);
  const dragRef = useRef<string | null>(null);

  const groups = project.groups || [];
  const teachers = project.teachers || [];
  const subjects = project.subjects || [];

  const getSubject = (id: string) => subjects.find(s => s.id === id);
  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name || '';
  const getTeacherName = (id?: string) => teachers.find(t => t.id === id)?.shortName || teachers.find(t => t.id === id)?.name || '';

  const semesterNeeded = (rule: CurriculumRule): number => {
    const split = (project.generatedSplits || []).find(s => s.ruleId === rule.id);
    if (split) return activeSemester === 'semester1' ? split.first : split.second;
    return Math.ceil(rule.hoursPerWeek);
  };

  const seed = () => {
    const result = project.generatedSchedules
      ? (activeSemester === 'semester1' ? project.generatedSchedules.semester1 : project.generatedSchedules.semester2)
      : project.generatedSchedule;
    const placed = (result?.schedule || []).map(l => ({ ...l }));
    const placedCount = new Map<string, number>();
    for (const lesson of placed) {
      placedCount.set(lesson.ruleId, (placedCount.get(lesson.ruleId) || 0) + 1);
    }
    const pool: Lesson[] = [];
    for (const rule of project.curriculum) {
      const needed = semesterNeeded(rule);
      const count = placedCount.get(rule.id) || 0;
      const missing = Math.max(0, needed - count);
      for (let i = 0; i < missing; i++) {
        pool.push({
          id: `pending-${rule.id}-${i}`,
          ruleId: rule.id,
          groupId: rule.groupId,
          subjectId: rule.subjectId,
          teacherId: rule.teacherId,
          roomId: rule.roomId,
          day: '',
          period: 0,
        });
      }
    }
    setGridLessons(placed);
    setPoolLessons(pool);
    historyRef.current = [];
  };

  useEffect(() => {
    seed();
  }, [activeSemester]);

  const commit = (mutate: (g: Lesson[], p: Lesson[]) => { grid: Lesson[]; pool: Lesson[] }) => {
    historyRef.current.push({ grid: gridLessons, pool: poolLessons });
    if (historyRef.current.length > 50) historyRef.current.shift();
    const next = mutate(gridLessons, poolLessons);
    setGridLessons(next.grid);
    setPoolLessons(next.pool);
  };

  const moveLesson = (id: string, day: string, period: number) => {
    const inGrid = gridLessons.some(l => l.id === id);
    const inPool = poolLessons.some(l => l.id === id);
    if (!inGrid && !inPool) return;
    commit((g, p) => {
      const fromPool = p.find(l => l.id === id);
      const grid = fromPool
        ? [...g, { ...fromPool, day, period }]
        : g.map(l => (l.id === id ? { ...l, day, period } : l));
      return { grid, pool: fromPool ? p.filter(l => l.id !== id) : p };
    });
  };

  const unassignLesson = (id: string) => {
    const existing = gridLessons.find(l => l.id === id);
    if (!existing) return;
    commit((g, p) => ({
      grid: g.filter(l => l.id !== id),
      pool: [...p, { ...existing, day: '', period: 0 }],
    }));
  };

  const undo = () => {
    const last = historyRef.current.pop();
    if (!last) return;
    setGridLessons(last.grid);
    setPoolLessons(last.pool);
  };

  const analysis = useMemo(
    () => analyzeSchedule(gridLessons, poolLessons, project),
    [gridLessons, poolLessons, project]
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
    () => countLessons(visibleGrid, visiblePool, project),
    [visibleGrid, visiblePool, project]
  );

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
      conflicts: buildConflicts(gridLessons, poolLessons, project),
      score: computeScore(gridLessons, poolLessons, project),
    });
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
                return (
                  <div
                    key={lesson.id}
                    className="checker-chip"
                    draggable
                    onDragStart={(e) => handleDragStart(e, lesson.id)}
                    style={{ borderLeftColor: subject?.color || undefined }}
                    title={`${getGroupName(lesson.groupId)} • ${getTeacherName(lesson.teacherId)}`}
                  >
                    <span className="checker-chip-subject">{subject?.shortName || subject?.name || '?'}</span>
                    <span className="checker-chip-group">{getGroupName(lesson.groupId)}</span>
                    <span className="checker-chip-teacher">{getTeacherName(lesson.teacherId)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
