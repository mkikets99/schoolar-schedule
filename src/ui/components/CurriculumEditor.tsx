import { useState } from 'react';
import { CurriculumRule } from '../../shared/types';
import { useProject } from '../context/ProjectContext';

export const CurriculumEditor = () => {
  const { project, updateCurriculum } = useProject();
  const curriculum = project?.curriculum || [];
  const groups = project?.groups || [];
  const subjects = project?.subjects || [];
  const teachers = project?.teachers || [];
  const rooms = project?.rooms || [];

  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [hours, setHours] = useState(1);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupId || !selectedSubjectId) return;

    const newItem: CurriculumRule = {
      id: crypto.randomUUID(),
      groupId: selectedGroupId,
      subjectId: selectedSubjectId,
      hoursPerWeek: hours,
    };

    updateCurriculum([...curriculum, newItem]);
  };

  const handleRemove = (id: string) => {
    updateCurriculum(curriculum.filter(t => t.id !== id));
  };

  const handleUpdate = (id: string, updates: Partial<CurriculumRule>) => {
    updateCurriculum(curriculum.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const getGroupName = (id: string) => groups.find(g => g.id === id)?.name || 'Unknown';
  const getSubjectName = (id: string) => subjects.find(s => s.id === id)?.name || 'Unknown';

  return (
    <div className="entity-editor">
      <form onSubmit={handleAdd} className="add-form">
        <select value={selectedGroupId} onChange={(e) => setSelectedGroupId(e.target.value)} required>
          <option value="">Select Group</option>
          {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <select value={selectedSubjectId} onChange={(e) => setSelectedSubjectId(e.target.value)} required>
          <option value="">Select Subject</option>
          {subjects.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input 
          type="number" 
          value={hours} 
          onChange={(e) => setHours(parseFloat(e.target.value) || 1)}
          min="0.5"
          step="0.5"
          style={{ width: '80px' }}
        />
        <button type="submit">Add Rule</button>
      </form>

      <table className="editor-table">
        <thead>
          <tr>
            <th>Group</th>
            <th>Subject</th>
            <th>Hours/Week</th>
            <th>Default Teacher</th>
            <th>Default Room</th>
            <th>Actions</th>
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
        </tbody>
      </table>
    </div>
  );
};
