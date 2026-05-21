import { useState } from 'react';
import { Subject } from '../../shared/types';
import { useProject } from '../context/ProjectContext';

export const SubjectEditor = () => {
  const { project, updateSubjects } = useProject();
  const subjects = project?.subjects || [];

  const [newName, setNewName] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const newItem: Subject = {
      id: crypto.randomUUID(),
      name: newName.trim(),
    };

    updateSubjects([...subjects, newItem]);
    setNewName('');
  };

  const handleRemove = (id: string) => {
    updateSubjects(subjects.filter(t => t.id !== id));
  };

  const handleUpdate = (id: string, updates: Partial<Subject>) => {
    updateSubjects(subjects.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  return (
    <div className="entity-editor">
      <form onSubmit={handleAdd} className="add-form">
        <input 
          type="text" 
          placeholder="New Subject Name" 
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit">Add Subject</button>
      </form>

      <table className="editor-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Short Name</th>
            <th>Color</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {subjects.map(item => (
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
                  placeholder="CODE"
                />
              </td>
              <td>
                <input 
                  type="color" 
                  value={item.color || '#646cff'} 
                  onChange={(e) => handleUpdate(item.id, { color: e.target.value })}
                  style={{ width: '40px', padding: 0 }}
                />
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
