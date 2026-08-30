import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, FormField } from './Modal';
import { GenerateSettings } from '../../shared/types';

interface GenerateModalProps {
  open: boolean;
  settings: GenerateSettings;
  onClose: () => void;
  onGenerate: (settings: GenerateSettings) => void;
}

export const GenerateModal = ({ open, settings, onClose, onGenerate }: GenerateModalProps) => {
  const { t } = useTranslation();
  const [attempts, setAttempts] = useState(settings.attempts);
  const [maxSpillPasses, setMaxSpillPasses] = useState(settings.maxSpillPasses);

  useEffect(() => {
    if (open) {
      setAttempts(settings.attempts);
      setMaxSpillPasses(settings.maxSpillPasses);
    }
  }, [open, settings]);

  const submit = () => {
    onGenerate({
      attempts: Math.max(1, Math.min(200, Math.floor(attempts || 1))),
      maxSpillPasses: Math.max(0, Math.min(20, Math.floor(maxSpillPasses || 0))),
    });
  };

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={t('generate_settings')}
      actions={
        <>
          <button onClick={onClose} className="secondary-btn">{t('cancel')}</button>
          <button onClick={submit} className="primary-btn">{t('generate')}</button>
        </>
      }
    >
      <p className="section-desc">{t('generate_settings_hint')}</p>
      <FormField label={t('generate_attempts')}>
        <input
          type="number"
          min={1}
          max={200}
          value={attempts}
          onChange={(e) => setAttempts(Number(e.target.value))}
        />
      </FormField>
      <p className="form-hint">{t('generate_attempts_hint')}</p>
      <FormField label={t('generate_max_spill_passes')}>
        <input
          type="number"
          min={0}
          max={20}
          value={maxSpillPasses}
          onChange={(e) => setMaxSpillPasses(Number(e.target.value))}
        />
      </FormField>
      <p className="form-hint">{t('generate_max_spill_passes_hint')}</p>
    </Modal>
  );
};