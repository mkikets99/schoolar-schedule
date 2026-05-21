import { useState } from 'react';
import { Room } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';
import { ImportWizard } from './ImportWizard';

export const RoomEditor = () => {
  const { project, updateRooms } = useProject();
  const rooms = project?.rooms || [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', capacity: 30 });

  const handleAdd = () => {
    if (!newItem.name.trim()) return;

    const room: Room = {
      id: crypto.randomUUID(),
      name: newItem.name.trim(),
      capacity: newItem.capacity,
      types: [],
    };

    updateRooms([...rooms, room]);
    setNewItem({ name: '', capacity: 30 });
    setIsModalOpen(false);
  };

  const handleRemove = (id: string) => {
    if (confirm('Are you sure you want to delete this room?')) {
      updateRooms(rooms.filter(t => t.id !== id));
    }
  };

  const handleUpdate = (id: string, updates: Partial<Room>) => {
    updateRooms(rooms.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleImport = (data: any[]) => {
    const imported: Room[] = data.map((row: any) => ({
      id: crypto.randomUUID(),
      name: row.Name || row.name || row.number || '',
      capacity: parseInt(row.Capacity || row.capacity) || 30,
      types: [],
    })).filter(r => r.name);
    
    updateRooms([...rooms, ...imported]);
  };

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>Rooms</h2>
        <div className="header-actions" style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={() => setIsImportModalOpen(true)} className="secondary-btn">Import Data</button>
          <button onClick={() => setIsModalOpen(true)} className="primary-btn">Add Room</button>
        </div>
      </div>

      <ImportWizard 
        isOpen={isImportModalOpen} 
        onClose={() => setIsImportModalOpen(false)} 
        type="room"
        onImport={handleImport}
      />

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title="Add New Room"
        actions={
          <>
            <button onClick={() => setIsModalOpen(false)} className="secondary-btn">Cancel</button>
            <button onClick={handleAdd} className="primary-btn">Create Room</button>
          </>
        }
      >
        <FormField label="Room Name / Number">
          <input 
            type="text" 
            placeholder="e.g. Room 101 or Physics Lab" 
            value={newItem.name}
            onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
            autoFocus
          />
        </FormField>
        <FormField label="Capacity (Students)">
          <input 
            type="number" 
            value={newItem.capacity}
            onChange={(e) => setNewItem({ ...newItem, capacity: parseInt(e.target.value) || 0 })}
            min="1"
          />
        </FormField>
      </Modal>

      <table className="editor-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Capacity</th>
            <th>Types</th>
            <th style={{ width: '100px' }}>Actions</th>
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
                />
              </td>
              <td>{item.types.join(', ')}</td>
              <td>
                <button onClick={() => handleRemove(item.id)} className="delete-btn">Delete</button>
              </td>
            </tr>
          ))}
          {rooms.length === 0 && (
            <tr>
              <td colSpan={4} className="empty-row">No rooms added yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
