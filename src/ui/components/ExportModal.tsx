import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from './Modal';
import { ExportContext, ExportFormat, ExportReportType, exportReport } from '../services/ExportService';

const REPORT_TYPES: { id: ExportReportType; labelKey: string; descKey: string }[] = [
  { id: 'all', labelKey: 'report_all', descKey: 'report_all_desc' },
  { id: 'with_teachers', labelKey: 'report_with_teachers', descKey: 'report_with_teachers_desc' },
  { id: 'only_lessons', labelKey: 'report_only_lessons', descKey: 'report_only_lessons_desc' },
  { id: 'teacher_load', labelKey: 'report_teacher_load', descKey: 'report_teacher_load_desc' },
];

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  context: ExportContext;
}

export const ExportModal = ({ isOpen, onClose, context }: ExportModalProps) => {
  const { t } = useTranslation();
  const [reportType, setReportType] = useState<ExportReportType>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set(context.groupIds));
  const [format, setFormat] = useState<ExportFormat>('xlsx');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setSelected(new Set(context.groupIds));
      setBusy(false);
    }
  }, [isOpen, context.groupIds]);

  const groups = useMemo(
    () => [...context.groups].sort((a, b) => a.name.localeCompare(b.name)),
    [context.groups]
  );

  const toggleGroup = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleExport = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    try {
      await exportReport(reportType, format, { ...context, groupIds: [...selected] }, t);
    } finally {
      setBusy(false);
    }
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t('export_modal_title')}
      actions={
        <>
          <button className="secondary-btn" onClick={onClose} disabled={busy}>{t('cancel')}</button>
          <button className="primary-btn" onClick={handleExport} disabled={busy || selected.size === 0}>
            {busy ? t('exporting') : t('export_btn')}
          </button>
        </>
      }
    >
      <div className="form-field">
        <label className="form-label">{t('report_type')}</label>
        <div className="export-option-list">
          {REPORT_TYPES.map(rt => (
            <label key={rt.id} className={`export-option ${reportType === rt.id ? 'selected' : ''}`}>
              <input
                type="radio"
                name="report-type"
                checked={reportType === rt.id}
                onChange={() => setReportType(rt.id)}
              />
              <div>
                <div className="option-label">{t(rt.labelKey)}</div>
                <div className="option-desc">{t(rt.descKey)}</div>
              </div>
            </label>
          ))}
        </div>
        <div className="export-hint">{t('report_more')}</div>
      </div>

      <div className="form-field">
        <div className="export-toolbar">
          <label className="form-label" style={{ marginBottom: 0 }}>{t('select_classes')}</label>
          <div className="export-toolbar-actions">
            <button type="button" className="export-link-btn" onClick={() => setSelected(new Set(context.groupIds))}>{t('select_all')}</button>
            <button type="button" className="export-link-btn" onClick={() => setSelected(new Set())}>{t('clear_selection')}</button>
          </div>
        </div>
        <div className="export-checkbox-list">
          {groups.map(g => (
            <label key={g.id} className="export-checkbox-item">
              <input type="checkbox" checked={selected.has(g.id)} onChange={() => toggleGroup(g.id)} />
              {g.name}
            </label>
          ))}
        </div>
        <div className="export-count">{t('selected_count', { count: selected.size })}</div>
        {selected.size === 0 && <div className="export-warning">{t('select_at_least_one')}</div>}
      </div>

      <div className="form-field">
        <label className="form-label">{t('export_format')}</label>
        <div className="export-format-options">
          <label className="export-format-option">
            <input type="radio" name="export-format" checked={format === 'xlsx'} onChange={() => setFormat('xlsx')} />
            {t('format_xlsx')}
          </label>
          <label className="export-format-option">
            <input type="radio" name="export-format" checked={format === 'pdf'} onChange={() => setFormat('pdf')} />
            {t('format_pdf')}
          </label>
        </div>
      </div>
    </Modal>
  );
};
