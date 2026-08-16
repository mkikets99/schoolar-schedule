import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../context/ProjectContext';
import { LoadDistribution } from '../../shared/types';
import { useTableControls, TableSearch, SortableTh } from './TableControls';
import { SearchableSelect } from './SearchableSelect';

export const LoadDistributionUI = () => {
  const { t } = useTranslation();
  const { project, updateLoadDistribution, updateCurriculum } = useProject();
  const teachers = project?.teachers || [];
  const groups = project?.groups || [];
  const curriculum = project?.curriculum || [];
  const load = project?.loadDistribution || [];
  const loadTeacherIds = [...new Set(load.map(l => l.teacherId))];

  const [isDraft, setIsDraft] = useState(true);
  const [groupFilter, setGroupFilter] = useState('');
  const [teacherFilter, setTeacherFilter] = useState('');
  const [unassignedOnly, setUnassignedOnly] = useState(false);

  const getSubjectName = (id: string) => project?.subjects.find(s => s.id === id)?.name || 'Unknown';
  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name || 'Unknown';
  const getTeacherName = (id?: string) => (id ? teachers.find(t => t.id === id)?.name || '' : '');

  const { query, setQuery, sort, toggleSort, rows: displayedRules, total, shown } = useTableControls<typeof curriculum[0]>({
    rows: curriculum,
    getSearchText: (rule) =>
      `${getGroupName(rule.groupId)} ${getSubjectName(rule.subjectId)} ${getTeacherName(rule.teacherId)}`,
    getSortValue: (rule, key) => {
      switch (key) {
        case 'group': return getGroupName(rule.groupId);
        case 'subject': return getSubjectName(rule.subjectId);
        case 'hours': return rule.hoursPerWeek;
        case 'teacher': return getTeacherName(rule.teacherId);
        default: return getGroupName(rule.groupId);
      }
    },
    extraFilter: (rule) => {
      if (groupFilter && rule.groupId !== groupFilter) return false;
      if (teacherFilter && rule.teacherId !== teacherFilter) return false;
      if (unassignedOnly && rule.teacherId) return false;
      return true;
    },
    defaultSort: { key: 'group', direction: 'asc' },
  });

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
          <div
            key={tchr.id}
            className={`teacher-card clickable ${teacherFilter === tchr.id ? 'active' : ''}`}
            style={{ opacity: isDraft ? 1 : 0.7 }}
            onClick={() => setTeacherFilter(prev => prev === tchr.id ? '' : tchr.id)}
            title={teacherFilter === tchr.id ? t('clear_teacher_filter') : t('filter_by_teacher')}
          >
            <strong>{tchr.name}</strong>
            <span>{teacherHours[tchr.id] || 0} hrs</span>
          </div>
        ))}
      </div>

      <div className="table-toolbar">
        <TableSearch value={query} onChange={setQuery} placeholder={t('search_placeholder')} />
        <SearchableSelect
          className="table-filter"
          value={groupFilter}
          onChange={setGroupFilter}
          options={groups.map(g => ({ value: g.id, label: g.name }))}
          placeholder={t('all_groups')}
          allowEmpty
        />
        <SearchableSelect
          className="table-filter"
          value={teacherFilter}
          onChange={setTeacherFilter}
          options={teachers.map(tchr => ({ value: tchr.id, label: tchr.name }))}
          placeholder={t('all_teachers')}
          allowEmpty
          pinTop={loadTeacherIds}
        />
        <label className="table-toggle">
          <input type="checkbox" checked={unassignedOnly} onChange={(e) => setUnassignedOnly(e.target.checked)} />
          {t('unassigned_only')}
        </label>
        <span className="table-count">{t('showing_count', { shown, total })}</span>
      </div>

      <table className="editor-table">
        <thead>
          <tr>
            <SortableTh label={t('group')} sortKey="group" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('subject')} sortKey="subject" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('hours')} sortKey="hours" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('assigned_teacher')} sortKey="teacher" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {displayedRules.map(rule => (
            <tr key={rule.id} className={!rule.teacherId ? 'unassigned' : ''}>
              <td>{getGroupName(rule.groupId)}</td>
              <td>{getSubjectName(rule.subjectId)}</td>
              <td>{rule.hoursPerWeek}</td>
              <td>
                <SearchableSelect
                  value={rule.teacherId || ''}
                  onChange={(v) => handleAssignTeacher(rule.id, v || undefined)}
                  options={teachers.map(tchr => ({ value: tchr.id, label: tchr.name }))}
                  placeholder={t('unassigned')}
                  allowEmpty
                  disabled={!isDraft}
                  pinTop={loadTeacherIds}
                />
              </td>
            </tr>
          ))}
          {displayedRules.length === 0 && (
            <tr>
              <td colSpan={4} className="empty-row">{curriculum.length === 0 ? t('no_rules') : t('no_results')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
