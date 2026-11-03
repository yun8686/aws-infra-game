import type { ConnectionTypeId } from '../../src/domain/catalog/ids';
import { addNode, connect, type CommandResult, type EditPolicy } from '../../src/domain/graph/commands';
import type { InfrastructureGraph, NodeId } from '../../src/domain/graph/types';
import { createBaselineGraph } from '../../src/data/templates';
import type { Finding } from '../../src/domain/validation/findings';

export const unwrap = <E>(r: CommandResult<E>): { graph: InfrastructureGraph } & E => {
  if (!r.ok) throw new Error(`Command rejected: ${r.error.map((f: Finding) => f.code).join(', ')}`);
  return r.value;
};

/** Small fluent builder that drives the real edit commands. */
export class GraphBuilder {
  constructor(
    public graph: InfrastructureGraph = createBaselineGraph(),
    private readonly policy: EditPolicy = {},
  ) {}

  add(serviceType: string, config?: unknown, name?: string): NodeId {
    const r = unwrap(
      addNode(
        this.graph,
        { serviceType, ...(config !== undefined ? { config } : {}), ...(name ? { name } : {}) },
        this.policy,
      ),
    );
    this.graph = r.graph;
    return r.nodeId;
  }

  link(
    sourceNodeId: NodeId,
    targetNodeId: NodeId,
    connectionType: ConnectionTypeId,
    config?: unknown,
  ): string {
    const r = unwrap(
      connect(
        this.graph,
        { sourceNodeId, targetNodeId, connectionType, ...(config ? { config } : {}) },
        this.policy,
      ),
    );
    this.graph = r.graph;
    return r.connectionId;
  }
}

export interface WebStack {
  b: GraphBuilder;
  vpc: NodeId;
  pubA: NodeId;
  pubB: NodeId;
  privA: NodeId;
  privB: NodeId;
  sgAlb: NodeId;
  sgWeb: NodeId;
  sgDb: NodeId;
  alb: NodeId;
  web: NodeId;
  web2: NodeId;
  db: NodeId;
}

/**
 * Builds, from the free-construction baseline and using only edit commands, an architecture
 * equivalent to the e-commerce starter template.
 */
export const buildWebStackFromBaseline = (): WebStack => {
  const b = new GraphBuilder();
  const vpc = b.add('network.vpc');
  const subnet = (tier: string, az: string, cidr: string) => {
    const id = b.add('network.subnet', { tier, az, cidr });
    b.link(id, vpc, 'placed_in');
    return id;
  };
  const pubA = subnet('public', 'az-a', '10.0.0.0/24');
  const pubB = subnet('public', 'az-b', '10.0.1.0/24');
  const privA = subnet('private', 'az-a', '10.0.10.0/24');
  const privB = subnet('private', 'az-b', '10.0.11.0/24');
  const sg = (rules: unknown[]) => {
    const id = b.add('network.security_group', { inboundRules: rules });
    b.link(id, vpc, 'placed_in');
    return id;
  };
  const sgAlb = sg([{ port: 80, source: { kind: 'anywhere' } }]);
  const sgWeb = sg([{ port: 80, source: { kind: 'security_group', nodeId: sgAlb } }]);
  const sgDb = sg([{ port: 5432, source: { kind: 'security_group', nodeId: sgWeb } }]);

  const alb = b.add('lb.alb');
  b.link(alb, pubA, 'placed_in');
  b.link(alb, pubB, 'placed_in');
  b.link(alb, sgAlb, 'secured_by');

  const server = (name: string) => {
    const id = b.add('compute.ec2', { instanceSize: 'small' }, name);
    b.link(id, privA, 'placed_in');
    b.link(id, sgWeb, 'secured_by');
    return id;
  };
  const web = server('web-1');
  const web2 = server('web-2');

  const db = b.add('database.rds');
  b.link(db, privA, 'placed_in');
  b.link(db, privB, 'placed_in');
  b.link(db, sgDb, 'secured_by');

  b.link('internet-1', alb, 'routes_to');
  b.link(alb, web, 'routes_to');
  b.link(alb, web2, 'routes_to');
  b.link(web, db, 'data_access', { poolSize: 10 });
  b.link(web2, db, 'data_access', { poolSize: 10 });
  return { b, vpc, pubA, pubB, privA, privB, sgAlb, sgWeb, sgDb, alb, web, web2, db };
};

export const codes = (findings: readonly Finding[]): string[] => findings.map((f) => f.code);
