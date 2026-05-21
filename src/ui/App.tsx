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
  const [workerStatus, setWorkerStatus] = useState<string>(t('initializing'));
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('../worker/worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === 'READY') {
        setWorkerStatus(t('worker_ready'));
      } else if (type === 'PROGRESS') {
        setWorkerStatus(`${t('generating')} ${payload.progress}%`);
      } else if (type === 'RESULT') {
        setWorkerStatus(t('schedule_generated'));
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
      setWorkerStatus(t('starting_gen'));
      workerRef.current.postMessage({
        type: 'GENERATE_SCHEDULE',
        payload: project
      });
    }
  };

  const handleReset = () => {
    if (confirm(t('confirm_reset'))) {
      indexedDB.deleteDatabase('SchoolarScheduleDB');
      window.location.reload(); 
    }
  };

  if (isLoading) {
    return (
      <div className="loading-screen">
        <div className="loader"></div>
        <p>{t('loading')}</p>
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
                <button onClick={handleReset} className="reset-btn">{t('cancel')} / {t('reset')}</button>
              </div>
            </nav>

            <div className="view-container">
              {currentView === 'dashboard' && (
                <section className="dashboard">
                  <div className="dashboard-hero">
                    <h2>{t('welcome_to')} {project.school.name}</h2>
                    <p>{t('manage_structure_desc')}</p>
                  </div>
                  
                  <div className="dashboard-grid">
                    <div className="stat-card">
                      <h3>{t('structure')}</h3>
                      <div className="stats-list">
                        <div className="stat-item">{t('teachers_count', { count: project.teachers?.length || 0 })}</div>
                        <div className="stat-item">{t('subjects_count', { count: project.subjects?.length || 0 })}</div>
                        <div className="stat-item">{t('groups_count', { count: project.groups?.length || 0 })}</div>
                        <div className="stat-item">{t('rooms_count', { count: project.rooms?.length || 0 })}</div>
                      </div>
                      <button onClick={() => setCurrentView('teachers')} className="card-action">{t('manage_structure')}</button>
                    </div>

                    <div className="stat-card primary">
                      <h3>{t('scheduling')}</h3>
                      <div className="stats-list">
                        <div className="stat-item">{t('curriculum_rules_count', { count: project.curriculum?.length || 0 })}</div>
                        <div className="stat-item">{t('hours_assigned_count', { count: project.generatedSchedule?.schedule?.length || 0 })}</div>
                      </div>
                      <button onClick={() => setCurrentView('schedule')} className="card-action">{t('go_to_scheduling')}</button>
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
                    <button onClick={handleGenerateSchedule} className="generate-btn-small">{t('regenerate')}</button>
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
