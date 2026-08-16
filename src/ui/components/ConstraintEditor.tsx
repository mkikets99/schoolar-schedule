import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Constraint, ConstraintKind } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';
import { useTableControls, TableSearch, SortableTh } from './TableControls';
import { SearchableSelect } from './SearchableSelect';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const ALL_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const KIND_KEYS: Record<ConstraintKind, { labelKey: string; badgeClass: string }> = {
  TEACHER_BUSY: { labelKey: 'teacher_busy', badgeClass: 'teacher-busy' },
  NO_FIRST_PERIOD: { labelKey: 'no_first_period', badgeClass: 'no-first' },
};

export const ConstraintEditor = () => {
  const { t } = useTranslation();
  const { project, updateConstraints } = useProject();
  const constraints = project?.constraints || [];
  const teachers = project?.teachers || [];
  const subjects = project?.subjects || [];
  const groups = project?.groups || [];
  const loadTeacherIds = [...new Set((project?.loadDistribution || []).map(l => l.teacherId))];

  const [busyOpen, setBusyOpen] = useState(false);
  const [firstOpen, setFirstOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState('');

  const [busyTeacherId, setBusyTeacherId] = useState('');
  const [busyDay, setBusyDay] = useState('*');
  const [busyPeriods, setBusyPeriods] = useState<Set<number>>(new Set());

  const [firstSubjectId, setFirstSubjectId] = useState('');
  const [firstGroupId, setFirstGroupId] = useState('');

  const teacherName = (id?: string) => (id ? teachers.find(x => x.id === id)?.name || id : '');
  const subjectName = (id?: string) => (id ? subjects.find(x => x.id === id)?.name || id : '');
  const groupName = (id?: string) => (id ? groups.find(x => x.id === id)?.name || '' : '');

  const dayLabel = (day: string) => (day === '*' ? t('every_day') : t(day.toLowerCase()));
  const periodsLabel = (periods: number[]) => periods.slice().sort((a, b) => a - b).join(', ');

  const getDetails = (c: Constraint): string => {
    if (c.kind === 'TEACHER_BUSY') {
      return `${teacherName(c.teacherId)} — ${dayLabel(c.day || '*')}: ${periodsLabel(c.periods || [])}`;
    }
    const scope = c.groupId ? `${groupName(c.groupId)} · ` : '';
    return `${scope}${subjectName(c.subjectId)} — ${t('cannot_be_first_period')}`;
  };

  const { query, setQuery, sort, toggleSort, rows: displayed, total, shown } = useTableControls<Constraint>({
    rows: constraints,
    getSearchText: (c) => {
      const kindKey = KIND_KEYS[c.kind]?.labelKey || '';
      return `${t(kindKey)} ${getDetails(c)}`;
    },
    getSortValue: (c, key) => {
      switch (key) {
        case 'kind': return t(KIND_KEYS[c.kind]?.labelKey || '');
        case 'details': return getDetails(c);
        default: return getDetails(c);
      }
    },
    extraFilter: kindFilter ? (c) => c.kind === kindFilter : undefined,
    defaultSort: { key: 'details', direction: 'asc' },
  });

  const togglePeriod = (p: number) => {
    setBusyPeriods(prev => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  };

  const handleAddBusy = () => {
    if (!busyTeacherId) { alert(t('need_teacher')); return; }
    if (busyPeriods.size === 0) { alert(t('need_periods')); return; }
    const constraint: Constraint = {
      id: crypto.randomUUID(),
      kind: 'TEACHER_BUSY',
      teacherId: busyTeacherId,
      day: busyDay,
      periods: [...busyPeriods],
    };
    updateConstraints([...constraints, constraint]);
    setBusyTeacherId('');
    setBusyDay('*');
    setBusyPeriods(new Set());
    setBusyOpen(false);
  };

  const handleAddFirst = () => {
    if (!firstSubjectId) { alert(t('need_subject')); return; }
    const constraint: Constraint = {
      id: crypto.randomUUID(),
      kind: 'NO_FIRST_PERIOD',
      subjectId: firstSubjectId,
      groupId: firstGroupId || undefined,
    };
    updateConstraints([...constraints, constraint]);
    setFirstSubjectId('');
    setFirstGroupId('');
    setFirstOpen(false);
  };

  const handleDelete = (id: string) => {
    if (confirm(t('confirm_delete_constraint'))) {
      updateConstraints(constraints.filter(c => c.id !== id));
    }
  };

  const canAdd = teachers.length > 0 || subjects.length > 0;

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>{t('constraints')}</h2>
        <div className="header-actions" style={{ display: 'flex', gap: '0.5rem' }}>
          <button onClick={() => setBusyOpen(true)} className="secondary-btn" disabled={teachers.length === 0}>{t('add_teacher_busy')}</button>
          <button onClick={() => setFirstOpen(true)} className="primary-btn" disabled={subjects.length === 0}>{t('add_no_first_period')}</button>
        </div>
      </div>

      <p className="section-desc">{t('constraints_desc')}</p>
      <p className="section-desc">{t('constraints_affect_gen')}</p>

      {!canAdd && <p className="empty-hint">{t('no_teachers_no_subjects')}</p>}

      <Modal
        isOpen={busyOpen}
        onClose={() => setBusyOpen(false)}
        title={t('add_teacher_busy')}
        actions={
          <>
            <button onClick={() => setBusyOpen(false)} className="secondary-btn">{t('cancel')}</button>
            <button onClick={handleAddBusy} className="primary-btn">{t('create')}</button>
          </>
        }
      >
        <FormField label={t('teacher')}>
          <SearchableSelect
            value={busyTeacherId}
            onChange={setBusyTeacherId}
            options={teachers.map(t => ({ value: t.id, label: t.name }))}
            placeholder={t('select_teacher')}
            allowEmpty
            pinTop={loadTeacherIds}
          />
        </FormField>
        <FormField label={t('day')}>
          <select value={busyDay} onChange={(e) => setBusyDay(e.target.value)}>
            <option value="*">{t('every_day')}</option>
            {DAYS.map(d => <option key={d} value={d}>{t(d.toLowerCase())}</option>)}
          </select>
        </FormField>
        <FormField label={t('periods')}>
          <div className="period-chips">
            {ALL_PERIODS.map(p => (
              <span
                key={p}
                className={`period-chip ${busyPeriods.has(p) ? 'active' : ''}`}
                onClick={() => togglePeriod(p)}
              >
                {p}
              </span>
            ))}
          </div>
        </FormField>
      </Modal>

      <Modal
        isOpen={firstOpen}
        onClose={() => setFirstOpen(false)}
        title={t('add_no_first_period')}
        actions={
          <>
            <button onClick={() => setFirstOpen(false)} className="secondary-btn">{t('cancel')}</button>
            <button onClick={handleAddFirst} className="primary-btn">{t('create')}</button>
          </>
        }
      >
        <FormField label={t('subject')}>
          <SearchableSelect
            value={firstSubjectId}
            onChange={setFirstSubjectId}
            options={subjects.map(s => ({ value: s.id, label: s.name }))}
            placeholder={t('select_subject')}
            allowEmpty
          />
        </FormField>
        <FormField label={t('group')}>
          <SearchableSelect
            value={firstGroupId}
            onChange={setFirstGroupId}
            options={groups.map(g => ({ value: g.id, label: g.name }))}
            placeholder={t('all_groups')}
            allowEmpty
          />
        </FormField>
      </Modal>

      <div className="table-toolbar">
        <TableSearch value={query} onChange={setQuery} placeholder={t('search_placeholder')} />
        <select className="table-filter" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
          <option value="">{t('all')}</option>
          <option value="TEACHER_BUSY">{t('teacher_busy')}</option>
          <option value="NO_FIRST_PERIOD">{t('no_first_period')}</option>
        </select>
        <span className="table-count">{t('showing_count', { shown, total })}</span>
      </div>

      <table className="editor-table">
        <thead>
          <tr>
            <SortableTh label={t('constraint_type')} sortKey="kind" sort={sort} onSort={toggleSort} style={{ width: '180px' }} />
            <SortableTh label={t('details')} sortKey="details" sort={sort} onSort={toggleSort} />
            <th style={{ width: '100px' }}>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {displayed.map(c => {
            const meta = KIND_KEYS[c.kind];
            return (
              <tr key={c.id}>
                <td>
                  <span className={`constraint-badge ${meta?.badgeClass || ''}`}>{t(meta?.labelKey || '')}</span>
                </td>
                <td>{getDetails(c)}</td>
                <td>
                  <button onClick={() => handleDelete(c.id)} className="delete-btn">{t('delete')}</button>
                </td>
              </tr>
            );
          })}
          {displayed.length === 0 && (
            <tr>
              <td colSpan={3} className="empty-row">{constraints.length === 0 ? t('no_constraints') : t('no_results')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
