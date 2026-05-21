import { useState } from 'react';
import { Teacher } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';
import { ImportWizard } from './ImportWizard';

export const TeacherEditor = () => {
  const { project, updateTeachers } = useProject();
  const teachers = project?.teachers || [];

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [newTeacher, setNewTeacher] = useState({ name: '', shortName: '' });

  const handleAddTeacher = () => {
    if (!newTeacher.name.trim()) return;

    const teacher: Teacher = {
      id: crypto.randomUUID(),
      name: newTeacher.name.trim(),
      shortName: newTeacher.shortName.trim() || undefined,
      subjects: [],
    };

    updateTeachers([...teachers, teacher]);
    setNewTeacher({ name: '', shortName: '' });
    setIsModalOpen(false);
  };

  const handleRemoveTeacher = (id: string) => {
    if (confirm('Are you sure you want to delete this teacher?')) {
      updateTeachers(teachers.filter(t => t.id !== id));
    }
  };

  const handleUpdateTeacher = (id: string, updates: Partial<Teacher>) => {
    updateTeachers(teachers.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  const handleImport = (data: any[]) => {
    const imported: Teacher[] = data.map((row: any) => ({
      id: crypto.randomUUID(),
      name: row.Name || row.name || '',
      shortName: row.ShortName || row.shortName || row.Initials || '',
      subjects: [],
    })).filter(t => t.name);
    
    updateTeachers([...teachers, ...imported]);
  };

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>Teachers</h2>
        <div className="header-actions" style={{ display: 'flex', gap: '1rem' }}>
          <button onClick={() => setIsImportModalOpen(true)} className="secondary-btn">Import Data</button>
          <button onClick={() => setIsModalOpen(true)} className="primary-btn">Add Teacher</button>
        </div>
      </div>

      <ImportWizard 
        isOpen={isImportModalOpen} 
        onClose={() => setIsImportModalOpen(false)} 
        type="teacher"
        onImport={handleImport}
      />

      <Modal 
        isOpen={isModalOpen} 
        onClose={() => setIsModalOpen(false)} 
        title="Add New Teacher"
        actions={
          <>
            <button onClick={() => setIsModalOpen(false)} className="secondary-btn">Cancel</button>
            <button onClick={handleAddTeacher} className="primary-btn">Create Teacher</button>
          </>
        }
      >
        <FormField label="Full Name">
          <input 
            type="text" 
            placeholder="e.g. John Doe" 
            value={newTeacher.name}
            onChange={(e) => setNewTeacher({ ...newTeacher, name: e.target.value })}
            autoFocus
          />
        </FormField>
        <FormField label="Short Name / Initials">
          <input 
            type="text" 
            placeholder="e.g. J.D." 
            value={newTeacher.shortName}
            onChange={(e) => setNewTeacher({ ...newTeacher, shortName: e.target.value })}
          />
        </FormField>
      </Modal>

      <table className="editor-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Short Name</th>
            <th>Subjects</th>
            <th style={{ width: '100px' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {teachers.map(teacher => (
            <tr key={teacher.id}>
              <td>
                <input 
                  type="text" 
                  value={teacher.name} 
                  onChange={(e) => handleUpdateTeacher(teacher.id, { name: e.target.value })}
                />
              </td>
              <td>
                <input 
                  type="text" 
                  value={teacher.shortName || ''} 
                  onChange={(e) => handleUpdateTeacher(teacher.id, { shortName: e.target.value })}
                />
              </td>
              <td>{teacher.subjects.length} subjects</td>
              <td>
                <button onClick={() => handleRemoveTeacher(teacher.id)} className="delete-btn">Delete</button>
              </td>
            </tr>
          ))}
          {teachers.length === 0 && (
            <tr>
              <td colSpan={4} className="empty-row">No teachers added yet. Click "Add Teacher" to start.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
