import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface SelectOption {
  value: string;
  label: string;
}

interface MultiSelectProps {
  value: string[];
  onChange: (value: string[]) => void;
  options: SelectOption[];
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

const byLabel = (a: SelectOption, b: SelectOption) =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true });

export const MultiSelect = ({
  value,
  onChange,
  options,
  placeholder = '',
  className = '',
  disabled = false,
}: MultiSelectProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const sortedOptions = useMemo(() => [...options].sort(byLabel), [options]);

  const visibleOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedOptions;
    return sortedOptions.filter(o => o.label.toLowerCase().includes(q));
  }, [sortedOptions, query]);

  const selectedMap = useMemo(() => new Set(value), [value]);
  const selectedLabels = useMemo(
    () => sortedOptions.filter(o => selectedMap.has(o.value)).map(o => o.label),
    [sortedOptions, selectedMap]
  );

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  const toggle = (opt: SelectOption) => {
    if (selectedMap.has(opt.value)) {
      onChange(value.filter(v => v !== opt.value));
    } else {
      onChange([...value, opt.value]);
    }
  };

  return (
    <div className={`combobox ${className}`} ref={containerRef}>
      <button
        type="button"
        className={`combobox-trigger ${selectedLabels.length === 0 ? 'placeholder' : ''}`}
        onClick={() => (disabled ? undefined : setOpen(o => !o))}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-multiselectable="true"
      >
        <span className="combobox-trigger-label">
          {selectedLabels.length === 0
            ? placeholder
            : `${selectedLabels.join(', ')}`}
        </span>
        <span className="combobox-caret">&#9662;</span>
      </button>

      {open && (
        <div className="combobox-dropdown">
          <input
            ref={searchRef}
            className="combobox-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('search_placeholder')}
          />
          <div className="combobox-list" role="listbox" aria-multiselectable="true">
            {visibleOptions.map(opt => (
              <label key={opt.value} className="combobox-option-check" data-value={opt.value}>
                <input
                  type="checkbox"
                  checked={selectedMap.has(opt.value)}
                  onChange={() => toggle(opt)}
                />
                <span>{opt.label}</span>
              </label>
            ))}
            {visibleOptions.length === 0 && (
              <div className="combobox-no-results">{t('no_results')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
