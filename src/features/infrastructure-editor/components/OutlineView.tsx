import { readConfig } from '../../../domain/catalog/catalog';
import { listNodes, nodesOfType, sourcesOf } from '../../../domain/graph/graph';
import type { InfrastructureGraph, NodeId } from '../../../domain/graph/types';
import { nodeLabel } from './EditorSheets';
import { partSummary } from '../summary';

/** List alternative to the diagram (PRODUCT_SPEC §12): VPC › subnet › resources, then the rest. */
export function OutlineView(props: {
  readonly graph: InfrastructureGraph;
  readonly selectedId: NodeId | undefined;
  readonly issues: Readonly<Record<NodeId, 'error' | 'warning'>>;
  readonly onSelect: (id: NodeId) => void;
}) {
  const { graph } = props;
  const shown = new Set<NodeId>();
  const summaryOf = (id: NodeId) => {
    const node = graph.nodes[id];
    if (!node) return '';
    // Whole-resource summary (a zonal part summary would show a per-AZ count).
    return partSummary(graph, id, { role: 'single' });
  };
  const item = (id: NodeId) => {
    shown.add(id);
    const issue = props.issues[id];
    return (
      <button
        type="button"
        className={`outline-item ${props.selectedId === id ? 'is-selected' : ''}`}
        aria-pressed={props.selectedId === id}
        onClick={() => props.onSelect(id)}
      >
        {nodeLabel(graph, id)}
        {summaryOf(id) && <span className="outline-meta"> {summaryOf(id)}</span>}
        {issue && (
          <span className={`issue-pill issue-${issue}`}>{issue === 'error' ? 'エラー' : '警告'}</span>
        )}
      </button>
    );
  };

  const vpcs = nodesOfType(graph, 'network.vpc');
  const tree = vpcs.map((vpc) => {
    const subnets = sourcesOf(graph, vpc.id, 'placed_in').filter((n) => n.serviceType === 'network.subnet');
    return (
      <li key={vpc.id}>
        {item(vpc.id)}
        <ul>
          {subnets.map((s) => {
            const cfg = readConfig(s, 'network.subnet');
            return (
              <li key={s.id}>
                {item(s.id)}
                <span className="outline-meta">
                  {cfg ? `${cfg.az} ・ ${cfg.tier === 'public' ? 'パブリック' : 'プライベート'}` : ''}
                </span>
                <ul>
                  {sourcesOf(graph, s.id, 'placed_in').map((r) => (
                    <li key={r.id}>{item(r.id)}</li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </li>
    );
  });
  // Render the tree first so `shown` is filled, then everything not yet listed.
  const rest = listNodes(graph).filter((n) => !shown.has(n.id) && n.serviceType !== 'network.vpc');

  return (
    <div className="outline-view">
      <ul>{tree}</ul>
      {rest.length > 0 && (
        <>
          <h3>その他</h3>
          <ul>
            {rest.map((n) => (
              <li key={n.id}>{item(n.id)}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
