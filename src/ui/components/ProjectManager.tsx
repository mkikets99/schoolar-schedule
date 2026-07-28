import { useState, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../context/ProjectContext';
import { importProject } from '../services/ProjectExportService';

export const ProjectManager = () => {
  const { t } = useTranslation();
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
        alert(t('import_failed', { error: (err as Error).message }));
      }
    }
  };

  if (project) {
    return (
      <span className="project-badge">{project.school.name}</span>
    );
  }

  return (
    <div className="project-manager-init">
      <p>{t('welcome_to')}! {t('create_new_project')}...</p>
      
      <form onSubmit={handleCreate} className="create-project-form">
        <div className="form-input-container">
          <input 
            type="text" 
            placeholder={t('school_name')}
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            required
          />
        </div>
        <button type="submit" className="primary-btn" style={{ width: '100%', marginTop: '1rem' }}>{t('create_new_project')}</button>
      </form>

      <div className="import-project">
        <div className="divider">{t('or')}</div>
        <button onClick={handleImportClick} className="import-btn">
          {t('import_schoolproj')}
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
