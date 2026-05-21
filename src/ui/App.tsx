import { useState, useEffect, useRef } from 'react';
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
      // Clear IndexedDB
      indexedDB.deleteDatabase('SchoolarScheduleDB');
      window.location.reload(); 
    }
  };

  if (isLoading) {
    return <div className="loading">Loading project...</div>;
  }

  return (
    <div className="app-container">
      <header>
        <ProjectManager />
        <div className="status-bar">
          <span>Worker: {workerStatus}</span>
        </div>
      </header>
      
      <main>
        {!project ? (
          <ProjectManager />
        ) : (
          <div className="workspace">
            <nav className="side-nav">
              <div className="nav-group">
                <button className={currentView === 'dashboard' ? 'active' : ''} onClick={() => setCurrentView('dashboard')}>Dashboard</button>
                <button className={currentView === 'teachers' ? 'active' : ''} onClick={() => setCurrentView('teachers')}>Teachers</button>
                <button className={currentView === 'subjects' ? 'active' : ''} onClick={() => setCurrentView('subjects')}>Subjects</button>
                <button className={currentView === 'rooms' ? 'active' : ''} onClick={() => setCurrentView('rooms')}>Rooms</button>
                <button className={currentView === 'groups' ? 'active' : ''} onClick={() => setCurrentView('groups')}>Groups</button>
                <button className={currentView === 'curriculum' ? 'active' : ''} onClick={() => setCurrentView('curriculum')}>Curriculum</button>
                <button className={currentView === 'load' ? 'active' : ''} onClick={() => setCurrentView('load')}>Load Distribution</button>
                <button className={currentView === 'schedule' ? 'active' : ''} onClick={() => setCurrentView('schedule')}>Schedule</button>
              </div>

              <div className="nav-footer">
                <button onClick={() => exportProject(project)}>Export .schoolproj</button>
                <button onClick={handleReset} className="reset-btn">New / Reset</button>
              </div>
            </nav>

            <div className="view-container">
              {currentView === 'dashboard' && (
                <section className="dashboard">
                  <h2>Dashboard</h2>
                  <p>Welcome to {project.school.name} scheduling workspace.</p>
                  <div className="stats">
                    <div>Teachers: {project.teachers.length}</div>
                    <div>Groups: {project.groups.length}</div>
                    <div>Subjects: {project.subjects.length}</div>
                    <div>Hours Assigned: {project.generatedSchedule?.schedule.length || 0}</div>
                  </div>
                </section>
              )}
              {currentView === 'teachers' && (
                <section className="editor-view">
                  <h2>Teachers</h2>
                  <TeacherEditor />
                </section>
              )}
              {currentView === 'subjects' && (
                <section className="editor-view">
                  <h2>Subjects</h2>
                  <SubjectEditor />
                </section>
              )}
              {currentView === 'rooms' && (
                <section className="editor-view">
                  <h2>Rooms</h2>
                  <RoomEditor />
                </section>
              )}
              {currentView === 'groups' && (
                <section className="editor-view">
                  <h2>Groups</h2>
                  <GroupEditor />
                </section>
              )}
              {currentView === 'curriculum' && (
                <section className="editor-view">
                  <h2>Curriculum</h2>
                  <CurriculumEditor />
                </section>
              )}
              {currentView === 'load' && (
                <section className="editor-view">
                  <h2>Load Distribution</h2>
                  <LoadDistributionUI />
                </section>
              )}
              {currentView === 'schedule' && (
                <section className="schedule-view">
                  <div className="view-header">
                    <h2>Schedule</h2>
                    <button onClick={handleGenerateSchedule} className="generate-btn-small">
                      Regenerate
                    </button>
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
