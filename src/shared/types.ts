/**
 * Core Data Models for Schoolar Schedule
 */

export interface School {
  id: string;
  name: string;
  address?: string;
}

export interface AcademicYear {
  id: string;
  name: string; // e.g., "2023/2024"
  startDate: string;
  endDate: string;
}

export interface Teacher {
  id: string;
  name: string;
  shortName?: string;
  subjects: string[]; // Subject IDs
  color?: string;
}

export interface Subject {
  id: string;
  name: string;
  shortName?: string;
  color?: string;
}

export interface Room {
  id: string;
  name: string;
  capacity?: number;
  types: string[]; // e.g., "lab", "classroom", "gym"
}

export interface Group {
  id: string;
  name: string;
  grade: number;
  subgroups: string[];
  parentGroupId?: string;
  periodStart?: number;
  periodEnd?: number;
  maxDailyLessons?: number;
}

export interface CurriculumRule {
  id: string;
  groupId: string;
  subjectId: string;
  hoursPerWeek: number;
  teacherId?: string; // Default teacher
  roomId?: string; // Default room
}

export interface LoadDistribution {
  teacherId: string;
  subjectId: string;
  groupId: string;
  hours: number;
}

export interface Constraint {
  id: string;
  type: 'HARD' | 'SOFT';
  category: 'TEACHER_AVAILABILITY' | 'ROOM_AVAILABILITY' | 'GROUP_OVERLAP' | 'CURRICULUM_MATCH';
  targetId: string; // ID of the entity this constraint applies to
  payload: any; // Specific constraint data (e.g., time slots)
}

export interface Lesson {
  id: string;
  ruleId: string;
  groupId: string;
  subjectId: string;
  teacherId?: string;
  roomId?: string;
  day: string;
  period: number;
}

export interface ScheduleResult {
  schedule: Lesson[];
  conflicts: any[];
  score: number;
}

export interface ProjectState {
  version: string;
  school: School;
  academicYears: AcademicYear[];
  teachers: Teacher[];
  subjects: Subject[];
  rooms: Room[];
  groups: Group[];
  curriculum: CurriculumRule[];
  loadDistribution: LoadDistribution[];
  constraints: Constraint[];
  generatedSchedule?: ScheduleResult;
}

export type WorkerMessageType = 
  | 'INIT' 
  | 'READY' 
  | 'GENERATE_SCHEDULE' 
  | 'PROGRESS' 
  | 'RESULT' 
  | 'ERROR' 
  | 'UPDATE_CONSTRAINTS' 
  | 'CANCEL';

export interface WorkerMessage {
  type: WorkerMessageType;
  payload?: any;
}
