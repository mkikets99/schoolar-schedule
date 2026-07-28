import { createContext, useContext, useState, ReactNode, useEffect } from 'react';
import { ProjectState, School, Teacher, Subject, Room, Group, CurriculumRule, LoadDistribution, ScheduleResult, AcademicYear, Constraint } from '../../shared/types';
import { storageService } from '../services/StorageService';

interface ProjectContextType {
  project: ProjectState | null;
  isLoading: boolean;
  setProject: (project: ProjectState) => void;
  updateSchool: (school: School) => void;
  updateAcademicYears: (years: AcademicYear[]) => void;
  updateTeachers: (teachers: Teacher[]) => void;
  updateSubjects: (subjects: Subject[]) => void;
  updateRooms: (rooms: Room[]) => void;
  updateGroups: (groups: Group[]) => void;
  updateCurriculum: (curriculum: CurriculumRule[]) => void;
  updateLoadDistribution: (load: LoadDistribution[]) => void;
  updateConstraints: (constraints: Constraint[]) => void;
  updateGeneratedSchedule: (result: ScheduleResult) => void;
  createNewProject: (name: string) => void;
}

const ProjectContext = createContext<ProjectContextType | undefined>(undefined);

export const ProjectProvider = ({ children }: { children: ReactNode }) => {
  const [project, setProject] = useState<ProjectState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load project on mount
  useEffect(() => {
    const load = async () => {
      try {
        const savedProject = await storageService.loadProject();
        if (savedProject) {
          setProject(savedProject);
        }
      } catch (error) {
        console.error('Failed to load project:', error);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  // Autosave project whenever it changes
  useEffect(() => {
    if (project) {
      storageService.saveProject(project).catch((err) => {
        console.error('Autosave failed:', err);
      });
    }
  }, [project]);

  const createNewProject = (name: string) => {
    const newProject: ProjectState = {
      version: '1.0.0',
      school: {
        id: crypto.randomUUID(),
        name: name,
      },
      academicYears: [],
      teachers: [],
      subjects: [],
      rooms: [],
      groups: [],
      curriculum: [],
      loadDistribution: [],
      constraints: [],
    };
    setProject(newProject);
  };

  const updateSchool = (school: School) => {
    setProject(prev => prev ? { ...prev, school } : prev);
  };

  const updateAcademicYears = (academicYears: AcademicYear[]) => {
    setProject(prev => prev ? { ...prev, academicYears } : prev);
  };

  const updateTeachers = (teachers: Teacher[]) => {
    setProject(prev => prev ? { ...prev, teachers } : prev);
  };

  const updateSubjects = (subjects: Subject[]) => {
    setProject(prev => prev ? { ...prev, subjects } : prev);
  };

  const updateRooms = (rooms: Room[]) => {
    setProject(prev => prev ? { ...prev, rooms } : prev);
  };

  const updateGroups = (groups: Group[]) => {
    setProject(prev => prev ? { ...prev, groups } : prev);
  };

  const updateCurriculum = (curriculum: CurriculumRule[]) => {
    setProject(prev => prev ? { ...prev, curriculum } : prev);
  };

  const updateLoadDistribution = (load: LoadDistribution[]) => {
    setProject(prev => prev ? { ...prev, loadDistribution: load } : prev);
  };

  const updateConstraints = (constraints: Constraint[]) => {
    setProject(prev => prev ? { ...prev, constraints } : prev);
  };

  const updateGeneratedSchedule = (generatedSchedule: ScheduleResult) => {
    setProject(prev => prev ? { ...prev, generatedSchedule } : prev);
  };

  return (
    <ProjectContext.Provider value={{ 
      project, 
      isLoading, 
      setProject, 
      updateSchool, 
      updateAcademicYears,
      updateTeachers, 
      updateSubjects, 
      updateRooms, 
      updateGroups,
      updateCurriculum,
      updateLoadDistribution,
      updateConstraints,
      updateGeneratedSchedule,
      createNewProject 
    }}>
      {children}
    </ProjectContext.Provider>
  );
};

export const useProject = () => {
  const context = useContext(ProjectContext);
  if (context === undefined) {
    throw new Error('useProject must be used within a ProjectProvider');
  }
  return context;
};
