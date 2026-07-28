import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useProject } from '../context/ProjectContext';
import { importProject } from '../services/ProjectExportService';
import { storageService } from '../services/StorageService';

interface SnapshotEntry {
  id: number;
  timestamp: string;
  label: string;
}

export const ProjectManager = () => {
  const { t } = useTranslation();
  const { project, createNewProject, setProject } = useProject();
  const [schoolName, setSchoolName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [snapshots, setSnapshots] = useState<SnapshotEntry[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);

  useEffect(() => {
    if (project) {
      storageService.listSnapshots().then(setSnapshots).catch(() => {});
    }
  }, [project]);

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

  const handleSaveSnapshot = async () => {
    if (!project) return;
    try {
      await storageService.saveSnapshot(project);
      const list = await storageService.listSnapshots();
      setSnapshots(list);
    } catch (err) {
      console.error('Failed to save snapshot:', err);
    }
  };

  const handleRestoreSnapshot = async (id: number) => {
    if (!confirm(t('confirm_restore_snapshot'))) return;
    try {
      const snapshotProject = await storageService.loadSnapshot(id);
      if (snapshotProject) {
        setProject(snapshotProject);
      }
    } catch (err) {
      console.error('Failed to restore snapshot:', err);
    }
  };

  const handleDeleteSnapshot = async (id: number) => {
    try {
      await storageService.deleteSnapshot(id);
      setSnapshots(snapshots.filter(s => s.id !== id));
    } catch (err) {
      console.error('Failed to delete snapshot:', err);
    }
  };

  if (project) {
    return (
      <div className="project-info" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <span className="project-badge">{project.school.name}</span>
        <button onClick={handleSaveSnapshot} className="secondary-btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>{t('save_snapshot')}</button>
        <button onClick={() => setShowSnapshots(!showSnapshots)} className="secondary-btn" style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}>
          {t('snapshots')} ({snapshots.length})
        </button>
        {showSnapshots && snapshots.length > 0 && (
          <div className="snapshot-dropdown">
            {snapshots.map(s => (
              <div key={s.id} className="snapshot-item">
                <span>{new Date(s.timestamp).toLocaleString()}</span>
                <button onClick={() => handleRestoreSnapshot(s.id)} className="primary-btn" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>{t('restore')}</button>
                <button onClick={() => handleDeleteSnapshot(s.id)} className="delete-btn" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}>{t('delete')}</button>
              </div>
            ))}
          </div>
        )}
        {showSnapshots && snapshots.length === 0 && (
          <div className="snapshot-dropdown">
            <span style={{ color: '#666', fontStyle: 'italic' }}>{t('no_snapshots')}</span>
          </div>
        )}
      </div>
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
