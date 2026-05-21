import { useState } from 'react';
import { useProject } from '../context/ProjectContext';
import { Lesson } from '../../shared/types';

export const ScheduleViewer = () => {
  const { project } = useProject();
  const schedule = project?.generatedSchedule?.schedule || [];
  const groups = project?.groups || [];
  const teachers = project?.teachers || [];
  const subjects = project?.subjects || [];
  const rooms = project?.rooms || [];

  const [filterType, setFilterType] = useState<'group' | 'teacher'>('group');
  const [filterId, setFilterId] = useState<string>('');

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const periods = [1, 2, 3, 4, 5, 6, 7, 8];

  const filteredLessons = schedule.filter(lesson => {
    if (!filterId) return false;
    if (filterType === 'group') return lesson.groupId === filterId;
    if (filterType === 'teacher') return lesson.teacherId === filterId;
    return false;
  });

  const getLessonAt = (day: string, period: number) => {
    return filteredLessons.find(l => l.day === day && l.period === period);
  };

  const getSubjectName = (id: string) => subjects.find(s => s.id === id)?.name || '???';
  const getTeacherName = (id?: string) => teachers.find(t => t.id === id)?.shortName || teachers.find(t => t.id === id)?.name || '';
  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name || '';
  const getRoomName = (id?: string) => rooms.find(r => r.id === id)?.name || '';

  return (
    <div className="schedule-viewer">
      <div className="viewer-controls">
        <select value={filterType} onChange={(e) => { setFilterType(e.target.value as any); setFilterId(''); }}>
          <option value="group">View Group</option>
          <option value="teacher">View Teacher</option>
        </select>

        <select value={filterId} onChange={(e) => setFilterId(e.target.value)}>
          <option value="">-- Select {filterType} --</option>
          {filterType === 'group' 
            ? groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)
            : teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)
          }
        </select>
      </div>

      {!filterId ? (
        <div className="no-selection">Please select a {filterType} to view their schedule.</div>
      ) : (
        <div className="schedule-grid-container">
          <table className="schedule-grid">
            <thead>
              <tr>
                <th>Period</th>
                {days.map(day => <th key={day}>{day}</th>)}
              </tr>
            </thead>
            <tbody>
              {periods.map(period => (
                <tr key={period}>
                  <td className="period-col">{period}</td>
                  {days.map(day => {
                    const lesson = getLessonAt(day, period);
                    return (
                      <td key={day} className="slot">
                        {lesson && (
                          <div className="lesson-box">
                            <div className="subject">{getSubjectName(lesson.subjectId)}</div>
                            <div className="details">
                              {filterType === 'group' ? getTeacherName(lesson.teacherId) : getGroupName(lesson.groupId)}
                              {lesson.roomId && <span> • {getRoomName(lesson.roomId)}</span>}
                            </div>
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
