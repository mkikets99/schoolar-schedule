import { useState } from 'react';
import { CurriculumRule } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';

export const CurriculumEditor = () => {
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
    roomId: ''
  });

  const handleAdd = () => {
    if (!newItem.groupId || !newItem.subjectId) return;

    const rule: CurriculumRule = {
      id: crypto.randomUUID(),
      groupId: newItem.groupId,
      subjectId: newItem.subjectId,
      hoursPerWeek: newItem.hours,
      teacherId: newItem.teacherId || undefined,
      roomId: newItem.roomId || undefined
    };

    updateCurriculum([...curriculum, rule]);
    setNewItem({ groupId: '', subjectId: '', hours: 1, teacherId: '', roomId: '' });
    setIsModalOpen(false);
  };

  const handleRemove = (id: string) => {
    if (confirm('Are you sure you want to delete this curriculum rule?')) {
      updateCurriculum(curriculum.filter(t => t.id !== id));
    }
  };

  const handleUpdate = (id: string, updates: Partial<CurriculumRule>) => {
    updateCurriculum(curriculum.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name || 'Unknown';
  const getSubjectName = (id: string) => subjects.find(s => s.id === id)?.name || 'Unknown';

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>Curriculum</h2>
        <button onClick={() => setIsModalOpen(true)} className="primary-btn">Add Curriculum Rule</button>
      </div>

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title="Add Curriculum Rule"
        actions={
          <>
            <button onClick={() => setIsModalOpen(false)} className="secondary-btn">Cancel</button>
            <button onClick={handleAdd} className="primary-btn">Add Rule</button>
          </>
        }
      >
        <FormField label="Target Group">
          <select value={newItem.groupId} onChange={(e) => setNewItem({ ...newItem, groupId: e.target.value })}>
            <option value="">Select Group...</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </FormField>
        <FormField label="Subject">
          <select value={newItem.subjectId} onChange={(e) => setNewItem({ ...newItem, subjectId: e.target.value })}>
            <option value="">Select Subject...</option>
            {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </FormField>
        <FormField label="Hours Per Week">
          <input 
            type="number" 
            value={newItem.hours} 
            onChange={(e) => setNewItem({ ...newItem, hours: parseFloat(e.target.value) || 1 })}
            min="0.5"
            step="0.5"
          />
        </FormField>
        <FormField label="Assign Teacher (Optional)">
          <select value={newItem.teacherId} onChange={(e) => setNewItem({ ...newItem, teacherId: e.target.value })}>
            <option value="">No Teacher assigned</option>
            {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </FormField>
        <FormField label="Preferred Room (Optional)">
          <select value={newItem.roomId} onChange={(e) => setNewItem({ ...newItem, roomId: e.target.value })}>
            <option value="">No Room preferred</option>
            {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </FormField>
      </Modal>

      <table className="editor-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Subject</th>
            <th style={{ width: '100px' }}>Hrs/Wk</th>
            <th>Teacher</th>
            <th>Room</th>
            <th style={{ width: '100px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {curriculum.map(item => (
            <tr key={item.id}>
              <td>{getGroupName(item.groupId)}</td>
              <td>{getSubjectName(item.subjectId)}</td>
              <td>
                <input 
                  type="number" 
                  value={item.hoursPerWeek} 
                  onChange={(e) => handleUpdate(item.id, { hoursPerWeek: parseFloat(e.target.value) || 1 })}
                  min="0.5"
                  step="0.5"
                />
              </td>
              <td>
                <select 
                  value={item.teacherId || ''} 
                  onChange={(e) => handleUpdate(item.id, { teacherId: e.target.value || undefined })}
                >
                  <option value="">None</option>
                  {teachers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </td>
              <td>
                <select 
                  value={item.roomId || ''} 
                  onChange={(e) => handleUpdate(item.id, { roomId: e.target.value || undefined })}
                >
                  <option value="">None</option>
                  {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </td>
              <td>
                <button onClick={() => handleRemove(item.id)} className="delete-btn">Delete</button>
              </td>
            </tr>
          ))}
          {curriculum.length === 0 && (
            <tr>
              <td colSpan={6} className="empty-row">No curriculum rules defined yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
