import { useState } from 'react';
import { framesOfKind, regionOf, type Diagram } from '../../model';
import { Breadcrumb } from './Breadcrumb';
import { DiagramCanvas } from './DiagramCanvas';
import type { NodeMetricBadge } from '../monitoring/series';

/** Read-only diagram with its own drill-down, for monitoring (status badges per resource). */
export function DiagramViewer({
  diagram,
  badges,
  onSelect,
}: {
  readonly diagram: Diagram;
  readonly badges?: Readonly<Record<string, NodeMetricBadge>> | undefined;
  readonly onSelect: (resourceId: string) => void;
}) {
  const [frameId, setFrameId] = useState<string | null>(
    () => framesOfKind(diagram, 'vpc')[0]?.id ?? regionOf(diagram)?.id ?? null,
  );
  const open = frameId && diagram.frames[frameId] ? frameId : (regionOf(diagram)?.id ?? null);
  return (
    <div className="diagram-viewer">
      <Breadcrumb diagram={diagram} frameId={open} onOpen={setFrameId} />
      <DiagramCanvas
        diagram={diagram}
        frameId={open}
        badges={badges}
        onOpenFrame={setFrameId}
        onSelect={onSelect}
      />
    </div>
  );
}

export const resourceName = (d: Diagram, id: string): string => d.resources[id]?.name ?? id;
