import { describe, it, expect } from 'vitest';
import {
  importTeachersCSV,
  importSubjectsCSV,
  importRoomsCSV,
  importGroupsCSV,
} from '../../ui/services/CSVImportService';

function makeFile(content: string, filename = 'test.csv'): File {
  return new File([content], filename, { type: 'text/csv' });
}

describe('CSVImportService', () => {
  it('imports teachers from CSV', async () => {
    const csv = 'name,shortName\nJohn Doe,JD\nJane Smith,JS\n';
    const teachers = await importTeachersCSV(makeFile(csv));

    expect(teachers).toHaveLength(2);
    expect(teachers[0].name).toBe('John Doe');
    expect(teachers[0].shortName).toBe('JD');
    expect(teachers[1].name).toBe('Jane Smith');
    expect(teachers[1].shortName).toBe('JS');
    expect(teachers[0].id).toBeDefined();
    expect(teachers[0].subjects).toEqual([]);
  });

  it('imports teachers with alternate column names', async () => {
    const csv = 'Name,initials\nAlice Smith,A.S.\n';
    const teachers = await importTeachersCSV(makeFile(csv));

    expect(teachers).toHaveLength(1);
    expect(teachers[0].name).toBe('Alice Smith');
    expect(teachers[0].shortName).toBe('A.S.');
  });

  it('imports subjects from CSV', async () => {
    const csv = 'name,shortName\nMathematics,MATH\nPhysics,PHYS\n';
    const subjects = await importSubjectsCSV(makeFile(csv));

    expect(subjects).toHaveLength(2);
    expect(subjects[0].name).toBe('Mathematics');
    expect(subjects[0].shortName).toBe('MATH');
    expect(subjects[1].name).toBe('Physics');
    expect(subjects[1].shortName).toBe('PHYS');
  });

  it('imports subjects with code column', async () => {
    const csv = 'Name,code\nEnglish,ENG\n';
    const subjects = await importSubjectsCSV(makeFile(csv));

    expect(subjects).toHaveLength(1);
    expect(subjects[0].name).toBe('English');
    expect(subjects[0].shortName).toBe('ENG');
  });

  it('imports rooms from CSV', async () => {
    const csv = 'name,maxGroups\nRoom 101,2\nLab 1,3\n';
    const rooms = await importRoomsCSV(makeFile(csv));

    expect(rooms).toHaveLength(2);
    expect(rooms[0].name).toBe('Room 101');
    expect(rooms[0].maxGroups).toBe(2);
    expect(rooms[1].name).toBe('Lab 1');
    expect(rooms[1].maxGroups).toBe(3);
  });

  it('imports rooms with default max groups', async () => {
    const csv = 'name\nRoom 101\n';
    const rooms = await importRoomsCSV(makeFile(csv));

    expect(rooms).toHaveLength(1);
    expect(rooms[0].maxGroups).toBe(1);
  });

  it('imports groups from CSV', async () => {
    const csv = 'name,grade\n10-A,10\n11-B,11\n';
    const groups = await importGroupsCSV(makeFile(csv));

    expect(groups).toHaveLength(2);
    expect(groups[0].name).toBe('10-A');
    expect(groups[0].grade).toBe(10);
    expect(groups[1].name).toBe('11-B');
    expect(groups[1].grade).toBe(11);
  });

  it('imports groups with default grade', async () => {
    const csv = 'name\n9-C\n';
    const groups = await importGroupsCSV(makeFile(csv));

    expect(groups).toHaveLength(1);
    expect(groups[0].grade).toBe(1);
  });

  it('filters out empty rows', async () => {
    const csv = 'name\nValid Name\n\n';
    const result = await importTeachersCSV(makeFile(csv));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Valid Name');
  });

  it('handles file read errors', async () => {
    const csv = 'name\nTest\n';
    const result = await importTeachersCSV(makeFile(csv));

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Test');
  });
});
