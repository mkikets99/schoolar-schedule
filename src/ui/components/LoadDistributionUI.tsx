import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../context/ProjectContext';
import { LoadDistribution } from '../../shared/types';

export const LoadDistributionUI = () => {
  const { t } = useTranslation();
  const { project, updateLoadDistribution, updateCurriculum } = useProject();
  const teachers = project?.teachers || [];
  const groups = project?.groups || [];
  const curriculum = project?.curriculum || [];
  const load = project?.loadDistribution || [];

  const [isDraft, setIsDraft] = useState(true);

  const handleAssignTeacher = (ruleId: string, teacherId: string | undefined) => {
    const updatedCurriculum = curriculum.map(rule => 
      rule.id === ruleId ? { ...rule, teacherId } : rule
    );
    updateCurriculum(updatedCurriculum);

    if (teacherId) {
      const rule = curriculum.find(r => r.id === ruleId);
      if (rule) {
        const newLoad: LoadDistribution = {
          teacherId,
          groupId: rule.groupId,
          subjectId: rule.subjectId,
          hours: rule.hoursPerWeek
        };
        updateLoadDistribution([...load.filter(l => !(l.groupId === rule.groupId && l.subjectId === rule.subjectId)), newLoad]);
      }
    }
  };

  const getSubjectName = (id: string) => project?.subjects.find(s => s.id === id)?.name || 'Unknown';
  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name || 'Unknown';

  const teacherHours = teachers.reduce((acc, tchr) => {
    acc[tchr.id] = curriculum
      .filter(r => r.teacherId === tchr.id)
      .reduce((sum, r) => sum + r.hoursPerWeek, 0);
    return acc;
  }, {} as Record<string, number>);

  const totalCurriculumHours = curriculum.reduce((sum, r) => sum + r.hoursPerWeek, 0);
  const assignedHours = curriculum.filter(r => r.teacherId).reduce((sum, r) => sum + r.hoursPerWeek, 0);
  const unassignedCount = curriculum.filter(r => !r.teacherId).length;

  return (
    <div className="load-distribution">
      <div className="view-header">
        <h2>{t('load_distribution')}</h2>
        <div className="mode-toggle" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', background: '#1e1e1e', padding: '0.5rem', borderRadius: '8px' }}>
          <span className={`mode-btn ${isDraft ? 'active' : ''}`} onClick={() => setIsDraft(true)}>{t('draft')}</span>
          <span className={`mode-btn ${!isDraft ? 'active' : ''}`} onClick={() => setIsDraft(false)}>{t('approved')}</span>
          <span className="mode-indicator" style={{ marginLeft: '0.5rem', fontSize: '0.75rem', padding: '0.2rem 0.5rem', borderRadius: '4px', background: isDraft ? '#FFC10733' : '#4CAF5033', color: isDraft ? '#FFC107' : '#4CAF50' }}>
            {isDraft ? t('draft_mode') : t('approved_mode')}
          </span>
        </div>
      </div>

      <div className="summary-cards">
        <div className="stat-card small">
          <h3>{t('total_hours')}</h3>
          <div className="stat-value" style={{ fontSize: '1.5rem' }}>{totalCurriculumHours}</div>
        </div>
        <div className="stat-card small">
          <h3>{t('assigned')}</h3>
          <div className="stat-value" style={{ fontSize: '1.5rem', color: '#4CAF50' }}>{assignedHours}</div>
        </div>
        <div className="stat-card small">
          <h3>{t('unassigned')}</h3>
          <div className="stat-value" style={{ fontSize: '1.5rem', color: unassignedCount > 0 ? '#ff4d4d' : '#4CAF50' }}>{unassignedCount}</div>
        </div>
        {teachers.map(tchr => (
          <div key={tchr.id} className="teacher-card" style={{ opacity: isDraft ? 1 : 0.7 }}>
            <strong>{tchr.name}</strong>
            <span>{teacherHours[tchr.id] || 0} hrs</span>
          </div>
        ))}
      </div>

      <table className="editor-table">
        <thead>
          <tr>
            <th>{t('group')}</th>
            <th>{t('subject')}</th>
            <th>{t('hours')}</th>
            <th>{t('assigned_teacher')}</th>
          </tr>
        </thead>
        <tbody>
          {curriculum.map(rule => (
            <tr key={rule.id} className={!rule.teacherId ? 'unassigned' : ''}>
              <td>{getGroupName(rule.groupId)}</td>
              <td>{getSubjectName(rule.subjectId)}</td>
              <td>{rule.hoursPerWeek}</td>
              <td>
                <select 
                  value={rule.teacherId || ''} 
                  onChange={(e) => handleAssignTeacher(rule.id, e.target.value || undefined)}
                  disabled={!isDraft}
                >
                  <option value="">{t('unassigned')}</option>
                  {teachers.map(tchr => (
                    <option key={tchr.id} value={tchr.id}>{tchr.name}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
          {curriculum.length === 0 && (
            <tr>
              <td colSpan={4} className="empty-row">{t('no_rules')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
