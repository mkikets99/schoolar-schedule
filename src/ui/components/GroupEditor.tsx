import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Group } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';
import { ImportWizard } from './ImportWizard';
import { useTableControls, TableSearch, SortableTh } from './TableControls';

export const GroupEditor = () => {
  const { t } = useTranslation();
  const { project, updateGroups } = useProject();
  const groups = project?.groups || [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', grade: 1, shift: 'first' as 'first' | 'second' });
  const [gradeFilter, setGradeFilter] = useState('');
  const [shiftFilter, setShiftFilter] = useState('');

  const grades = [...new Set(groups.map(g => g.grade))].sort((a, b) => a - b);

  const { query, setQuery, sort, toggleSort, rows: displayedGroups, total, shown } = useTableControls<Group>({
    rows: groups,
    getSearchText: (group) => `${group.name} ${group.subgroups.join(' ')}`,
    getSortValue: (group, key) => {
      switch (key) {
        case 'name': return group.name;
        case 'grade': return group.grade;
        case 'maxDailyLessons': return group.maxDailyLessons ?? 8;
        default: return group.name;
      }
    },
    extraFilter: (group) => {
      if (gradeFilter && group.grade !== parseInt(gradeFilter)) return false;
      if (shiftFilter) {
        const shift = group.periodStart === 6 ? 'second' : 'first';
        if (shift !== shiftFilter) return false;
      }
      return true;
    },
    defaultSort: { key: 'name', direction: 'asc' },
  });

  const handleAdd = () => {
    if (!newItem.name.trim()) return;

    const group: Group = {
      id: crypto.randomUUID(),
      name: newItem.name.trim(),
      grade: newItem.grade,
      subgroups: [],
      periodStart: newItem.shift === 'first' ? 1 : 6,
      periodEnd: newItem.shift === 'first' ? 8 : 12,
      maxDailyLessons: newItem.grade <= 4 ? 5 : 7,
    };

    updateGroups([...groups, group]);
    setNewItem({ name: '', grade: 1, shift: 'first' });
    setIsModalOpen(false);
  };

  const handleRemove = (id: string) => {
    if (confirm(t('confirm_delete_group'))) {
      updateGroups(groups.filter(t => t.id !== id));
    }
  };

  const handleUpdate = (id: string, updates: Partial<Group>) => {
    updateGroups(groups.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleImport = (data: any[]) => {
    const imported: Group[] = data.map((row: any) => ({
      id: crypto.randomUUID(),
      name: row.Name || row.name || '',
      grade: parseInt(row.Grade || row.grade) || 1,
      subgroups: [],
    })).filter(g => g.name);

    updateGroups([...groups, ...imported]);
    alert(t('import_success', { count: imported.length }));
  };

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>{t('groups')}</h2>
        <div className="header-actions" style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={() => setIsImportModalOpen(true)} className="secondary-btn">{t('import_data')}</button>
          <button onClick={() => setIsModalOpen(true)} className="primary-btn">{t('add_group')}</button>
        </div>
      </div>

      <ImportWizard 
        isOpen={isImportModalOpen} 
        onClose={() => setIsImportModalOpen(false)} 
        type="group"
        onImport={handleImport}
      />

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title={t('new_group')}
        actions={
          <>
            <button onClick={() => setIsModalOpen(false)} className="secondary-btn">{t('cancel')}</button>
            <button onClick={handleAdd} className="primary-btn">{t('create_group')}</button>
          </>
        }
      >
        <FormField label={t('group_name')}>
          <input 
            type="text" 
            placeholder="e.g. 10-A or Class 4" 
            value={newItem.name}
            onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
            autoFocus
          />
        </FormField>
        <FormField label={t('grade_level')}>
          <input 
            type="number" 
            value={newItem.grade}
            onChange={(e) => setNewItem({ ...newItem, grade: parseInt(e.target.value) || 1 })}
            min="1"
            max="12"
          />
        </FormField>
        <FormField label={t('shift')}>
          <select 
            value={newItem.shift}
            onChange={(e) => setNewItem({ ...newItem, shift: e.target.value as 'first' | 'second' })}
          >
            <option value="first">{t('shift_first')} (1-8)</option>
            <option value="second">{t('shift_second')} (6-12)</option>
          </select>
        </FormField>
      </Modal>

      <div className="table-toolbar">
        <TableSearch value={query} onChange={setQuery} placeholder={t('search_placeholder')} />
        <select className="table-filter" value={gradeFilter} onChange={(e) => setGradeFilter(e.target.value)}>
          <option value="">{t('all_grades')}</option>
          {grades.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
        <select className="table-filter" value={shiftFilter} onChange={(e) => setShiftFilter(e.target.value)}>
          <option value="">{t('all_shifts')}</option>
          <option value="first">{t('shift_first')}</option>
          <option value="second">{t('shift_second')}</option>
        </select>
        <span className="table-count">{t('showing_count', { shown, total })}</span>
      </div>

        <table className="editor-table">
        <thead>
          <tr>
            <SortableTh label={t('name')} sortKey="name" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('grade')} sortKey="grade" sort={sort} onSort={toggleSort} />
            <th>{t('shift')}</th>
            <th>{t('periods')}</th>
            <SortableTh label={t('max_daily')} sortKey="maxDailyLessons" sort={sort} onSort={toggleSort} />
            <th>{t('subgroups')}</th>
            <th style={{ width: '100px' }}>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {displayedGroups.map(item => (
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
                  type="number" 
                  value={item.grade} 
                  onChange={(e) => handleUpdate(item.id, { grade: parseInt(e.target.value) || 1 })}
                  min="1"
                  max="12"
                />
              </td>
              <td>
                <select 
                  value={item.periodStart === 6 ? 'second' : 'first'}
                  onChange={(e) => {
                    const shift = e.target.value;
                    handleUpdate(item.id, {
                      periodStart: shift === 'first' ? 1 : 6,
                      periodEnd: shift === 'first' ? 8 : 12,
                    });
                  }}
                >
                  <option value="first">{t('shift_first')}</option>
                  <option value="second">{t('shift_second')}</option>
                </select>
              </td>
              <td>{item.periodStart ?? 1}–{item.periodEnd ?? 8}</td>
              <td>
                <input 
                  type="number" 
                  value={item.maxDailyLessons ?? 8}
                  onChange={(e) => handleUpdate(item.id, { maxDailyLessons: parseInt(e.target.value) || 1 })}
                  min="1"
                  max="12"
                  style={{ width: '60px' }}
                />
              </td>
              <td>{t('subgroups_count', { count: item.subgroups.length })}</td>
              <td>
                <button onClick={() => handleRemove(item.id)} className="delete-btn">{t('delete')}</button>
              </td>
            </tr>
          ))}
          {displayedGroups.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-row">{groups.length === 0 ? t('no_groups') : t('no_results')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
