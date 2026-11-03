import { createEmptyGraph } from '../../domain/graph/graph';
import type { InfrastructureGraph } from '../../domain/graph/types';

/**
 * Minimal starting point for free-construction missions and sandbox:
 * only the system-managed Internet entry node (ADR 0010).
 */
export const createBaselineGraph = (): InfrastructureGraph => ({
  ...createEmptyGraph(),
  nodes: {
    'internet-1': { id: 'internet-1', serviceType: 'external.internet', name: 'Internet', config: {} },
  },
});
