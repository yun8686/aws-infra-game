import type { InfrastructureGraph } from '../graph/types';
import { dependencyFindings } from './dependencies';
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
export const validateGraph = (graph: InfrastructureGraph): ValidationReport => {
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
  ];
  return { findings, canSimulate: !hasErrors(findings) };
};
