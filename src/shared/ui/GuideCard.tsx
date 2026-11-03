import { useState, type ReactNode } from 'react';
import { dismissGuide, isGuideDismissed } from './preferences';

/** First-visit explanation of what to do on a screen. Dismissed once, per device. */
export function GuideCard({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  const [hidden, setHidden] = useState(() => isGuideDismissed(id));
  if (hidden) return null;
  return (
    <aside className="guide-card" aria-label={title}>
      <div className="guide-text">
        <strong>💡 {title}</strong>
        <div>{children}</div>
      </div>
      <button
        type="button"
        className="text-button"
        onClick={() => {
          dismissGuide(id);
          setHidden(true);
        }}
      >
        わかった
      </button>
    </aside>
  );
}
