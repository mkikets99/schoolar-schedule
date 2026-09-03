import { describe, it, expect } from 'vitest';
import { ProjectState } from '../../shared/types';
import { generateSemesterSchedules } from '../../worker/generator';

function simpleProject(): ProjectState {
  return {
    version: '1.0.0',
    school: { id: 's1', name: 'Test', address: '' },
    academicYears: [],
    teachers: [{ id: 't1', name: 'Teacher', subjects: ['m'] }],
    subjects: [{ id: 'm', name: 'Math', shortName: 'M' }],
    rooms: [{ id: 'r1', name: 'Room', maxGroups: 1, types: ['classroom'] }],
    groups: [
      { id: 'g1', name: '7-A', grade: 7, subgroups: [], periodStart: 1, periodEnd: 8 },
      { id: 'g2', name: '7-B', grade: 7, subgroups: [], periodStart: 1, periodEnd: 8 },
    ],
    curriculum: [
      { id: 'c1', groupId: 'g1', subjectId: 'm', hoursPerWeek: 5, teacherId: 't1', roomId: 'r1' },
      { id: 'c2', groupId: 'g2', subjectId: 'm', hoursPerWeek: 5, teacherId: 't1', roomId: 'r1' },
    ],
    loadDistribution: [],
    constraints: [],
    lockedLessons: [],
  };
}

describe('generation log (installer-style action lines)', () => {
  it('emits LOG messages with phases and a completion line', async () => {
    const messages: { type: string; payload?: any }[] = [];
    await generateSemesterSchedules(simpleProject(), (msg) => messages.push(msg), { attempts: 1 });

    const logs = messages.filter((m) => m.type === 'LOG').map((m) => m.payload);
    expect(logs.length).toBeGreaterThan(0);

    // Every log entry carries an id, time, level and message.
    for (const entry of logs) {
      expect(typeof entry.id).toBe('number');
      expect(typeof entry.time).toBe('number');
      expect(['info', 'step', 'success', 'warn']).toContain(entry.level);
      expect(typeof entry.message).toBe('string');
      expect(entry.message.length).toBeGreaterThan(0);
    }

    const text = logs.map((l) => l.message).join('\n');
    // Completion line is always present.
    expect(text).toContain('Generation complete');
    // Semester placement steps.
    expect(text).toContain('semester 1');
    expect(text).toContain('semester 2');
    // Attempt entries.
    expect(logs.some((l) => l.attempt === 1)).toBe(true);
  });

  it('places the final progress at 100 after all LOG entries flow', async () => {
    const messages: { type: string; payload?: any }[] = [];
    await generateSemesterSchedules(simpleProject(), (msg) => messages.push(msg), { attempts: 1 });

    const progress = messages.filter((m) => m.type === 'PROGRESS');
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1].payload.progress).toBe(100);
  });
});
