import { describe, it, expect } from 'vitest';
import { ProjectState, CurriculumRule } from '../../shared/types';
import { generateSemesterSchedules } from '../../worker/generator';

function makeProject(groups: any[], curriculum: CurriculumRule[]): ProjectState {
  return {
    version: '1.0.0',
    school: { id: 's1', name: 'Test', address: '' },
    academicYears: [],
    teachers: [
      { id: 't1', name: 'Teacher A', subjects: ['subj-1', 'subj-2', 'subj-3'] },
      { id: 't2', name: 'Teacher B', subjects: ['subj-1', 'subj-2', 'subj-3'] },
    ],
    subjects: [
      { id: 'subj-1', name: 'Subject 1', shortName: 'S1' },
      { id: 'subj-2', name: 'Subject 2', shortName: 'S2' },
      { id: 'subj-3', name: 'Subject 3', shortName: 'S3' },
    ],
    rooms: [],
    groups,
    curriculum,
    loadDistribution: [],
    constraints: [],
  };
}

async function run(project: ProjectState, settings?: any) {
  const messages: { type: string; payload?: any }[] = [];
  await generateSemesterSchedules(project, (msg) => messages.push(msg), settings);
  const payload = messages.find((m) => m.type === 'RESULT')!.payload;
  return payload.schedules.semester1.schedule;
}

describe('generator grade ordering', () => {
  it('places lower-grade groups first regardless of their list order', async () => {
    const groups = [
      { id: 'g10', name: '10-A', grade: 10, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
      { id: 'g2', name: '2-A', grade: 2, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
      { id: 'g5', name: '5-A', grade: 5, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
    ];
    const curriculum: CurriculumRule[] = groups.map((g, i) => ({
      id: `r${i}`,
      groupId: g.id,
      subjectId: `subj-${i + 1}`,
      hoursPerWeek: 1,
      teacherId: `t${i % 2 === 0 ? '1' : '2'}`,
      roomId: undefined,
    }));

    const schedule = await run(makeProject(groups, curriculum), { attempts: 1 });
    expect(schedule.map((l: any) => l.groupId)).toEqual(['g2', 'g5', 'g10']);
  });

  it('keeps grade ordering stable across multiple shuffled attempts', async () => {
    const groups = [
      { id: 'g1a', name: '1-A', grade: 1, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
      { id: 'g1b', name: '1-B', grade: 1, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
      { id: 'g9', name: '9-A', grade: 9, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
    ];
    const curriculum: CurriculumRule[] = groups.map((g, i) => ({
      id: `r${i}`,
      groupId: g.id,
      subjectId: `subj-${i + 1}`,
      hoursPerWeek: 1,
      teacherId: `t${i % 2 === 0 ? '1' : '2'}`,
      roomId: undefined,
    }));

    const schedule = await run(makeProject(groups, curriculum), { attempts: 5 });
    const order = schedule.map((l: any) => l.groupId);
    expect(order.slice(0, 2).sort()).toEqual(['g1a', 'g1b']);
    expect(order[2]).toBe('g9');
  });

  it('places groups with tighter daily limits first within the same grade', async () => {
    const groups = [
      { id: 'gLoose', name: '5-B', grade: 5, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
      { id: 'gTight', name: '5-A', grade: 5, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 2 },
    ];
    const curriculum: CurriculumRule[] = groups.map((g, i) => ({
      id: `r${i}`,
      groupId: g.id,
      subjectId: `subj-${i + 1}`,
      hoursPerWeek: 1,
      teacherId: `t${i % 2 === 0 ? '1' : '2'}`,
      roomId: undefined,
    }));

    const schedule = await run(makeProject(groups, curriculum), { attempts: 1 });
    expect(schedule.map((l: any) => l.groupId)).toEqual(['gTight', 'gLoose']);
  });

  it('places double lessons before singles within the same grade and limit', async () => {
    const groups = [
      { id: 'gSingle', name: '7-B', grade: 7, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
      { id: 'gDouble', name: '7-A', grade: 7, subgroups: [], periodStart: 1, periodEnd: 8, maxDailyLessons: 8 },
    ];
    const curriculum: CurriculumRule[] = [
      { id: 'rd', groupId: 'gDouble', subjectId: 'subj-1', hoursPerWeek: 2, teacherId: 't1', roomId: undefined, doubleLesson: true },
      { id: 'rs', groupId: 'gSingle', subjectId: 'subj-2', hoursPerWeek: 1, teacherId: 't2', roomId: undefined, doubleLesson: false },
    ];

    const schedule = await run(makeProject(groups, curriculum), { attempts: 1 });
    expect(schedule[0].groupId).toBe('gDouble');
    expect(schedule[1].groupId).toBe('gDouble');
    expect(schedule[2].groupId).toBe('gSingle');
  });
});