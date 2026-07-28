import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../context/ProjectContext';

export const ScheduleViewer = () => {
  const { t } = useTranslation();
  const { project } = useProject();
  const schedule = project?.generatedSchedule?.schedule || [];
  const groups = project?.groups || [];
  const teachers = project?.teachers || [];
  const subjects = project?.subjects || [];
  const rooms = project?.rooms || [];

  const [filterType, setFilterType] = useState<'group' | 'teacher' | 'all'>('all');
  const [filterId, setFilterId] = useState<string>('');
  const [lockedLessons, setLockedLessons] = useState<Set<string>>(new Set());

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const periods = [1, 2, 3, 4, 5, 6, 7, 8];

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
      groupSlot.get(lesson.groupId)!.get(slotKey)!.push(lesson.id);
      if (groupSlot.get(lesson.groupId)!.get(slotKey)!.length > 1) {
        for (const lid of groupSlot.get(lesson.groupId)!.get(slotKey)!) keys.add(lid);
      }
    }
    return keys;
  }, [schedule]);

  const displayedLessons = useMemo(() => {
    if (filterType === 'all') return schedule;
    return schedule.filter(lesson => {
      if (filterType === 'group') return lesson.groupId === filterId;
      if (filterType === 'teacher') return lesson.teacherId === filterId;
      return false;
    });
  }, [schedule, filterType, filterId]);

  const getLessonsAt = (day: string, period: number) => {
    return displayedLessons.filter(l => l.day === day && l.period === period);
  };

  const getSubjectName = (id: string) => subjects.find(s => s.id === id)?.name || '???';
  const getTeacherName = (id?: string) => teachers.find(t => t.id === id)?.shortName || teachers.find(t => t.id === id)?.name || '';
  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name || '';
  const getRoomName = (id?: string) => rooms.find(r => r.id === id)?.name || '';

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

  return (
    <div className="schedule-viewer">
      <div className="viewer-controls">
        <select value={filterType} onChange={(e) => { setFilterType(e.target.value as any); setFilterId(''); }}>
          <option value="all">{t('all')}</option>
          <option value="group">{t('view_group')}</option>
          <option value="teacher">{t('view_teacher')}</option>
        </select>

        {filterType !== 'all' && (
          <select value={filterId} onChange={(e) => setFilterId(e.target.value)}>
            <option value="">{t('select_view', { type: filterType })}</option>
            {filterType === 'group'
              ? groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)
              : teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)
            }
          </select>
        )}

        {filterType === 'all' && (
          <div className="summary-badge">
            {schedule.length} {t('lessons_assigned').toLowerCase()}
            {conflictKeys.size > 0 && <span className="conflict-count"> • {conflictKeys.size} {t('conflicts').toLowerCase()}</span>}
          </div>
        )}
      </div>

      {schedule.length === 0 ? (
        <div className="no-selection">{t('generate_schedule_first')}</div>
      ) : (
        <div className="schedule-grid-container">
          <table className="schedule-grid full-schedule">
            <thead>
              <tr>
                <th>{t('period')}</th>
                {days.map(day => <th key={day}>{day}</th>)}
              </tr>
            </thead>
            <tbody>
              {periods.map(period => (
                <tr key={period}>
                  <td className="period-col">{period}</td>
                  {days.map(day => {
                    const lessons = getLessonsAt(day, period);
                    return (
                      <td key={day} className={`slot ${lessons.length > 1 ? 'multi-slot' : ''}`}>
                        {lessons.length === 0 ? null : lessons.length === 1 ? (() => {
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
    </div>
  );
};
