import type { Diagram } from '../../model';
import { frameTitle } from './labels';
import { breadcrumb } from './layout';

export interface BreadcrumbProps {
  readonly diagram: Diagram;
  readonly frameId: string | null;
  readonly onOpen: (frameId: string) => void;
}

/** AWS Cloud › リージョン › vpc › AZ › サブネット. Every level above the open frame is a button. */
export function Breadcrumb({ diagram, frameId, onOpen }: BreadcrumbProps) {
  const chain = breadcrumb(diagram, frameId);
  return (
    <nav className="breadcrumb" aria-label="表示中の枠">
      <ol>
        {chain.map((f, i) => {
          const last = i === chain.length - 1;
          const title = frameTitle(f.kind, f.name);
          return (
            <li key={f.id}>
              {last ? (
                <span aria-current="location">{title}</span>
              ) : (
                <button type="button" onClick={() => onOpen(f.id)}>
                  {title}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
