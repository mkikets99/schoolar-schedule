import { ReactNode, useMemo, useState, CSSProperties } from 'react';

export type SortDirection = 'asc' | 'desc';

export interface TableSort {
  key: string;
  direction: SortDirection;
}

export interface UseTableControlsOptions<T> {
  rows: T[];
  getSearchText: (row: T) => string;
  getSortValue: (row: T, key: string) => string | number | null | undefined;
  extraFilter?: (row: T) => boolean;
  defaultSort?: TableSort;
}

export function useTableControls<T>({
  rows,
  getSearchText,
  getSortValue,
  extraFilter,
  defaultSort,
}: UseTableControlsOptions<T>) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<TableSort | undefined>(defaultSort);

  const filtered = useMemo(() => {
    let result = rows;
    if (extraFilter) result = result.filter(extraFilter);
    const q = query.trim().toLowerCase();
    if (q) {
      result = result.filter(row => getSearchText(row).toLowerCase().includes(q));
    }
    return result;
  }, [rows, query, extraFilter, getSearchText]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const { key, direction } = sort;
    const mult = direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = getSortValue(a, key);
      const vb = getSortValue(b, key);
      if (va == null && vb == null) return 0;
      if (va == null || va === '') return 1;
      if (vb == null || vb === '') return -1;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mult;
      return String(va).localeCompare(String(vb), undefined, { numeric: true }) * mult;
    });
  }, [filtered, sort, getSortValue]);

  const toggleSort = (key: string) => {
    setSort(prev =>
      prev?.key === key
        ? prev.direction === 'asc'
          ? { key, direction: 'desc' }
          : undefined
        : { key, direction: 'asc' }
    );
  };

  return { query, setQuery, sort, toggleSort, rows: sorted, total: rows.length, shown: sorted.length };
}

export const TableSearch = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) => (
  <input
    type="search"
    className="table-search"
    placeholder={placeholder}
    value={value}
    onChange={(e) => onChange(e.target.value)}
  />
);

export const SortableTh = ({
  label,
  sortKey,
  sort,
  onSort,
  style,
}: {
  label: ReactNode;
  sortKey: string;
  sort?: TableSort;
  onSort: (key: string) => void;
  style?: CSSProperties;
}) => {
  const active = sort?.key === sortKey;
  const indicator = active ? (sort!.direction === 'asc' ? '↑' : '↓') : '↕';
  return (
    <th
      className="sortable"
      style={{ cursor: 'pointer', userSelect: 'none', ...style }}
      onClick={() => onSort(sortKey)}
      title={active ? `Sorted ${sort!.direction === 'asc' ? 'ascending' : 'descending'}` : 'Click to sort'}
    >
      {label} <span className={`sort-indicator ${active ? 'active' : ''}`}>{indicator}</span>
    </th>
  );
};
