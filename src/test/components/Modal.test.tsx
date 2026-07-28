import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Modal, FormField } from '../../ui/components/Modal';

describe('Modal', () => {
  it('renders with title and children', () => {
    render(
      <Modal isOpen={true} onClose={vi.fn()} title="Test Modal">
        <p>Modal content</p>
      </Modal>
    );

    expect(screen.getByText('Test Modal')).toBeInTheDocument();
    expect(screen.getByText('Modal content')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} title="Test">
        <p>Content</p>
      </Modal>
    );

    const closeButton = screen.getByRole('button');
    fireEvent.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when isOpen is false', () => {
    render(
      <Modal isOpen={false} onClose={vi.fn()} title="Hidden">
        <p>You should not see this</p>
      </Modal>
    );

    expect(screen.queryByText('Hidden')).not.toBeInTheDocument();
    expect(screen.queryByText('You should not see this')).not.toBeInTheDocument();
  });
});

describe('FormField', () => {
  it('renders label and input', () => {
    render(
      <FormField label="Name">
        <input data-testid="name-input" />
      </FormField>
    );

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByTestId('name-input')).toBeInTheDocument();
  });
});
