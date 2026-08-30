import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MultiSelect } from '../../ui/components/MultiSelect';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: any) => {
      if (key === 'selected_count') return `${params?.count ?? 0} selected`;
      if (key === 'search_placeholder') return 'Search...';
      if (key === 'select_all') return 'Select all';
      if (key === 'select_visible') return 'Select visible';
      if (key === 'no_results') return 'No results';
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

const options = [
  { value: 'r1', label: 'Math · 5-A' },
  { value: 'r2', label: 'Math · 5-B' },
  { value: 'r3', label: 'History · 6-A' },
];

const Harness = ({ initial = [] as string[], items = options }: { initial?: string[]; items?: typeof options }) => {
  const [value, setValue] = useState(initial);
  return <MultiSelect value={value} onChange={setValue} options={items} placeholder="select_rule" />;
};

const open = (container: HTMLElement) => {
  fireEvent.click(container.querySelector('.combobox-trigger')!);
};

describe('MultiSelect', () => {
  it('shows the placeholder when nothing is selected', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('.combobox-trigger-label')!.textContent).toBe('select_rule');
  });

  it('toggles an option and updates the trigger label', () => {
    const { container } = render(<Harness />);
    open(container);
    fireEvent.click(container.querySelector('.combobox-option-check')!);
    expect(container.querySelector('.combobox-trigger-label')!.textContent).toBe('History · 6-A');
  });

  it('selects every option with the select-all action', () => {
    const { container } = render(<Harness />);
    open(container);
    fireEvent.click(screen.getByText('Select all'));
    const label = container.querySelector('.combobox-trigger-label')!.textContent;
    expect(label).toContain('Math · 5-A');
    expect(label).toContain('Math · 5-B');
    expect(label).toContain('History · 6-A');
    expect(container.querySelector('.combobox-actions-count')!.textContent).toBe('3 selected');
  });

  it('selects only the search-filtered options with the select-visible action', () => {
    const { container } = render(<Harness />);
    open(container);
    fireEvent.change(container.querySelector('.combobox-search')!, { target: { value: 'Math' } });
    expect(screen.getByText('Select visible (2)')).toBeDefined();
    fireEvent.click(screen.getByText('Select visible (2)'));
    const label = container.querySelector('.combobox-trigger-label')!.textContent!;
    expect(label).toContain('Math · 5-A');
    expect(label).toContain('Math · 5-B');
    expect(label).not.toContain('History');
    expect(container.querySelector('.combobox-actions-count')!.textContent).toBe('2 selected');
  });

  it('select-visible adds to an existing selection without removing it', () => {
    const { container } = render(<Harness initial={['r3']} />);
    open(container);
    fireEvent.change(container.querySelector('.combobox-search')!, { target: { value: 'Math' } });
    fireEvent.click(screen.getByText('Select visible (2)'));
    const label = container.querySelector('.combobox-trigger-label')!.textContent!;
    expect(label).toContain('History · 6-A');
    expect(label).toContain('Math · 5-A');
    expect(label).toContain('Math · 5-B');
    expect(container.querySelector('.combobox-actions-count')!.textContent).toBe('3 selected');
  });

  it('hides the select-visible action when there is no search query', () => {
    const { container } = render(<Harness />);
    open(container);
    expect(screen.queryByText(/Select visible/)).toBeNull();
    expect(screen.getByText('Select all')).toBeDefined();
  });
});