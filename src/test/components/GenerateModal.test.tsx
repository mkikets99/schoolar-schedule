import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { GenerateModal } from '../../ui/components/GenerateModal';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

const settings = { attempts: 20, maxSpillPasses: 4, optimizePasses: 8 };

const spinbuttons = () => screen.getAllByRole('spinbutton') as HTMLInputElement[];

describe('GenerateModal', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<GenerateModal open={false} settings={settings} onClose={() => {}} onGenerate={() => {}} />);
    expect(container.querySelector('.modal-overlay')).toBeNull();
  });

  it('pre-fills the current settings', () => {
    render(<GenerateModal open settings={{ attempts: 7, maxSpillPasses: 3, optimizePasses: 12 }} onClose={() => {}} onGenerate={() => {}} />);
    expect(spinbuttons()[0].value).toBe('7');
    expect(spinbuttons()[1].value).toBe('3');
    expect(spinbuttons()[2].value).toBe('12');
    expect(screen.getByText('generate_settings')).toBeDefined();
  });

  it('submits entered settings on Generate', () => {
    const onGenerate = vi.fn();
    render(<GenerateModal open settings={settings} onClose={() => {}} onGenerate={onGenerate} />);
    fireEvent.change(spinbuttons()[0], { target: { value: '5' } });
    fireEvent.change(spinbuttons()[1], { target: { value: '0' } });
    fireEvent.change(spinbuttons()[2], { target: { value: '3' } });
    fireEvent.click(screen.getByText('generate'));
    expect(onGenerate).toHaveBeenCalledWith({ attempts: 5, maxSpillPasses: 0, optimizePasses: 3 });
  });

  it('clamps out-of-range values', () => {
    const onGenerate = vi.fn();
    render(<GenerateModal open settings={settings} onClose={() => {}} onGenerate={onGenerate} />);
    fireEvent.change(spinbuttons()[0], { target: { value: '500' } });
    fireEvent.change(spinbuttons()[1], { target: { value: '-3' } });
    fireEvent.change(spinbuttons()[2], { target: { value: '999' } });
    fireEvent.click(screen.getByText('generate'));
    expect(onGenerate).toHaveBeenCalledWith({ attempts: 200, maxSpillPasses: 0, optimizePasses: 60 });
  });

  it('resets empty attempts to the minimum of 1', () => {
    const onGenerate = vi.fn();
    render(<GenerateModal open settings={settings} onClose={() => {}} onGenerate={onGenerate} />);
    fireEvent.change(spinbuttons()[0], { target: { value: '' } });
    fireEvent.click(screen.getByText('generate'));
    expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ attempts: 1 }));
  });

  it('closes without generating on Cancel', () => {
    const onClose = vi.fn();
    const onGenerate = vi.fn();
    render(<GenerateModal open settings={settings} onClose={onClose} onGenerate={onGenerate} />);
    fireEvent.click(screen.getByText('cancel'));
    expect(onClose).toHaveBeenCalled();
    expect(onGenerate).not.toHaveBeenCalled();
  });
});