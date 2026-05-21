import { useState } from 'react';
import { Room } from '../../shared/types';
import { useProject } from '../context/ProjectContext';

export const RoomEditor = () => {
  const { project, updateRooms } = useProject();
  const rooms = project?.rooms || [];

  const [newName, setNewName] = useState('');

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;

    const newItem: Room = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      types: [],
    };

    updateRooms([...rooms, newItem]);
    setNewName('');
  };

  const handleRemove = (id: string) => {
    updateRooms(rooms.filter(t => t.id !== id));
  };

  const handleUpdate = (id: string, updates: Partial<Room>) => {
    updateRooms(rooms.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  return (
    <div className="entity-editor">
      <form onSubmit={handleAdd} className="add-form">
        <input 
          type="text" 
          placeholder="New Room Name" 
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit">Add Room</button>
      </form>

      <table className="editor-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Capacity</th>
            <th>Types</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map(item => (
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
                  value={item.capacity || ''} 
                  onChange={(e) => handleUpdate(item.id, { capacity: parseInt(e.target.value) || 0 })}
                  placeholder="30"
                />
              </td>
              <td>
                {item.types.join(', ')}
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
