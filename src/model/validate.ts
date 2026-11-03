import { FRAME_PARENT, LINK_RULES, isComputeType, resourceDef, type ComputeType } from './catalog';
import { finding, type Finding } from './findings';
import { isTrafficAllowed, reachableFromUsers } from './network';
import {
  appsOf,
  childFrames,
  framesOfKind,
  getFrame,
  getResource,
  igwOf,
  linksFrom,
  linksTo,
  listFrames,
  listLinks,
  listResources,
  resourcesOfType,
  securityGroupIdsOf,
  securityGroupsOf,
  subnetIdsOf,
  subnetTier,
  vpcOfFrame,
  zonesOf,
} from './query';
import { PORTS, type AppId, type Diagram, type Resource, type ResourceOf } from './schema';

export interface ValidationContext {
  /** Applications the scenario sends traffic to; each must run on a reachable server. */
  readonly requiredApps?: readonly AppId[];
}

const structureFindings = (d: Diagram): Finding[] => {
  const out: Finding[] = [];
  const regions = framesOfKind(d, 'region');
  if (regions.length !== 1)
    out.push(
      finding(
        'structure.region_count',
        'error',
        regions.map((r) => r.id),
      ),
    );

  for (const f of listFrames(d)) {
    const expected = FRAME_PARENT[f.kind];
    const parent = getFrame(d, f.parentId);
    if (expected === null ? f.parentId !== null : parent?.kind !== expected) {
      out.push(finding('structure.wrong_frame', 'error', [f.id]));
    }
  }
  for (const vpc of framesOfKind(d, 'vpc')) {
    const seen = new Map<string, string>();
    for (const az of childFrames(d, vpc.id)) {
      if (az.kind !== 'az') continue;
      const other = seen.get(az.config.zone);
      if (other)
        out.push(
          finding('structure.duplicate_zone', 'error', [az.id, other], { params: { zone: az.config.zone } }),
        );
      else seen.set(az.config.zone, az.id);
    }
  }

  for (const r of listResources(d)) {
    const def = resourceDef(r.type);
    const frame = getFrame(d, r.frameId);
    if (def.frameKind === null ? r.frameId !== null : frame?.kind !== def.frameKind) {
      out.push(finding('structure.wrong_frame', 'error', [r.id]));
      continue;
    }
    const vpc = vpcOfFrame(d, r.frameId);
    const cfg = r.config as { subnetIds?: string[]; standbySubnetId?: string | null };
    const badSubnet = [...(cfg.subnetIds ?? []), ...(cfg.standbySubnetId ? [cfg.standbySubnetId] : [])].some(
      (s) => !getFrame(d, s, 'subnet') || vpcOfFrame(d, s)?.id !== vpc?.id,
    );
    const badSg = securityGroupIdsOf(r).some((g) => {
      const sg = getResource(d, g, 'sg');
      return !sg || vpcOfFrame(d, sg.frameId)?.id !== vpc?.id;
    });
    const badRule =
      r.type === 'sg' &&
      r.config.inbound.some((rule) => rule.source.kind === 'sg' && !getResource(d, rule.source.sgId, 'sg'));
    if (badSubnet || badSg || badRule) out.push(finding('structure.dangling_reference', 'error', [r.id]));
  }

  for (const l of listLinks(d)) {
    const a = getResource(d, l.from);
    const b = getResource(d, l.to);
    if (!a || !b) out.push(finding('structure.dangling_reference', 'error', [l.id]));
    else if (!(LINK_RULES[l.kind][a.type]?.includes(b.type) ?? false)) {
      out.push(finding('link.not_allowed', 'error', [l.id, a.id, b.id]));
    }
  }

  const users = resourcesOfType(d, 'users');
  if (users.length === 0) out.push(finding('entry.missing', 'error'));
  if (users.length > 1)
    out.push(
      finding(
        'entry.multiple',
        'error',
        users.map((u) => u.id),
      ),
    );
  for (const r of listResources(d)) {
    const max = resourceDef(r.type).maxPerDiagram;
    if (r.type === 'users' || max === undefined) continue;
    const all = resourcesOfType(d, r.type);
    if (all.length > max && all[0]?.id === r.id) {
      out.push(
        finding(
          'diagram.max_per_diagram',
          'error',
          all.map((x) => x.id),
          { params: { type: r.type, max } },
        ),
      );
    }
  }
  return out;
};

const placementFindings = (d: Diagram): Finding[] => {
  const out: Finding[] = [];
  for (const r of listResources(d)) {
    if (!resourceDef(r.type).spansSubnets) continue;
    const subnets = subnetIdsOf(d, r);
    if (subnets.length === 0) {
      out.push(finding('placement.subnets_required', 'error', [r.id]));
      continue;
    }
    const zones = zonesOf(d, r);
    if (r.type === 'alb') {
      if (zones.length < 2) out.push(finding('placement.alb_requires_two_azs', 'error', [r.id]));
      if (r.config.scheme === 'internet-facing' && subnets.some((s) => subnetTier(d, s) !== 'public')) {
        out.push(finding('placement.internet_facing_requires_public_subnet', 'error', [r.id]));
      }
    }
  }
  for (const db of resourcesOfType(d, 'rds')) {
    if (!db.config.multiAz) continue;
    if (!db.config.standbySubnetId) out.push(finding('placement.rds_standby_required', 'error', [db.id]));
    else if (zonesOf(d, db).length < 2)
      out.push(finding('placement.rds_multi_az_requires_two_azs', 'error', [db.id]));
  }
  const users = resourcesOfType(d, 'users')[0];
  if (users) {
    // Traffic from the Internet enters a VPC through its Internet Gateway.
    const reported = new Set<string>();
    for (const l of linksFrom(d, users.id, 'traffic')) {
      const t = getResource(d, l.to);
      const vpc = t ? vpcOfFrame(d, t.frameId) : undefined;
      if (vpc && !igwOf(d, vpc.id) && !reported.has(vpc.id)) {
        reported.add(vpc.id);
        out.push(finding('placement.igw_required', 'error', [vpc.id, l.id]));
      }
    }
    for (const l of linksFrom(d, users.id, 'traffic')) {
      const t = getResource(d, l.to);
      if (t?.type === 'ec2' && t.frameId && subnetTier(d, t.frameId) !== 'public') {
        out.push(finding('placement.internet_target_requires_public_subnet', 'error', [t.id, l.id]));
      }
    }
  }
  return out;
};

const isCompute = (r: Resource): r is ResourceOf<ComputeType> => isComputeType(r.type);

const dependencyFindings = (d: Diagram, ctx: ValidationContext): Finding[] => {
  const out: Finding[] = [];
  const users = resourcesOfType(d, 'users')[0];
  const reachable = reachableFromUsers(d);
  const computes = listResources(d).filter(isCompute);

  if (users && !computes.some((c) => reachable.has(c.id))) {
    out.push(finding('dependency.no_request_path', 'error', [users.id]));
  }
  if (users) {
    for (const l of linksFrom(d, users.id, 'traffic')) {
      const t = getResource(d, l.to, 'alb');
      if (t?.config.scheme === 'internal')
        out.push(finding('dependency.internal_alb_from_internet', 'error', [t.id, l.id]));
    }
  }

  for (const alb of resourcesOfType(d, 'alb')) {
    if (linksFrom(d, alb.id, 'traffic').length === 0)
      out.push(finding('dependency.alb_no_targets', 'warning', [alb.id]));
  }
  for (const c of computes) {
    if (!reachable.has(c.id)) out.push(finding('dependency.unreachable_compute', 'warning', [c.id]));
    else if (linksFrom(d, c.id, 'data').length === 0) {
      out.push(finding('dependency.compute_without_database', 'warning', [c.id]));
    }
  }

  // Redundancy advisory per serving group: the servers one router sends traffic to.
  const advised = new Set<string>();
  for (const router of [...(users ? [users] : []), ...resourcesOfType(d, 'alb')]) {
    if (!reachable.has(router.id)) continue;
    const group = linksFrom(d, router.id, 'traffic')
      .map((l) => getResource(d, l.to))
      .filter((r): r is ResourceOf<ComputeType> => r !== undefined && isCompute(r));
    if (group.length === 0) continue;
    const zones = new Set(group.flatMap((g) => zonesOf(d, g)));
    if (zones.size !== 1) continue;
    for (const g of group) {
      if (advised.has(g.id)) continue;
      advised.add(g.id);
      out.push(finding('placement.single_az_compute', 'info', [g.id]));
    }
  }

  for (const db of resourcesOfType(d, 'rds')) {
    if (!linksTo(d, db.id, 'data').some((l) => reachable.has(l.from))) {
      out.push(finding('dependency.unused_database', 'warning', [db.id]));
    }
  }

  for (const r of listResources(d)) {
    if (resourceDef(r.type).securable && securityGroupsOf(d, r).length === 0) {
      out.push(finding('dependency.no_security_group', 'warning', [r.id]));
    }
  }
  for (const l of listLinks(d)) {
    const target = getResource(d, l.to);
    if (!target || securityGroupsOf(d, target).length === 0) continue;
    if (!isTrafficAllowed(d, l.from, l.to)) {
      out.push(finding('dependency.traffic_blocked_by_security_group', 'warning', [l.to, l.from, l.id]));
    }
  }

  if (ctx.requiredApps && ctx.requiredApps.length > 0) {
    const served = new Set<AppId>();
    for (const c of computes) if (reachable.has(c.id)) for (const a of appsOf(c)) served.add(a);
    for (const app of ctx.requiredApps) {
      if (!served.has(app))
        out.push(finding('dependency.app_not_served', 'warning', [], { params: { app } }));
    }
  }
  return out;
};

const isAdminPort = (port: number | 'all') =>
  port !== 'all' && (PORTS.admin as readonly number[]).includes(port);

export const securityFindings = (d: Diagram): Finding[] => {
  const out: Finding[] = [];
  const dbSgIds = new Set(resourcesOfType(d, 'rds').flatMap((db) => securityGroupIdsOf(db)));
  for (const sg of resourcesOfType(d, 'sg')) {
    for (const rule of sg.config.inbound) {
      if (rule.source.kind !== 'anywhere') continue;
      if (rule.port === 'all') {
        out.push(
          finding('security.all_ports_open_to_internet', 'warning', [sg.id], { riskLevel: 'critical' }),
        );
      } else if (rule.port === PORTS.database && dbSgIds.has(sg.id)) {
        out.push(finding('security.db_port_open_to_internet', 'warning', [sg.id], { riskLevel: 'critical' }));
      } else if (isAdminPort(rule.port)) {
        out.push(
          finding('security.admin_port_open_to_internet', 'warning', [sg.id], {
            riskLevel: 'major',
            params: { port: rule.port },
          }),
        );
      }
    }
  }
  for (const db of resourcesOfType(d, 'rds')) {
    if (subnetIdsOf(d, db).some((s) => subnetTier(d, s) === 'public')) {
      out.push(finding('security.db_in_public_subnet', 'warning', [db.id], { riskLevel: 'major' }));
    }
  }
  const users = resourcesOfType(d, 'users')[0];
  if (users) {
    for (const l of linksFrom(d, users.id, 'traffic')) {
      if (getResource(d, l.to)?.type === 'ec2') {
        out.push(
          finding('security.compute_directly_exposed', 'warning', [l.to, l.id], { riskLevel: 'minor' }),
        );
      }
    }
  }
  return out;
};

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

/**
 * Validates a schema-valid diagram. Structure errors short-circuit the semantic checks, which
 * assume a well-formed frame tree. Findings are ordered by severity, then by emission order.
 */
export const validateDiagram = (d: Diagram, ctx: ValidationContext = {}): Finding[] => {
  const structure = structureFindings(d);
  const all = structure.some((f) => f.severity === 'error')
    ? structure
    : [...structure, ...placementFindings(d), ...dependencyFindings(d, ctx), ...securityFindings(d)];
  return all
    .map((f, i) => ({ f, i }))
    .sort((a, b) => SEVERITY_ORDER[a.f.severity] - SEVERITY_ORDER[b.f.severity] || a.i - b.i)
    .map(({ f }) => f);
};

/** Findings about one frame, resource or link. */
export const findingsFor = (findings: readonly Finding[], id: string): Finding[] =>
  findings.filter((f) => f.targetIds.includes(id));
