import { useState } from 'react';
import { Group } from '../../shared/types';
import { useProject } from '../context/ProjectContext';

export const GroupEditor = () => {
  const { project, updateGroups } = useProject();
  const groups = project?.groups || [];

  const [newName, setNewName] = useState('');
  const [newGrade, setNewGrade] = useState(1);

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const newItem: Group = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      grade: newGrade,
      subgroups: [],
    };

    updateGroups([...groups, newItem]);
    setNewName('');
  };

  const handleRemove = (id: string) => {
    updateGroups(groups.filter(t => t.id !== id));
  };

  const handleUpdate = (id: string, updates: Partial<Group>) => {
    updateGroups(groups.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  return (
    <div className="entity-editor">
      <form onSubmit={handleAdd} className="add-form">
        <input 
          type="text" 
          placeholder="New Group Name (e.g., 10-A)" 
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <input 
          type="number" 
          placeholder="Grade" 
          value={newGrade}
          onChange={(e) => setNewGrade(parseInt(e.target.value) || 1)}
          min="1"
          max="12"
          style={{ width: '80px' }}
        />
        <button type="submit">Add Group</button>
      </form>

      <table className="editor-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Grade</th>
            <th>Subgroups</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {groups.map(item => (
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
                {item.subgroups.length} subgroups
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
