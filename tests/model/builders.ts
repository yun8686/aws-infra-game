import {
  REGION_ID,
  USERS_ID,
  addFrame,
  addResource,
  connect,
  createBaseDiagram,
  updateConfig,
  type Diagram,
  type EditResult,
  type ResourceConfigMap,
  type ResourceType,
} from '../../src/model';

export const must = (r: EditResult): { diagram: Diagram; id: string } => {
  if (!r.ok) throw new Error(`edit rejected: ${r.finding.code} ${JSON.stringify(r.finding.params ?? {})}`);
  return r;
};

/** Small fluent builder over the edit commands, so tests read like the player's actions. */
export class DiagramBuilder {
  constructor(public d: Diagram = createBaseDiagram()) {}

  frame(
    kind: 'vpc' | 'az' | 'subnet',
    parentId: string,
    config: Record<string, unknown> = {},
    id?: string,
  ): string {
    const r = must(addFrame(this.d, kind, parentId, { config: config as never, ...(id ? { id } : {}) }));
    this.d = r.diagram;
    return r.id;
  }

  resource<T extends ResourceType>(
    type: T,
    frameId: string,
    config: Partial<ResourceConfigMap[T]> = {},
    id?: string,
  ): string {
    const r = must(addResource(this.d, type, frameId, { config, ...(id ? { id } : {}) }));
    this.d = r.diagram;
    return r.id;
  }

  link(kind: 'traffic' | 'data', from: string, to: string): string {
    const r = must(connect(this.d, kind, from, to));
    this.d = r.diagram;
    return r.id;
  }

  set(id: string, patch: Record<string, unknown>): void {
    const cur = (this.d.resources[id]?.config ?? this.d.frames[id]?.config) as Record<string, unknown>;
    this.d = must(updateConfig(this.d, id, { ...cur, ...patch })).diagram;
  }
}

export interface Standard {
  b: DiagramBuilder;
  vpc: string;
  pubA: string;
  pubB: string;
  privA: string;
  privB: string;
  alb: string;
  webA: string;
  webB: string;
  db: string;
  sgAlb: string;
  sgWeb: string;
  sgDb: string;
}

/** A healthy two-AZ web stack: ALB → two EC2 (one per AZ) → RDS, with tight security groups. */
export const standardStack = (): Standard => {
  const b = new DiagramBuilder();
  const vpc = b.frame('vpc', REGION_ID);
  const azA = b.frame('az', vpc);
  const azB = b.frame('az', vpc);
  const pubA = b.frame('subnet', azA, { tier: 'public' });
  const privA = b.frame('subnet', azA, { tier: 'private' });
  const pubB = b.frame('subnet', azB, { tier: 'public' });
  const privB = b.frame('subnet', azB, { tier: 'private' });
  const sgAlb = b.resource('sg', vpc, { inbound: [{ port: 80, source: { kind: 'anywhere' } }] });
  const sgWeb = b.resource('sg', vpc, { inbound: [{ port: 80, source: { kind: 'sg', sgId: sgAlb } }] });
  const sgDb = b.resource('sg', vpc, { inbound: [{ port: 5432, source: { kind: 'sg', sgId: sgWeb } }] });
  const alb = b.resource('alb', vpc, { securityGroupIds: [sgAlb] });
  const webA = b.resource('ec2', privA, { securityGroupIds: [sgWeb] });
  const webB = b.resource('ec2', privB, { securityGroupIds: [sgWeb] });
  const db = b.resource('rds', vpc, { securityGroupIds: [sgDb] });
  b.link('traffic', USERS_ID, alb);
  b.link('traffic', alb, webA);
  b.link('traffic', alb, webB);
  b.link('data', webA, db);
  b.link('data', webB, db);
  return { b, vpc, pubA, pubB, privA, privB, alb, webA, webB, db, sgAlb, sgWeb, sgDb };
};
