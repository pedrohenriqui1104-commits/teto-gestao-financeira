import { useEffect } from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  tone = 'danger',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onCancel();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onCancel]);

  if (!open) return null;

  const isDanger = tone === 'danger';

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-sm max-h-[90vh] overflow-y-auto bg-dark-surface-variant border border-dark-outline rounded-xl p-5 space-y-4 shadow-2xl">
        <div className="flex items-start gap-3">
          <div
            className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
              isDanger ? 'bg-error/15 text-error' : 'bg-warning/15 text-warning'
            }`}
          >
            <span className="material-symbols-outlined text-xl">
              {isDanger ? 'warning' : 'help'}
            </span>
          </div>
          <div className="flex-1">
            <h3
              id="confirm-dialog-title"
              className="font-headline text-headline-sm text-dark-on-surface font-bold leading-snug"
            >
              {title}
            </h3>
            <p className="text-xs text-dark-on-surface-variant mt-1.5 leading-relaxed">
              {description}
            </p>
          </div>
        </div>

        <div className="flex gap-2.5 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 px-3 rounded-DEFAULT bg-dark-surface border border-dark-outline text-xs text-dark-on-surface font-semibold hover:border-dark-on-surface-variant transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`flex-1 py-2.5 px-3 rounded-DEFAULT text-xs font-bold transition-colors ${
              isDanger
                ? 'bg-error text-white hover:bg-primary'
                : 'bg-warning text-on-warning hover:opacity-90'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
