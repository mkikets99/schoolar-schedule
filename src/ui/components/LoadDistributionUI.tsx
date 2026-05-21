import { useProject } from '../context/ProjectContext';
import { LoadDistribution } from '../../shared/types';

export const LoadDistributionUI = () => {
  const { project, updateLoadDistribution, updateCurriculum } = useProject();
  const teachers = project?.teachers || [];
  const groups = project?.groups || [];
  const curriculum = project?.curriculum || [];
  const load = project?.loadDistribution || [];

  const handleAssignTeacher = (ruleId: string, teacherId: string | undefined) => {
    const updatedCurriculum = curriculum.map(rule => 
      rule.id === ruleId ? { ...rule, teacherId } : rule
    );
    updateCurriculum(updatedCurriculum);
    
    // Also sync load distribution for compatibility
    if (teacherId) {
      const rule = curriculum.find(r => r.id === ruleId);
      if (rule) {
        const newLoad: LoadDistribution = {
          teacherId,
          groupId: rule.groupId,
          subjectId: rule.subjectId,
          hours: rule.hoursPerWeek
        };
        // This is a simplified sync, in real app we'd manage this more carefully
        updateLoadDistribution([...load.filter(l => !(l.groupId === rule.groupId && l.subjectId === rule.subjectId)), newLoad]);
      }
    }
  };

  const getSubjectName = (id: string) => project?.subjects.find(s => s.id === id)?.name || 'Unknown';
  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name || 'Unknown';

  const teacherHours = teachers.reduce((acc, t) => {
    acc[t.id] = curriculum
      .filter(r => r.teacherId === t.id)
      .reduce((sum, r) => sum + r.hoursPerWeek, 0);
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="load-distribution">
      <div className="summary-cards">
        {teachers.map(t => (
          <div key={t.id} className="teacher-card">
            <strong>{t.name}</strong>
            <span>{teacherHours[t.id] || 0} hrs</span>
          </div>
        ))}
      </div>

      <table className="editor-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Subject</th>
            <th>Hours</th>
            <th>Assigned Teacher</th>
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
                >
                  <option value="">-- Unassigned --</option>
                  {teachers.map(t => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
