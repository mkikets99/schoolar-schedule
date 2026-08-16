import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AcademicYear } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';
import { useTableControls, TableSearch, SortableTh } from './TableControls';

export const SchoolEditor = () => {
  const { t } = useTranslation();
  const { project, updateSchool, updateAcademicYears } = useProject();
  const [schoolName, setSchoolName] = useState(project?.school.name || '');
  const [schoolAddress, setSchoolAddress] = useState(project?.school.address || '');
  const [isYearModalOpen, setIsYearModalOpen] = useState(false);
  const [newYear, setNewYear] = useState({ name: '', startDate: '', endDate: '' });

  const handleSaveSchool = () => {
    if (project) {
      updateSchool({ ...project.school, name: schoolName, address: schoolAddress || undefined });
    }
  };

  const handleToggleSplitSubject = (subjectId: string) => {
    if (!project) return;
    const current = project.school.splitSubjects || [];
    const next = current.includes(subjectId)
      ? current.filter(s => s !== subjectId)
      : [...current, subjectId];
    updateSchool({ ...project.school, splitSubjects: next });
  };

  const academicYears = project?.academicYears || [];

  const { query, setQuery, sort, toggleSort, rows: displayedYears, total, shown } = useTableControls<AcademicYear>({
    rows: academicYears,
    getSearchText: (year) => `${year.name} ${year.startDate} ${year.endDate}`,
    getSortValue: (year, key) => {
      switch (key) {
        case 'name': return year.name;
        case 'startDate': return year.startDate;
        case 'endDate': return year.endDate;
        default: return year.name;
      }
    },
    defaultSort: { key: 'name', direction: 'asc' },
  });

  const handleAddYear = () => {
    if (!newYear.name.trim() || !newYear.startDate || !newYear.endDate) return;
    const year: AcademicYear = {
      id: crypto.randomUUID(),
      name: newYear.name.trim(),
      startDate: newYear.startDate,
      endDate: newYear.endDate,
    };
    updateAcademicYears([...academicYears, year]);
    setNewYear({ name: '', startDate: '', endDate: '' });
    setIsYearModalOpen(false);
  };

  const handleRemoveYear = (id: string) => {
    updateAcademicYears(academicYears.filter(y => y.id !== id));
  };

  const handleUpdateYear = (id: string, updates: Partial<AcademicYear>) => {
    updateAcademicYears(academicYears.map(y => y.id === id ? { ...y, ...updates } : y));
  };

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>{t('school_settings')}</h2>
      </div>

      <div className="section-card">
        <h3 className="section-title">{t('school_info')}</h3>
        <div className="form-grid">
          <FormField label={t('school_name')}>
            <input type="text" value={schoolName} onChange={(e) => setSchoolName(e.target.value)} />
          </FormField>
          <FormField label={t('school_address')}>
            <input type="text" value={schoolAddress} onChange={(e) => setSchoolAddress(e.target.value)} placeholder={t('optional')} />
          </FormField>
          <div>
            <button onClick={handleSaveSchool} className="primary-btn">{t('save')}</button>
          </div>
        </div>
      </div>

      <div className="section-card">
        <h3 className="section-title">{t('split_subjects')}</h3>
        <p className="section-desc">{t('split_subjects_desc')}</p>
        <div className="checkbox-grid">
          {(project?.subjects || []).map(subj => {
            const isSplit = (project?.school.splitSubjects || []).includes(subj.id);
            return (
              <label key={subj.id} className="checkbox-label">
                <input
                  type="checkbox"
                  checked={isSplit}
                  onChange={() => handleToggleSplitSubject(subj.id)}
                />
                <span>{subj.name}</span>
              </label>
            );
          })}
          {(project?.subjects || []).length === 0 && <span className="empty-hint">{t('no_subjects_yet')}</span>}
        </div>
      </div>

      <div className="view-header">
        <h3>{t('academic_years')}</h3>
        <button onClick={() => setIsYearModalOpen(true)} className="primary-btn">{t('add_year')}</button>
      </div>

      <Modal isOpen={isYearModalOpen} onClose={() => setIsYearModalOpen(false)} title={t('add_year')}
        actions={
          <>
            <button onClick={() => setIsYearModalOpen(false)} className="secondary-btn">{t('cancel')}</button>
            <button onClick={handleAddYear} className="primary-btn">{t('create')}</button>
          </>
        }
      >
        <FormField label={t('year_name')}>
          <input type="text" placeholder="e.g. 2024/2025" value={newYear.name} onChange={(e) => setNewYear({ ...newYear, name: e.target.value })} autoFocus />
        </FormField>
        <FormField label={t('start_date')}>
          <input type="date" value={newYear.startDate} onChange={(e) => setNewYear({ ...newYear, startDate: e.target.value })} />
        </FormField>
        <FormField label={t('end_date')}>
          <input type="date" value={newYear.endDate} onChange={(e) => setNewYear({ ...newYear, endDate: e.target.value })} />
        </FormField>
      </Modal>

      <div className="table-toolbar">
        <TableSearch value={query} onChange={setQuery} placeholder={t('search_placeholder')} />
        <span className="table-count">{t('showing_count', { shown, total })}</span>
      </div>

      <table className="editor-table">
        <thead>
          <tr>
            <SortableTh label={t('year_name')} sortKey="name" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('start_date')} sortKey="startDate" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('end_date')} sortKey="endDate" sort={sort} onSort={toggleSort} />
            <th style={{ width: '100px' }}>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {displayedYears.map(year => (
            <tr key={year.id}>
              <td>
                <input type="text" value={year.name} onChange={(e) => handleUpdateYear(year.id, { name: e.target.value })} />
              </td>
              <td>
                <input type="date" value={year.startDate} onChange={(e) => handleUpdateYear(year.id, { startDate: e.target.value })} />
              </td>
              <td>
                <input type="date" value={year.endDate} onChange={(e) => handleUpdateYear(year.id, { endDate: e.target.value })} />
              </td>
              <td>
                <button onClick={() => handleRemoveYear(year.id)} className="delete-btn">{t('delete')}</button>
              </td>
            </tr>
          ))}
          {displayedYears.length === 0 && (
            <tr><td colSpan={4} className="empty-row">{academicYears.length === 0 ? t('no_years') : t('no_results')}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
