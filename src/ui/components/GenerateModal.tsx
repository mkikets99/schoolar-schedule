import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, FormField } from './Modal';
import { GenerateSettings, GenerationMode } from '../../shared/types';

interface GenerateModalProps {
  open: boolean;
  settings: GenerateSettings;
  onClose: () => void;
  onGenerate: (settings: GenerateSettings) => void;
}

export const GenerateModal = ({ open, settings, onClose, onGenerate }: GenerateModalProps) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<GenerationMode>(settings.mode ?? 'runs');
  const [attempts, setAttempts] = useState(settings.attempts);
  const [generationTimeMs, setGenerationTimeMs] = useState(settings.generationTimeMs ?? 20000);
  const [maxSpillPasses, setMaxSpillPasses] = useState(settings.maxSpillPasses);
  const [optimizePasses, setOptimizePasses] = useState(settings.optimizePasses ?? 8);

  useEffect(() => {
    if (open) {
      setMode(settings.mode ?? 'runs');
      setAttempts(settings.attempts);
      setGenerationTimeMs(settings.generationTimeMs ?? 20000);
      setMaxSpillPasses(settings.maxSpillPasses);
      setOptimizePasses(settings.optimizePasses ?? 8);
    }
  }, [open, settings]);

  // Values ≤ the special marker -1 mean "Unlimited" and pass through untouched;
  // any positive number is floored to its natural minimum to reject nonsense.
  const normalize = (v: number, floor: number) => v === -1 ? -1 : Math.max(floor, Math.floor(v));

  const submit = () => {
    onGenerate({
      mode,
      attempts: normalize(attempts, 1),
      generationTimeMs: normalize(generationTimeMs, 250),
      maxSpillPasses: normalize(maxSpillPasses, 0),
      optimizePasses: normalize(optimizePasses, 0),
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

      <FormField label={t('generate_mode')}>
        <div style={{ display: 'flex', gap: '1rem' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <input
              type="radio"
              name="gen-mode"
              checked={mode === 'runs'}
              onChange={() => setMode('runs')}
            />
            {t('generate_mode_runs')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
            <input
              type="radio"
              name="gen-mode"
              checked={mode === 'time'}
              onChange={() => setMode('time')}
            />
            {t('generate_mode_time')}
          </label>
        </div>
      </FormField>
      <p className="form-hint">{t('generate_mode_hint')}</p>

      {mode === 'runs' ? (
        <>
          <FormField label={t('generate_attempts')}>
            <input
              type="number"
              min={-1}
              value={attempts}
              onChange={(e) => setAttempts(Number(e.target.value))}
            />
            {attempts === -1 && <span className="unlimited-badge">{t('unlimited')}</span>}
          </FormField>
          <p className="form-hint">{t('generate_attempts_hint')}</p>
        </>
      ) : (
        <>
          <FormField label={t('generate_time_ms')}>
            <input
              type="number"
              min={-1}
              value={generationTimeMs}
              onChange={(e) => setGenerationTimeMs(Number(e.target.value))}
            />
            {generationTimeMs === -1 && <span className="unlimited-badge">{t('unlimited')}</span>}
          </FormField>
          <p className="form-hint">{t('generate_time_ms_hint')}</p>
        </>
      )}

      <FormField label={t('generate_max_spill_passes')}>
        <input
          type="number"
          min={-1}
          value={maxSpillPasses}
          onChange={(e) => setMaxSpillPasses(Number(e.target.value))}
        />
        {maxSpillPasses === -1 && <span className="unlimited-badge">{t('unlimited')}</span>}
      </FormField>
      <p className="form-hint">{t('generate_max_spill_passes_hint')}</p>
      <FormField label={t('generate_optimize_passes')}>
        <input
          type="number"
          min={-1}
          value={optimizePasses}
          onChange={(e) => setOptimizePasses(Number(e.target.value))}
        />
        {optimizePasses === -1 && <span className="unlimited-badge">{t('unlimited')}</span>}
      </FormField>
      <p className="form-hint">{t('generate_optimize_passes_hint')}</p>
    </Modal>
  );
};