import { useState } from 'react';
import { Teacher } from '../../shared/types';
import { useProject } from '../context/ProjectContext';

export const TeacherEditor = () => {
  const { project, updateTeachers } = useProject();
  const teachers = project?.teachers || [];

  const [newTeacherName, setNewTeacherName] = useState('');

  const handleAddTeacher = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTeacherName.trim()) return;

    const newTeacher: Teacher = {
      id: crypto.randomUUID(),
      name: newTeacherName.trim(),
      subjects: [],
    };

    updateTeachers([...teachers, newTeacher]);
    setNewTeacherName('');
  };

  const handleRemoveTeacher = (id: string) => {
    updateTeachers(teachers.filter(t => t.id !== id));
  };

  const handleUpdateTeacher = (id: string, updates: Partial<Teacher>) => {
    updateTeachers(teachers.map(t => t.id === id ? { ...t, ...updates } : t));
  };

  return (
    <div className="teacher-editor">
      <form onSubmit={handleAddTeacher} className="add-form">
        <input 
          type="text" 
          placeholder="New Teacher Name" 
          value={newTeacherName}
          onChange={(e) => setNewTeacherName(e.target.value)}
        />
        <button type="submit">Add Teacher</button>
      </form>

      <table className="editor-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Short Name</th>
            <th>Subjects</th>
            <th>Actions</th>
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
                  placeholder="Initials"
                />
              </td>
              <td>
                {teacher.subjects.length} subjects
              </td>
              <td>
                <button onClick={() => handleRemoveTeacher(teacher.id)} className="delete-btn">Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
