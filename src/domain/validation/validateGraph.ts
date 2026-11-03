import type { InfrastructureGraph } from '../graph/types';
import type { AppId } from '../catalog/apps';
import { appCoverageFindings, dependencyFindings } from './dependencies';
import { hasErrors, type Finding } from './findings';
import { duplicateFindings, placementFindings } from './placement';
import { securityFindings } from './security';
import { structureFindings } from './structure';

export interface ValidationReport {
  readonly findings: readonly Finding[];
  /** False when any error-severity finding exists. */
  readonly canSimulate: boolean;
}

/**
 * Validates any infrastructure graph — template-based, blank, or sandbox — with the same rules.
 * Output order is deterministic.
 */
export interface ValidationContext {
  /** Applications the mission needs served (ADR 0016). */
  readonly requiredApps?: readonly AppId[];
}

export const validateGraph = (
  graph: InfrastructureGraph,
  context: ValidationContext = {},
): ValidationReport => {
  const structural = structureFindings(graph);
  // Semantic rules assume a structurally sound graph; stop early to avoid noisy cascades.
  if (hasErrors(structural.filter((f) => f.category === 'structure'))) {
    return { findings: structural, canSimulate: false };
  }
  const findings = [
    ...structural,
    ...duplicateFindings(graph),
    ...placementFindings(graph),
    ...dependencyFindings(graph),
    ...securityFindings(graph),
    ...appCoverageFindings(graph, context.requiredApps ?? []),
  ];
  return { findings, canSimulate: !hasErrors(findings) };
};
