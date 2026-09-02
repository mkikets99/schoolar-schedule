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
    // Leave Monday/period 1 free: jsdom drop events carry no clientX, so the
    // target slot always resolves to period 1 of the first day row.
    const project: ProjectState = {
      ...makeProject(),
      generatedSchedule: {
        schedule: [
          { id: 'l1', ruleId: 'c1', groupId: 'g1', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Tuesday', period: 2 },
        ],
        conflicts: [{ type: 'UNASSIGNED_HOURS', ruleId: 'c1', missing: 1 }],
        score: 0.5,
      },
    };
    const { container } = render(<InlineEditor project={project} activeSemester="semester1" onSave={vi.fn()} />);
    const chip = container.querySelector('.checker-chip')!;
    fireEvent.dragStart(chip, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    const dayTrack = container.querySelectorAll('.timeline-day')[0] as HTMLElement;
    fireEvent.drop(dayTrack, { clientX: 130, dataTransfer: { getData: vi.fn(() => '') } });
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(2);
    expect(container.querySelectorAll('.checker-chip').length).toBe(0);
  });

  it('force-inserts a pool lesson when the rearrange engine cannot open the slot', () => {
    const { container } = render(<InlineEditor project={makeProject()} activeSemester="semester1" onSave={vi.fn()} />);
    const chip = container.querySelector('.checker-chip')!;
    fireEvent.dragStart(chip, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    const dayTrack = container.querySelectorAll('.timeline-day')[0] as HTMLElement;
    fireEvent.drop(dayTrack, { clientX: 130, dataTransfer: { getData: vi.fn(() => '') } });
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(2);
    expect(container.querySelectorAll('.checker-chip').length).toBe(0);
  });

  it('proposes moving a blocking lesson and applies the change on confirm', () => {
    // g1 is placed at Monday/2; another class occupies Monday/1 (the jsdom drop
    // target). Placing the missing g1 lesson there must relocate the blocker.
    const project: ProjectState = {
      ...makeProject(),
      groups: [
        { id: 'g1', name: '5-A', grade: 5, subgroups: [] },
        { id: 'g2', name: '5-B', grade: 5, subgroups: [] },
      ],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 6, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g2', subjectId: 'subj1', hoursPerWeek: 6, teacherId: 't1', roomId: 'r1' },
      ],
      generatedSchedule: {
        schedule: [
          { id: 'l1', ruleId: 'c1', groupId: 'g1', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Monday', period: 2 },
          { id: 'l2', ruleId: 'c2', groupId: 'g2', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Monday', period: 1 },
        ],
        conflicts: [
          { type: 'UNASSIGNED_HOURS', ruleId: 'c1', missing: 1 },
          { type: 'UNASSIGNED_HOURS', ruleId: 'c2', missing: 1 },
        ],
        score: 0.5,
      },
    };
    const onSave = vi.fn();
    const { container } = render(<InlineEditor project={project} activeSemester="semester1" onSave={onSave} filter={{ type: 'group', id: 'g1' }} />);
    const chip = container.querySelector('.checker-chip')!;
    fireEvent.dragStart(chip, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(container.querySelectorAll('.timeline-day')[0] as HTMLElement, {
      clientX: 130,
      dataTransfer: { getData: vi.fn(() => '') },
    });
    expect(screen.getByText('rearrange_confirm_title')).toBeTruthy();
    fireEvent.click(screen.getByText('rearrange_confirm_accept'));
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(2);
    fireEvent.click(screen.getByText('editor_apply'));
    const grid = (onSave.mock.calls[0][0] as any).schedule;
    expect(grid.length).toBe(3);
    const main = grid.find((l: any) => l.id === 'pending-c1-0');
    expect(main).toBeDefined();
    expect(main.day).toBe('Monday');
    expect(main.period).toBe(1);
    const blocker = grid.find((l: any) => l.id === 'l2');
    expect(blocker).toBeDefined();
    expect(blocker.period).not.toBe(1);
    expect(grid.find((l: any) => l.id === 'l1').period).toBe(2);
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
    const { container } = render(<InlineEditor project={makeTwoGroupProject()} activeSemester="semester1" onSave={vi.fn()} filter={{ type: 'group', id: 'g1' }} />);
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(1);
    expect(container.querySelectorAll('.checker-chip').length).toBe(1);
    expect(container.querySelector('.checker-zone-title')!.textContent).toContain('5-A');
  });

  it('re-rendering with another class filter shows that class lessons', () => {
    const { container } = render(<InlineEditor project={makeTwoGroupProject()} activeSemester="semester1" onSave={vi.fn()} filter={{ type: 'group', id: 'g2' }} />);
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(1);
    expect(container.querySelectorAll('.checker-chip').length).toBe(1);
    expect(container.querySelector('.checker-zone-title')!.textContent).toContain('5-B');
  });

  it('still flags conflicts with another class sharing teacher and room', () => {
    const { container } = render(<InlineEditor project={makeTwoGroupProject()} activeSemester="semester1" onSave={vi.fn()} filter={{ type: 'group', id: 'g1' }} />);
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
    const { container } = render(<InlineEditor project={makeSplitProject()} activeSemester="semester1" onSave={vi.fn()} filter={{ type: 'group', id: 'g1' }} />);
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(2);
    expect(container.querySelectorAll('.checker-chip').length).toBe(2);
    expect(container.querySelector('.checker-zone-title')!.textContent).toContain('5-A (1)');
  });

  it('opens the needed curriculum distribution modal listing every entered rule', () => {
    const { container } = render(<InlineEditor project={makeTwoGroupProject()} activeSemester="semester1" onSave={vi.fn()} />);
    expect(container.querySelector('.modal-overlay')).toBeNull();
    fireEvent.click(screen.getByText('editor_curriculum_distribution'));
    const rows = Array.from(container.querySelectorAll('.detail-row'));
    expect(rows.length).toBe(2);
    expect(rows[0].querySelector('.detail-main')!.textContent).toContain('Math — 5-A');
    expect(rows[1].querySelector('.detail-main')!.textContent).toContain('Math — 5-B');
    // Active semester split is taken from the working splits.
    expect(rows[0].querySelector('.detail-meta')!.textContent).toContain('semester_1');
    expect(rows[0].querySelector('.detail-meta')!.textContent).toContain('semester_2');
  });
});

describe('InlineEditor teacher edit mode', () => {
  it('shows only the selected teacher lessons across all classes', () => {
    const { container } = render(
      <InlineEditor project={makeSplitProject()} activeSemester="semester1" onSave={vi.fn()} filter={{ type: 'teacher', id: 't1' }} />
    );
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(1);
    expect(container.querySelectorAll('.checker-chip').length).toBe(1);
    expect(container.querySelector('.checker-zone-title')!.textContent).toContain('Anna');
  });

  it('re-rendering with another teacher filter shows that teacher lessons', () => {
    const { container } = render(
      <InlineEditor project={makeSplitProject()} activeSemester="semester1" onSave={vi.fn()} filter={{ type: 'teacher', id: 't2' }} />
    );
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(1);
    expect(container.querySelector('.checker-zone-title')!.textContent).toContain('Bohdan');
    const lesson = container.querySelector('.timeline-lesson')!;
    expect((lesson as HTMLElement).title).not.toContain('Anna');
  });

  it('lists only the selected teacher rules in the curriculum distribution modal', () => {
    const { container } = render(
      <InlineEditor project={makeSplitProject()} activeSemester="semester1" onSave={vi.fn()} filter={{ type: 'teacher', id: 't1' }} />
    );
    fireEvent.click(screen.getByText('editor_curriculum_distribution'));
    const rows = Array.from(container.querySelectorAll('.detail-row'));
    expect(rows.length).toBe(1);
    expect(rows[0].querySelector('.detail-meta')!.textContent).toContain('2');
  });

  it('shows only the selected teacher unassigned count, not the whole project', () => {
    const project: ProjectState = {
      version: '1.0.0',
      school: { id: 's1', name: 'Test School' },
      academicYears: [],
      teachers: [
        { id: 't1', name: 'Anna', subjects: ['subj1'] },
        { id: 't2', name: 'Bohdan', subjects: ['subj1'] },
      ],
      subjects: [{ id: 'subj1', name: 'Math', shortName: 'M' }],
      rooms: [{ id: 'r1', name: 'Room 1', types: [] }],
      groups: [
        { id: 'g1', name: '5-A', grade: 5, subgroups: [] },
        { id: 'g2', name: '5-B', grade: 5, subgroups: [] },
      ],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g2', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't2', roomId: 'r1' },
      ],
      loadDistribution: [],
      constraints: [],
      generatedSchedule: {
        schedule: [
          { id: 'l1', ruleId: 'c1', groupId: 'g1', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Monday', period: 1 },
          { id: 'l2', ruleId: 'c1', groupId: 'g1', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Monday', period: 2 },
          { id: 'l3', ruleId: 'c2', groupId: 'g2', subjectId: 'subj1', teacherId: 't2', roomId: 'r1', day: 'Monday', period: 3 },
        ],
        conflicts: [{ type: 'UNASSIGNED_HOURS', ruleId: 'c2', missing: 1 }],
        score: 0.75,
      },
    };
    const { container } = render(
      <InlineEditor project={project} activeSemester="semester1" onSave={vi.fn()} filter={{ type: 'teacher', id: 't1' }} />
    );
    expect(container.querySelector('.checker-zone-title')!.textContent).toContain('Anna (0)');
    expect(container.querySelector('.checker-empty')).toBeTruthy();
  });

  it('force-inserts a pool placement that would otherwise swap the lesson to another teacher', () => {
    const project: ProjectState = {
      version: '1.0.0',
      school: { id: 's1', name: 'Test School' },
      academicYears: [],
      teachers: [
        { id: 't1', name: 'Anna', subjects: ['subj1'] },
        { id: 't2', name: 'Bohdan', subjects: ['subj1'] },
      ],
      subjects: [{ id: 'subj1', name: 'Math', shortName: 'M' }],
      rooms: [{ id: 'r1', name: 'Room 1', types: [] }],
      groups: [
        { id: 'g1', name: '5-A', grade: 5, subgroups: [] },
        { id: 'g2', name: '5-B', grade: 5, subgroups: [] },
      ],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't1', roomId: 'r1' },
        { id: 'c2', groupId: 'g2', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't2', roomId: 'r1' },
      ],
      loadDistribution: [],
      constraints: [{ id: 'x1', kind: 'TEACHER_BUSY', teacherId: 't1', day: 'Monday', periods: [1] }],
      generatedSchedule: {
        schedule: [
          { id: 'l1', ruleId: 'c1', groupId: 'g1', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Tuesday', period: 2 },
          { id: 'l2', ruleId: 'c2', groupId: 'g2', subjectId: 'subj1', teacherId: 't2', roomId: 'r1', day: 'Monday', period: 1 },
        ],
        conflicts: [{ type: 'UNASSIGNED_HOURS', ruleId: 'c1', missing: 1 }],
        score: 0.5,
      },
    };
    const { container } = render(
      <InlineEditor project={project} activeSemester="semester1" onSave={vi.fn()} filter={{ type: 'teacher', id: 't1' }} />
    );
    const chip = container.querySelector('.checker-chip')!;
    fireEvent.dragStart(chip, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(container.querySelectorAll('.timeline-day')[0] as HTMLElement, {
      clientX: 130,
      dataTransfer: { getData: vi.fn(() => '') },
    });
    expect(screen.queryByText('rearrange_blocked_title')).toBeNull();
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(2);
    expect(container.querySelectorAll('.checker-chip').length).toBe(0);
  });

  it('never reassigns the moved lesson to a different teacher when replacing', () => {
    // The moved pool lesson belongs to t1, whose target slot is busy that day.
    // Before the fix a substitute (t2) solution could take over; it must not.
    const project: ProjectState = {
      version: '1.0.0',
      school: { id: 's1', name: 'Test School' },
      academicYears: [],
      teachers: [
        { id: 't1', name: 'Anna', subjects: ['subj1'] },
        { id: 't2', name: 'Bohdan', subjects: ['subj1'] },
      ],
      subjects: [{ id: 'subj1', name: 'Math', shortName: 'M' }],
      rooms: [{ id: 'r1', name: 'Room 1', types: [] }],
      groups: [{ id: 'g1', name: '5-A', grade: 5, subgroups: [] }],
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 2, teacherId: 't1', roomId: 'r1' },
      ],
      loadDistribution: [],
      constraints: [{ id: 'x1', kind: 'TEACHER_BUSY', teacherId: 't1', day: 'Monday', periods: [2] }],
      generatedSchedule: {
        schedule: [
          { id: 'l1', ruleId: 'c1', groupId: 'g1', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Monday', period: 1 },
        ],
        conflicts: [{ type: 'UNASSIGNED_HOURS', ruleId: 'c1', missing: 1 }],
        score: 0.5,
      },
    };
    const onSave = vi.fn();
    const { container } = render(
      <InlineEditor project={project} activeSemester="semester1" onSave={onSave} filter={{ type: 'group', id: 'g1' }} />
    );
    const chip = container.querySelector('.checker-chip')!;
    fireEvent.dragStart(chip, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(container.querySelectorAll('.timeline-day')[0] as HTMLElement, {
      clientX: 130,
      dataTransfer: { getData: vi.fn(() => '') },
    });
    fireEvent.click(screen.getByText('editor_apply'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const grid = (onSave.mock.calls[0][0] as any).schedule;
    const moved = grid.filter((l: any) => l.ruleId === 'c1');
    // Both hours of c1 keep teacher t1 - never reassigned to t2.
    expect(moved.every((l: any) => l.teacherId === 't1')).toBe(true);
  });
});

describe('InlineEditor draft lifecycle (view/edit toggle)', () => {
  it('keeps in-progress edits while hidden and when restored', () => {
    const project = makeProject();
    const { container, rerender } = render(
      <InlineEditor project={project} activeSemester="semester1" onSave={vi.fn()} active />
    );
    const lesson = container.querySelector('.timeline-lesson')!;
    fireEvent.dragStart(lesson, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(container.querySelector('.checker-zone')!, { dataTransfer: { getData: vi.fn(() => '') } });
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(0);

    rerender(<InlineEditor project={project} activeSemester="semester1" onSave={vi.fn()} active={false} />);
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(0);

    rerender(<InlineEditor project={project} activeSemester="semester1" onSave={vi.fn()} active />);
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(0);
  });

  it('reseesds from the project when the generation session changes', () => {
    const project = makeProject();
    const { container, rerender } = render(
      <InlineEditor project={project} activeSemester="semester1" onSave={vi.fn()} active sessionKey={0} />
    );
    const lesson = container.querySelector('.timeline-lesson')!;
    fireEvent.dragStart(lesson, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(container.querySelector('.checker-zone')!, { dataTransfer: { getData: vi.fn(() => '') } });
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(0);

    rerender(<InlineEditor project={project} activeSemester="semester1" onSave={vi.fn()} active sessionKey={1} />);
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(1);
    expect(container.querySelectorAll('.checker-chip').length).toBe(1);
  });

  it('reseesds a fresh schedule when the semester changes while hidden', () => {
    const project = makeProject();
    const { container, rerender } = render(
      <InlineEditor project={project} activeSemester="semester1" onSave={vi.fn()} active />
    );
    const lesson = container.querySelector('.timeline-lesson')!;
    fireEvent.dragStart(lesson, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(container.querySelector('.checker-zone')!, { dataTransfer: { getData: vi.fn(() => '') } });
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(0);

    rerender(<InlineEditor project={project} activeSemester="semester1" onSave={vi.fn()} active={false} />);
    rerender(<InlineEditor project={project} activeSemester="semester2" onSave={vi.fn()} active={false} />);
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(0);

    rerender(<InlineEditor project={project} activeSemester="semester2" onSave={vi.fn()} active />);
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(1);
  });
});

describe('InlineEditor two-semester shared pool', () => {
  const makeTwoSemesterProject = (): ProjectState => {
    const base = makeProject();
    return {
      ...base,
      curriculum: [
        { id: 'c1', groupId: 'g1', subjectId: 'subj1', hoursPerWeek: 6, teacherId: 't1', roomId: 'r1' },
      ],
      generatedSchedules: {
        semester1: {
          schedule: [
            { id: 'l1', ruleId: 'c1', groupId: 'g1', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Tuesday', period: 1 },
            { id: 'l2', ruleId: 'c1', groupId: 'g1', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Monday', period: 2 },
          ],
          conflicts: [],
          score: 1,
        },
        semester2: {
          schedule: [
            { id: 'l3', ruleId: 'c1', groupId: 'g1', subjectId: 'subj1', teacherId: 't1', roomId: 'r1', day: 'Tuesday', period: 2 },
          ],
          conflicts: [],
          score: 1,
        },
      },
      generatedSplits: [
        { ruleId: 'c1', hoursPerWeek: 3, first: 3, second: 3 },
      ],
    };
  };

  it('aggregates unassigned lessons from both semesters into one pool', () => {
    const { container } = render(
      <InlineEditor project={makeTwoSemesterProject()} activeSemester="semester1" onSave={vi.fn()} />
    );
    expect(container.querySelectorAll('.timeline-lesson').length).toBe(2);
    expect(container.querySelectorAll('.checker-chip').length).toBe(3);
    // 2 of the 3 missing lessons belong to the other (semester 2) schedule.
    expect(container.querySelectorAll('.checker-chip.other-semester').length).toBe(2);
  });

  it('shifts one hour to the edited semester when an other-semester lesson is placed', () => {
    const onSave = vi.fn();
    const { container } = render(
      <InlineEditor project={makeTwoSemesterProject()} activeSemester="semester1" onSave={onSave} />
    );
    const chip = container.querySelector('.checker-chip.other-semester')!;
    fireEvent.dragStart(chip, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    const dayTrack = container.querySelectorAll('.timeline-day')[0] as HTMLElement;
    vi.spyOn(dayTrack, 'getBoundingClientRect').mockReturnValue({
      left: 0, top: 0, width: 480, height: 50, right: 480, bottom: 50, x: 0, y: 0,
      toJSON: () => ({}),
    });
    fireEvent.drop(dayTrack, { clientX: 130, dataTransfer: { getData: vi.fn(() => '') } });

    expect(container.querySelectorAll('.timeline-lesson').length).toBe(3);

    fireEvent.click(screen.getByText('editor_apply'));
    expect(onSave).toHaveBeenCalledTimes(1);
    const splits = onSave.mock.calls[0][1] as any[];
    expect(splits).toBeDefined();
    const c1 = splits.find(s => s.ruleId === 'c1');
    expect(c1.first).toBe(4);
    expect(c1.second).toBe(2);
  });
});

describe('InlineEditor lesson locks', () => {
  it('marks a locked lesson with a badge and toggles it on double-click', () => {
    const onToggleLock = vi.fn();
    const project: ProjectState = {
      ...makeProject(),
      lockedLessons: [{ ruleId: 'c1', day: 'Monday', period: 1 }],
    };
    const { container } = render(
      <InlineEditor project={project} activeSemester="semester1" onSave={vi.fn()} onToggleLock={onToggleLock} />
    );
    const lesson = container.querySelector('.timeline-lesson')!;
    expect(lesson.className).toContain('locked');
    expect(lesson.querySelector('.timeline-lesson-lock-badge')).toBeTruthy();

    fireEvent.doubleClick(lesson);
    expect(onToggleLock).toHaveBeenCalledTimes(1);
    expect(onToggleLock.mock.calls[0][0]).toMatchObject({ ruleId: 'c1', day: 'Monday', period: 1 });
  });

  it('hints to unlock a locked lesson and to lock a free one', () => {
    const project: ProjectState = {
      ...makeProject(),
      lockedLessons: [{ ruleId: 'c1', day: 'Monday', period: 1 }],
    };
    const { container } = render(
      <InlineEditor project={project} activeSemester="semester1" onSave={vi.fn()} onToggleLock={vi.fn()} />
    );
    const lesson = container.querySelector('.timeline-lesson')!;
    expect((lesson as HTMLElement).title).toContain('click_to_unlock_lesson');
  });

  it('does not show a lock badge for lessons of the other semester', () => {
    const project: ProjectState = {
      ...makeProject(),
      generatedSchedules: {
        semester1: makeProject().generatedSchedule!,
        semester2: makeProject().generatedSchedule!,
      },
      generatedSplits: [{ ruleId: 'c1', hoursPerWeek: 2, first: 1, second: 1 }],
      lockedLessons: [{ ruleId: 'c1', day: 'Monday', period: 1, semester: 'semester2' }],
    };
    const { container } = render(
      <InlineEditor project={project} activeSemester="semester1" onSave={vi.fn()} onToggleLock={vi.fn()} />
    );
    const lesson = container.querySelector('.timeline-lesson')!;
    expect(lesson.className).not.toContain('locked');
  });
});
