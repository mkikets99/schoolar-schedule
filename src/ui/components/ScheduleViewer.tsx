import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../context/ProjectContext';
import { ExportModal } from './ExportModal';
import { ExportContext } from '../services/ExportService';
import { Modal } from './Modal';
import { InlineEditor } from './InlineEditor';
import { SearchableSelect } from './SearchableSelect';
import { analyzeEmptySlots } from '../services/scheduleAnalyzer';
import { CurriculumRule, ScheduleResult } from '../../shared/types';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const ALL_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

export const ScheduleViewer = () => {
  const { t } = useTranslation();
  const { project, updateGeneratedSchedules, updateGeneratedSchedule } = useProject();
  const [activeSemester, setActiveSemester] = useState<'semester1' | 'semester2'>('semester1');
  const [editMode, setEditMode] = useState(false);
  const scheduleResult = project?.generatedSchedules
    ? project.generatedSchedules[activeSemester]
    : project?.generatedSchedule;
  const schedule = scheduleResult?.schedule || [];
  const groups = project?.groups || [];
  const teachers = project?.teachers || [];
  const subjects = project?.subjects || [];
  const rooms = project?.rooms || [];
  const loadTeacherIds = [...new Set((project?.loadDistribution || []).map(l => l.teacherId))];
  const schoolName = project?.school.name || 'Schedule';

  const neededHours = useMemo(() => {
    if (!project) return 0;
    const splits = project.generatedSplits;
    if (!splits || splits.length === 0) {
      return project.curriculum.reduce((s, r) => s + r.hoursPerWeek, 0);
    }
    const splitMap = new Map(splits.map(s => [s.ruleId, s]));
    return project.curriculum.reduce((s, r) => {
      const split = splitMap.get(r.id);
      if (!split) return s;
      return s + (activeSemester === 'semester1' ? split.first : split.second);
    }, 0);
  }, [project, activeSemester]);
  const assignedHours = schedule.length;
  const unassignedHours = Math.max(0, neededHours - assignedHours);
  const score = scheduleResult?.score ?? 0;

  const [filterType, setFilterType] = useState<'group' | 'teacher' | 'subject' | 'all'>('all');
  const [filterId, setFilterId] = useState<string>('');
  const [lockedLessons, setLockedLessons] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);
  const [unassignedOpen, setUnassignedOpen] = useState(false);
  const [gapsOpen, setGapsOpen] = useState(false);
  const [teacherLoadOpen, setTeacherLoadOpen] = useState(false);
  const [classLoadOpen, setClassLoadOpen] = useState(false);

  const days = DAYS;
  const allPeriods = ALL_PERIODS;

  const conflictKeys = useMemo(() => {
    const keys = new Set<string>();
    const teacherSlot = new Map<string, Map<string, string[]>>();
    const groupSlot = new Map<string, Map<string, string[]>>();

    for (const lesson of schedule) {
      const slotKey = `${lesson.day}-${lesson.period}`;

      if (lesson.teacherId) {
        if (!teacherSlot.has(lesson.teacherId)) teacherSlot.set(lesson.teacherId, new Map());
        if (!teacherSlot.get(lesson.teacherId)!.has(slotKey)) teacherSlot.get(lesson.teacherId)!.set(slotKey, []);
        teacherSlot.get(lesson.teacherId)!.get(slotKey)!.push(lesson.id);
        if (teacherSlot.get(lesson.teacherId)!.get(slotKey)!.length > 1) {
          for (const lid of teacherSlot.get(lesson.teacherId)!.get(slotKey)!) keys.add(lid);
        }
      }

      if (!groupSlot.has(lesson.groupId)) groupSlot.set(lesson.groupId, new Map());
      if (!groupSlot.get(lesson.groupId)!.has(slotKey)) groupSlot.get(lesson.groupId)!.set(slotKey, []);
      const slotLessons = groupSlot.get(lesson.groupId)!.get(slotKey)!;
      const isSameSubjectSplit = slotLessons.length > 0 && slotLessons.some(lid => {
        const other = schedule.find(l => l.id === lid);
        return other && other.subjectId === lesson.subjectId;
      });
      slotLessons.push(lesson.id);
      if (slotLessons.length > 1 && !isSameSubjectSplit) {
        for (const lid of slotLessons) keys.add(lid);
      }
    }
    return keys;
  }, [schedule]);

  const displayedLessons = useMemo(() => {
    if (filterType === 'all') return schedule;
    return schedule.filter(lesson => {
      if (filterType === 'group') return lesson.groupId === filterId;
      if (filterType === 'teacher') return lesson.teacherId === filterId;
      if (filterType === 'subject') return lesson.subjectId === filterId;
      return false;
    });
  }, [schedule, filterType, filterId]);

  const groupGaps = useMemo(() => {
    const result = new Map<string, Map<string, number[]>>();
    for (const group of groups) {
      const start = group.periodStart ?? 1;
      const dayMap = new Map<string, number[]>();
      for (const day of days) {
        const periods = schedule
          .filter(l => l.groupId === group.id && l.day === day)
          .map(l => l.period);
        if (periods.length === 0) continue;
        const last = Math.max(...periods);
        const occupied = new Set(periods);
        const bad: number[] = [];
        for (let p = start; p < last; p++) {
          if (!occupied.has(p)) bad.push(p);
        }
        if (bad.length > 0) dayMap.set(day, bad);
      }
      if (dayMap.size > 0) result.set(group.id, dayMap);
    }
    return result;
  }, [schedule, groups, days]);

  const displayedGroupIds = useMemo(
    () => new Set(displayedLessons.map(l => l.groupId)),
    [displayedLessons]
  );

  const gapSlots = useMemo(() => {
    const map = new Map<string, number>();
    for (const gid of displayedGroupIds) {
      const dayMap = groupGaps.get(gid);
      if (!dayMap) continue;
      for (const [day, periods] of dayMap) {
        for (const p of periods) {
          const key = `${day}-${p}`;
          map.set(key, (map.get(key) || 0) + 1);
        }
      }
    }
    return map;
  }, [displayedGroupIds, groupGaps]);

  const gapCount = useMemo(() => {
    let total = 0;
    for (const count of gapSlots.values()) total += count;
    return total;
  }, [gapSlots]);

  const emptySlotReasons = useMemo(() => {
    if (!project) return new Map<string, string[]>();
    const pendingByRule = new Map<string, number>();
    for (const c of scheduleResult?.conflicts || []) {
      if (c.type === 'UNASSIGNED_HOURS' && c.ruleId) {
        pendingByRule.set(c.ruleId, (pendingByRule.get(c.ruleId) || 0) + (c.missing ?? 1));
      }
    }
    return analyzeEmptySlots(schedule, project, pendingByRule, days);
  }, [schedule, project, scheduleResult, days]);

  const getLessonsAt = (day: string, period: number) => {
    return displayedLessons.filter(l => l.day === day && l.period === period);
  };

  const getSubjectName = (id: string) => subjects.find(s => s.id === id)?.name || '???';
  const getTeacherName = (id?: string) => teachers.find(t => t.id === id)?.shortName || teachers.find(t => t.id === id)?.name || '';
  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name || '';
  const getRoomName = (id?: string) => rooms.find(r => r.id === id)?.name || '';

  const gapReasonTitles = useMemo(() => {
    const titles = new Map<string, string>();
    for (const gid of displayedGroupIds) {
      const dayMap = groupGaps.get(gid);
      if (!dayMap) continue;
      for (const [day, periods] of dayMap) {
        for (const p of periods) {
          const key = `${day}-${p}`;
          const reasons = emptySlotReasons.get(`${gid}|${day}|${p}`);
          if (!reasons || reasons.length === 0) continue;
          const text = `${getGroupName(gid) || gid}:\n${reasons.map(r => `• ${t(r)}`).join('\n')}`;
          titles.set(key, titles.has(key) ? `${titles.get(key)}\n\n${text}` : text);
        }
      }
    }
    return titles;
  }, [displayedGroupIds, groupGaps, emptySlotReasons, getGroupName, t]);

  const unassignedDetails = useMemo(() => {
    const perRule = new Map<string, number>();
    for (const c of scheduleResult?.conflicts || []) {
      if (c.type === 'UNASSIGNED_HOURS' && c.ruleId) {
        perRule.set(c.ruleId, (perRule.get(c.ruleId) || 0) + (c.missing ?? 1));
      }
    }
    const rows: { rule: CurriculumRule; missing: number }[] = [];
    for (const [ruleId, missing] of perRule) {
      const rule = (project?.curriculum || []).find(r => r.id === ruleId);
      if (rule) rows.push({ rule, missing });
    }
    rows.sort((a, b) => b.missing - a.missing);
    return rows;
  }, [project, scheduleResult]);

  const gapDetails = useMemo(() => {
    const rows: { groupId: string; day: string; periods: number[]; reasons: Map<number, string[]> }[] = [];
    for (const gid of displayedGroupIds) {
      const dayMap = groupGaps.get(gid);
      if (!dayMap) continue;
      for (const [day, periods] of dayMap) {
        const sorted = [...periods].sort((a, b) => a - b);
        const reasons = new Map<number, string[]>();
        for (const p of sorted) {
          const rs = emptySlotReasons.get(`${gid}|${day}|${p}`);
          if (rs && rs.length > 0) reasons.set(p, rs.map(r => t(r)));
        }
        rows.push({ groupId: gid, day, periods: sorted, reasons });
      }
    }
    rows.sort((a, b) => getGroupName(a.groupId).localeCompare(getGroupName(b.groupId)) || a.day.localeCompare(b.day));
    return rows;
  }, [displayedGroupIds, groupGaps, getGroupName, emptySlotReasons, t]);

  const intendedLoadMap = (kind: 'teacher' | 'group'): Map<string, number> => {
    const map = new Map<string, number>();
    const add = (id: string, v: number) => map.set(id, (map.get(id) || 0) + v);
    const ld = project?.loadDistribution || [];
    if (ld.length > 0) {
      for (const l of ld) {
        const v = l.hours / 2;
        if (kind === 'teacher' && l.teacherId) add(l.teacherId, v);
        if (kind === 'group' && l.groupId) add(l.groupId, v);
      }
    } else {
      const splitMap = new Map((project?.generatedSplits || []).map(s => [s.ruleId, s]));
      for (const rule of project?.curriculum || []) {
        const split = splitMap.get(rule.id);
        if (!split) continue;
        const v = activeSemester === 'semester1' ? split.first : split.second;
        if (kind === 'teacher' && rule.teacherId) add(rule.teacherId, v);
        if (kind === 'group') add(rule.groupId, v);
      }
    }
    return map;
  };

  const teacherLoads = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lesson of schedule) {
      if (!lesson.teacherId) continue;
      counts.set(lesson.teacherId, (counts.get(lesson.teacherId) || 0) + 1);
    }
    const intended = intendedLoadMap('teacher');
    return teachers
      .map(tc => ({
        id: tc.id,
        name: tc.name || tc.shortName || tc.id,
        count: counts.get(tc.id) || 0,
        intended: intended.get(tc.id) ?? null,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [schedule, teachers, project, activeSemester]);

  const classLoads = useMemo(() => {
    const counts = new Map<string, number>();
    for (const lesson of schedule) {
      counts.set(lesson.groupId, (counts.get(lesson.groupId) || 0) + 1);
    }
    const intended = intendedLoadMap('group');
    return groups
      .map(g => ({
        id: g.id,
        name: g.name || g.id,
        count: counts.get(g.id) || 0,
        intended: intended.get(g.id) ?? null,
      }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [schedule, groups, project, activeSemester]);

  const exportContext = useMemo<ExportContext>(() => ({
    schedule,
    groupIds: groups.map(g => g.id),
    groups,
    teachers,
    subjects,
    rooms,
    schoolName,
    conflictKeys,
    neededHours,
    assignedHours,
    unassignedHours,
    score,
  }), [schedule, groups, teachers, subjects, rooms, schoolName, conflictKeys, neededHours, assignedHours, unassignedHours, score]);
  const toggleLock = (lessonId: string) => {
    setLockedLessons(prev => {
      const next = new Set(prev);
      if (next.has(lessonId)) next.delete(lessonId);
      else next.add(lessonId);
      return next;
    });
  };

  const isLocked = (lessonId: string) => lockedLessons.has(lessonId);
  const isConflict = (lessonId: string) => conflictKeys.has(lessonId);

  const handleEditorSave = (result: ScheduleResult) => {
    if (!project) return;
    if (project.generatedSchedules) {
      updateGeneratedSchedules({ ...project.generatedSchedules, [activeSemester]: result });
    } else {
      updateGeneratedSchedule(result);
    }
  };

  const hasSchedule = schedule.length > 0;

  return (
    <div className="schedule-viewer">
      <div className="viewer-controls">
        <div className="semester-switcher">
          <button
            className={activeSemester === 'semester1' ? 'active' : ''}
            onClick={() => setActiveSemester('semester1')}
            disabled={!project?.generatedSchedules}
          >
            {t('semester_1')}
          </button>
          <button
            className={activeSemester === 'semester2' ? 'active' : ''}
            onClick={() => setActiveSemester('semester2')}
            disabled={!project?.generatedSchedules}
          >
            {t('semester_2')}
          </button>
        </div>

        <div className="mode-toggle">
          <button className={`mode-btn ${!editMode ? 'active' : ''}`} onClick={() => setEditMode(false)}>{t('mode_view')}</button>
          <button className={`mode-btn ${editMode ? 'active' : ''}`} onClick={() => setEditMode(true)} disabled={!hasSchedule}>{t('mode_edit')}</button>
        </div>

        {!editMode && (
          <>
            <select value={filterType} onChange={(e) => { setFilterType(e.target.value as any); setFilterId(''); }}>
              <option value="all">{t('all')}</option>
              <option value="group">{t('view_group')}</option>
              <option value="teacher">{t('view_teacher')}</option>
              <option value="subject">{t('view_subject')}</option>
            </select>

            {filterType !== 'all' && (
              <SearchableSelect
                value={filterId}
                onChange={setFilterId}
                options={filterType === 'group'
                  ? groups.map(g => ({ value: g.id, label: g.name }))
                  : filterType === 'teacher'
                  ? teachers.map(t => ({ value: t.id, label: t.name }))
                  : subjects.map(s => ({ value: s.id, label: s.name }))}
                placeholder={t('select_view', { type: filterType })}
                allowEmpty
                pinTop={filterType === 'teacher' ? loadTeacherIds : []}
              />
            )}

            {filterType === 'all' && (
              <div className="summary-badge">
                {schedule.length} {t('lessons_assigned').toLowerCase()}
                {conflictKeys.size > 0 && <span className="conflict-count"> • {conflictKeys.size} {t('conflicts').toLowerCase()}</span>}
                {gapCount > 0 && <span className="gap-count"> • {gapCount} {t('unfilled_gaps').toLowerCase()}</span>}
              </div>
            )}
          </>
        )}

        {hasSchedule && (
          <div className="export-actions">
            <button onClick={() => setTeacherLoadOpen(true)} className="export-btn">{t('teacher_load')}</button>
            <button onClick={() => setClassLoadOpen(true)} className="export-btn">{t('class_load')}</button>
            <button onClick={() => setExportOpen(true)} className="export-btn">{t('export')}</button>
          </div>
        )}
      </div>

      <div className="schedule-stats">
        <div className="stat-block needed">
          <span className="stat-label">{t('needed')}</span>
          <span className="stat-value">{neededHours}</span>
        </div>
        <div className="stat-block assigned">
          <span className="stat-label">{t('assigned')}</span>
          <span className="stat-value">{assignedHours}</span>
        </div>
        <div className={`stat-block unassigned clickable ${unassignedHours > 0 ? 'warn' : 'ok'}`} onClick={() => setUnassignedOpen(true)} title={t('unassigned_click_hint')}>
          <span className="stat-label">{t('unassigned')}</span>
          <span className="stat-value">{unassignedHours}</span>
        </div>
        <div className={`stat-block conflicts ${conflictKeys.size > 0 ? 'warn' : 'ok'}`}>
          <span className="stat-label">{t('conflicts')}</span>
          <span className="stat-value">{conflictKeys.size}</span>
        </div>
        <div className={`stat-block gaps clickable ${gapCount > 0 ? 'gap-warn' : 'ok'}`} onClick={() => setGapsOpen(true)} title={t('gaps_click_hint')}>
          <span className="stat-label">{t('unfilled_gaps')}</span>
          <span className="stat-value">{gapCount}</span>
        </div>
        <div className={`stat-block score ${score >= 1 ? 'ok' : score >= 0.5 ? 'mid' : 'warn'}`}>
          <span className="stat-label">{t('score')}</span>
          <span className="stat-value">{(score * 100).toFixed(0)}%</span>
        </div>
      </div>

      {!hasSchedule ? (
        <div className="no-selection">{t('generate_schedule_first')}</div>
      ) : editMode && project ? (
        <InlineEditor
          project={project}
          activeSemester={activeSemester}
          onSave={handleEditorSave}
        />
      ) : (
        <div className="schedule-grid-container">
          <table className="schedule-grid full-schedule" id="schedule-table">
            <thead>
              <tr>
                <th>{t('period')}</th>
                {days.map(day => <th key={day}>{day}</th>)}
              </tr>
            </thead>
            <tbody>
              {allPeriods.map(period => (
                <tr key={period}>
                  <td className="period-col">{period}</td>
                  {days.map(day => {
                    const lessons = getLessonsAt(day, period);
                    const gapGroups = gapSlots.get(`${day}-${period}`) || 0;
                    const isGapSlot = lessons.length === 0 && gapGroups > 0;
                    return (
                      <td key={day} className={`slot ${lessons.length > 1 ? 'multi-slot' : ''} ${isGapSlot ? 'gap-slot' : ''}`}>
                        {lessons.length === 0 ? isGapSlot ? (
                          <div className="gap-marker" title={gapReasonTitles.get(`${day}-${period}`) || t('unfilled_gaps_desc')}>
                            {gapGroups > 1 ? `×${gapGroups}` : '×'}
                          </div>
                        ) : null : lessons.length === 1 ? (() => {
                          const lesson = lessons[0];
                          return (
                            <div
                              className={`lesson-box ${isLocked(lesson.id) ? 'locked' : ''} ${isConflict(lesson.id) ? 'conflict' : ''}`}
                              onClick={() => toggleLock(lesson.id)}
                              title={isLocked(lesson.id) ? t('click_to_unlock') : t('click_to_lock')}
                            >
                              <div className="subject">{getSubjectName(lesson.subjectId)}</div>
                              <div className="details">
                                {filterType === 'all' ? `${getGroupName(lesson.groupId)} • ${getTeacherName(lesson.teacherId)}` : filterType === 'group' ? getTeacherName(lesson.teacherId) : getGroupName(lesson.groupId)}
                                {lesson.roomId && <span> • {getRoomName(lesson.roomId)}</span>}
                              </div>
                              {isLocked(lesson.id) && <div className="lock-badge">{t('locked')}</div>}
                              {isConflict(lesson.id) && <div className="conflict-badge-small">!</div>}
                            </div>
                          );
                        })() : (
                          <div className="lesson-list">
                            {lessons.map(lesson => (
                              <div
                                key={lesson.id}
                                className={`lesson-box mini ${isLocked(lesson.id) ? 'locked' : ''} ${isConflict(lesson.id) ? 'conflict' : ''}`}
                                onClick={() => toggleLock(lesson.id)}
                                title={isLocked(lesson.id) ? t('click_to_unlock') : t('click_to_lock')}
                              >
                                <div className="subject">{getSubjectName(lesson.subjectId)}</div>
                                <div className="details">
                                  {filterType === 'all' ? `${getGroupName(lesson.groupId)} • ${getTeacherName(lesson.teacherId)}` : filterType === 'group' ? getTeacherName(lesson.teacherId) : getGroupName(lesson.groupId)}
                                </div>
                                {isLocked(lesson.id) && <div className="lock-badge">{t('locked')}</div>}
                                {isConflict(lesson.id) && <div className="conflict-badge-small">!</div>}
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ExportModal isOpen={exportOpen} onClose={() => setExportOpen(false)} context={exportContext} />

      <Modal isOpen={unassignedOpen} onClose={() => setUnassignedOpen(false)} title={t('unassigned_details')}>
        {unassignedDetails.length === 0 ? (
          <div className="detail-empty">{t('no_unassigned')}</div>
        ) : (
          <div className="detail-list">
            {unassignedDetails.map(({ rule, missing }) => (
              <div key={rule.id} className="detail-row">
                <span className="detail-main">
                  {getSubjectName(rule.subjectId)} — {getGroupName(rule.groupId)}
                  {rule.teacherId && <span> ({getTeacherName(rule.teacherId)})</span>}
                </span>
                <span className="detail-meta">
                  {t('unassigned_per_rule', { missing, hours: rule.hoursPerWeek })}
                </span>
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal isOpen={gapsOpen} onClose={() => setGapsOpen(false)} title={t('gap_details')}>
        {gapDetails.length === 0 ? (
          <div className="detail-empty">{t('no_gaps')}</div>
        ) : (
          <div className="detail-list">
            {gapDetails.map((row, i) => (
              <div key={i} className="detail-row">
                <span className="detail-main">
                  {t('row_group_day', { group: getGroupName(row.groupId), day: t(row.day.toLowerCase()) })}
                </span>
                <span className="detail-meta">{t('gap_periods', { periods: row.periods.join(', ') })}</span>
                {row.periods.some(p => (row.reasons.get(p)?.length || 0) > 0) && (
                  <div className="detail-sub">
                    {row.periods.map(p => {
                      const rs = row.reasons.get(p);
                      if (!rs || rs.length === 0) return null;
                      return <div key={p}>{t('gap_period_reason', { period: p, reasons: rs.join(', ') })}</div>;
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      <Modal isOpen={teacherLoadOpen} onClose={() => setTeacherLoadOpen(false)} title={t('teacher_load_title', { semester: t(activeSemester) })}>
        {teacherLoads.length === 0 ? (
          <div className="detail-empty">{t('no_teachers')}</div>
        ) : (
          <div className="detail-list">
            {teacherLoads.map((row) => (
              <div key={row.id} className={`detail-row${row.intended != null && Math.abs(row.count - row.intended) > 0.5 ? ' detail-mismatch' : ''}`}>
                <span className="detail-main">{row.name}</span>
                <span className="detail-meta">
                  {t('lessons_count', { count: row.count })}
                  {row.intended != null && ` / ${t('intended_count', { count: Math.round(row.intended) })}`}
                </span>
              </div>
            ))}
            <div className="detail-row detail-total">
              <span className="detail-main">{t('total')}</span>
              <span className="detail-meta">{t('lessons_count', { count: teacherLoads.reduce((s, r) => s + r.count, 0) })}</span>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={classLoadOpen} onClose={() => setClassLoadOpen(false)} title={t('class_load_title', { semester: t(activeSemester) })}>
        {classLoads.length === 0 ? (
          <div className="detail-empty">{t('no_groups')}</div>
        ) : (
          <div className="detail-list">
            {classLoads.map((row) => (
              <div key={row.id} className={`detail-row${row.intended != null && Math.abs(row.count - row.intended) > 0.5 ? ' detail-mismatch' : ''}`}>
                <span className="detail-main">{row.name}</span>
                <span className="detail-meta">
                  {t('lessons_count', { count: row.count })}
                  {row.intended != null && ` / ${t('intended_count', { count: Math.round(row.intended) })}`}
                </span>
              </div>
            ))}
            <div className="detail-row detail-total">
              <span className="detail-main">{t('total')}</span>
              <span className="detail-meta">{t('lessons_count', { count: classLoads.reduce((s, r) => s + r.count, 0) })}</span>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};