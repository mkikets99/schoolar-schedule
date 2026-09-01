import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Constraint, ConstraintKind, autoMaxPerDay } from '../../shared/types';
import { useProject } from '../context/ProjectContext';
import { Modal, FormField } from './Modal';
import { useTableControls, TableSearch, SortableTh } from './TableControls';
import { SearchableSelect } from './SearchableSelect';
import { MultiSelect } from './MultiSelect';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
const ALL_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

const KIND_KEYS: Record<ConstraintKind, { labelKey: string; badgeClass: string }> = {
  TEACHER_BUSY: { labelKey: 'teacher_busy', badgeClass: 'teacher-busy' },
  NO_FIRST_PERIOD: { labelKey: 'no_first_period', badgeClass: 'no-first' },
  FORBID_LESSON: { labelKey: 'forbid_lesson', badgeClass: 'forbid-lesson' },
  MAX_DAILY_LESSONS: { labelKey: 'max_daily_lessons', badgeClass: 'max-daily' },
};

export const ConstraintEditor = () => {
  const { t } = useTranslation();
  const { project, updateConstraints } = useProject();
  const constraints = project?.constraints || [];
  const teachers = project?.teachers || [];
  const subjects = project?.subjects || [];
  const groups = project?.groups || [];
  const rooms = project?.rooms || [];
  const loadTeacherIds = [...new Set((project?.loadDistribution || []).map(l => l.teacherId))];

  const [busyOpen, setBusyOpen] = useState(false);
  const [firstOpen, setFirstOpen] = useState(false);
  const [forbidOpen, setForbidOpen] = useState(false);
  const [maxDailyOpen, setMaxDailyOpen] = useState(false);
  const [kindFilter, setKindFilter] = useState('');

  const [busyTeacherId, setBusyTeacherId] = useState('');
  const [busyDay, setBusyDay] = useState('*');
  const [busyPeriods, setBusyPeriods] = useState<Set<number>>(new Set());

  const [firstSubjectId, setFirstSubjectId] = useState('');
  const [firstGroupId, setFirstGroupId] = useState('');

  const [forbidRuleIds, setForbidRuleIds] = useState<string[]>([]);
  const [forbidSemester, setForbidSemester] = useState<1 | 2>(1);
  const [forbidHours, setForbidHours] = useState(0);
  const [maxDailyRuleIds, setMaxDailyRuleIds] = useState<string[]>([]);
  const [maxDailyPerDay, setMaxDailyPerDay] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);

  const teacherName = (id?: string) => (id ? teachers.find(x => x.id === id)?.name || id : '');
  const subjectName = (id?: string) => (id ? subjects.find(x => x.id === id)?.name || id : '');
  const groupName = (id?: string) => (id ? groups.find(x => x.id === id)?.name || '' : '');
  const roomName = (id?: string) => (id ? rooms.find(x => x.id === id)?.name || id : '');
  const ruleLabel = (ruleId?: string) => {
    const rule = (project?.curriculum || []).find(r => r.id === ruleId);
    if (!rule) return ruleId || '';
    // Split rules share the same group + subject, distinguished only by their
    // per-subgroup teacher/room; append them so the label - and any selector -
    // never shows duplicate entries.
    const teacher = rule.teacherId ? ` · ${teacherName(rule.teacherId)}` : '';
    const room = rule.roomId ? ` · @${roomName(rule.roomId)}` : '';
    return `${subjectName(rule.subjectId)} · ${groupName(rule.groupId)}${teacher}${room}`;
  };

  const dayLabel = (day: string) => (day === '*' ? t('every_day') : t(day.toLowerCase()));
  const periodsLabel = (periods: number[]) => periods.slice().sort((a, b) => a - b).join(', ');

  const getDetails = (c: Constraint): string => {
    if (c.kind === 'TEACHER_BUSY') {
      return `${teacherName(c.teacherId)} — ${dayLabel(c.day || '*')}: ${periodsLabel(c.periods || [])}`;
    }
    if (c.kind === 'FORBID_LESSON') {
      return `${ruleLabel(c.ruleId)} — ${t(c.semester === 2 ? 'semester_2' : 'semester_1')}: ${c.hours ?? 0} ${t('hrs_wk')}`;
    }
    if (c.kind === 'MAX_DAILY_LESSONS') {
      return `${ruleLabel(c.ruleId)} — ${t('at_most')} ${c.maxPerDay ?? 1} ${t(c.maxPerDay === 1 ? 'lesson_per_day' : 'lessons_per_day')}`;
    }
    const scope = c.groupId ? `${groupName(c.groupId)} · ` : '';
    return `${scope}${subjectName(c.subjectId)} — ${t('cannot_be_first_period')}`;
  };

  const sameConstraint = (a: Constraint, b: Constraint): boolean => {
    if (a.kind !== b.kind) return false;
    if (a.kind === 'TEACHER_BUSY') {
      const ap = new Set(a.periods || []);
      const bp = new Set(b.periods || []);
      return a.teacherId === b.teacherId && (a.day || '*') === (b.day || '*') &&
        ap.size === bp.size && [...ap].every(p => bp.has(p));
    }
    if (a.kind === 'NO_FIRST_PERIOD') {
      return a.subjectId === b.subjectId && (a.groupId || '') === (b.groupId || '');
    }
    if (a.kind === 'FORBID_LESSON') {
      return a.ruleId === b.ruleId && a.semester === b.semester;
    }
    return a.ruleId === b.ruleId && a.maxPerDay === b.maxPerDay;
  };

  const findDuplicateConstraint = (draft: Constraint, ignoreId?: string): Constraint | undefined =>
    constraints.find(c => c.id !== ignoreId && sameConstraint(c, draft));

  const openEdit = (c: Constraint) => {
    setEditId(c.id);
    if (c.kind === 'TEACHER_BUSY') {
      setBusyTeacherId(c.teacherId || '');
      setBusyDay(c.day || '*');
      setBusyPeriods(new Set(c.periods || []));
      setBusyOpen(true);
    } else if (c.kind === 'NO_FIRST_PERIOD') {
      setFirstSubjectId(c.subjectId || '');
      setFirstGroupId(c.groupId || '');
      setFirstOpen(true);
    } else if (c.kind === 'MAX_DAILY_LESSONS') {
      setMaxDailyRuleIds(c.ruleId ? [c.ruleId] : []);
      setMaxDailyPerDay(c.maxPerDay ?? 1);
      setMaxDailyOpen(true);
    } else {
      setForbidRuleIds(c.ruleId ? [c.ruleId] : []);
      setForbidSemester(c.semester || 1);
      setForbidHours(c.hours ?? 0);
      setForbidOpen(true);
    }
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
    const draft: Constraint = {
      id: editId || crypto.randomUUID(),
      kind: 'TEACHER_BUSY',
      teacherId: busyTeacherId,
      day: busyDay,
      periods: [...busyPeriods],
    };
    if (findDuplicateConstraint(draft, editId ?? undefined)) { alert(t('duplicate_constraint')); return; }
    if (editId) {
      updateConstraints(constraints.map(c => c.id === editId ? { ...draft, id: editId } : c));
    } else {
      updateConstraints([...constraints, draft]);
    }
    setBusyTeacherId('');
    setBusyDay('*');
    setBusyPeriods(new Set());
    setEditId(null);
    setBusyOpen(false);
  };

  const handleAddFirst = () => {
    if (!firstSubjectId) { alert(t('need_subject')); return; }
    const draft: Constraint = {
      id: editId || crypto.randomUUID(),
      kind: 'NO_FIRST_PERIOD',
      subjectId: firstSubjectId,
      groupId: firstGroupId || undefined,
    };
    if (findDuplicateConstraint(draft, editId ?? undefined)) { alert(t('duplicate_constraint')); return; }
    if (editId) {
      updateConstraints(constraints.map(c => c.id === editId ? { ...draft, id: editId } : c));
    } else {
      updateConstraints([...constraints, draft]);
    }
    setFirstSubjectId('');
    setFirstGroupId('');
    setEditId(null);
    setFirstOpen(false);
  };

  const handleAddForbid = () => {
    if (forbidRuleIds.length === 0) { alert(t('need_rule')); return; }
    const hours = Math.max(0, Math.floor(forbidHours || 0));
    // In edit mode the edited row is re-scoped to the newly selected rules.
    const base = editId ? constraints.filter(c => c.id !== editId) : constraints;

    const byKey = new Map<string, Constraint>();
    for (const c of base) {
      if (c.kind === 'FORBID_LESSON' && c.ruleId) byKey.set(`${c.ruleId}|${c.semester}`, { ...c });
    }

    let changed = 0;
    for (const ruleId of forbidRuleIds) {
      const key = `${ruleId}|${forbidSemester}`;
      const existing = byKey.get(key);
      if (existing) {
        if (existing.hours !== hours) {
          byKey.set(key, { ...existing, hours });
          changed++;
        }
      } else {
        byKey.set(key, {
          id: crypto.randomUUID(),
          kind: 'FORBID_LESSON',
          ruleId,
          semester: forbidSemester,
          hours,
        });
        changed++;
      }
    }

    if (!editId && changed === 0) { alert(t('duplicate_constraint')); return; }

    const result: Constraint[] = [];
    for (const c of base) {
      if (c.kind !== 'FORBID_LESSON' || !c.ruleId) { result.push(c); continue; }
      const key = `${c.ruleId}|${c.semester}`;
      const merged = byKey.get(key);
      if (merged) { byKey.delete(key); result.push(merged); }
      else result.push(c);
    }
    for (const c of byKey.values()) result.push(c);

    updateConstraints(result);
    setForbidRuleIds([]);
    setForbidSemester(1);
    setForbidHours(0);
    setEditId(null);
    setForbidOpen(false);
  };

  const handleAddMaxDaily = () => {
    if (maxDailyRuleIds.length === 0) { alert(t('need_rule')); return; }
    const perDay = Math.max(1, Math.floor(maxDailyPerDay || 0));
    // In edit mode the edited row is re-scoped to the newly selected rules.
    const base = editId ? constraints.filter(c => c.id !== editId) : constraints;

    const byKey = new Map<string, Constraint>();
    for (const c of base) {
      if (c.kind === 'MAX_DAILY_LESSONS' && c.ruleId) byKey.set(c.ruleId, { ...c });
    }

    let changed = 0;
    for (const ruleId of maxDailyRuleIds) {
      const existing = byKey.get(ruleId);
      if (existing) {
        if (existing.maxPerDay !== perDay) {
          byKey.set(ruleId, { ...existing, maxPerDay: perDay });
          changed++;
        }
      } else {
        byKey.set(ruleId, {
          id: crypto.randomUUID(),
          kind: 'MAX_DAILY_LESSONS',
          ruleId,
          maxPerDay: perDay,
        });
        changed++;
      }
    }

    if (!editId && changed === 0) { alert(t('duplicate_constraint')); return; }

    const result: Constraint[] = [];
    for (const c of base) {
      if (c.kind !== 'MAX_DAILY_LESSONS' || !c.ruleId) { result.push(c); continue; }
      const merged = byKey.get(c.ruleId);
      if (merged) { byKey.delete(c.ruleId); result.push(merged); }
      else result.push(c);
    }
    for (const c of byKey.values()) result.push(c);

    updateConstraints(result);
    setMaxDailyRuleIds([]);
    setMaxDailyPerDay(1);
    setEditId(null);
    setMaxDailyOpen(false);
  };

  const handleDelete = (id: string) => {
    if (confirm(t('confirm_delete_constraint'))) {
      updateConstraints(constraints.filter(c => c.id !== id));
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allDisplayedSelected = displayed.length > 0 && displayed.every(c => selectedIds.has(c.id));

  const toggleSelectAll = () => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (allDisplayedSelected) {
        displayed.forEach(c => next.delete(c.id));
      } else {
        displayed.forEach(c => next.add(c.id));
      }
      return next;
    });
  };

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    if (confirm(t('confirm_delete_selected_constraint', { count: selectedIds.size }))) {
      updateConstraints(constraints.filter(c => !selectedIds.has(c.id)));
      setSelectedIds(new Set());
    }
  };

  const handleDeleteAll = () => {
    if (constraints.length === 0) return;
    if (confirm(t('confirm_delete_all_constraint', { count: constraints.length }))) {
      updateConstraints([]);
      setSelectedIds(new Set());
    }
  };

  const canAdd = teachers.length > 0 || subjects.length > 0;

  const explicitMaxDailyIds = new Set(
    (project?.constraints || [])
      .filter(c => c.kind === 'MAX_DAILY_LESSONS' && c.ruleId)
      .map(c => c.ruleId!)
  );
  const autoLimits = (project?.curriculum || [])
    .map(rule => ({
      rule,
      cap: autoMaxPerDay(rule, project?.loadDistribution || []),
      overridden: explicitMaxDailyIds.has(rule.id),
    }))
    .filter(x => x.cap !== undefined);

  return (
    <div className="entity-editor">
      <div className="view-header">
        <h2>{t('constraints')}</h2>
        <div className="header-actions" style={{ display: 'flex', gap: '0.5rem' }}>
          {constraints.length > 0 && (
            <>
              <button
                onClick={handleDeleteSelected}
                disabled={selectedIds.size === 0}
                className="delete-btn"
              >
                {t('delete_selected')}{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
              </button>
              <button onClick={handleDeleteAll} className="delete-btn">{t('delete_all')}</button>
            </>
          )}
          <button onClick={() => { setEditId(null); setBusyOpen(true); }} className="secondary-btn" disabled={teachers.length === 0}>{t('add_teacher_busy')}</button>
          <button onClick={() => { setEditId(null); setFirstOpen(true); }} className="primary-btn" disabled={subjects.length === 0}>{t('add_no_first_period')}</button>
          <button onClick={() => { setEditId(null); setForbidOpen(true); }} className="secondary-btn" disabled={(project?.curriculum.length || 0) === 0}>{t('add_forbid_lesson')}</button>
          <button onClick={() => { setEditId(null); setMaxDailyOpen(true); }} className="secondary-btn" disabled={(project?.curriculum.length || 0) === 0}>{t('add_max_daily')}</button>
        </div>
      </div>

      <p className="section-desc">{t('constraints_desc')}</p>
      <p className="section-desc">{t('constraints_affect_gen')}</p>

      {autoLimits.length > 0 && (
        <div className="auto-limits-panel">
          <h3 className="auto-limits-title">{t('auto_daily_limits')}</h3>
          <p className="section-desc">{t('auto_daily_limits_desc')}</p>
          <ul className="auto-limits-list">
            {autoLimits.map(({ rule, cap, overridden }) => (
              <li key={rule.id} className={`auto-limits-row${overridden ? ' overridden' : ''}`}>
                <span className="auto-limits-label">{ruleLabel(rule.id)}</span>
                <span className="auto-limits-value">
                  {t('at_most')} {cap} {t(cap === 1 ? 'lesson_per_day' : 'lessons_per_day')}
                </span>
                {overridden && <span className="constraint-badge max-daily">{t('auto_limit_overridden')}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!canAdd && <p className="empty-hint">{t('no_teachers_no_subjects')}</p>}

      <Modal
        isOpen={busyOpen}
        onClose={() => setBusyOpen(false)}
        title={t('add_teacher_busy')}
        actions={
          <>
            <button onClick={() => setBusyOpen(false)} className="secondary-btn">{t('cancel')}</button>
            <button onClick={handleAddBusy} className="primary-btn">{editId ? t('save') : t('create')}</button>
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
            <button onClick={handleAddFirst} className="primary-btn">{editId ? t('save') : t('create')}</button>
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

      <Modal
        isOpen={forbidOpen}
        onClose={() => setForbidOpen(false)}
        title={t('add_forbid_lesson')}
        actions={
          <>
            <button onClick={() => setForbidOpen(false)} className="secondary-btn">{t('cancel')}</button>
            <button onClick={handleAddForbid} className="primary-btn">{editId ? t('save') : t('create')}</button>
          </>
        }
      >
        <p className="section-desc">{t('forbid_lesson_hint')}</p>
        <FormField label={t('lesson')}>
          <MultiSelect
            value={forbidRuleIds}
            onChange={setForbidRuleIds}
            options={(project?.curriculum || []).map(r => ({ value: r.id, label: ruleLabel(r.id) }))}
            placeholder={t('select_rule')}
          />
        </FormField>
        <FormField label={t('semester')}>
          <select value={forbidSemester} onChange={(e) => setForbidSemester(Number(e.target.value) as 1 | 2)}>
            <option value={1}>{t('semester_1')}</option>
            <option value={2}>{t('semester_2')}</option>
          </select>
        </FormField>
        <FormField label={t('hours')}>
          <input
            type="number"
            min={0}
            value={forbidHours}
            onChange={(e) => setForbidHours(Number(e.target.value))}
          />
        </FormField>
      </Modal>

      <Modal
        isOpen={maxDailyOpen}
        onClose={() => setMaxDailyOpen(false)}
        title={t('add_max_daily')}
        actions={
          <>
            <button onClick={() => setMaxDailyOpen(false)} className="secondary-btn">{t('cancel')}</button>
            <button onClick={handleAddMaxDaily} className="primary-btn">{editId ? t('save') : t('create')}</button>
          </>
        }
      >
        <p className="section-desc">{t('max_daily_hint')}</p>
        <FormField label={t('lesson')}>
          <MultiSelect
            value={maxDailyRuleIds}
            onChange={setMaxDailyRuleIds}
            options={(project?.curriculum || []).map(r => ({ value: r.id, label: ruleLabel(r.id) }))}
            placeholder={t('select_rule')}
          />
        </FormField>
        <FormField label={t('max_per_day')}>
          <input
            type="number"
            min={1}
            value={maxDailyPerDay}
            onChange={(e) => setMaxDailyPerDay(Number(e.target.value))}
          />
        </FormField>
      </Modal>

      <div className="table-toolbar">
        <TableSearch value={query} onChange={setQuery} placeholder={t('search_placeholder')} />
        <select className="table-filter" value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
          <option value="">{t('all')}</option>
          <option value="TEACHER_BUSY">{t('teacher_busy')}</option>
          <option value="NO_FIRST_PERIOD">{t('no_first_period')}</option>
          <option value="FORBID_LESSON">{t('forbid_lesson')}</option>
          <option value="MAX_DAILY_LESSONS">{t('max_daily_lessons')}</option>
        </select>
        <span className="table-count">{t('showing_count', { shown, total })}</span>
      </div>

      <table className="editor-table">
        <thead>
          <tr>
            <th style={{ width: '40px' }}>
              <input
                type="checkbox"
                checked={allDisplayedSelected}
                onChange={toggleSelectAll}
                disabled={displayed.length === 0}
                title={t('select_all_displayed')}
              />
            </th>
            <th style={{ width: '40px' }}>#</th>
            <SortableTh label={t('constraint_type')} sortKey="kind" sort={sort} onSort={toggleSort} style={{ width: '180px' }} />
            <SortableTh label={t('details')} sortKey="details" sort={sort} onSort={toggleSort} />
            <th style={{ width: '130px' }}>{t('actions')}</th>
          </tr>
        </thead>
        <tbody>
          {displayed.map((c, index) => {
            const meta = KIND_KEYS[c.kind];
            return (
              <tr key={c.id} className={selectedIds.has(c.id) ? 'selected-row' : ''}>
                <td>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(c.id)}
                    onChange={() => toggleSelect(c.id)}
                  />
                </td>
                <td>{index + 1}</td>
                <td>
                  <span className={`constraint-badge ${meta?.badgeClass || ''}`}>{t(meta?.labelKey || '')}</span>
                </td>
                <td>{getDetails(c)}</td>
                <td>
                  <button onClick={() => openEdit(c)} className="secondary-btn">{t('mode_edit')}</button>
                  <button onClick={() => handleDelete(c.id)} className="delete-btn">{t('delete')}</button>
                </td>
              </tr>
            );
          })}
          {displayed.length === 0 && (
            <tr>
              <td colSpan={5} className="empty-row">{constraints.length === 0 ? t('no_constraints') : t('no_results')}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};
