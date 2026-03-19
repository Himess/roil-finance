import { useEffect, useRef } from 'react';
import clsx from 'clsx';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  // Auto-focus cancel button on open
  useEffect(() => {
    if (isOpen) {
      // Small delay to allow the animation to start
      requestAnimationFrame(() => cancelRef.current?.focus());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/30" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative bg-white border border-surface-border rounded-xl p-6 max-w-sm w-full mx-4 shadow-xl animate-dialog-in"
      >
        <h3 id="confirm-dialog-title" className="text-xl font-semibold text-ink mb-2">{title}</h3>
        <p className="text-base text-ink-secondary mb-6">{message}</p>
        <div className="flex gap-3 justify-end">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-4 py-2 text-base text-ink-secondary hover:text-ink transition"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={clsx('px-4 py-2 text-base rounded-lg font-medium transition',
              variant === 'danger' ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-amber-600 hover:bg-amber-700 text-white'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
