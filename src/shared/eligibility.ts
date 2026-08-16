import { Teacher } from './types';

export const canTeachSubject = (teacher: Teacher, subjectId: string): boolean =>
  teacher.subjects.length === 0 || teacher.subjects.includes(subjectId);

export const eligibleTeachers = (teachers: Teacher[], subjectId: string): Teacher[] =>
  subjectId ? teachers.filter(t => canTeachSubject(t, subjectId)) : teachers;

export const eligibleTeacherOptions = (teachers: Teacher[], subjectId: string) =>
  eligibleTeachers(teachers, subjectId).map(t => ({ value: t.id, label: t.name }));
