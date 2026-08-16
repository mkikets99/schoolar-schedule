import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Teacher } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';
import { ImportWizard } from './ImportWizard';
import { useTableControls, TableSearch, SortableTh } from './TableControls';

export const TeacherEditor = () => {
  const { t } = useTranslation();
  const { project, updateTeachers } = useProject();
  const teachers = project?.teachers || [];
  const subjects = project?.subjects || [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [newTeacher, setNewTeacher] = useState({ name: '', shortName: '' });
  const [subjectFilter, setSubjectFilter] = useState('');

  const { query, setQuery, sort, toggleSort, rows: displayedTeachers, total, shown } = useTableControls<Teacher>({
    rows: teachers,
    getSearchText: (teacher) => {
      const subjectNames = teacher.subjects
        .map(id => subjects.find(s => s.id === id)?.name || '')
        .join(' ');
      return `${teacher.name} ${teacher.shortName || ''} ${subjectNames}`;
    },
    getSortValue: (teacher, key) => {
      switch (key) {
        case 'name': return teacher.name;
        case 'shortName': return teacher.shortName || '';
        case 'subjects': return teacher.subjects.length;
        default: return teacher.name;
      }
    },
    extraFilter: subjectFilter ? (teacher) => teacher.subjects.includes(subjectFilter) : undefined,
    defaultSort: { key: 'name', direction: 'asc' },
  });

  const handleAddTeacher = () => {
    if (!newTeacher.name.trim()) return;

    const teacher: Teacher = {
      id: crypto.randomUUID(),
      name: newTeacher.name.trim(),
      shortName: newTeacher.shortName.trim() || undefined,
      subjects: [],
    };

    updateTeachers([...teachers, teacher]);
    setNewTeacher({ name: '', shortName: '' });
    setIsModalOpen(false);
  };

  const handleRemoveTeacher = (id: string) => {
    if (confirm(t('confirm_delete_teacher'))) {
      updateTeachers(teachers.filter(t => t.id !== id));
    }
  };

  const handleUpdateTeacher = (id: string, updates: Partial<Teacher>) => {
    updateTeachers(teachers.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleImport = (data: any[]) => {
    const imported: Teacher[] = data.map((row: any) => ({
      id: crypto.randomUUID(),
      name: row.Name || row.name || '',
      shortName: row.ShortName || row.shortName || row.Initials || '',
      subjects: [],
    })).filter(t => t.name);
    
    updateTeachers([...teachers, ...imported]);
    alert(t('import_success', { count: imported.length }));
  };

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>{t('teachers')}</h2>
        <div className="header-actions" style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={() => setIsImportModalOpen(true)} className="secondary-btn">{t('import_data')}</button>
          <button onClick={() => setIsModalOpen(true)} className="primary-btn">{t('add_teacher')}</button>
        </div>
      </div>

      <ImportWizard 
        isOpen={isImportModalOpen} 
        onClose={() => setIsImportModalOpen(false)} 
        type="teacher"
        onImport={handleImport}
      />

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={t('new_teacher')}
        actions={
          <>
            <button onClick={() => setIsModalOpen(false)} className="secondary-btn">{t('cancel')}</button>
            <button onClick={handleAddTeacher} className="primary-btn">{t('create')}</button>
          </>
        }
      >
        <FormField label={t('full_name')}>
          <input 
            type="text" 
            placeholder="e.g. John Doe" 
            value={newTeacher.name}
            onChange={(e) => setNewTeacher({ ...newTeacher, name: e.target.value })}
            autoFocus
          />
        </FormField>
        <FormField label={t('short_name')}>
          <input 
            type="text" 
            placeholder="e.g. J.D." 
            value={newTeacher.shortName}
            onChange={(e) => setNewTeacher({ ...newTeacher, shortName: e.target.value })}
          />
        </FormField>
      </Modal>

      <div className="table-toolbar">
        <TableSearch value={query} onChange={setQuery} placeholder={t('search_placeholder')} />
        <select className="table-filter" value={subjectFilter} onChange={(e) => setSubjectFilter(e.target.value)}>
          <option value="">{t('all_subjects')}</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <span className="table-count">{t('showing_count', { shown, total })}</span>
      </div>

      <table className="editor-table">
        <thead>
          <tr>
            <SortableTh label={t('name')} sortKey="name" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('short_name')} sortKey="shortName" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('subjects')} sortKey="subjects" sort={sort} onSort={toggleSort} />
            <th style={{ width: '100px' }}>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {displayedTeachers.map(teacher => (
            <tr key={teacher.id}>
              <td>
                <input 
                  type="text" 
                  value={teacher.name} 
                  onChange={(e) => handleUpdateTeacher(teacher.id, { name: e.target.value })}
                />
              </td>
              <td>
                <input 
                  type="text" 
                  value={teacher.shortName || ''} 
                  onChange={(e) => handleUpdateTeacher(teacher.id, { shortName: e.target.value })}
                />
              </td>
              <td>{teacher.subjects.length}</td>
              <td>
                <button onClick={() => handleRemoveTeacher(teacher.id)} className="delete-btn">{t('delete')}</button>
              </td>
            </tr>
          ))}
          {displayedTeachers.length === 0 && (
            <tr>
              <td colSpan={4} className="empty-row">{teachers.length === 0 ? t('no_data', { type: 'teacher' }) : t('no_results')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
