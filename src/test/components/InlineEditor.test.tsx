import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { InlineEditor } from '../../ui/components/InlineEditor';
import { ProjectState } from '../../shared/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
}));

const makeProject = (): ProjectState => ({
  version: '1.0.0',
  school: { id: 's1', name: 'Test School' },
  academicYears: [],
  teachers: [{ id: 't1', name: 'Anna', subjects: ['subj1'] }],
  subjects: [{ id: 'subj1', name: 'Math', shortName: 'M' }],
  rooms: [{ id: 'r1', name: 'Room 1', types: [] }],
  groups: [{ id: 'g1', name: '5-A', grade: 5, subgroups: [] }],
  curriculum: [
    { id: 'c1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't1', roomId: 'r1' },
  ],
  loadDistribution: [],
  constraints: [],
  generatedSchedule: {
    schedule: [
      { id: 'l1', ruleId: 'c1', groupId: 'g1', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Monday', period: 1 },
    ],
    conflicts: [{ type: 'UNASSIGNED_HOURS', ruleId: 'c1', missing: 1 }],
    score: 0.5,
  },
});

const makeSplitProject = (): ProjectState => ({
  version: '1.0.0',
  school: { id: 's1', name: 'Test School' },
  academicYears: [],
  teachers: [
    { id: 't1', name: 'Anna', subjects: ['subj1'] },
    { id: 't2', name: 'Bohdan', subjects: ['subj1'] },
  ],
  subjects: [{ id: 'subj1', name: 'English', shortName: 'En' }],
  rooms: [{ id: 'r1', name: 'Room 1', types: [] }],
  groups: [{ id: 'g1', name: '5-A', grade: 5, subgroups: [] }],
  curriculum: [
    { id: 'c1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't1', roomId: 'r1' },
    { id: 'c2', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't2', roomId: 'r1' },
  ],
  loadDistribution: [],
  constraints: [],
  generatedSchedule: {
    schedule: [
      { id: 'l1', ruleId: 'c1', groupId: 'g1', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Monday', period: 1 },
      { id: 'l2', ruleId: 'c2', groupId: 'g1', subjectId: 'subj1', teacherId: 't2', roomId: 'r1', day: 'Monday', period: 1 },
    ],
    conflicts: [
      { type: 'UNASSIGNED_HOURS', ruleId: 'c1', missing: 1 },
      { type: 'UNASSIGNED_HOURS', ruleId: 'c2', missing: 1 },
    ],
    score: 0.5,
  },
});

const makeTwoGroupProject = (): ProjectState => ({
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
});

describe('InlineEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a timeline with 5 day rows and 12 period columns', () => {
    const { container } = render(<InlineEditor project={makeProject()} activeSemester="semester1" onSave={vi.fn()} />);
    expect(container.querySelectorAll('.timeline-day').length).toBe(5);
    expect(container.querySelectorAll('.timeline-header-period').length).toBe(12);
  });

  it('seeds placed lessons on the grid and missing lessons into the checker zone', () => {
    const { container } = render(<InlineEditor project={makeProject()} activeSemester="semester1" onSave={vi.fn()} />);
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(1);
    expect(container.querySelectorAll('.checker-chip').length).toBe(1);
  });

  it('moves a pool lesson onto the grid when dragged', () => {
    const { container } = render(<InlineEditor project={makeProject()} activeSemester="semester1" onSave={vi.fn()} />);
    const chip = container.querySelector('.checker-chip')!;
    fireEvent.dragStart(chip, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    const dayTrack = container.querySelectorAll('.timeline-day')[0] as HTMLElement;
    vi.spyOn(dayTrack, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 480, height: 50, right: 480, bottom: 50, x: 0, y: 0,
      toJSON: () => ({}),
    });
    fireEvent.drop(dayTrack, { clientX: 130, dataTransfer: { getData: vi.fn(() => '') } });
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(2);
    expect(container.querySelectorAll('.checker-chip').length).toBe(0);
  });

  it('unassigns a grid lesson when dropped into the checker zone', () => {
    const { container } = render(<InlineEditor project={makeProject()} activeSemester="semester1" onSave={vi.fn()} />);
    const lesson = container.querySelector('.timeline-lesson')!;
    fireEvent.dragStart(lesson, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(container.querySelector('.checker-zone')!, { dataTransfer: { getData: vi.fn(() => '') } });
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(0);
    expect(container.querySelectorAll('.checker-chip').length).toBe(2);
  });

  it('applies the edited schedule through onSave', () => {
    const onSave = vi.fn();
    const { container } = render(<InlineEditor project={makeProject()} activeSemester="semester1" onSave={onSave} />);
    const lesson = container.querySelector('.timeline-lesson')!;
    fireEvent.dragStart(lesson, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(container.querySelector('.checker-zone')!, { dataTransfer: { getData: vi.fn(() => '') } });
    fireEvent.click(screen.getByText('editor_apply'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const result = onSave.mock.calls[0][0];
    expect(result.schedule.length).toBe(0);
    expect(result.conflicts).toContainEqual({ type: 'UNASSIGNED_HOURS', ruleId: 'c1', missing: 2 });
  });

  it('shows only the selected class lessons on the timeline and pool', () => {
    const { container } = render(<InlineEditor project={makeTwoGroupProject()} activeSemester="semester1" onSave={vi.fn()} />);
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(1);
    expect(container.querySelectorAll('.checker-chip').length).toBe(1);
    expect(container.querySelector('.checker-zone-title')!.textContent).toContain('5-A');
  });

  it('switching the class selector shows that class lessons', () => {
    const { container } = render(<InlineEditor project={makeTwoGroupProject()} activeSemester="semester1" onSave={vi.fn()} />);
    fireEvent.change(container.querySelector('.inline-editor-toolbar select')!, { target: { value: 'g2' } });
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(1);
    expect(container.querySelector('.checker-zone-title')!.textContent).toContain('5-B');
  });

  it('still flags conflicts with another class sharing teacher and room', () => {
    const { container } = render(<InlineEditor project={makeTwoGroupProject()} activeSemester="semester1" onSave={vi.fn()} />);
    const lesson = container.querySelector('.timeline-lesson')!;
    expect(lesson.className).toContain('conflict');
    const title = (container.querySelector('.timeline-lesson') as HTMLElement).title;
    expect(title).toContain('conflict_teacher_slot');
    expect(title).toContain('conflict_room_slot');
    expect(title).toContain('conflict_caused_by');
    expect(title).toContain('5-B');
    expect(title).toContain('monday, period 1');
  });

  it('counts a split lesson (same group+subject in one slot) as 1 unassigned in the checker', () => {
    const { container } = render(<InlineEditor project={makeSplitProject()} activeSemester="semester1" onSave={vi.fn()} />);
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(2);
    expect(container.querySelectorAll('.checker-chip').length).toBe(2);
    expect(container.querySelector('.checker-zone-title')!.textContent).toContain('5-A (1)');
  });
});
