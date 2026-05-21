import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ProjectProvider, useProject } from './context/ProjectContext';
import { ProjectManager } from './components/ProjectManager';
import { TeacherEditor } from './components/TeacherEditor';
import { SubjectEditor } from './components/SubjectEditor';
import { RoomEditor } from './components/RoomEditor';
import { GroupEditor } from './components/GroupEditor';
import { CurriculumEditor } from './components/CurriculumEditor';
import { LoadDistributionUI } from './components/LoadDistributionUI';
import { ScheduleViewer } from './components/ScheduleViewer';
import { exportProject } from './services/ProjectExportService';
import './index.css';

function AppContent() {
  const { t, i18n } = useTranslation();
  const { project, isLoading, updateGeneratedSchedule } = useProject();
  const [workerStatus, setWorkerStatus] = useState<string>('Initializing...');
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('../worker/worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'READY') {
        setWorkerStatus('Worker Ready');
      } else if (type === 'PROGRESS') {
        setWorkerStatus(`Generating: ${payload.progress}%`);
      } else if (type === 'RESULT') {
        setWorkerStatus('Schedule Generated');
        updateGeneratedSchedule(payload);
      }
    };

    worker.postMessage({ type: 'INIT' });
    workerRef.current = worker;

    return () => {
      worker.terminate();
    };
  }, []);

  const [currentView, setCurrentView] = useState<'dashboard' | 'teachers' | 'subjects' | 'rooms' | 'groups' | 'curriculum' | 'load' | 'schedule'>('dashboard');

  const handleGenerateSchedule = () => {
    if (workerRef.current && project) {
      setWorkerStatus('Starting generation...');
      workerRef.current.postMessage({
        type: 'GENERATE_SCHEDULE',
        payload: project
      });
    }
  };

  const handleReset = () => {
    if (confirm('Are you sure you want to delete the current project? All unsaved data will be lost.')) {
      indexedDB.deleteDatabase('SchoolarScheduleDB');
      window.location.reload(); 
    }
  };

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loader"></div>
        <p>Initializing Workspace...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header>
        <div className="header-brand">
          <h1>{t('app_title')}</h1>
          {project && <span className="project-badge">{project.school.name}</span>}
        </div>
        
        <div className="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <select 
            value={i18n.language} 
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            style={{ 
              background: '#333', 
              color: '#fff', 
              border: '1px solid #444', 
              borderRadius: '4px', 
              padding: '0.4rem' 
            }}
          >
            <option value="en">English</option>
            <option value="uk">Українська</option>
          </select>
          <div className="status-bar">
            <span>{workerStatus}</span>
          </div>
        </div>
      </header>
      
      <main>
        {!project ? (
          <div className="onboarding">
            <ProjectManager />
          </div>
        ) : (
          <div className="workspace">
            <nav className="side-nav">
              <div className="nav-group">
                <button className={currentView === 'dashboard' ? 'active' : ''} onClick={() => setCurrentView('dashboard')}>{t('dashboard')}</button>
                <button className={currentView === 'teachers' ? 'active' : ''} onClick={() => setCurrentView('teachers')}>{t('teachers')}</button>
                <button className={currentView === 'subjects' ? 'active' : ''} onClick={() => setCurrentView('subjects')}>{t('subjects')}</button>
                <button className={currentView === 'rooms' ? 'active' : ''} onClick={() => setCurrentView('rooms')}>{t('rooms')}</button>
                <button className={currentView === 'groups' ? 'active' : ''} onClick={() => setCurrentView('groups')}>{t('groups')}</button>
                <button className={currentView === 'curriculum' ? 'active' : ''} onClick={() => setCurrentView('curriculum')}>{t('curriculum')}</button>
                <button className={currentView === 'load' ? 'active' : ''} onClick={() => setCurrentView('load')}>{t('load_distribution')}</button>
                <button className={currentView === 'schedule' ? 'active' : ''} onClick={() => setCurrentView('schedule')}>{t('schedule')}</button>
              </div>

              <div className="nav-footer">
                <button onClick={() => exportProject(project)}>Export .schoolproj</button>
                <button onClick={handleReset} className="reset-btn">{t('cancel')} / Reset</button>
              </div>
            </nav>

            <div className="view-container">
              {currentView === 'dashboard' && (
                <section className="dashboard">
                  <div className="dashboard-hero">
                    <h2>Welcome to {project.school.name}</h2>
                    <p>Your scheduling environment is ready.</p>
                  </div>
                  
                  <div className="dashboard-grid">
                    <div className="stat-card">
                      <h3>Structure</h3>
                      <div className="stats-list">
                        <div className="stat-item">Teachers: <strong>{project.teachers?.length || 0}</strong></div>
                        <div className="stat-item">Subjects: <strong>{project.subjects?.length || 0}</strong></div>
                        <div className="stat-item">Groups: <strong>{project.groups?.length || 0}</strong></div>
                        <div className="stat-item">Rooms: <strong>{project.rooms?.length || 0}</strong></div>
                      </div>
                      <button onClick={() => setCurrentView('teachers')} className="card-action">Manage Structure</button>
                    </div>

                    <div className="stat-card primary">
                      <h3>Scheduling</h3>
                      <div className="stats-list">
                        <div className="stat-item">Curriculum Rules: <strong>{project.curriculum?.length || 0}</strong></div>
                        <div className="stat-item">Hours Assigned: <strong>{project.generatedSchedule?.schedule?.length || 0}</strong></div>
                      </div>
                      <button onClick={() => setCurrentView('schedule')} className="card-action">Go to Scheduling</button>
                    </div>
                  </div>
                </section>
              )}
              {currentView === 'teachers' && <section className="editor-view"><h2>{t('teachers')}</h2><TeacherEditor /></section>}
              {currentView === 'subjects' && <section className="editor-view"><h2>{t('subjects')}</h2><SubjectEditor /></section>}
              {currentView === 'rooms' && <section className="editor-view"><h2>{t('rooms')}</h2><RoomEditor /></section>}
              {currentView === 'groups' && <section className="editor-view"><h2>{t('groups')}</h2><GroupEditor /></section>}
              {currentView === 'curriculum' && <section className="editor-view"><h2>{t('curriculum')}</h2><CurriculumEditor /></section>}
              {currentView === 'load' && <section className="editor-view"><h2>{t('load_distribution')}</h2><LoadDistributionUI /></section>}
              {currentView === 'schedule' && (
                <section className="schedule-view">
                  <div className="view-header">
                    <h2>{t('schedule')}</h2>
                    <button onClick={handleGenerateSchedule} className="generate-btn-small">Regenerate</button>
                  </div>
                  <ScheduleViewer />
                </section>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

function App() {
  return (
    <ProjectProvider>
      <AppContent />
    </ProjectProvider>
  );
}

export default App;
