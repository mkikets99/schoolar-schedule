import JSZip from 'jszip';
import { writeFileSync } from 'fs';

const grades = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
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
  { id: 's-cs', name: 'Computer Science', shortName: 'CS', color: '#00BCD4' },
  { id: 's-pe', name: 'Physical Education', shortName: 'PE', color: '#FFEB3B' },
  { id: 's-art', name: 'Art', shortName: 'ART', color: '#E91E63' },
  { id: 's-music', name: 'Music', shortName: 'MUS', color: '#673AB7' },
  { id: 's-philo', name: 'Philosophy', shortName: 'PHIL', color: '#3F51B5' },
  { id: 's-econ', name: 'Economics', shortName: 'ECON', color: '#CDDC39' },
];

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

function randChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- Groups: 25 classes across grades 1-11 ---
const groups = [];
const classCounts = { 1: 3, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 2, 8: 2, 9: 2, 10: 1, 11: 1 };
let groupIdx = 0;
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

// --- Teachers: 50 ---
const teachers = [];
const subjectIds = subjects.map(s => s.id);
for (let i = 0; i < 50; i++) {
  const subjectsForTeacher = pick(subjectIds, randInt(1, 3));
  teachers.push({
    id: `t-${String(i + 1).padStart(2, '0')}`,
    name: `${teacherFirstNames[i]} ${teacherLastNames[i]}`,
    shortName: `${teacherFirstNames[i][0]}.${teacherLastNames[i][0]}.`,
    subjects: subjectsForTeacher,
  });
}

// --- Rooms ---
const rooms = [];
const roomTypes = ['classroom', 'lab', 'gym', 'computer-lab', 'art-studio', 'music-room', 'hall'];
for (let i = 1; i <= 30; i++) {
  const type = i <= 15 ? 'classroom' : i <= 20 ? 'lab' : i <= 22 ? 'computer-lab' : i <= 24 ? 'gym' : i <= 26 ? 'art-studio' : i <= 28 ? 'music-room' : 'hall';
  rooms.push({
    id: `r-${String(i).padStart(2, '0')}`,
    name: i <= 20 ? `Room ${100 + i}` : i === 21 ? 'Physics Lab' : i === 22 ? 'Chemistry Lab' : i === 23 ? 'Computer Lab A' : i === 24 ? 'Computer Lab B' : i === 25 ? 'Gym A' : i === 26 ? 'Gym B' : i === 27 ? 'Art Studio' : i === 28 ? 'Music Room' : i === 29 ? 'Auditorium' : 'Multi-purpose Hall',
    capacity: type === 'hall' ? 100 : type === 'gym' ? 60 : type === 'classroom' ? 30 : 24,
    types: [type],
  });
}

// --- Curriculum Rules ---
const curriculum = [];
const classRooms = rooms.filter(r => r.types.includes('classroom'));
const labs = rooms.filter(r => r.types.includes('lab'));
const compLabs = rooms.filter(r => r.types.includes('computer-lab'));
const gyms = rooms.filter(r => r.types.includes('gym'));
const artStudio = rooms.find(r => r.types.includes('art-studio'));
const musicRoom = rooms.find(r => r.types.includes('music-room'));

function findTeacher(subjectId, excludeIds = new Set()) {
  const candidates = teachers.filter(t => t.subjects.includes(subjectId) && !excludeIds.has(t.id));
  if (candidates.length === 0) {
    const fallback = teachers.filter(t => t.subjects.includes(subjectId));
    return fallback.length > 0 ? fallback[0] : teachers[0];
  }
  return candidates[0];
}

function findRoom(type, excludeIds = new Set()) {
  let pool;
  if (type === 'classroom') pool = classRooms;
  else if (type === 'lab') pool = labs;
  else if (type === 'computer-lab') pool = compLabs;
  else if (type === 'gym') pool = gyms;
  else pool = rooms;
  const available = pool.filter(r => !excludeIds.has(r.id));
  return available.length > 0 ? available[0] : pool[0];
}

let ruleIdx = 0;
const usedTeachers = new Set();
const usedRooms = new Set();

const weeklyHoursByGrade = {
  1: { 's-math': 4, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-art': 2, 's-music': 1 },
  2: { 's-math': 4, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-art': 2, 's-music': 1 },
  3: { 's-math': 4, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-art': 2, 's-music': 1 },
  4: { 's-math': 4, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-art': 1, 's-music': 1, 's-cs': 1 },
  5: { 's-math': 5, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-hist': 2, 's-geo': 2, 's-bio': 2, 's-cs': 1, 's-art': 1, 's-music': 1 },
  6: { 's-math': 5, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-hist': 2, 's-geo': 2, 's-bio': 2, 's-cs': 1, 's-art': 1, 's-music': 1 },
  7: { 's-math': 5, 's-phys': 2, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-hist': 2, 's-geo': 2, 's-bio': 2, 's-cs': 1, 's-art': 1 },
  8: { 's-math': 5, 's-phys': 2, 's-chem': 2, 's-eng': 3, 's-ukr': 3, 's-pe': 3, 's-hist': 2, 's-geo': 1, 's-bio': 2, 's-cs': 1 },
  9: { 's-math': 5, 's-phys': 2, 's-chem': 2, 's-bio': 2, 's-eng': 3, 's-ukr': 3, 's-lit': 2, 's-hist': 2, 's-geo': 1, 's-cs': 1, 's-pe': 3 },
  10: { 's-math': 4, 's-phys': 3, 's-chem': 2, 's-bio': 2, 's-eng': 3, 's-ukr': 3, 's-lit': 2, 's-hist': 2, 's-geo': 1, 's-cs': 2, 's-pe': 3, 's-econ': 1, 's-philo': 1 },
  11: { 's-math': 4, 's-phys': 3, 's-chem': 2, 's-bio': 2, 's-eng': 3, 's-ukr': 3, 's-lit': 2, 's-hist': 2, 's-geo': 1, 's-cs': 2, 's-pe': 3, 's-econ': 1, 's-philo': 1 },
};

// Subjects that support splits (multiple subgroups)
const splitSubjects = ['s-eng', 's-pe', 's-cs'];

for (const group of groups) {
  const gradeHours = weeklyHoursByGrade[group.grade] || weeklyHoursByGrade[5];
  const subgroups = [];
  let hasSplit = false;

  for (const [subjId, hours] of Object.entries(gradeHours)) {
    // Decide if this group splits this subject (1 in 3 chance for split subjects)
    const couldSplit = splitSubjects.includes(subjId);
    const shouldSplit = couldSplit && Math.random() < 0.35 && !hasSplit && group.grade >= 5;

    if (shouldSplit) {
      const numGroups = randInt(2, 3);
      hasSplit = true;

      for (let sg = 0; sg < numGroups; sg++) {
        const subgroupId = `${group.id}-${subjId}-${sg + 1}`;
        subgroups.push(subgroupId);

        const teacher = findTeacher(subjId);
        usedTeachers.add(teacher.id);
        const room = findRoom(subjId === 's-pe' ? 'gym' : subjId === 's-cs' ? 'computer-lab' : 'classroom');
        usedRooms.add(room.id);

        curriculum.push({
          id: `cr-${String(++ruleIdx).padStart(3, '0')}`,
          groupId: group.id,
          subjectId: subjId,
          hoursPerWeek: Math.ceil(hours / numGroups),
          teacherId: teacher.id,
          roomId: room.id,
        });
      }
    } else {
      const teacher = findTeacher(subjId);
      usedTeachers.add(teacher.id);
      let room;
      if (subjId === 's-pe') room = findRoom('gym');
      else if (subjId === 's-cs' || subjId === 's-phys') room = findRoom('computer-lab');
      else if (subjId === 's-chem') room = findRoom('lab');
      else room = findRoom('classroom');
      usedRooms.add(room.id);

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

// --- Load Distribution ---
const loadDistribution = curriculum.map(rule => ({
  teacherId: rule.teacherId,
  subjectId: rule.subjectId,
  groupId: rule.groupId,
  hours: rule.hoursPerWeek,
}));

// --- Constraints (optional, leave empty) ---
const constraints = [];

// --- Build manifest ---
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

console.log(`Created example.schoolproj with:
  - ${groups.length} groups (${groups.map(g => g.name).join(', ')})
  - ${teachers.length} teachers
  - ${subjects.length} subjects
  - ${rooms.length} rooms
  - ${curriculum.length} curriculum rules
  - ${loadDistribution.length} load distribution entries
  - Groups with splits: ${groups.filter(g => g.subgroups.length > 0).map(g => g.name + ' (' + g.subgroups.join(',') + ')').join(', ') || 'none'}`);
