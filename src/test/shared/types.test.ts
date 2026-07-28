import { describe, it, expect } from 'vitest';
import {
  ProjectState,
  Teacher,
  Subject,
  Room,
  Group,
  ScheduleResult,
  WorkerMessage,
} from '../../shared/types';

const baseProject: ProjectState = {
  version: '1.0.0',
  school: { id: 's1', name: 'Test School', address: '123 Main St' },
  academicYears: [{ id: 'ay1', name: '2024/2025', startDate: '2024-09-01', endDate: '2025-06-30' }],
  teachers: [{ id: 't1', name: 'Alice', shortName: 'A.', subjects: ['s1'] }],
  subjects: [{ id: 's1', name: 'Math', shortName: 'M', color: '#FF0000' }],
  rooms: [{ id: 'r1', name: 'Room 101', capacity: 30, types: ['classroom'] }],
  groups: [{ id: 'g1', name: '10-A', grade: 10, subgroups: ['g1-a', 'g1-b'] }],
  curriculum: [{ id: 'c1', groupId: 'g1', subjectId: 's1', hoursPerWeek: 5, teacherId: 't1', roomId: 'r1' }],
  loadDistribution: [{ teacherId: 't1', subjectId: 's1', groupId: 'g1', hours: 5 }],
  constraints: [],
};

describe('ProjectState structure', () => {
  it('creates a valid project with all required fields', () => {
    expect(baseProject.version).toBe('1.0.0');
    expect(baseProject.school.name).toBe('Test School');
    expect(baseProject.teachers).toHaveLength(1);
    expect(baseProject.subjects).toHaveLength(1);
    expect(baseProject.rooms).toHaveLength(1);
    expect(baseProject.groups).toHaveLength(1);
    expect(baseProject.curriculum).toHaveLength(1);
    expect(baseProject.loadDistribution).toHaveLength(1);
    expect(baseProject.constraints).toEqual([]);
    expect(baseProject.generatedSchedule).toBeUndefined();
  });

  it('handles ScheduleResult structure', () => {
    const scheduleResult: ScheduleResult = {
      schedule: [
        {
          id: 'l1',
          ruleId: 'c1',
          groupId: 'g1',
          subjectId: 's1',
          teacherId: 't1',
          roomId: 'r1',
          day: 'Monday',
          period: 1,
        },
      ],
      conflicts: [],
      score: 1.0,
    };
    expect(scheduleResult.score).toBe(1.0);
    expect(scheduleResult.schedule[0].day).toBe('Monday');
    expect(scheduleResult.schedule[0].period).toBe(1);
  });

  it('handles WorkerMessage structure', () => {
    const msg: WorkerMessage = { type: 'INIT' };
    expect(msg.type).toBe('INIT');
  });

  it('allows optional fields on Teacher', () => {
    const t: Teacher = { id: 't2', name: 'Bob', subjects: [] };
    expect(t.shortName).toBeUndefined();
    expect(t.color).toBeUndefined();
  });

  it('allows optional fields on Subject', () => {
    const s: Subject = { id: 's2', name: 'Physics' };
    expect(s.shortName).toBeUndefined();
    expect(s.color).toBeUndefined();
  });

  it('requires types array on Room even if empty', () => {
    const r: Room = { id: 'r2', name: 'Lab', capacity: 20, types: [] };
    expect(r.types).toEqual([]);
  });

  it('allows subgroups as empty array on Group', () => {
    const g: Group = { id: 'g2', name: '11-B', grade: 11, subgroups: [] };
    expect(g.subgroups).toEqual([]);
  });
});
