import Papa from 'papaparse';
import { Teacher, Subject, Room, Group } from '../../shared/types';

export const importTeachersCSV = (file: File): Promise<Teacher[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const teachers: Teacher[] = results.data.map((row: any) => ({
          id: crypto.randomUUID(),
          name: row.name || row.Name || '',
          shortName: row.shortName || row.ShortName || row.initials || '',
          maxGroups: parseInt(row.maxGroups || row['max groups'] || row['Max Groups']) || 1,
          subjects: [],
        })).filter(t => t.name);
        resolve(teachers);
      },
      error: (error) => reject(error)
    });
  });
};

export const importSubjectsCSV = (file: File): Promise<Subject[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const subjects: Subject[] = results.data.map((row: any) => ({
          id: crypto.randomUUID(),
          name: row.name || row.Name || '',
          shortName: row.shortName || row.ShortName || row.code || '',
        })).filter(s => s.name);
        resolve(subjects);
      },
      error: (error) => reject(error)
    });
  });
};

export const importRoomsCSV = (file: File): Promise<Room[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const rooms: Room[] = results.data.map((row: any) => ({
          id: crypto.randomUUID(),
          name: row.name || row.Name || row.number || '',
          maxGroups: parseInt(row.maxGroups || row['max groups'] || row['Max Groups']) || 1,
          types: [],
        })).filter(r => r.name);
        resolve(rooms);
      },
      error: (error) => reject(error)
    });
  });
};

export const importGroupsCSV = (file: File): Promise<Group[]> => {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const groups: Group[] = results.data.map((row: any) => ({
          id: crypto.randomUUID(),
          name: row.name || row.Name || '',
          grade: parseInt(row.grade || row.Grade) || 1,
          subgroups: [],
        })).filter(g => g.name);
        resolve(groups);
      },
      error: (error) => reject(error)
    });
  });
};
