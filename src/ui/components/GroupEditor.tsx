import { useState } from 'react';
import { Group } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';
import { ImportWizard } from './ImportWizard';

export const GroupEditor = () => {
  const { project, updateGroups } = useProject();
  const groups = project?.groups || [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', grade: 1 });

  const handleAdd = () => {
    if (!newItem.name.trim()) return;

    const group: Group = {
      id: crypto.randomUUID(),
      name: newItem.name.trim(),
      grade: newItem.grade,
      subgroups: [],
    };

    updateGroups([...groups, group]);
    setNewItem({ name: '', grade: 1 });
    setIsModalOpen(false);
  };

  const handleRemove = (id: string) => {
    if (confirm('Are you sure you want to delete this group?')) {
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
  };

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>Groups</h2>
        <div className="header-actions" style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={() => setIsImportModalOpen(true)} className="secondary-btn">Import Data</button>
          <button onClick={() => setIsModalOpen(true)} className="primary-btn">Add Group</button>
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
        title="Add New Group"
        actions={
          <>
            <button onClick={() => setIsModalOpen(false)} className="secondary-btn">Cancel</button>
            <button onClick={handleAdd} className="primary-btn">Create Group</button>
          </>
        }
      >
        <FormField label="Group Name">
          <input 
            type="text" 
            placeholder="e.g. 10-A or Class 4" 
            value={newItem.name}
            onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
            autoFocus
          />
        </FormField>
        <FormField label="Grade / Level">
          <input 
            type="number" 
            value={newItem.grade}
            onChange={(e) => setNewItem({ ...newItem, grade: parseInt(e.target.value) || 1 })}
            min="1"
            max="12"
          />
        </FormField>
      </Modal>

      <table className="editor-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Grade</th>
            <th>Subgroups</th>
            <th style={{ width: '100px' }}>Actions</th>
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
              <td>{item.subgroups.length} subgroups</td>
              <td>
                <button onClick={() => handleRemove(item.id)} className="delete-btn">Delete</button>
              </td>
            </tr>
          ))}
          {groups.length === 0 && (
            <tr>
              <td colSpan={4} className="empty-row">No groups added yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
