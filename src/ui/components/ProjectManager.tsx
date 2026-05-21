import { useState, useRef } from 'react';
import { useProject } from '../context/ProjectContext';
import { importProject } from '../services/ProjectExportService';

export const ProjectManager = () => {
  const { project, createNewProject, setProject } = useProject();
  const [schoolName, setSchoolName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (schoolName.trim()) {
      createNewProject(schoolName.trim());
    }
  };

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        const importedProject = await importProject(file);
        setProject(importedProject);
      } catch (err) {
        alert('Failed to import project: ' + (err as Error).message);
      }
    }
  };

  if (project) {
    return (
      <div className="project-info">
        <h3>{project.school.name}</h3>
      </div>
    );
  }

  return (
    <div className="project-manager-init">
      <p>Welcome! Start by creating a new project or importing an existing one.</p>
      
      <form onSubmit={handleCreate} className="create-project-form">
        <div className="form-input-container">
          <input 
            type="text" 
            placeholder="Enter School Name" 
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="primary-btn" style={{ width: '100%', marginTop: '1rem' }}>Create New Project</button>
      </form>

      <div className="import-project">
        <div className="divider">OR</div>
        <button onClick={handleImportClick} className="import-btn">
          Import .schoolproj File
        </button>
        <input 
          type="file" 
          ref={fileInputRef} 
          style={{ display: 'none' }} 
          accept=".schoolproj"
          onChange={handleFileChange}
        />
      </div>
    </div>
  );
};
