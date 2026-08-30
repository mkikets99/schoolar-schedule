import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConstraintEditor } from '../../ui/components/ConstraintEditor';

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

const subjectA = '11111111-1111-1111-1111-111111111111';
const groupA = '22222222-2222-2222-2222-222222222222';
const groupB = '33333333-3333-3333-3333-333333333333';
const r1 = 'aaaa0000-0000-0000-0000-000000000001';
const r2 = 'aaaa0000-0000-0000-0000-000000000002';
const r3 = 'aaaa0000-0000-0000-0000-000000000003';

const makeProject = (constraints: any[] = []) => ({
  id: 'p1',
  teachers: [],
  subjects: [{ id: subjectA, name: 'Math', shortName: 'Math' }],
  groups: [
    { id: groupA, name: '5-A' },
    { id: groupB, name: '5-B' },
  ],
  curriculum: [
    { id: r1, subjectId: subjectA, groupId: groupA, hoursPerWeek: 3 },
    { id: r2, subjectId: subjectA, groupId: groupA, hoursPerWeek: 2 },
    { id: r3, subjectId: subjectA, groupId: groupB, hoursPerWeek: 2 },
  ],
  constraints,
  timetable: [],
});

const selectAllOptions = (container: HTMLElement) => {
  fireEvent.click(container.querySelector('.combobox-trigger')!);
  const actions = [...container.querySelectorAll('.combobox-actions button')];
  fireEvent.click(actions[0]); // select all
  return [...container.querySelectorAll('.combobox-option-check input')];
};

describe('ConstraintEditor', () => {
  beforeEach(() => {
    cleanup();
    vi.stubGlobal('alert', vi.fn());
  });

  it('creates one FORBID_LESSON constraint per selected rule', () => {
    const updateConstraints = vi.fn();
    useProjectMock.mockReturnValue({
      project: makeProject(),
      updateConstraints,
    });
    const { container } = render(<ConstraintEditor />);

    fireEvent.click(screen.getByText('add_forbid_lesson'));
    const inputs = selectAllOptions(container);
    expect(inputs).toHaveLength(3);

    const hours = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    fireEvent.change(hours, { target: { value: '2' } });

    fireEvent.click(screen.getByText('create'));

    expect(updateConstraints).toHaveBeenCalledTimes(1);
    const created = updateConstraints.mock.calls[0][0];
    expect(created).toHaveLength(3);
    expect(created.map((c: any) => c.kind)).toEqual(['FORBID_LESSON', 'FORBID_LESSON', 'FORBID_LESSON']);
    expect(created.map((c: any) => c.ruleId).sort()).toEqual([r1, r2, r3].sort());
    expect(created.every((c: any) => c.semester === 1)).toBe(true);
    expect(created.every((c: any) => c.hours === 2)).toBe(true);
  });

  it('creates FORBID_LESSON only for search-filtered rules via select-visible', () => {
    const updateConstraints = vi.fn();
    useProjectMock.mockReturnValue({
      project: makeProject(),
      updateConstraints,
    });
    const { container } = render(<ConstraintEditor />);

    fireEvent.click(screen.getByText('add_forbid_lesson'));
    fireEvent.click(container.querySelector('.combobox-trigger')!);
    fireEvent.change(container.querySelector('.combobox-search')!, { target: { value: '5-B' } });
    const actions = [...container.querySelectorAll('.combobox-actions button')];
    expect(actions[1].textContent).toContain('select_visible');
    fireEvent.click(actions[1]);

    fireEvent.click(screen.getByText('create'));

    const created = updateConstraints.mock.calls[0][0];
    expect(created).toHaveLength(1);
    expect(created[0].ruleId).toBe(r3);
  });

  it('creates one MAX_DAILY_LESSONS constraint per selected rule', () => {
    const updateConstraints = vi.fn();
    useProjectMock.mockReturnValue({
      project: makeProject(),
      updateConstraints,
    });
    const { container } = render(<ConstraintEditor />);

    fireEvent.click(screen.getByText('add_max_daily'));
    selectAllOptions(container);

    const perDay = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    fireEvent.change(perDay, { target: { value: '3' } });

    fireEvent.click(screen.getByText('create'));

    const created = updateConstraints.mock.calls[0][0];
    expect(created).toHaveLength(3);
    expect(created.map((c: any) => c.kind)).toEqual(['MAX_DAILY_LESSONS', 'MAX_DAILY_LESSONS', 'MAX_DAILY_LESSONS']);
    expect(created.map((c: any) => c.ruleId).sort()).toEqual([r1, r2, r3].sort());
    expect(created.every((c: any) => c.maxPerDay === 3)).toBe(true);
  });

  it('re-scopes an edited FORBID_LESSON constraint to the re-selected rules', () => {
    const existing = [{ id: 'c1', kind: 'FORBID_LESSON', ruleId: r1, semester: 1, hours: 1 }];
    const updateConstraints = vi.fn();
    useProjectMock.mockReturnValue({
      project: makeProject(existing),
      updateConstraints,
    });
    const { container } = render(<ConstraintEditor />);

    fireEvent.click(screen.getAllByText('mode_edit')[0]);
    const checks = selectAllOptions(container);
    expect(checks).toHaveLength(3);
    const hours = container.querySelector<HTMLInputElement>('input[type="number"]')!;
    fireEvent.change(hours, { target: { value: '2' } });

    fireEvent.click(screen.getByText('save'));

    const created = updateConstraints.mock.calls[0][0];
    expect(created).toHaveLength(3);
    expect(created.map((c: any) => c.ruleId).sort()).toEqual([r1, r2, r3].sort());
    expect(created.every((c: any) => c.hours === 2)).toBe(true);
    expect(created.every((c: any) => c.semester === 1)).toBe(true);
  });

  it('rejects submitting without any selected rule', () => {
    const updateConstraints = vi.fn();
    useProjectMock.mockReturnValue({
      project: makeProject(),
      updateConstraints,
    });
    render(<ConstraintEditor />);

    fireEvent.click(screen.getByText('add_forbid_lesson'));
    fireEvent.click(screen.getByText('create'));
    expect(updateConstraints).not.toHaveBeenCalled();
  });
});