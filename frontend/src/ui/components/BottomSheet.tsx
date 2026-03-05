import type { PropsWithChildren } from 'react';

interface BottomSheetProps extends PropsWithChildren {
  open: boolean;
  title: string;
  onClose: () => void;
}

export const BottomSheet = ({ open, title, onClose, children }: BottomSheetProps) => {
  if (!open) {
    return null;
  }

  return (
    <div className="bottom-sheet-overlay" role="presentation" onClick={onClose}>
      <section className="bottom-sheet" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <header className="bottom-sheet-header">
          <h3>{title}</h3>
        </header>
        <div className="bottom-sheet-content">{children}</div>
      </section>
    </div>
  );
};
