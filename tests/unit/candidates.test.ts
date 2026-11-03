import { describe, expect, it } from 'vitest';
import { connectionCandidates } from '../../src/domain/graph/candidates';
import { TEMPLATES } from '../../src/data/templates';
import { addNode } from '../../src/domain/graph/commands';
import { unwrap } from '../fixtures/builders';

const byId = (cs: ReturnType<typeof connectionCandidates>) =>
  Object.fromEntries(cs.map((c) => [c.nodeId, c]));

describe('connectionCandidates', () => {
  it('offers valid targets in either tap order and explains the rest', () => {
    const add = unwrap(addNode(TEMPLATES['ecommerce-starter'](), { serviceType: 'compute.autoscaling' }));
    const c = byId(connectionCandidates(add.graph, add.nodeId));
    expect(c['subnet-3']?.options).toEqual([
      { sourceNodeId: add.nodeId, targetNodeId: 'subnet-3', connectionType: 'placed_in' },
    ]);
    // Reverse direction: ALB → ASG is offered when the ASG is selected first.
    expect(c['alb-1']?.options).toEqual([
      { sourceNodeId: 'alb-1', targetNodeId: add.nodeId, connectionType: 'routes_to' },
    ]);
    expect(c['rds-1']?.options[0]?.connectionType).toBe('data_access');
    // Not allowed at all.
    expect(c['internet-1']?.options).toEqual([]);
    expect(c['internet-1']?.reasons[0]?.code).toBe('connection.not_allowed');
    // Allowed by type but rejected by rules (VPC has no placement relation with an ASG).
    expect(c['vpc-1']?.reasons[0]?.code).toBe('connection.not_allowed');
  });

  it('reports rule violations such as duplicates', () => {
    const c = byId(connectionCandidates(TEMPLATES['ecommerce-starter'](), 'ec2-1'));
    expect(c['rds-1']?.options).toEqual([]);
    expect(c['rds-1']?.reasons.map((r) => r.code)).toEqual(['connection.duplicate']);
  });

  it('can be restricted to one connection type (placement step)', () => {
    const add = unwrap(addNode(TEMPLATES['ecommerce-starter'](), { serviceType: 'database.rds' }));
    const valid = connectionCandidates(add.graph, add.nodeId, {}, 'placed_in')
      .filter((c) => c.options.length > 0)
      .map((c) => c.nodeId);
    expect(valid).toEqual(['subnet-1', 'subnet-2', 'subnet-3', 'subnet-4']);
  });
});
