import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Subject } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';
import { ImportWizard } from './ImportWizard';
import { useTableControls, TableSearch, SortableTh } from './TableControls';

export const SubjectEditor = () => {
  const { t } = useTranslation();
  const { project, updateSubjects } = useProject();
  const subjects = project?.subjects || [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', shortName: '', color: '#646cff' });

  const { query, setQuery, sort, toggleSort, rows: displayedSubjects, total, shown } = useTableControls<Subject>({
    rows: subjects,
    getSearchText: (subject) => `${subject.name} ${subject.shortName || ''}`,
    getSortValue: (subject, key) => {
      switch (key) {
        case 'name': return subject.name;
        case 'shortName': return subject.shortName || '';
        default: return subject.name;
      }
    },
    defaultSort: { key: 'name', direction: 'asc' },
  });

  const handleAdd = () => {
    if (!newItem.name.trim()) return;

    const subject: Subject = {
      id: crypto.randomUUID(),
      name: newItem.name.trim(),
      shortName: newItem.shortName.trim() || undefined,
      color: newItem.color
    };

    updateSubjects([...subjects, subject]);
    setNewItem({ name: '', shortName: '', color: '#646cff' });
    setIsModalOpen(false);
  };

  const handleRemove = (id: string) => {
    if (confirm(t('confirm_delete_subject'))) {
      updateSubjects(subjects.filter(t => t.id !== id));
    }
  };

  const handleUpdate = (id: string, updates: Partial<Subject>) => {
    updateSubjects(subjects.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleImport = (data: any[]) => {
    const imported: Subject[] = data.map((row: any) => ({
      id: crypto.randomUUID(),
      name: row.Name || row.name || '',
      shortName: row.ShortName || row.shortName || row.Code || row.code || '',
      color: '#646cff'
    })).filter(s => s.name);

    updateSubjects([...subjects, ...imported]);
    alert(t('import_success', { count: imported.length }));
  };

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>{t('subjects')}</h2>
        <div className="header-actions" style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={() => setIsImportModalOpen(true)} className="secondary-btn">{t('import_data')}</button>
          <button onClick={() => setIsModalOpen(true)} className="primary-btn">{t('add_subject')}</button>
        </div>
      </div>

      <ImportWizard 
        isOpen={isImportModalOpen} 
        onClose={() => setIsImportModalOpen(false)} 
        type="subject"
        onImport={handleImport}
      />

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={t('new_subject')}
        actions={
          <>
            <button onClick={() => setIsModalOpen(false)} className="secondary-btn">{t('cancel')}</button>
            <button onClick={handleAdd} className="primary-btn">{t('create_subject')}</button>
          </>
        }
      >
        <FormField label={t('subject_name')}>
          <input 
            type="text" 
            placeholder="e.g. Mathematics" 
            value={newItem.name}
            onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
            autoFocus
          />
        </FormField>
        <FormField label={t('short_code')}>
          <input 
            type="text" 
            placeholder="e.g. MATH" 
            value={newItem.shortName}
            onChange={(e) => setNewItem({ ...newItem, shortName: e.target.value })}
          />
        </FormField>
        <FormField label={t('color_label')}>
          <input 
            type="color" 
            value={newItem.color}
            onChange={(e) => setNewItem({ ...newItem, color: e.target.value })}
          />
        </FormField>
      </Modal>

      <div className="table-toolbar">
        <TableSearch value={query} onChange={setQuery} placeholder={t('search_placeholder')} />
        <span className="table-count">{t('showing_count', { shown, total })}</span>
      </div>

      <table className="editor-table">
        <thead>
          <tr>
            <SortableTh label={t('name')} sortKey="name" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('short_code')} sortKey="shortName" sort={sort} onSort={toggleSort} />
            <th style={{ width: '80px' }}>{t('color')}</th>
            <th style={{ width: '100px' }}>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {displayedSubjects.map(item => (
            <tr key={item.id}>
              <td>
                <input 
                  type="text" 
                  value={item.name} 
                  onChange={(e) => handleUpdate(item.id, { name: e.target.value })}
                />
              </td>
              <td>
                <input 
                  type="text" 
                  value={item.shortName || ''} 
                  onChange={(e) => handleUpdate(item.id, { shortName: e.target.value })}
                />
              </td>
              <td>
                <input 
                  type="color" 
                  value={item.color || '#646cff'} 
                  onChange={(e) => handleUpdate(item.id, { color: e.target.value })}
                  style={{ width: '40px', padding: 0, border: 'none', height: '24px' }}
                />
              </td>
              <td>
                <button onClick={() => handleRemove(item.id)} className="delete-btn">{t('delete')}</button>
              </td>
            </tr>
          ))}
          {displayedSubjects.length === 0 && (
            <tr>
              <td colSpan={4} className="empty-row">{subjects.length === 0 ? t('no_subjects') : t('no_results')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
