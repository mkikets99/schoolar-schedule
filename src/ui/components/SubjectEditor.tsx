import { useState } from 'react';
import { Subject } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';
import { ImportWizard } from './ImportWizard';

export const SubjectEditor = () => {
  const { project, updateSubjects } = useProject();
  const subjects = project?.subjects || [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [newItem, setNewItem] = useState({ name: '', shortName: '', color: '#646cff' });

  const handleAdd = () => {
    if (!newItem.name.trim()) return;

    const subject: Subject = {
      id: crypto.randomUUID(),
      name: newItem.name.trim(),
      shortName: newItem.shortName.trim() || undefined,
      color: newItem.color
    };

    updateSubjects([...subjects, subject]);
    setNewItem({ name: '', shortName: '', color: '#646cff' });
    setIsModalOpen(false);
  };

  const handleRemove = (id: string) => {
    if (confirm('Are you sure you want to delete this subject?')) {
      updateSubjects(subjects.filter(t => t.id !== id));
    }
  };

  const handleUpdate = (id: string, updates: Partial<Subject>) => {
    updateSubjects(subjects.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleImport = (data: any[]) => {
    const imported: Subject[] = data.map((row: any) => ({
      id: crypto.randomUUID(),
      name: row.Name || row.name || '',
      shortName: row.ShortName || row.shortName || row.Code || row.code || '',
      color: '#646cff'
    })).filter(s => s.name);
    
    updateSubjects([...subjects, ...imported]);
  };

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>Subjects</h2>
        <div className="header-actions" style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={() => setIsImportModalOpen(true)} className="secondary-btn">Import Data</button>
          <button onClick={() => setIsModalOpen(true)} className="primary-btn">Add Subject</button>
        </div>
      </div>

      <ImportWizard 
        isOpen={isImportModalOpen} 
        onClose={() => setIsImportModalOpen(false)} 
        type="subject"
        onImport={handleImport}
      />

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title="Add New Subject"
        actions={
          <>
            <button onClick={() => setIsModalOpen(false)} className="secondary-btn">Cancel</button>
            <button onClick={handleAdd} className="primary-btn">Create Subject</button>
          </>
        }
      >
        <FormField label="Subject Name">
          <input 
            type="text" 
            placeholder="e.g. Mathematics" 
            value={newItem.name}
            onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
            autoFocus
          />
        </FormField>
        <FormField label="Short Code">
          <input 
            type="text" 
            placeholder="e.g. MATH" 
            value={newItem.shortName}
            onChange={(e) => setNewItem({ ...newItem, shortName: e.target.value })}
          />
        </FormField>
        <FormField label="Color Label">
          <input 
            type="color" 
            value={newItem.color}
            onChange={(e) => setNewItem({ ...newItem, color: e.target.value })}
          />
        </FormField>
      </Modal>

      <table className="editor-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Short Code</th>
            <th style={{ width: '80px' }}>Color</th>
            <th style={{ width: '100px' }}>Actions</th>
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
                />
              </td>
              <td>
                <input 
                  type="color" 
                  value={item.color || '#646cff'} 
                  onChange={(e) => handleUpdate(item.id, { color: e.target.value })}
                  style={{ width: '40px', padding: 0, border: 'none', height: '24px' }}
                />
              </td>
              <td>
                <button onClick={() => handleRemove(item.id)} className="delete-btn">Delete</button>
              </td>
            </tr>
          ))}
          {subjects.length === 0 && (
            <tr>
              <td colSpan={4} className="empty-row">No subjects added yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
