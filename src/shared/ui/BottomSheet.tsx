import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './bottom-sheet.css';

export interface BottomSheetProps {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly initialSize?: 'half' | 'full';
  readonly footer?: ReactNode;
}

/** Non-modal bottom sheet. Expanding/collapsing uses a button, so no drag gesture is required. */
export function BottomSheet({
  title,
  subtitle,
  onClose,
  children,
  initialSize = 'half',
  footer,
}: BottomSheetProps) {
  const [size, setSize] = useState(initialSize);
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <section
      ref={ref}
      className={`bottom-sheet size-${size}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
    >
      <header className="sheet-header">
        <button
          type="button"
          className="sheet-grip"
          aria-label={size === 'half' ? 'シートを広げる' : 'シートを縮める'}
          onClick={() => setSize(size === 'half' ? 'full' : 'half')}
        />
        <div className="sheet-title-row">
          <div className="sheet-titles">
            <h2 id={titleId}>{title}</h2>
            {subtitle && <div className="sheet-subtitle">{subtitle}</div>}
          </div>
          <button type="button" className="icon-button sheet-close" aria-label="閉じる" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      <div className="sheet-body">{children}</div>
      {footer && <footer className="sheet-footer">{footer}</footer>}
    </section>
  );
}
