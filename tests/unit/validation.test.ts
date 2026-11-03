import { describe, expect, it } from 'vitest';
import { connect, removeNode, updateNodeConfig } from '../../src/domain/graph/commands';
import { createEmptyGraph } from '../../src/domain/graph/graph';
import type { InfrastructureGraph } from '../../src/domain/graph/types';
import { validateGraph } from '../../src/domain/validation';
import { createBaselineGraph, TEMPLATES } from '../../src/data/templates';
import { buildWebStackFromBaseline, codes, unwrap } from '../fixtures/builders';

const findingCodes = (g: InfrastructureGraph) => codes(validateGraph(g).findings);

describe('validateGraph — start states', () => {
  it('an empty graph cannot be simulated because it has no entry', () => {
    const report = validateGraph(createEmptyGraph());
    expect(report.canSimulate).toBe(false);
    expect(codes(report.findings)).toEqual(['entry.missing']);
  });

  it('the free-construction baseline has an entry but no request path', () => {
    const report = validateGraph(createBaselineGraph());
    expect(report.canSimulate).toBe(false);
    expect(codes(report.findings)).toEqual(['dependency.no_request_path']);
  });

  it('the e-commerce template is simulatable and has no security findings', () => {
    const report = validateGraph(TEMPLATES['ecommerce-starter']());
    // Only the advisory about the deliberately single-AZ web tier (a lesson in the mission).
    expect(report.findings.map((f) => [f.code, f.severity, f.nodeIds])).toEqual([
      ['placement.single_az_compute', 'info', ['ec2-1']],
      ['placement.single_az_compute', 'info', ['ec2-2']],
    ]);
    expect(report.canSimulate).toBe(true);
  });
});

describe('validateGraph — structure', () => {
  it('reports unknown services, dangling connections and invalid config without crashing', () => {
    const g: InfrastructureGraph = {
      schemaVersion: 1,
      nodes: {
        a: { id: 'a', serviceType: 'compute.lambda', name: 'a', config: {} },
        b: { id: 'b', serviceType: 'compute.ec2', name: 'b', config: { instanceSize: 'tiny' } },
      },
      connections: { c: { id: 'c', sourceNodeId: 'b', targetNodeId: 'zzz', connectionType: 'routes_to' } },
    };
    const report = validateGraph(g);
    expect(report.canSimulate).toBe(false);
    expect(codes(report.findings)).toEqual([
      'node.unknown_service',
      'node.invalid_config',
      'graph.dangling_connection',
    ]);
  });
});

describe('validateGraph — placement and dependencies', () => {
  it('requires an ALB to span two AZs', () => {
    const s = buildWebStackFromBaseline();
    const conn = Object.values(s.b.graph.connections).find(
      (c) => c.sourceNodeId === s.alb && c.targetNodeId === s.pubB,
    );
    const g = unwrap(removeNode(s.b.graph, s.pubB)).graph;
    expect(conn).toBeDefined();
    expect(findingCodes(g)).toContain('placement.alb_requires_two_azs');
  });

  it('requires public subnets for an internet-facing ALB', () => {
    const s = buildWebStackFromBaseline();
    const g = unwrap(
      connect(s.b.graph, { sourceNodeId: s.alb, targetNodeId: s.privA, connectionType: 'placed_in' }),
    ).graph;
    expect(findingCodes(g)).toContain('placement.internet_facing_requires_public_subnet');
  });

  it('requires two AZs for Multi-AZ RDS', () => {
    const s = buildWebStackFromBaseline();
    let g = unwrap(
      updateNodeConfig(s.b.graph, s.db, {
        instanceClass: 'db.small',
        storageTier: 'standard',
        multiAz: true,
      }),
    ).graph;
    expect(validateGraph(g).canSimulate).toBe(true);
    g = unwrap(removeNode(g, s.privB)).graph;
    expect(findingCodes(g)).toContain('placement.rds_multi_az_requires_two_azs');
  });

  it('reports missing placement as an error', () => {
    const s = buildWebStackFromBaseline();
    s.b.add('compute.ec2');
    const report = validateGraph(s.b.graph);
    expect(report.canSimulate).toBe(false);
    expect(codes(report.findings)).toEqual(
      expect.arrayContaining([
        'placement.missing',
        'dependency.unreachable_compute',
        'dependency.no_security_group',
      ]),
    );
  });

  it('warns that a disconnected server provides no capacity', () => {
    const s = buildWebStackFromBaseline();
    const extra = s.b.add('compute.ec2');
    s.b.link(extra, s.privB, 'placed_in');
    s.b.link(extra, s.sgWeb, 'secured_by');
    const report = validateGraph(s.b.graph);
    expect(report.canSimulate).toBe(true);
    expect(
      report.findings.filter((f) => f.code === 'dependency.unreachable_compute').map((f) => f.nodeIds),
    ).toEqual([[extra]]);
  });

  it('rejects routing from the Internet to an internal ALB', () => {
    const s = buildWebStackFromBaseline();
    const g = unwrap(
      updateNodeConfig(s.b.graph, s.alb, {
        scheme: 'internal',
        listener: 'http',
        healthCheck: { intervalSec: 30, unhealthyThreshold: 3 },
      }),
    ).graph;
    expect(findingCodes(g)).toContain('dependency.internal_alb_from_internet');
  });

  it('warns when a security group blocks a connected path', () => {
    const s = buildWebStackFromBaseline();
    const g = unwrap(
      updateNodeConfig(s.b.graph, s.sgDb, { inboundRules: [{ port: 3306, source: { kind: 'vpc' } }] }),
    ).graph;
    const blocked = validateGraph(g).findings.filter(
      (f) => f.code === 'dependency.traffic_blocked_by_security_group',
    );
    expect(blocked).toHaveLength(2);
    expect(blocked.map((f) => f.nodeIds)).toEqual([
      [s.web, s.db],
      [s.web2, s.db],
    ]);
  });

  it('accepts a vpc-scoped rule for traffic inside the VPC', () => {
    const s = buildWebStackFromBaseline();
    const g = unwrap(
      updateNodeConfig(s.b.graph, s.sgDb, { inboundRules: [{ port: 5432, source: { kind: 'vpc' } }] }),
    ).graph;
    expect(validateGraph(g).findings.filter((f) => f.severity !== 'info')).toEqual([]);
  });

  it('reports dangling security-group references from loaded data', () => {
    const s = buildWebStackFromBaseline();
    const g = unwrap(
      updateNodeConfig(s.b.graph, s.sgDb, {
        inboundRules: [{ port: 5432, source: { kind: 'security_group', nodeId: 'sg-999' } }],
      }),
    ).graph;
    expect(findingCodes(g)).toContain('dependency.security_group_rule_dangling_reference');
  });
});

describe('validateGraph — security', () => {
  it('flags a database port open to anywhere as critical', () => {
    const s = buildWebStackFromBaseline();
    const g = unwrap(
      updateNodeConfig(s.b.graph, s.sgDb, { inboundRules: [{ port: 5432, source: { kind: 'anywhere' } }] }),
    ).graph;
    const f = validateGraph(g).findings.find((x) => x.code === 'security.db_port_open_to_internet');
    expect(f).toMatchObject({ riskLevel: 'critical', severity: 'warning', nodeIds: [s.sgDb] });
    // security findings do not block simulation
    expect(validateGraph(g).canSimulate).toBe(true);
  });

  it('flags all ports and admin ports open to anywhere', () => {
    const s = buildWebStackFromBaseline();
    const g = unwrap(
      updateNodeConfig(s.b.graph, s.sgWeb, {
        inboundRules: [
          { port: 'all', source: { kind: 'anywhere' } },
          { port: 22, source: { kind: 'anywhere' } },
        ],
      }),
    ).graph;
    const sec = validateGraph(g).findings.filter((f) => f.category === 'security');
    expect(sec.map((f) => [f.code, f.riskLevel])).toEqual([
      ['security.all_ports_open_to_internet', 'critical'],
      ['security.admin_port_open_to_internet', 'major'],
    ]);
  });

  it('flags a database in a public subnet and a directly exposed server', () => {
    const s = buildWebStackFromBaseline();
    s.b.link(s.db, s.pubB, 'placed_in');
    const direct = s.b.add('compute.ec2');
    s.b.link(direct, s.pubA, 'placed_in');
    s.b.link(direct, s.sgAlb, 'secured_by');
    s.b.link('internet-1', direct, 'routes_to');
    const sec = validateGraph(s.b.graph).findings.filter((f) => f.category === 'security');
    expect(sec.map((f) => [f.code, f.riskLevel])).toEqual([
      ['security.db_in_public_subnet', 'major'],
      ['security.compute_directly_exposed', 'minor'],
    ]);
  });

  it('requires a public subnet when the Internet targets a server directly', () => {
    const s = buildWebStackFromBaseline();
    s.b.link('internet-1', s.web, 'routes_to');
    expect(findingCodes(s.b.graph)).toContain('placement.internet_target_requires_public_subnet');
  });
});

describe('validateGraph — determinism', () => {
  it('returns identical output for identical input', () => {
    const g = buildWebStackFromBaseline().b.graph;
    expect(validateGraph(g)).toEqual(validateGraph(structuredClone(g)));
  });
});

describe('redundancy advisory per serving group (ADR 0015)', () => {
  it('advises when every server behind a load balancer is in one AZ, and stops once another AZ is used', async () => {
    const { setWebServers } = await import('../fixtures/solutions');
    const { TEMPLATES } = await import('../../src/data/templates');
    const single = setWebServers(TEMPLATES['ecommerce-starter'](), 3);
    expect(
      validateGraph(single).findings.filter((f) => f.code === 'placement.single_az_compute'),
    ).toHaveLength(3);
    const spread = setWebServers(TEMPLATES['ecommerce-starter'](), 3, { subnets: ['subnet-4'] });
    expect(validateGraph(spread).findings.filter((f) => f.code === 'placement.single_az_compute')).toEqual(
      [],
    );
  });
});
