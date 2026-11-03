import { describe, expect, it } from 'vitest';
import { addNode, connect, removeNode } from '../../src/domain/graph/commands';
import { parseGraphDocument } from '../../src/domain/graph/schema';
import { validateGraph } from '../../src/domain/validation';
import { createBaselineGraph, TEMPLATES } from '../../src/data/templates';
import { ecommerceStarterTemplate } from '../../src/data/templates/ecommerce-starter';
import { buildWebStackFromBaseline, unwrap } from '../fixtures/builders';

/**
 * Template expansion and free construction are the same system with different initial graphs
 * (ADR 0001). These tests exercise both paths through identical commands and validation.
 */
describe('template and free construction share one graph model', () => {
  it('a graph built from the baseline matches the template semantically', () => {
    const built = buildWebStackFromBaseline().b.graph;
    const template = TEMPLATES['ecommerce-starter']();
    const signature = (g: typeof built) => ({
      nodes: Object.values(g.nodes)
        .map((n) => [n.id, n.serviceType, JSON.stringify(n.config)])
        .sort(),
      connections: Object.values(g.connections)
        .map((c) => [c.sourceNodeId, c.targetNodeId, c.connectionType, JSON.stringify(c.config)])
        .sort(),
    });
    expect(signature(built)).toEqual(signature(template));
    expect(validateGraph(built)).toEqual(validateGraph(template));
  });

  it('the same commands extend a template graph', () => {
    let g = TEMPLATES['ecommerce-starter']();
    const asg = unwrap(addNode(g, { serviceType: 'compute.autoscaling' }));
    g = asg.graph;
    for (const [target, type] of [
      ['subnet-3', 'placed_in'],
      ['subnet-4', 'placed_in'],
      ['sg-2', 'secured_by'],
    ] as const) {
      g = unwrap(connect(g, { sourceNodeId: asg.nodeId, targetNodeId: target, connectionType: type })).graph;
    }
    g = unwrap(
      connect(g, { sourceNodeId: 'alb-1', targetNodeId: asg.nodeId, connectionType: 'routes_to' }),
    ).graph;
    g = unwrap(
      connect(g, { sourceNodeId: asg.nodeId, targetNodeId: 'rds-1', connectionType: 'data_access' }),
    ).graph;
    g = unwrap(removeNode(g, 'ec2-1')).graph;
    const report = validateGraph(g);
    expect(report.findings).toEqual([]);
    expect(report.canSimulate).toBe(true);
  });

  it('a template can be torn down to the baseline', () => {
    let g = TEMPLATES['ecommerce-starter']();
    for (const id of Object.keys(g.nodes)) {
      if (id === 'internet-1') continue;
      g = unwrap(removeNode(g, id)).graph;
    }
    expect(g).toEqual(createBaselineGraph());
  });

  it('templates survive a JSON round-trip through the save schema', () => {
    const json = JSON.parse(JSON.stringify(ecommerceStarterTemplate));
    const parsed = parseGraphDocument(json);
    expect(parsed.ok).toBe(true);
    expect(parseGraphDocument({ schemaVersion: 2, nodes: {}, connections: {} }).ok).toBe(false);
  });
});
