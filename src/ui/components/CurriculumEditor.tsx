import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CurriculumRule } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';
import { useTableControls, TableSearch, SortableTh } from './TableControls';
import { SearchableSelect } from './SearchableSelect';
import { eligibleTeacherOptions } from '../../shared/eligibility';

interface SubgroupEntry {
  id: string;
  teacherId: string;
  roomId: string;
}

export const CurriculumEditor = () => {
  const { t } = useTranslation();
  const { project, updateCurriculum } = useProject();
  const curriculum = project?.curriculum || [];
  const groups = project?.groups || [];
  const subjects = project?.subjects || [];
  const teachers = project?.teachers || [];
  const rooms = project?.rooms || [];
  const loadTeacherIds = [...new Set((project?.loadDistribution || []).map(l => l.teacherId))];
  const groupOptions = groups.map(g => ({ value: g.id, label: g.name }));
  const subjectOptions = subjects.map(s => ({ value: s.id, label: s.name }));
  const roomOptions = rooms.map(r => ({ value: r.id, label: r.name }));
  const teacherOptionsForSubject = (subjectId: string) =>
    eligibleTeacherOptions(teachers, subjectId);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [groupFilter, setGroupFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [splitsOnly, setSplitsOnly] = useState(false);
  const [newItem, setNewItem] = useState({
    groupId: '',
    subjectId: '',
    hours: 1,
    teacherId: '',
    roomId: '',
    double: false,
  });
  const [splitMode, setSplitMode] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [subgroups, setSubgroups] = useState<SubgroupEntry[]>([
    { id: 'sg-1', teacherId: '', roomId: '' },
    { id: 'sg-2', teacherId: '', roomId: '' },
  ]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const handleSplitCountChange = (n: number) => {
    setSplitCount(n);
    const current = [...subgroups];
    while (current.length < n) {
      current.push({ id: `sg-${current.length + 1}`, teacherId: '', roomId: '' });
    }
    setSubgroups(current.slice(0, n));
  };

  const updateSubgroup = (idx: number, field: keyof SubgroupEntry, value: string) => {
    setSubgroups(subgroups.map((sg, i) => i === idx ? { ...sg, [field]: value } : sg));
  };

  const handleAdd = () => {
    if (!newItem.groupId || !newItem.subjectId) return;

    if (splitMode) {
      const newRules = subgroups.map(sg => ({
        id: crypto.randomUUID(),
        groupId: newItem.groupId,
        subjectId: newItem.subjectId,
        hoursPerWeek: Math.ceil(newItem.hours / splitCount),
        teacherId: sg.teacherId || undefined,
        roomId: sg.roomId || undefined,
      }));
      updateCurriculum([...curriculum, ...newRules]);
    } else {
      const rule: CurriculumRule = {
        id: crypto.randomUUID(),
        groupId: newItem.groupId,
        subjectId: newItem.subjectId,
        hoursPerWeek: newItem.hours,
        teacherId: newItem.teacherId || undefined,
        roomId: newItem.roomId || undefined,
        doubleLesson: newItem.double || undefined,
      };
      updateCurriculum([...curriculum, rule]);
    }

    setNewItem({ groupId: '', subjectId: '', hours: 1, teacherId: '', roomId: '', double: false });
    setSplitMode(false);
    setSplitCount(2);
    setSubgroups([
      { id: 'sg-1', teacherId: '', roomId: '' },
      { id: 'sg-2', teacherId: '', roomId: '' },
    ]);
    setIsModalOpen(false);
  };

  const handleRemove = (id: string) => {
    if (confirm(t('confirm_delete_rule'))) {
      updateCurriculum(curriculum.filter(t => t.id !== id));
    }
  };

  const handleUpdate = (id: string, updates: Partial<CurriculumRule>) => {
    updateCurriculum(curriculum.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name || 'Unknown';
  const getSubjectName = (id: string) => subjects.find(s => s.id === id)?.name || 'Unknown';
  const getTeacherName = (id?: string) => (id ? teachers.find(t => t.id === id)?.name || '' : '');
  const getRoomName = (id?: string) => (id ? rooms.find(r => r.id === id)?.name || '' : '');

  const isSplitRule = (item: CurriculumRule) =>
    curriculum.some(other =>
      other.id !== item.id &&
      other.groupId === item.groupId &&
      other.subjectId === item.subjectId
    );

  const isDuplicate = (item: CurriculumRule) => {
    const sameKey = curriculum.filter(o =>
      o.groupId === item.groupId && o.subjectId === item.subjectId
    );
    return sameKey.length > 1 && sameKey[0].id !== item.id;
  };

  const { query, setQuery, sort, toggleSort, rows: displayedCurriculum, total, shown } = useTableControls<CurriculumRule>({
    rows: curriculum,
    getSearchText: (rule) =>
      `${getGroupName(rule.groupId)} ${getSubjectName(rule.subjectId)} ${getTeacherName(rule.teacherId)} ${getRoomName(rule.roomId)}`,
    getSortValue: (rule, key) => {
      switch (key) {
        case 'group': return getGroupName(rule.groupId);
        case 'subject': return getSubjectName(rule.subjectId);
        case 'hours': return rule.hoursPerWeek;
        case 'teacher': return getTeacherName(rule.teacherId);
        case 'room': return getRoomName(rule.roomId);
        case 'split': return isSplitRule(rule) ? 1 : 0;
        case 'double': return rule.doubleLesson ? 1 : 0;
        default: return getGroupName(rule.groupId);
      }
    },
    extraFilter: (rule) => {
      if (groupFilter && rule.groupId !== groupFilter) return false;
      if (subjectFilter && rule.subjectId !== subjectFilter) return false;
      if (splitsOnly && !isSplitRule(rule)) return false;
      return true;
    },
    defaultSort: { key: 'group', direction: 'asc' },
  });

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allDisplayedSelected = displayedCurriculum.length > 0 &&
    displayedCurriculum.every(item => selectedIds.has(item.id));

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allDisplayedSelected) {
        displayedCurriculum.forEach(item => next.delete(item.id));
      } else {
        displayedCurriculum.forEach(item => next.add(item.id));
      }
      return next;
    });
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (confirm(t('confirm_delete_selected', { count: selectedIds.size }))) {
      updateCurriculum(curriculum.filter(r => !selectedIds.has(r.id)));
      setSelectedIds(new Set());
    }
  };

  const handleDeleteAll = () => {
    if (curriculum.length === 0) return;
    if (confirm(t('confirm_delete_all', { count: curriculum.length }))) {
      updateCurriculum([]);
      setSelectedIds(new Set());
    }
  };

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>{t('curriculum')}</h2>
        <div className="header-actions-group">
          {curriculum.length > 0 && (
            <>
              <button
                onClick={handleDeleteSelected}
                disabled={selectedIds.size === 0}
                className="delete-btn"
              >
                {t('delete_selected')}{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </button>
              <button onClick={handleDeleteAll} className="delete-btn">{t('delete_all')}</button>
            </>
          )}
          <button onClick={() => setIsModalOpen(true)} className="primary-btn">{t('add_rule')}</button>
        </div>
      </div>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={splitMode ? t('add_split_rule') : t('add_rule_title')}
        actions={
          <>
            <button onClick={() => setIsModalOpen(false)} className="secondary-btn">{t('cancel')}</button>
            <button onClick={handleAdd} className="primary-btn">{splitMode ? t('add_split_rule') : t('add_rule')}</button>
          </>
        }
      >
        <FormField label={t('target_group')}>
          <SearchableSelect
            value={newItem.groupId}
            onChange={(v) => setNewItem({ ...newItem, groupId: v })}
            options={groupOptions}
            placeholder={t('select_group')}
            allowEmpty
          />
        </FormField>
        <FormField label={t('subject')}>
          <SearchableSelect
            value={newItem.subjectId}
            onChange={(v) => setNewItem({ ...newItem, subjectId: v })}
            options={subjectOptions}
            placeholder={t('select_subject')}
            allowEmpty
          />
        </FormField>
        <FormField label={t('hours_per_week')}>
          <input
            type="number"
            value={newItem.hours}
            onChange={(e) => setNewItem({ ...newItem, hours: parseFloat(e.target.value) || 1 })}
            min="0.5"
            step="0.5"
          />
        </FormField>

        <div className="form-field">
          <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={splitMode} onChange={(e) => setSplitMode(e.target.checked)} />
            {t('split_into_subgroups')}
          </label>
        </div>

        {!splitMode && (
          <div className="form-field">
            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={newItem.double} onChange={(e) => setNewItem({ ...newItem, double: e.target.checked })} />
              {t('double_lesson')}
            </label>
          </div>
        )}

        {splitMode && (
          <>
            <FormField label={t('subgroup_count')}>
              <select value={splitCount} onChange={(e) => handleSplitCountChange(parseInt(e.target.value))}>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </FormField>

            <div className="subgroup-section">
              {subgroups.map((sg, idx) => (
                <div key={sg.id} className="subgroup-card">
                  <h4 className="subgroup-title">{t('subgroup_n', { n: idx + 1 })}</h4>
                  <FormField label={t('assign_teacher')}>
                    <SearchableSelect
                      value={sg.teacherId}
                      onChange={(v) => updateSubgroup(idx, 'teacherId', v)}
                      options={teacherOptionsForSubject(newItem.subjectId)}
                      placeholder={t('no_teacher')}
                      allowEmpty
                      pinTop={loadTeacherIds}
                    />
                  </FormField>
                  <FormField label={t('preferred_room')}>
                    <SearchableSelect
                      value={sg.roomId}
                      onChange={(v) => updateSubgroup(idx, 'roomId', v)}
                      options={roomOptions}
                      placeholder={t('no_room')}
                      allowEmpty
                    />
                  </FormField>
                </div>
              ))}
            </div>
          </>
        )}

        {!splitMode && (
          <>
            <FormField label={t('assign_teacher')}>
              <SearchableSelect
                value={newItem.teacherId}
                onChange={(v) => setNewItem({ ...newItem, teacherId: v })}
                options={teacherOptionsForSubject(newItem.subjectId)}
                placeholder={t('no_teacher')}
                allowEmpty
                pinTop={loadTeacherIds}
              />
            </FormField>
            <FormField label={t('preferred_room')}>
              <SearchableSelect
                value={newItem.roomId}
                onChange={(v) => setNewItem({ ...newItem, roomId: v })}
                options={roomOptions}
                placeholder={t('no_room')}
                allowEmpty
              />
            </FormField>
          </>
        )}
      </Modal>

      <div className="table-toolbar">
        <TableSearch value={query} onChange={setQuery} placeholder={t('search_placeholder')} />
        <SearchableSelect
          className="table-filter"
          value={groupFilter}
          onChange={setGroupFilter}
          options={groupOptions}
          placeholder={t('all_groups')}
          allowEmpty
        />
        <SearchableSelect
          className="table-filter"
          value={subjectFilter}
          onChange={setSubjectFilter}
          options={subjectOptions}
          placeholder={t('all_subjects')}
          allowEmpty
        />
        <label className="table-toggle">
          <input type="checkbox" checked={splitsOnly} onChange={(e) => setSplitsOnly(e.target.checked)} />
          {t('splits_only')}
        </label>
        <span className="table-count">{t('showing_count', { shown, total })}</span>
      </div>

      <table className="editor-table">
        <thead>
          <tr>
            <th style={{ width: '40px' }}>
              <input
                type="checkbox"
                checked={allDisplayedSelected}
                onChange={toggleSelectAll}
                disabled={displayedCurriculum.length === 0}
                title={t('select_all_displayed')}
              />
            </th>
            <SortableTh label={t('group')} sortKey="group" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('subject')} sortKey="subject" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('hours')} sortKey="hours" sort={sort} onSort={toggleSort} style={{ width: '80px' }} />
            <SortableTh label={t('teacher')} sortKey="teacher" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('room')} sortKey="room" sort={sort} onSort={toggleSort} />
            <SortableTh label={t('split')} sortKey="split" sort={sort} onSort={toggleSort} style={{ width: '60px' }} />
            <SortableTh label={t('double_lesson')} sortKey="double" sort={sort} onSort={toggleSort} style={{ width: '60px' }} />
            <th style={{ width: '80px' }}>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {displayedCurriculum.map((item) => {
            const dup = isDuplicate(item);
            return (
              <tr key={item.id} className={dup ? 'split-group' : ''}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(item.id)}
                    onChange={() => toggleSelect(item.id)}
                  />
                </td>
                <td>{getGroupName(item.groupId)}</td>
                <td>{getSubjectName(item.subjectId)}</td>
                <td>
                  <input
                    type="number"
                    value={item.hoursPerWeek}
                    onChange={(e) => handleUpdate(item.id, { hoursPerWeek: parseFloat(e.target.value) || 1 })}
                    min="0.5"
                    step="0.5"
                    style={{ width: '60px' }}
                  />
                </td>
                <td>
                  <SearchableSelect
                    value={item.teacherId || ''}
                    onChange={(v) => handleUpdate(item.id, { teacherId: v || undefined })}
                    options={teacherOptionsForSubject(item.subjectId)}
                    placeholder={t('none')}
                    allowEmpty
                    pinTop={loadTeacherIds}
                  />
                </td>
                <td>
                  <SearchableSelect
                    value={item.roomId || ''}
                    onChange={(v) => handleUpdate(item.id, { roomId: v || undefined })}
                    options={roomOptions}
                    placeholder={t('none')}
                    allowEmpty
                  />
                </td>
                <td style={{ textAlign: 'center' }}>
                  {dup && <span className="split-badge">{t('split')}</span>}
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input
                    type="checkbox"
                    checked={!!item.doubleLesson}
                    onChange={(e) => handleUpdate(item.id, { doubleLesson: e.target.checked })}
                    title={t('double_lesson')}
                  />
                </td>
                <td>
                  <button onClick={() => handleRemove(item.id)} className="delete-btn">{t('delete')}</button>
                </td>
              </tr>
            );
          })}
          {displayedCurriculum.length === 0 && (
            <tr>
              <td colSpan={9} className="empty-row">{curriculum.length === 0 ? t('no_rules') : t('no_results')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
