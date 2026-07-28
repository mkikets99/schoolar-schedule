import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CurriculumRule } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';

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

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newItem, setNewItem] = useState({
    groupId: '',
    subjectId: '',
    hours: 1,
    teacherId: '',
    roomId: '',
  });
  const [splitMode, setSplitMode] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [subgroups, setSubgroups] = useState<SubgroupEntry[]>([
    { id: 'sg-1', teacherId: '', roomId: '' },
    { id: 'sg-2', teacherId: '', roomId: '' },
  ]);

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
      };
      updateCurriculum([...curriculum, rule]);
    }

    setNewItem({ groupId: '', subjectId: '', hours: 1, teacherId: '', roomId: '' });
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

  const isDuplicate = (item: typeof curriculum[0], index: number) =>
    curriculum.some((other, oi) =>
      oi !== index &&
      other.groupId === item.groupId &&
      other.subjectId === item.subjectId &&
      index > oi
    );

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>{t('curriculum')}</h2>
        <button onClick={() => setIsModalOpen(true)} className="primary-btn">{t('add_rule')}</button>
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
          <select value={newItem.groupId} onChange={(e) => setNewItem({ ...newItem, groupId: e.target.value })}>
            <option value="">{t('select_group')}</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </FormField>
        <FormField label={t('subject')}>
          <select value={newItem.subjectId} onChange={(e) => setNewItem({ ...newItem, subjectId: e.target.value })}>
            <option value="">{t('select_subject')}</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
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
                    <select value={sg.teacherId} onChange={(e) => updateSubgroup(idx, 'teacherId', e.target.value)}>
                      <option value="">{t('no_teacher')}</option>
                      {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </FormField>
                  <FormField label={t('preferred_room')}>
                    <select value={sg.roomId} onChange={(e) => updateSubgroup(idx, 'roomId', e.target.value)}>
                      <option value="">{t('no_room')}</option>
                      {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </FormField>
                </div>
              ))}
            </div>
          </>
        )}

        {!splitMode && (
          <>
            <FormField label={t('assign_teacher')}>
              <select value={newItem.teacherId} onChange={(e) => setNewItem({ ...newItem, teacherId: e.target.value })}>
                <option value="">{t('no_teacher')}</option>
                {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </FormField>
            <FormField label={t('preferred_room')}>
              <select value={newItem.roomId} onChange={(e) => setNewItem({ ...newItem, roomId: e.target.value })}>
                <option value="">{t('no_room')}</option>
                {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </FormField>
          </>
        )}
      </Modal>

      <table className="editor-table">
        <thead>
          <tr>
            <th>{t('group')}</th>
            <th>{t('subject')}</th>
            <th style={{ width: '80px' }}>{t('hours')}</th>
            <th>{t('teacher')}</th>
            <th>{t('room')}</th>
            <th style={{ width: '60px' }}>{t('split')}</th>
            <th style={{ width: '80px' }}>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {curriculum.map((item, index) => {
            const dup = isDuplicate(item, index);
            return (
              <tr key={item.id} className={dup ? 'split-group' : ''}>
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
                  <select
                    value={item.teacherId || ''}
                    onChange={(e) => handleUpdate(item.id, { teacherId: e.target.value || undefined })}
                  >
                    <option value="">{t('none')}</option>
                    {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </td>
                <td>
                  <select
                    value={item.roomId || ''}
                    onChange={(e) => handleUpdate(item.id, { roomId: e.target.value || undefined })}
                  >
                    <option value="">{t('none')}</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: 'center' }}>
                  {dup && <span className="split-badge">{t('split')}</span>}
                </td>
                <td>
                  <button onClick={() => handleRemove(item.id)} className="delete-btn">{t('delete')}</button>
                </td>
              </tr>
            );
          })}
          {curriculum.length === 0 && (
            <tr>
              <td colSpan={7} className="empty-row">{t('no_rules')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
