import { describe, expect, it } from 'vitest';
import {
  addNode,
  checkConnect,
  connect,
  disconnect,
  duplicateNode,
  removeNode,
  renameNode,
  updateConnectionConfig,
  updateNodeConfig,
} from '../../src/domain/graph/commands';
import { createEmptyGraph } from '../../src/domain/graph/graph';
import { createBaselineGraph } from '../../src/data/templates';
import { buildWebStackFromBaseline, codes, GraphBuilder, unwrap } from '../fixtures/builders';

describe('addNode', () => {
  it('adds a node with default config and a deterministic id', () => {
    const g0 = createEmptyGraph();
    const r1 = unwrap(addNode(g0, { serviceType: 'compute.ec2' }));
    const r2 = unwrap(addNode(r1.graph, { serviceType: 'compute.ec2' }));
    expect(r1.nodeId).toBe('ec2-1');
    expect(r2.nodeId).toBe('ec2-2');
    expect(r2.graph.nodes['ec2-1']?.config).toEqual({ instanceSize: 'small', apps: ['shop'] });
    expect(Object.keys(g0.nodes)).toHaveLength(0); // input is not mutated
  });

  it('rejects unknown services, invalid config and system-managed services', () => {
    const g = createBaselineGraph();
    const unknown = addNode(g, { serviceType: 'compute.lambda' });
    const invalid = addNode(g, {
      serviceType: 'compute.ec2',
      config: { instanceSize: 'huge' },
    });
    const system = addNode(g, { serviceType: 'external.internet' });
    expect(!unknown.ok && codes(unknown.error)).toEqual(['node.unknown_service']);
    expect(!invalid.ok && invalid.error[0]).toMatchObject({
      code: 'node.invalid_config',
      params: { field: 'instanceSize' },
    });
    expect(!system.ok && codes(system.error)).toEqual(['edit.system_managed']);
  });

  it('enforces the mission allow-list and per-graph maximums', () => {
    const g = createBaselineGraph();
    const blocked = addNode(g, { serviceType: 'database.rds' }, { allowedServiceTypes: ['compute.ec2'] });
    expect(!blocked.ok && codes(blocked.error)).toEqual(['edit.service_not_allowed']);
    const withCw = unwrap(addNode(g, { serviceType: 'monitoring.cloudwatch' })).graph;
    const second = addNode(withCw, { serviceType: 'monitoring.cloudwatch' });
    expect(!second.ok && codes(second.error)).toEqual(['graph.max_per_graph']);
  });
});

describe('connect', () => {
  it('creates an allowed connection with default config', () => {
    const b = new GraphBuilder();
    const ec2 = b.add('compute.ec2');
    const db = b.add('database.rds');
    const id = b.link(ec2, db, 'data_access');
    expect(b.graph.connections[id]).toMatchObject({
      connectionType: 'data_access',
      config: { poolSize: 10 },
    });
  });

  it('rejects disallowed pairs, self-loops, duplicates and missing nodes with explanations', () => {
    const b = new GraphBuilder();
    const ec2 = b.add('compute.ec2');
    const db = b.add('database.rds');
    b.link(ec2, db, 'data_access');
    expect(
      codes(checkConnect(b.graph, { sourceNodeId: db, targetNodeId: ec2, connectionType: 'data_access' })),
    ).toEqual(['connection.not_allowed']);
    expect(
      codes(checkConnect(b.graph, { sourceNodeId: ec2, targetNodeId: ec2, connectionType: 'routes_to' })),
    ).toEqual(['connection.self_loop']);
    expect(
      codes(checkConnect(b.graph, { sourceNodeId: ec2, targetNodeId: db, connectionType: 'data_access' })),
    ).toEqual(['connection.duplicate']);
    expect(
      codes(
        checkConnect(b.graph, { sourceNodeId: ec2, targetNodeId: 'nope', connectionType: 'data_access' }),
      ),
    ).toEqual(['edit.node_not_found']);
  });

  it('rejects placement beyond the maximum and across VPCs', () => {
    const b = new GraphBuilder();
    const vpc1 = b.add('network.vpc');
    const vpc2 = b.add('network.vpc');
    const subnet = b.add('network.subnet');
    b.link(subnet, vpc1, 'placed_in');
    const tooMany = checkConnect(b.graph, {
      sourceNodeId: subnet,
      targetNodeId: vpc2,
      connectionType: 'placed_in',
    });
    expect(codes(tooMany)).toContain('placement.too_many');

    const otherSubnet = b.add('network.subnet', { tier: 'private', az: 'az-b', cidr: '10.1.0.0/24' });
    b.link(otherSubnet, vpc2, 'placed_in');
    const asg = b.add('compute.autoscaling');
    b.link(asg, subnet, 'placed_in');
    const mixed = checkConnect(b.graph, {
      sourceNodeId: asg,
      targetNodeId: otherSubnet,
      connectionType: 'placed_in',
    });
    expect(codes(mixed)).toEqual(['placement.mixed_vpc']);
  });

  it('places a single EC2 instance in exactly one subnet (ADR 0015)', () => {
    const s = buildWebStackFromBaseline();
    const second = checkConnect(s.b.graph, {
      sourceNodeId: s.web,
      targetNodeId: s.privB,
      connectionType: 'placed_in',
    });
    expect(codes(second)).toEqual(['placement.too_many']);
  });

  it('rejects invalid connection config', () => {
    const b = new GraphBuilder();
    const ec2 = b.add('compute.ec2');
    const db = b.add('database.rds');
    const r = connect(b.graph, {
      sourceNodeId: ec2,
      targetNodeId: db,
      connectionType: 'data_access',
      config: { poolSize: 0 },
    });
    expect(!r.ok && codes(r.error)).toEqual(['connection.invalid_config']);
  });

  it('allows building incrementally (an ALB may start with one subnet)', () => {
    const s = buildWebStackFromBaseline();
    const alb2 = s.b.add('lb.alb');
    expect(
      checkConnect(s.b.graph, { sourceNodeId: alb2, targetNodeId: s.pubA, connectionType: 'placed_in' }),
    ).toEqual([]);
  });
});

describe('removeNode', () => {
  it('removes dependent connections and reports them', () => {
    const s = buildWebStackFromBaseline();
    const before = Object.keys(s.b.graph.connections).length;
    const r = unwrap(removeNode(s.b.graph, s.web));
    expect(r.graph.nodes[s.web]).toBeUndefined();
    // placed_in, secured_by, alb→web, web→db
    expect(r.removedConnectionIds).toHaveLength(4);
    expect(Object.keys(r.graph.connections)).toHaveLength(before - 4);
    for (const c of Object.values(r.graph.connections)) {
      expect([c.sourceNodeId, c.targetNodeId]).not.toContain(s.web);
    }
  });

  it('drops security-group rules that referenced a removed security group', () => {
    const s = buildWebStackFromBaseline();
    const r = unwrap(removeNode(s.b.graph, s.sgAlb));
    expect(r.modifiedNodeIds).toEqual([s.sgWeb]);
    expect(r.graph.nodes[s.sgWeb]?.config).toEqual({ inboundRules: [] });
  });

  it('protects system-managed and locked nodes', () => {
    const s = buildWebStackFromBaseline();
    const sys = removeNode(s.b.graph, 'internet-1');
    expect(!sys.ok && codes(sys.error)).toEqual(['edit.system_managed']);
    const locked = removeNode(s.b.graph, s.db, { lockedNodes: { [s.db]: 'no-delete' } });
    expect(!locked.ok && codes(locked.error)).toEqual(['edit.node_locked']);
    const missing = removeNode(s.b.graph, 'ghost');
    expect(!missing.ok && codes(missing.error)).toEqual(['edit.node_not_found']);
  });
});

describe('duplicateNode ("launch another like this")', () => {
  it('copies config and non-placement connections, leaving placement to the player', () => {
    const s = buildWebStackFromBaseline();
    const g = unwrap(updateNodeConfig(s.b.graph, s.web, { instanceSize: 'medium' })).graph;
    const r = unwrap(duplicateNode(g, s.web));
    const copy = r.graph.nodes[r.nodeId];
    expect(copy).toMatchObject({
      serviceType: 'compute.ec2',
      name: 'web-3',
      config: { instanceSize: 'medium' },
    });
    const kinds = Object.values(r.graph.connections)
      .filter((c) => c.sourceNodeId === r.nodeId || c.targetNodeId === r.nodeId)
      .map((c) => `${c.sourceNodeId === r.nodeId ? 'out' : 'in'}:${c.connectionType}`)
      .sort();
    expect(kinds).toEqual(['in:routes_to', 'out:data_access', 'out:secured_by']);
    expect(r.copiedConnectionIds).toHaveLength(3);
  });

  it('respects mission policy and reports missing nodes', () => {
    const s = buildWebStackFromBaseline();
    const blocked = duplicateNode(s.b.graph, s.web, { allowedServiceTypes: ['database.rds'] });
    expect(!blocked.ok && codes(blocked.error)).toEqual(['edit.service_not_allowed']);
    const missing = duplicateNode(s.b.graph, 'ghost');
    expect(!missing.ok && codes(missing.error)).toEqual(['edit.node_not_found']);
  });
});

describe('config, rename and disconnect', () => {
  it('validates config updates and respects read-only locks', () => {
    const s = buildWebStackFromBaseline();
    const next = { instanceSize: 'large', apps: ['shop'] };
    const r = unwrap(updateNodeConfig(s.b.graph, s.web, next));
    expect(r.graph.nodes[s.web]?.config).toEqual(next);
    const bad = updateNodeConfig(s.b.graph, s.web, { instanceSize: 'gigantic' });
    expect(!bad.ok && codes(bad.error)).toEqual(['node.invalid_config']);
    const ro = updateNodeConfig(s.b.graph, s.db, {}, { lockedNodes: { [s.db]: 'read-only' } });
    expect(!ro.ok && codes(ro.error)).toEqual(['edit.node_locked']);
    // no-delete still allows configuration
    const nd = updateNodeConfig(s.b.graph, s.web, next, { lockedNodes: { [s.web]: 'no-delete' } });
    expect(nd.ok).toBe(true);
  });

  it('renames and disconnects', () => {
    const s = buildWebStackFromBaseline();
    const renamed = unwrap(renameNode(s.b.graph, s.web, 'frontend')).graph;
    expect(renamed.nodes[s.web]?.name).toBe('frontend');
    const conn = Object.values(renamed.connections).find((c) => c.connectionType === 'data_access');
    if (!conn) throw new Error('fixture missing data_access');
    const updated = unwrap(updateConnectionConfig(renamed, conn.id, { poolSize: 30 })).graph;
    expect(updated.connections[conn.id]?.config).toEqual({ poolSize: 30 });
    const removed = unwrap(disconnect(updated, conn.id)).graph;
    expect(removed.connections[conn.id]).toBeUndefined();
    const again = disconnect(removed, conn.id);
    expect(!again.ok && codes(again.error)).toEqual(['edit.connection_not_found']);
  });
});
