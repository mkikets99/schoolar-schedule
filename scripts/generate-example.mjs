import JSZip from 'jszip';
import { writeFileSync } from 'fs';

const project = {
  version: '1.0.0',
  school: { id: 'sch-001', name: 'Greenwood High School' },
  academicYears: [
    { id: 'ay-2024', name: '2024/2025', startDate: '2024-09-01', endDate: '2025-06-30' }
  ],
  teachers: [
    { id: 't-1', name: 'Alice Johnson', shortName: 'A.J.', subjects: ['s-1', 's-3'] },
    { id: 't-2', name: 'Bob Smith', shortName: 'B.S.', subjects: ['s-2'] },
    { id: 't-3', name: 'Carol White', shortName: 'C.W.', subjects: ['s-3', 's-4'] },
    { id: 't-4', name: 'David Brown', shortName: 'D.B.', subjects: ['s-1', 's-5'] },
  ],
  subjects: [
    { id: 's-1', name: 'Mathematics', shortName: 'MATH', color: '#4CAF50' },
    { id: 's-2', name: 'Physics', shortName: 'PHYS', color: '#2196F3' },
    { id: 's-3', name: 'English', shortName: 'ENG', color: '#FF9800' },
    { id: 's-4', name: 'History', shortName: 'HIST', color: '#9C27B0' },
    { id: 's-5', name: 'Computer Science', shortName: 'CS', color: '#00BCD4' },
  ],
  rooms: [
    { id: 'r-1', name: 'Room 101', capacity: 30, types: ['classroom'] },
    { id: 'r-2', name: 'Room 102', capacity: 30, types: ['classroom'] },
    { id: 'r-3', name: 'Physics Lab', capacity: 24, types: ['lab'] },
    { id: 'r-4', name: 'Computer Lab', capacity: 20, types: ['lab'] },
    { id: 'r-5', name: 'Auditorium', capacity: 100, types: ['hall'] },
  ],
  groups: [
    { id: 'g-1', name: '10-A', grade: 10, subgroups: [] },
    { id: 'g-2', name: '10-B', grade: 10, subgroups: [] },
    { id: 'g-3', name: '11-A', grade: 11, subgroups: [] },
    { id: 'g-4', name: '11-B', grade: 11, subgroups: [] },
  ],
  curriculum: [
    { id: 'cr-1', groupId: 'g-1', subjectId: 's-1', hoursPerWeek: 5, teacherId: 't-1', roomId: 'r-1' },
    { id: 'cr-2', groupId: 'g-1', subjectId: 's-2', hoursPerWeek: 3, teacherId: 't-2', roomId: 'r-3' },
    { id: 'cr-3', groupId: 'g-1', subjectId: 's-3', hoursPerWeek: 4, teacherId: 't-3', roomId: 'r-1' },
    { id: 'cr-4', groupId: 'g-2', subjectId: 's-1', hoursPerWeek: 5, teacherId: 't-1', roomId: 'r-2' },
    { id: 'cr-5', groupId: 'g-2', subjectId: 's-2', hoursPerWeek: 3, teacherId: 't-2', roomId: 'r-3' },
    { id: 'cr-6', groupId: 'g-2', subjectId: 's-4', hoursPerWeek: 2, teacherId: 't-3', roomId: null },
    { id: 'cr-7', groupId: 'g-3', subjectId: 's-3', hoursPerWeek: 4, teacherId: 't-3', roomId: null },
    { id: 'cr-8', groupId: 'g-3', subjectId: 's-5', hoursPerWeek: 3, teacherId: 't-4', roomId: 'r-4' },
    { id: 'cr-9', groupId: 'g-3', subjectId: 's-1', hoursPerWeek: 4, teacherId: 't-4', roomId: null },
    { id: 'cr-10', groupId: 'g-4', subjectId: 's-5', hoursPerWeek: 3, teacherId: 't-4', roomId: 'r-4' },
    { id: 'cr-11', groupId: 'g-4', subjectId: 's-4', hoursPerWeek: 2, teacherId: null, roomId: null },
    { id: 'cr-12', groupId: 'g-4', subjectId: 's-3', hoursPerWeek: 4, teacherId: 't-3', roomId: null },
  ],
  loadDistribution: [
    { teacherId: 't-1', subjectId: 's-1', groupId: 'g-1', hours: 5 },
    { teacherId: 't-1', subjectId: 's-1', groupId: 'g-2', hours: 5 },
    { teacherId: 't-2', subjectId: 's-2', groupId: 'g-1', hours: 3 },
    { teacherId: 't-2', subjectId: 's-2', groupId: 'g-2', hours: 3 },
    { teacherId: 't-3', subjectId: 's-3', groupId: 'g-1', hours: 4 },
    { teacherId: 't-3', subjectId: 's-4', groupId: 'g-2', hours: 2 },
    { teacherId: 't-3', subjectId: 's-3', groupId: 'g-3', hours: 4 },
    { teacherId: 't-3', subjectId: 's-3', groupId: 'g-4', hours: 4 },
    { teacherId: 't-4', subjectId: 's-5', groupId: 'g-3', hours: 3 },
    { teacherId: 't-4', subjectId: 's-1', groupId: 'g-3', hours: 4 },
    { teacherId: 't-4', subjectId: 's-5', groupId: 'g-4', hours: 3 },
  ],
  constraints: [],
};

const zip = new JSZip();

const manifest = {
  version: project.version,
  school: project.school,
  exportedAt: new Date().toISOString(),
  files: [
    'academic_years.json', 'teachers.json', 'subjects.json', 'rooms.json',
    'groups.json', 'curriculum.json', 'load_distribution.json', 'constraints.json'
  ]
};

zip.file('manifest.json', JSON.stringify(manifest, null, 2));
zip.file('academic_years.json', JSON.stringify(project.academicYears, null, 2));
zip.file('teachers.json', JSON.stringify(project.teachers, null, 2));
zip.file('subjects.json', JSON.stringify(project.subjects, null, 2));
zip.file('rooms.json', JSON.stringify(project.rooms, null, 2));
zip.file('groups.json', JSON.stringify(project.groups, null, 2));
zip.file('curriculum.json', JSON.stringify(project.curriculum, null, 2));
zip.file('load_distribution.json', JSON.stringify(project.loadDistribution, null, 2));
zip.file('constraints.json', JSON.stringify(project.constraints, null, 2));

const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync('example.schoolproj', content);
console.log('Created example.schoolproj');
