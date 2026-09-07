import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ScheduleViewer } from '../../ui/components/ScheduleViewer';
import { ProjectState } from '../../shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

const { useProjectMock } = vi.hoisted(() => ({
  useProjectMock: vi.fn(),
}));

vi.mock('../../ui/context/ProjectContext', () => ({
  useProject: () => useProjectMock(),
}));

vi.mock('../../ui/services/workerPool', async () => {
  const { suggestRearrangeChoices } = await import('../../worker/rearrange');
  return {
    workerPool: {
      run: vi.fn((job: { kind: string; payload: any }) => {
        const { project, schedule, lessonId, target, semester } = job.payload;
        return Promise.resolve(suggestRearrangeChoices(project, schedule, lessonId, target, semester));
      }),
    },
    default: {},
  };
});

const makeTwoGroupProject = (allowedConflicts: any[] = []): ProjectState => ({
  version: '1.0.0',
  school: { id: 's1', name: 'Test School' },
  academicYears: [],
  teachers: [{ id: 't1', name: 'Anna', subjects: ['subj1'] }],
  subjects: [{ id: 'subj1', name: 'Math', shortName: 'M' }],
  rooms: [{ id: 'r1', name: 'Room 1', types: [] }],
  groups: [
    { id: 'g1', name: '5-A', grade: 5, subgroups: [] },
    { id: 'g2', name: '5-B', grade: 5, subgroups: [] },
  ],
  curriculum: [
    { id: 'c1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't1', roomId: 'r1' },
    { id: 'c2', groupId: 'g2', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't1', roomId: 'r1' },
  ],
  loadDistribution: [],
  constraints: [],
  generatedSchedule: {
    schedule: [
      { id: 'l1', ruleId: 'c1', groupId: 'g1', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Monday', period: 1 },
      { id: 'l2', ruleId: 'c2', groupId: 'g2', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Monday', period: 1 },
    ],
    conflicts: [{ type: 'UNASSIGNED_HOURS', ruleId: 'c1', missing: 1 }, { type: 'UNASSIGNED_HOURS', ruleId: 'c2', missing: 1 }],
    score: 0.5,
  },
  allowedConflicts,
});

const consent = (groupId: string) => ({
  id: `ac-${groupId}`,
  kind: 'teacher',
  teacherId: 't1',
  groupId,
  reason: 'TEACHER_SLOT',
} as const);

const stubProject = (project: ProjectState) => {
  useProjectMock.mockReturnValue({
    project,
    updateGeneratedSchedules: vi.fn(),
    updateGeneratedSchedule: vi.fn(),
    updateGeneratedSplits: vi.fn(),
    updateLockedLessons: vi.fn(),
    updateAllowedConflicts: vi.fn(),
  });
};

describe('ScheduleViewer allowed conflicts (view mode)', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('reports two overlapping lessons as conflicts when nothing is allowed', () => {
    stubProject(makeTwoGroupProject());
    const { container } = render(<ScheduleViewer />);
    const grid = container.querySelector('.schedule-grid')!;
    expect(grid.querySelectorAll('.lesson-box.conflict').length).toBe(2);
    expect(grid.querySelectorAll('.conflict-badge-small.allowed').length).toBe(0);
  });

  it('suppresses an overlap once every involved class consents', () => {
    stubProject(makeTwoGroupProject([consent('g1'), consent('g2')]));
    const { container } = render(<ScheduleViewer />);
    const grid = container.querySelector('.schedule-grid')!;
    expect(grid.querySelectorAll('.lesson-box.conflict').length).toBe(0);
    expect(grid.querySelectorAll('.conflict-badge-small.allowed').length).toBe(2);
  });

  it('keeps the unconsented lesson flagged when consent is one-sided', () => {
    stubProject(makeTwoGroupProject([consent('g1')]));
    const { container } = render(<ScheduleViewer />);
    const grid = container.querySelector('.schedule-grid')!;
    expect(grid.querySelectorAll('.lesson-box.conflict').length).toBe(1);
    expect(grid.querySelectorAll('.conflict-badge-small.allowed').length).toBe(1);
  });

  it('shows a remove button for each allowed conflict in the manage modal', () => {
    stubProject(makeTwoGroupProject([consent('g1'), consent('g2')]));
    const { container } = render(<ScheduleViewer />);
    const manageBtn = [...container.querySelectorAll('button')].find(b => b.textContent === 'allowed_conflicts_manage');
    expect(manageBtn).toBeTruthy();
    fireEvent.click(manageBtn!);
    expect(container.querySelectorAll('.remove-allowed-btn').length).toBe(2);
  });
});
