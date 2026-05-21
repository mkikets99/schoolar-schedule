import { ReactNode } from 'react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  actions?: ReactNode;
}

export const Modal = ({ isOpen, onClose, title, children, actions }: ModalProps) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </div>
        <div className="modal-body">
          {children}
        </div>
        {actions && (
          <div className="modal-footer">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
};

interface FormFieldProps {
  label: string;
  children: ReactNode;
  error?: string;
}

export const FormField = ({ label, children, error }: FormFieldProps) => {
  return (
    <div className="form-field">
      <label className="form-label">{label}</label>
      <div className="form-input-container">
        {children}
      </div>
      {error && <span className="form-error">{error}</span>}
    </div>
  );
};
