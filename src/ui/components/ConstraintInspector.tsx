import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../context/ProjectContext';

interface DisplayConflict {
  id: string;
  type: 'hard' | 'soft';
  description: string;
  source: string;
}

export const ConstraintInspector = () => {
  const { t } = useTranslation();
  const { project } = useProject();
  const schedule = project?.generatedSchedule?.schedule || [];
  const conflicts = project?.generatedSchedule?.conflicts || [];
  const score = project?.generatedSchedule?.score ?? 0;

  const detectedConflicts = useMemo(() => {
    const result: DisplayConflict[] = [];

    for (const c of conflicts) {
      if (c.type === 'UNASSIGNED_HOURS') {
        result.push({
          id: c.ruleId || crypto.randomUUID(),
          type: 'hard',
          description: t('conflict_unassigned', { missing: c.missing ?? 1 }),
          source: c.ruleId || 'unknown',
        });
      }
    }

    const teacherSlot = new Map<string, Set<string>>();
    for (const lesson of schedule) {
      const key = `${lesson.day}-${lesson.period}`;
      if (lesson.teacherId) {
        const tid = lesson.teacherId;
        if (!teacherSlot.has(tid)) teacherSlot.set(tid, new Set());
        if (teacherSlot.get(tid)!.has(key)) {
          result.push({
            id: `overlap-teacher-${tid}-${key}`,
            type: 'hard',
            description: t('conflict_teacher_overlap', {
              teacher: project?.teachers.find(t => t.id === tid)?.name || tid,
              day: lesson.day,
              period: lesson.period,
            }),
            source: tid,
          });
        }
        teacherSlot.get(tid)!.add(key);
      }
    }

    const groupSlot = new Map<string, Set<string>>();
    for (const lesson of schedule) {
      const key = `${lesson.day}-${lesson.period}`;
      const gid = lesson.groupId;
      if (!groupSlot.has(gid)) groupSlot.set(gid, new Set());
      if (groupSlot.get(gid)!.has(key)) {
        result.push({
          id: `overlap-group-${gid}-${key}`,
          type: 'hard',
          description: t('conflict_group_overlap', {
            group: project?.groups.find(g => g.id === gid)?.name || gid,
            day: lesson.day,
            period: lesson.period,
          }),
          source: gid,
        });
      }
      groupSlot.get(gid)!.add(key);
    }

    return result;
  }, [schedule, conflicts, project, t]);

  const totalConflicts = detectedConflicts.length;

  return (
    <div className="constraint-inspector">
      <div className="view-header">
        <h2>{t('constraints')}</h2>
      </div>

      <div className="summary-cards" style={{ marginBottom: '1.5rem' }}>
        <div className="stat-card">
          <h3>{t('schedule_score')}</h3>
          <div className="stat-value" style={{ fontSize: '2rem', color: score >= 1 ? '#4CAF50' : score >= 0.5 ? '#FFC107' : '#ff4d4d' }}>
            {(score * 100).toFixed(0)}%
          </div>
        </div>
        <div className="stat-card">
          <h3>{t('conflicts')}</h3>
          <div className="stat-value" style={{ fontSize: '2rem', color: totalConflicts > 0 ? '#ff4d4d' : '#4CAF50' }}>
            {totalConflicts}
          </div>
        </div>
        <div className="stat-card">
          <h3>{t('lessons_assigned')}</h3>
          <div className="stat-value" style={{ fontSize: '2rem' }}>
            {schedule.length}
          </div>
        </div>
      </div>

      {totalConflicts === 0 ? (
        <div className="no-conflicts">
          <p>{t('no_conflicts')}</p>
        </div>
      ) : (
        <div className="conflict-list">
          {detectedConflicts.map(conflict => (
            <div key={conflict.id} className={`conflict-item conflict-${conflict.type}`}>
              <div className="conflict-badge">{conflict.type === 'hard' ? 'HARD' : 'SOFT'}</div>
              <div className="conflict-body">
                <p className="conflict-desc">{conflict.description}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
