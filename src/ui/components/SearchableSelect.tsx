import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

export interface SelectOption {
  value: string;
  label: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  allowEmpty?: boolean;
  className?: string;
  disabled?: boolean;
  pinTop?: string[];
}

const byLabel = (a: SelectOption, b: SelectOption) =>
  a.label.localeCompare(b.label, undefined, { sensitivity: 'base', numeric: true });

export const SearchableSelect = ({
  value,
  onChange,
  options,
  placeholder = '',
  allowEmpty = false,
  className = '',
  disabled = false,
  pinTop = [],
}: SearchableSelectProps) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const sortedOptions = useMemo(() => {
    const pinnedSet = new Set(pinTop.filter(id => options.some(o => o.value === id)));
    const pinned = options.filter(o => pinnedSet.has(o.value)).sort(byLabel);
    const rest = options.filter(o => !pinnedSet.has(o.value)).sort(byLabel);
    return [...pinned, ...rest];
  }, [options, pinTop]);

  const visibleOptions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedOptions;
    return sortedOptions.filter(o => o.label.toLowerCase().includes(q));
  }, [sortedOptions, query]);

  const selected = sortedOptions.find(o => o.value === value);

  const openDropdown = () => {
    if (disabled) return;
    setQuery('');
    setHighlighted(0);
    setOpen(true);
  };

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

  useEffect(() => {
    if (!open || !listRef.current) return;
    const items = listRef.current.querySelectorAll<HTMLElement>('.combobox-option');
    items[highlighted]?.scrollIntoView({ block: 'nearest' });
  }, [highlighted, open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(h => Math.min(h + 1, visibleOptions.length + (allowEmpty ? 0 : -1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(h => Math.max(h - 1, 0));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const opt = allowEmpty && highlighted === 0
        ? { value: '', label: placeholder }
        : visibleOptions[highlighted - (allowEmpty ? 1 : 0)];
      if (opt) {
        onChange(opt.value);
        setOpen(false);
      }
    }
  };

  const select = (opt: SelectOption) => {
    onChange(opt.value);
    setOpen(false);
  };

  return (
    <div className={`combobox ${className}`} ref={containerRef}>
      <button
        type="button"
        className={`combobox-trigger ${!selected ? 'placeholder' : ''}`}
        onClick={() => (open ? setOpen(false) : openDropdown())}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="combobox-trigger-label">{selected ? selected.label : placeholder}</span>
        <span className="combobox-caret">&#9662;</span>
      </button>

      {open && (
        <div className="combobox-dropdown">
          <input
            ref={searchRef}
            className="combobox-search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlighted(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('search_placeholder')}
          />
          <div className="combobox-list" role="listbox">
            {allowEmpty && (
              <button
                type="button"
                className={`combobox-option ${value === '' ? 'selected' : ''} ${highlighted === 0 ? 'highlighted' : ''}`}
                onClick={() => select({ value: '', label: placeholder })}
                role="option"
                aria-selected={value === ''}
                data-value=""
              >
                {placeholder}
              </button>
            )}
            {visibleOptions.map((opt, i) => {
              const idx = allowEmpty ? i + 1 : i;
              return (
                <button
                  key={opt.value}
                  type="button"
                  className={`combobox-option ${value === opt.value ? 'selected' : ''} ${highlighted === idx ? 'highlighted' : ''}`}
                  onClick={() => select(opt)}
                  role="option"
                  aria-selected={value === opt.value}
                  data-value={opt.value}
                >
                  {opt.label}
                </button>
              );
            })}
            {visibleOptions.length === 0 && (
              <div className="combobox-no-results">{t('no_results')}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
