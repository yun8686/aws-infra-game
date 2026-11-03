import { DEFAULT_POOL_SIZE, FRAME_DEFINITIONS, FRAME_PARENT, LINK_RULES, resourceDef } from './catalog';
import { finding, type Finding, type FindingCode } from './findings';
import {
  childFrames,
  compareIds,
  descendantFrameIds,
  framesOfKind,
  getFrame,
  getResource,
  listFrames,
  listLinks,
  listResources,
  vpcOfFrame,
  zoneOfSubnet,
} from './query';
import {
  DIAGRAM_SCHEMA_VERSION,
  ZONES,
  frameConfigSchemas,
  linkConfigSchemas,
  resourceConfigSchemas,
  type Diagram,
  type Frame,
  type FrameConfigMap,
  type FrameKind,
  type Link,
  type LinkKind,
  type Resource,
  type ResourceConfigMap,
  type ResourceType,
  type Zone,
} from './schema';

export type EditResult = { ok: true; diagram: Diagram; id: string } | { ok: false; finding: Finding };

/** Mission restrictions applied on top of the model rules. */
export interface EditPolicy {
  /** Resources the customer requires to keep: they can be reconfigured but not removed. */
  readonly lockedIds?: readonly string[];
  /** Resource types the player may add; undefined = all. */
  readonly allowedTypes?: readonly ResourceType[];
}

const reject = (
  code: FindingCode,
  targetIds: readonly string[] = [],
  params?: Record<string, string | number>,
): EditResult => ({
  ok: false,
  finding: finding(code, 'error', targetIds, params ? { params } : {}),
});

const ok = (diagram: Diagram, id: string): EditResult => ({ ok: true, diagram, id });

const isLocked = (policy: EditPolicy, id: string) => policy.lockedIds?.includes(id) ?? false;

// ---- Ids and names ------------------------------------------------------------------

const allIds = (d: Diagram): Set<string> =>
  new Set([...Object.keys(d.frames), ...Object.keys(d.resources), ...Object.keys(d.links)]);

/** Smallest free `<prefix>-<n>`. */
export const nextId = (d: Diagram, prefix: string): string => {
  const used = allIds(d);
  for (let n = 1; ; n++) if (!used.has(`${prefix}-${n}`)) return `${prefix}-${n}`;
};

const usedNames = (d: Diagram) =>
  new Set([...Object.values(d.frames), ...Object.values(d.resources)].map((x) => x.name));

const uniqueName = (d: Diagram, base: string): string => {
  const used = usedNames(d);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
};

const zoneLetter = (zone: Zone) => zone.slice(-1);

const autoSubnetName = (tier: string, zone: Zone | undefined) => `${tier}-${zone ? zoneLetter(zone) : 'x'}`;

// ---- Base diagram -----------------------------------------------------------------

export const REGION_ID = 'region-1';
export const USERS_ID = 'users-1';

/** A diagram with only the system-managed Region and Users: the free-build starting point. */
export const createBaseDiagram = (): Diagram => ({
  schemaVersion: DIAGRAM_SCHEMA_VERSION,
  frames: { [REGION_ID]: { id: REGION_ID, kind: 'region', parentId: null, name: 'region', config: {} } },
  resources: { [USERS_ID]: { id: USERS_ID, type: 'users', frameId: null, name: 'users', config: {} } },
  links: {},
});

// ---- Reference checks -----------------------------------------------------------

const zonesUsedInVpc = (d: Diagram, vpcId: string, exceptAzId?: string): Set<Zone> =>
  new Set(
    childFrames(d, vpcId)
      .filter((f): f is Frame & { kind: 'az' } => f.kind === 'az' && f.id !== exceptAzId)
      .map((f) => f.config.zone),
  );

/** Subnet / security-group references of a resource config must stay inside its VPC. */
const referencesInsideVpc = (
  d: Diagram,
  frameId: string | null,
  config: Record<string, unknown>,
): boolean => {
  const vpc = vpcOfFrame(d, frameId);
  const subnetIds = [
    ...((config.subnetIds as string[] | undefined) ?? []),
    ...(typeof config.standbySubnetId === 'string' ? [config.standbySubnetId] : []),
  ];
  const sgIds = (config.securityGroupIds as string[] | undefined) ?? [];
  const rules = (config.inbound as { source: { kind: string; sgId?: string } }[] | undefined) ?? [];
  const sgRefs = [
    ...sgIds,
    ...rules.flatMap((r) => (r.source.kind === 'sg' && r.source.sgId ? [r.source.sgId] : [])),
  ];
  if ((subnetIds.length > 0 || sgRefs.length > 0) && !vpc) return false;
  return (
    subnetIds.every((id) => getFrame(d, id, 'subnet') && vpcOfFrame(d, id)?.id === vpc?.id) &&
    sgRefs.every((id) => {
      const sg = getResource(d, id, 'sg');
      return sg !== undefined && vpcOfFrame(d, sg.frameId)?.id === vpc?.id;
    })
  );
};

// ---- Suggestions ---------------------------------------------------------------------

/** One subnet per AZ of the preferred tier, for a spanning resource being added to a VPC. */
export const suggestSubnets = (d: Diagram, vpcId: string, tier: 'public' | 'private'): string[] => {
  const byZone = new Map<Zone, string>();
  for (const s of framesOfKind(d, 'subnet')) {
    if (s.config.tier !== tier || vpcOfFrame(d, s.id)?.id !== vpcId) continue;
    const zone = zoneOfSubnet(d, s.id);
    if (zone && !byZone.has(zone)) byZone.set(zone, s.id);
  }
  return [...byZone.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, id]) => id)
    .slice(0, 3);
};

const nextVpcCidr = (d: Diagram): string => {
  const used = new Set(framesOfKind(d, 'vpc').map((v) => v.config.cidr));
  for (let n = 0; n < 256; n++) if (!used.has(`10.${n}.0.0/16`)) return `10.${n}.0.0/16`;
  return '10.0.0.0/16';
};

const nextSubnetCidr = (d: Diagram, vpcId: string | undefined): string => {
  const vpc = vpcId ? getFrame(d, vpcId, 'vpc') : undefined;
  const second = vpc?.config.cidr.split('.')[1] ?? '0';
  const used = new Set(framesOfKind(d, 'subnet').map((s) => s.config.cidr));
  for (let n = 1; n < 256; n++) {
    const c = `10.${second}.${n}.0/24`;
    if (!used.has(c)) return c;
  }
  return `10.${second}.1.0/24`;
};

// ---- Frames ------------------------------------------------------------------------

export interface AddFrameOptions<K extends FrameKind> {
  readonly config?: Partial<FrameConfigMap[K]>;
  readonly name?: string;
  readonly id?: string;
}

export const addFrame = <K extends FrameKind>(
  d: Diagram,
  kind: K,
  parentId: string,
  opts: AddFrameOptions<K> = {},
): EditResult => {
  if (FRAME_DEFINITIONS[kind].systemManaged) return reject('edit.system_managed');
  const parent = getFrame(d, parentId);
  if (!parent) return reject('edit.not_found', [parentId]);
  if (FRAME_PARENT[kind] !== parent.kind) return reject('edit.wrong_frame', [parentId]);

  const id = opts.id ?? nextId(d, FRAME_DEFINITIONS[kind].idPrefix);
  if (allIds(d).has(id)) return reject('edit.invalid_config', [id], { field: 'id' });
  let config: Record<string, unknown> = { ...FRAME_DEFINITIONS[kind].defaultConfig, ...opts.config };
  let name = opts.name;

  if (kind === 'vpc') {
    if (!opts.config || !('cidr' in opts.config)) config = { ...config, cidr: nextVpcCidr(d) };
    name ??= uniqueName(d, id);
  } else if (kind === 'az') {
    const used = zonesUsedInVpc(d, parentId);
    const requested = opts.config && 'zone' in opts.config ? (opts.config.zone as Zone) : undefined;
    const zone = requested ?? ZONES.find((z) => !used.has(z));
    if (!zone || used.has(zone)) return reject('edit.no_free_zone', [parentId]);
    config = { zone };
    name ??= zone;
  } else if (kind === 'subnet') {
    const vpcId = vpcOfFrame(d, parentId)?.id;
    if (!opts.config || !('cidr' in opts.config)) config = { ...config, cidr: nextSubnetCidr(d, vpcId) };
    const zone = parent.kind === 'az' ? parent.config.zone : undefined;
    name ??= uniqueName(d, autoSubnetName(String(config.tier), zone));
  }

  const parsed = frameConfigSchemas[kind].safeParse(config);
  if (!parsed.success)
    return reject('edit.invalid_config', [id], { field: String(parsed.error.issues[0]?.path[0] ?? '') });
  const frame = { id, kind, parentId, name: name ?? id, config: parsed.data } as Frame;
  return ok({ ...d, frames: { ...d.frames, [id]: frame } }, id);
};

// ---- Resources -----------------------------------------------------------------------

export interface AddResourceOptions<T extends ResourceType> {
  readonly config?: Partial<ResourceConfigMap[T]>;
  readonly name?: string;
  readonly id?: string;
}

export const addResource = <T extends ResourceType>(
  d: Diagram,
  type: T,
  frameId: string,
  opts: AddResourceOptions<T> = {},
  policy: EditPolicy = {},
): EditResult => {
  const def = resourceDef(type);
  if (def.systemManaged) return reject('edit.system_managed');
  if (policy.allowedTypes && !policy.allowedTypes.includes(type))
    return reject('edit.type_not_allowed', [], { type });
  const frame = getFrame(d, frameId);
  if (!frame) return reject('edit.not_found', [frameId]);
  if (frame.kind !== def.frameKind) return reject('edit.wrong_frame', [frameId], { type });
  if (
    def.maxPerDiagram !== undefined &&
    listResources(d).filter((r) => r.type === type).length >= def.maxPerDiagram
  ) {
    return reject('edit.max_reached', [], { type, max: def.maxPerDiagram });
  }
  if (
    def.maxPerFrame !== undefined &&
    listResources(d).filter((r) => r.type === type && r.frameId === frameId).length >= def.maxPerFrame
  ) {
    return reject('edit.max_reached', [frameId], { type, max: def.maxPerFrame });
  }

  const id = opts.id ?? nextId(d, def.idPrefix);
  if (allIds(d).has(id)) return reject('edit.invalid_config', [id], { field: 'id' });
  let config: Record<string, unknown> = { ...def.defaultConfig, ...opts.config };
  if (def.spansSubnets && !(opts.config && 'subnetIds' in opts.config)) {
    const internal = type === 'alb' && config.scheme === 'internal';
    const tier = type === 'alb' && !internal ? 'public' : 'private';
    config = { ...config, subnetIds: suggestSubnets(d, frameId, tier) };
  }
  const parsed = resourceConfigSchemas[type].safeParse(config);
  if (!parsed.success)
    return reject('edit.invalid_config', [id], { field: String(parsed.error.issues[0]?.path[0] ?? '') });
  if (!referencesInsideVpc(d, frameId, parsed.data as Record<string, unknown>))
    return reject('edit.outside_vpc', [id]);

  const resource = {
    id,
    type,
    frameId,
    name: opts.name ?? uniqueName(d, id),
    config: parsed.data,
  } as Resource;
  return ok({ ...d, resources: { ...d.resources, [id]: resource } }, id);
};

// ---- Updates -------------------------------------------------------------------------

/** Replaces the config of a frame, resource or link after schema and reference checks. */
export const updateConfig = (d: Diagram, id: string, config: unknown): EditResult => {
  const frame = d.frames[id];
  if (frame) {
    if (FRAME_DEFINITIONS[frame.kind].systemManaged) return reject('edit.system_managed', [id]);
    const parsed = frameConfigSchemas[frame.kind].safeParse(config);
    if (!parsed.success)
      return reject('edit.invalid_config', [id], { field: String(parsed.error.issues[0]?.path[0] ?? '') });
    let name = frame.name;
    if (frame.kind === 'az') {
      const zone = (parsed.data as unknown as { zone: Zone }).zone;
      if (frame.parentId && zonesUsedInVpc(d, frame.parentId, id).has(zone))
        return reject('edit.no_free_zone', [id]);
      if (name === (frame.config as { zone: Zone }).zone) name = zone;
    }
    if (frame.kind === 'subnet') {
      const zone = zoneOfSubnet(d, id);
      const tier = (parsed.data as unknown as { tier: string }).tier;
      const oldTier = (frame.config as { tier: string }).tier;
      if (name === autoSubnetName(oldTier, zone) && tier !== oldTier) {
        name = uniqueName(d, autoSubnetName(tier, zone));
      }
    }
    const next = { ...frame, name, config: parsed.data } as Frame;
    return ok({ ...d, frames: { ...d.frames, [id]: next } }, id);
  }

  const resource = d.resources[id];
  if (resource) {
    if (resourceDef(resource.type).systemManaged) return reject('edit.system_managed', [id]);
    const parsed = resourceConfigSchemas[resource.type].safeParse(config);
    if (!parsed.success)
      return reject('edit.invalid_config', [id], { field: String(parsed.error.issues[0]?.path[0] ?? '') });
    if (!referencesInsideVpc(d, resource.frameId, parsed.data as Record<string, unknown>))
      return reject('edit.outside_vpc', [id]);
    const next = { ...resource, config: parsed.data } as Resource;
    return ok({ ...d, resources: { ...d.resources, [id]: next } }, id);
  }

  const link = d.links[id];
  if (link) {
    const parsed = linkConfigSchemas[link.kind].safeParse(config);
    if (!parsed.success)
      return reject('edit.invalid_config', [id], { field: String(parsed.error.issues[0]?.path[0] ?? '') });
    return ok({ ...d, links: { ...d.links, [id]: { ...link, config: parsed.data } as Link } }, id);
  }
  return reject('edit.not_found', [id]);
};

export const rename = (d: Diagram, id: string, name: string): EditResult => {
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > 40)
    return reject('edit.invalid_config', [id], { field: 'name' });
  const frame = d.frames[id];
  if (frame) return ok({ ...d, frames: { ...d.frames, [id]: { ...frame, name: trimmed } } }, id);
  const resource = d.resources[id];
  if (resource) return ok({ ...d, resources: { ...d.resources, [id]: { ...resource, name: trimmed } } }, id);
  return reject('edit.not_found', [id]);
};

/** Moves a resource to another frame of its kind inside the same VPC (e.g. an EC2 instance to another subnet). */
export const moveResource = (d: Diagram, id: string, frameId: string): EditResult => {
  const r = getResource(d, id);
  if (!r) return reject('edit.not_found', [id]);
  const def = resourceDef(r.type);
  if (def.systemManaged) return reject('edit.system_managed', [id]);
  const frame = getFrame(d, frameId);
  if (!frame) return reject('edit.not_found', [frameId]);
  if (frame.kind !== def.frameKind) return reject('edit.wrong_frame', [frameId]);
  if (vpcOfFrame(d, r.frameId)?.id !== vpcOfFrame(d, frameId)?.id)
    return reject('edit.outside_vpc', [id, frameId]);
  return ok({ ...d, resources: { ...d.resources, [id]: { ...r, frameId } as Resource } }, id);
};

/** Another resource with the same settings and links ("同じ設定でもう1台"), optionally in another frame. */
export const duplicateResource = (
  d: Diagram,
  id: string,
  frameId?: string,
  policy: EditPolicy = {},
): EditResult => {
  const r = getResource(d, id);
  if (!r) return reject('edit.not_found', [id]);
  const target = frameId ?? r.frameId;
  if (!target) return reject('edit.system_managed', [id]);
  if (vpcOfFrame(d, r.frameId)?.id !== vpcOfFrame(d, target)?.id)
    return reject('edit.outside_vpc', [id, target]);
  const added = addResource(d, r.type, target, { config: r.config as never }, policy);
  if (!added.ok) return added;
  let next = added.diagram;
  for (const l of listLinks(d)) {
    if (l.kind === 'traffic' && l.to === id) {
      const c = connect(next, 'traffic', l.from, added.id);
      if (c.ok) next = c.diagram;
    } else if (l.kind === 'data' && l.from === id) {
      const c = connect(next, 'data', added.id, l.to, l.config);
      if (c.ok) next = c.diagram;
    }
  }
  return ok(next, added.id);
};

// ---- Links -------------------------------------------------------------------------------

export const canLink = (d: Diagram, kind: LinkKind, from: string, to: string): boolean => {
  const a = getResource(d, from);
  const b = getResource(d, to);
  if (!a || !b || a.id === b.id) return false;
  return LINK_RULES[kind][a.type]?.includes(b.type) ?? false;
};

/** Resources `from` could be linked to with `kind` (excluding existing links). */
export const linkCandidates = (d: Diagram, kind: LinkKind, from: string): Resource[] =>
  listResources(d).filter(
    (r) =>
      canLink(d, kind, from, r.id) &&
      !listLinks(d).some((l) => l.kind === kind && l.from === from && l.to === r.id),
  );

/** Link kinds a resource can start. */
export const outgoingLinkKinds = (d: Diagram, from: string): LinkKind[] => {
  const r = getResource(d, from);
  if (!r) return [];
  return (Object.keys(LINK_RULES) as LinkKind[]).filter((k) => (LINK_RULES[k][r.type]?.length ?? 0) > 0);
};

export const connect = (
  d: Diagram,
  kind: LinkKind,
  from: string,
  to: string,
  config?: Partial<{ poolSize: number }>,
): EditResult => {
  if (!getResource(d, from) || !getResource(d, to)) return reject('edit.not_found', [from, to]);
  if (!canLink(d, kind, from, to)) return reject('edit.link_not_allowed', [from, to]);
  if (listLinks(d).some((l) => l.kind === kind && l.from === from && l.to === to)) {
    return reject('edit.link_duplicate', [from, to]);
  }
  const id = nextId(d, kind === 'traffic' ? 'route' : 'query');
  const link =
    kind === 'traffic'
      ? ({ id, kind, from, to, config: {} } as Link)
      : ({ id, kind, from, to, config: { poolSize: config?.poolSize ?? DEFAULT_POOL_SIZE } } as Link);
  const parsed = linkConfigSchemas[kind].safeParse(link.config);
  if (!parsed.success) return reject('edit.invalid_config', [id], { field: 'poolSize' });
  return ok({ ...d, links: { ...d.links, [id]: link } }, id);
};

export const disconnect = (d: Diagram, linkId: string): EditResult => {
  if (!d.links[linkId]) return reject('edit.not_found', [linkId]);
  const links = { ...d.links };
  delete links[linkId];
  return ok({ ...d, links }, linkId);
};

// ---- Removal ----------------------------------------------------------------------------

const withoutIds = (ids: readonly string[], removed: Set<string>) => ids.filter((i) => !removed.has(i));

/**
 * Removes a frame (with everything inside it), a resource or a link. References to removed
 * subnets and security groups are stripped from the remaining resources.
 */
export const remove = (d: Diagram, id: string, policy: EditPolicy = {}): EditResult => {
  if (d.links[id]) return disconnect(d, id);
  const frame = d.frames[id];
  const resource = d.resources[id];
  if (!frame && !resource) return reject('edit.not_found', [id]);
  if (frame && FRAME_DEFINITIONS[frame.kind].systemManaged) return reject('edit.system_managed', [id]);
  if (resource && resourceDef(resource.type).systemManaged) return reject('edit.system_managed', [id]);

  const removedFrames = frame ? descendantFrameIds(d, id) : new Set<string>();
  const removedResources = new Set<string>(
    resource
      ? [id]
      : listResources(d)
          .filter((r) => r.frameId && removedFrames.has(r.frameId))
          .map((r) => r.id),
  );

  // Locked resources may neither be removed nor lose their subnets / security groups.
  for (const r of listResources(d)) {
    if (!isLocked(policy, r.id)) continue;
    if (removedResources.has(r.id)) return reject('edit.locked', [r.id]);
    const cfg = r.config as {
      subnetIds?: string[];
      securityGroupIds?: string[];
      standbySubnetId?: string | null;
    };
    const refs = [
      ...(cfg.subnetIds ?? []),
      ...(cfg.securityGroupIds ?? []),
      ...(cfg.standbySubnetId ? [cfg.standbySubnetId] : []),
    ];
    if (refs.some((ref) => removedFrames.has(ref) || removedResources.has(ref)))
      return reject('edit.locked', [r.id]);
  }

  const frames: Record<string, Frame> = {};
  for (const f of listFrames(d)) if (!removedFrames.has(f.id)) frames[f.id] = f;

  const resources: Record<string, Resource> = {};
  for (const r of listResources(d)) {
    if (removedResources.has(r.id)) continue;
    const cfg = { ...(r.config as Record<string, unknown>) };
    if (Array.isArray(cfg.subnetIds)) cfg.subnetIds = withoutIds(cfg.subnetIds as string[], removedFrames);
    if (typeof cfg.standbySubnetId === 'string' && removedFrames.has(cfg.standbySubnetId))
      cfg.standbySubnetId = null;
    if (Array.isArray(cfg.securityGroupIds))
      cfg.securityGroupIds = withoutIds(cfg.securityGroupIds as string[], removedResources);
    if (r.type === 'sg') {
      cfg.inbound = r.config.inbound.filter(
        (rule) => !(rule.source.kind === 'sg' && removedResources.has(rule.source.sgId)),
      );
    }
    resources[r.id] = { ...r, config: cfg } as Resource;
  }

  const links: Record<string, Link> = {};
  for (const l of listLinks(d))
    if (!removedResources.has(l.from) && !removedResources.has(l.to)) links[l.id] = l;

  return ok({ ...d, frames, resources, links }, id);
};

/** Ids that `remove(id)` would delete, for the confirmation message. */
export const removalImpact = (
  d: Diagram,
  id: string,
): { frames: string[]; resources: string[]; links: string[] } => {
  if (d.links[id]) return { frames: [], resources: [], links: [id] };
  const removedFrames = d.frames[id] ? descendantFrameIds(d, id) : new Set<string>();
  const removedResources = new Set(
    d.resources[id]
      ? [id]
      : listResources(d)
          .filter((r) => r.frameId && removedFrames.has(r.frameId))
          .map((r) => r.id),
  );
  return {
    frames: [...removedFrames].filter((f) => f !== id).sort(compareIds),
    resources: [...removedResources].filter((r) => r !== id).sort(compareIds),
    links: listLinks(d)
      .filter((l) => removedResources.has(l.from) || removedResources.has(l.to))
      .map((l) => l.id),
  };
};
