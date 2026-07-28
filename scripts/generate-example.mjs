import JSZip from 'jszip';
import { writeFileSync } from 'fs';

const letters = ['A', 'B', 'C', 'D', 'E'];

const subjects = [
  { id: 's-math', name: 'Mathematics', shortName: 'MATH', color: '#4CAF50' },
  { id: 's-phys', name: 'Physics', shortName: 'PHYS', color: '#2196F3' },
  { id: 's-chem', name: 'Chemistry', shortName: 'CHEM', color: '#9C27B0' },
  { id: 's-bio', name: 'Biology', shortName: 'BIO', color: '#009688' },
  { id: 's-eng', name: 'English Language', shortName: 'ENG', color: '#FF9800' },
  { id: 's-ukr', name: 'Ukrainian Language', shortName: 'UKR', color: '#FF5722' },
  { id: 's-lit', name: 'Literature', shortName: 'LIT', color: '#795548' },
  { id: 's-hist', name: 'History', shortName: 'HIST', color: '#607D8B' },
  { id: 's-geo', name: 'Geography', shortName: 'GEO', color: '#8BC34A' },
  { id: 's-info', name: 'Informatics', shortName: 'INFO', color: '#00BCD4' },
  { id: 's-tech', name: 'Technology', shortName: 'TECH', color: '#FF6F00' },
  { id: 's-pe', name: 'Physical Education', shortName: 'PE', color: '#FFEB3B' },
  { id: 's-art', name: 'Art', shortName: 'ART', color: '#E91E63' },
  { id: 's-music', name: 'Music', shortName: 'MUS', color: '#673AB7' },
  { id: 's-econ', name: 'Economics', shortName: 'ECON', color: '#CDDC39' },
];

// --- 50 teachers ---
const teacherFirstNames = [
  'Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank', 'Grace', 'Henry', 'Ivy', 'Jack',
  'Kate', 'Leo', 'Mia', 'Noah', 'Olivia', 'Paul', 'Quinn', 'Rose', 'Sam', 'Tina',
  'Uma', 'Victor', 'Wendy', 'Xander', 'Yara', 'Zack', 'Anna', 'Ben', 'Chloe', 'Dan',
  'Ella', 'Finn', 'Gina', 'Hank', 'Isla', 'Jake', 'Kara', 'Liam', 'Maya', 'Nate',
  'Oscar', 'Pia', 'Rex', 'Sage', 'Troy', 'Una', 'Vince', 'Wade', 'Xena', 'Yves',
];
const teacherLastNames = [
  'Adams', 'Baker', 'Clark', 'Davis', 'Evans', 'Foster', 'Garcia', 'Harris', 'Irwin', 'Jones',
  'Kim', 'Lee', 'Miller', 'Nelson', 'Owens', 'Park', 'Quinn', 'Reed', 'Smith', 'Taylor',
  'Underwood', 'Vega', 'Wang', 'Xu', 'Young', 'Zhang', 'Brown', 'Carter', 'Diaz', 'Edwards',
  'Fisher', 'Green', 'Hill', 'Ishida', 'Johnson', 'Klein', 'Lopez', 'Martinez', 'Nguyen', 'Ortiz',
  'Patel', 'Roberts', 'Stone', 'Torres', 'Ueda', 'Valdez', 'Williams', 'Xavier', 'Yamada', 'Zhao',
];

function pick(arr, n) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// --- 25 groups ---
const groups = [];
let groupIdx = 0;
const classCounts = { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 2, 8: 2, 9: 2, 10: 1, 11: 1 };
for (let grade = 1; grade <= 11 && groupIdx < 25; grade++) {
  const count = classCounts[grade] || 2;
  for (let l = 0; l < count && groupIdx < 25; l++) {
    groups.push({
      id: `g-${String(groupIdx + 1).padStart(2, '0')}`,
      name: `${grade}-${letters[l]}`,
      grade,
      subgroups: [],
    });
    groupIdx++;
  }
}

// --- 50 rooms: 2 small (cap 15), rest 36 ---
const rooms = [];
// 20 classrooms (homerooms) + special rooms
for (let i = 1; i <= 20; i++) {
  rooms.push({
    id: `r-${String(i).padStart(2, '0')}`,
    name: `Room ${100 + i}`,
    capacity: 36,
    types: ['classroom'],
  });
}
// 2 small rooms for splits
rooms.push({ id: 'r-21', name: 'Small Room A', capacity: 15, types: ['classroom'] });
rooms.push({ id: 'r-22', name: 'Small Room B', capacity: 15, types: ['classroom'] });
// Computer labs (for Informatics)
rooms.push({ id: 'r-23', name: 'Computer Lab A', capacity: 18, types: ['computer-lab'] });
rooms.push({ id: 'r-24', name: 'Computer Lab B', capacity: 18, types: ['computer-lab'] });
rooms.push({ id: 'r-25', name: 'Computer Lab C', capacity: 18, types: ['computer-lab'] });
// Workshops (for Technology)
rooms.push({ id: 'r-26', name: 'Workshop A', capacity: 18, types: ['workshop'] });
rooms.push({ id: 'r-27', name: 'Workshop B', capacity: 18, types: ['workshop'] });
rooms.push({ id: 'r-28', name: 'Workshop C', capacity: 18, types: ['workshop'] });
// PE
rooms.push({ id: 'r-29', name: 'Gymnasium', capacity: 60, types: ['gym'] });
rooms.push({ id: 'r-30', name: 'Sports Hall', capacity: 60, types: ['gym'] });
// Art studio
rooms.push({ id: 'r-31', name: 'Art Studio', capacity: 30, types: ['art-studio'] });
// Music room
rooms.push({ id: 'r-32', name: 'Music Room', capacity: 30, types: ['music-room'] });
// Library
rooms.push({ id: 'r-33', name: 'Library', capacity: 36, types: ['classroom'] });

// Fill up to 50 with generic classrooms
for (let i = 34; i <= 50; i++) {
  rooms.push({
    id: `r-${String(i).padStart(2, '0')}`,
    name: `Room ${200 + i}`,
    capacity: 36,
    types: ['classroom'],
  });
}

// --- Assign each group a homeroom (classroom) ---
const homerooms = rooms.filter(r => r.types.includes('classroom') && r.capacity >= 30);
let roomIdx = 0;
const groupHomeroom = new Map();
for (const group of groups) {
  groupHomeroom.set(group.id, homerooms[roomIdx % homerooms.length]);
  roomIdx++;
}

// --- Subject teachers ---
const teacherSubjectPool = {};
for (const subj of subjects) {
  teacherSubjectPool[subj.id] = [];
}
// Assign each teacher 1-3 subjects
const subjectIds = subjects.map(s => s.id);
const teachers = [];
for (let i = 0; i < 50; i++) {
  const subjs = pick(subjectIds, randInt(1, 3));
  teachers.push({
    id: `t-${String(i + 1).padStart(2, '0')}`,
    name: `${teacherFirstNames[i]} ${teacherLastNames[i]}`,
    shortName: `${teacherFirstNames[i][0]}.${teacherLastNames[i][0]}.`,
    subjects: subjs,
  });
  for (const s of subjs) {
    teacherSubjectPool[s].push(teachers[teachers.length - 1].id);
  }
}

// --- Weekly hours per grade ---
const weeklyHoursByGrade = {
  1: { 's-math': 4, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-art': 2, 's-music': 1, 's-info': 0, 's-tech': 0 },
  2: { 's-math': 4, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-art': 2, 's-music': 1, 's-info': 0, 's-tech': 0 },
  3: { 's-math': 4, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-art': 2, 's-music': 1, 's-info': 0, 's-tech': 0 },
  4: { 's-math': 4, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-art': 1, 's-music': 1, 's-info': 1, 's-tech': 0 },
  5: { 's-math': 5, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-hist': 2, 's-geo': 2, 's-bio': 2, 's-info': 1, 's-tech': 1, 's-art': 1, 's-music': 1 },
  6: { 's-math': 5, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-hist': 2, 's-geo': 2, 's-bio': 2, 's-info': 1, 's-tech': 1, 's-art': 1, 's-music': 1 },
  7: { 's-math': 5, 's-phys': 2, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-hist': 2, 's-geo': 2, 's-bio': 2, 's-info': 1, 's-tech': 1, 's-art': 1 },
  8: { 's-math': 5, 's-phys': 2, 's-chem': 2, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-hist': 2, 's-geo': 1, 's-bio': 2, 's-info': 1, 's-tech': 1 },
  9: { 's-math': 5, 's-phys': 2, 's-chem': 2, 's-bio': 2, 's-eng': 3, 's-ukr': 3, 's-lit': 2, 's-hist': 2, 's-geo': 1, 's-info': 1, 's-tech': 1, 's-pe': 3 },
  10: { 's-math': 4, 's-phys': 3, 's-chem': 2, 's-bio': 2, 's-eng': 3, 's-ukr': 3, 's-lit': 2, 's-hist': 2, 's-geo': 1, 's-info': 2, 's-tech': 2, 's-pe': 3, 's-econ': 1 },
  11: { 's-math': 4, 's-phys': 3, 's-chem': 2, 's-bio': 2, 's-eng': 3, 's-ukr': 3, 's-lit': 2, 's-hist': 2, 's-geo': 1, 's-info': 2, 's-tech': 2, 's-pe': 3, 's-econ': 1 },
};

// Subjects that always split into subgroups
const splitSubjects = ['s-info', 's-tech'];

// --- Build curriculum ---
const curriculum = [];
let ruleIdx = 0;
let roomDistIdx = 0;

function getRoomFor(subjectId, groupId, isSplit = false) {
  if (subjectId === 's-pe') {
    const pool = rooms.filter(r => r.types.includes('gym'));
    return pool[roomDistIdx++ % pool.length];
  }
  if (subjectId === 's-info') {
    const pool = rooms.filter(r => r.types.includes('computer-lab'));
    return pool[roomDistIdx++ % pool.length];
  }
  if (subjectId === 's-tech') {
    const pool = rooms.filter(r => r.types.includes('workshop'));
    return pool[roomDistIdx++ % pool.length];
  }
  if (subjectId === 's-art') {
    return rooms.find(r => r.types.includes('art-studio'));
  }
  if (subjectId === 's-music') {
    return rooms.find(r => r.types.includes('music-room'));
  }
  const hr = groupHomeroom.get(groupId);
  if (hr && hr.capacity >= 36) return hr;
  const pool = rooms.filter(r => r.types.includes('classroom') && r.capacity >= 30);
  return pool[roomDistIdx++ % pool.length];
}

function getTeacher(subjectId) {
  const pool = teacherSubjectPool[subjectId] || [];
  if (pool.length === 0) return teachers[0];
  return teachers.find(t => t.id === pool[roomDistIdx % pool.length]) || teachers[0];
}

for (const group of groups) {
  const gradeHours = weeklyHoursByGrade[group.grade] || weeklyHoursByGrade[5];
  const subgroups = [];

  for (const [subjId, hours] of Object.entries(gradeHours)) {
    if (hours === 0) continue;

    const splitFromGrade = subjId === 's-info' ? 2 : subjId === 's-tech' ? 7 : 99;
    if (splitSubjects.includes(subjId) && hours > 0 && group.grade >= splitFromGrade) {
      for (let sg = 0; sg < 2; sg++) {
        const subgroupId = `${group.id}-${subjId}-${sg + 1}`;
        subgroups.push(subgroupId);

        const teacher = getTeacher(subjId);
        const room = rooms.filter(r => r.types.includes(subjId === 's-info' ? 'computer-lab' : 'workshop'))[roomDistIdx % 3];

        curriculum.push({
          id: `cr-${String(++ruleIdx).padStart(3, '0')}`,
          groupId: group.id,
          subjectId: subjId,
          hoursPerWeek: hours,
          teacherId: teacher.id,
          roomId: room.id,
        });
      }
    } else {
      const teacher = getTeacher(subjId);
      const room = getRoomFor(subjId, group.id);
      curriculum.push({
        id: `cr-${String(++ruleIdx).padStart(3, '0')}`,
        groupId: group.id,
        subjectId: subjId,
        hoursPerWeek: hours,
        teacherId: teacher.id,
        roomId: room.id,
      });
    }
  }

  group.subgroups = subgroups;
}

// --- Load distribution ---
const loadDistribution = curriculum.map(rule => ({
  teacherId: rule.teacherId,
  subjectId: rule.subjectId,
  groupId: rule.groupId,
  hours: rule.hoursPerWeek,
}));

const constraints = [];

const manifest = {
  version: '1.0.0',
  school: { id: 'sch-001', name: 'Big Example School' },
  exportedAt: new Date().toISOString(),
  files: [
    'academic_years.json', 'teachers.json', 'subjects.json', 'rooms.json',
    'groups.json', 'curriculum.json', 'load_distribution.json', 'constraints.json',
  ],
};

// --- Write ZIP ---
const zip = new JSZip();
zip.file('manifest.json', JSON.stringify(manifest, null, 2));
zip.file('academic_years.json', JSON.stringify([{ id: 'ay-2024', name: '2024/2025', startDate: '2024-09-01', endDate: '2025-06-30' }], null, 2));
zip.file('teachers.json', JSON.stringify(teachers, null, 2));
zip.file('subjects.json', JSON.stringify(subjects, null, 2));
zip.file('rooms.json', JSON.stringify(rooms, null, 2));
zip.file('groups.json', JSON.stringify(groups, null, 2));
zip.file('curriculum.json', JSON.stringify(curriculum, null, 2));
zip.file('load_distribution.json', JSON.stringify(loadDistribution, null, 2));
zip.file('constraints.json', JSON.stringify(constraints, null, 2));

const content = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
writeFileSync('example.schoolproj', content);

const splitGroups = groups.filter(g => g.subgroups.length > 0);
console.log(`Created example.schoolproj with:
  - ${groups.length} groups (grades ${Math.min(...groups.map(g => g.grade))}-${Math.max(...groups.map(g => g.grade))})
  - ${teachers.length} teachers
  - ${subjects.length} subjects
  - ${rooms.length} rooms (${rooms.filter(r => r.capacity === 15).length} small, ${rooms.filter(r => r.capacity >= 30).length} standard)
  - ${curriculum.length} curriculum rules
  - ${splitGroups.length} groups with subgroup splits
  - Homeroom assignment: each group has a dedicated classroom`);
