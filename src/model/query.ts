import { RESOURCE_DEFINITIONS } from './catalog';
import type {
  AppId,
  Diagram,
  Frame,
  FrameKind,
  FrameOf,
  Link,
  LinkKind,
  Resource,
  ResourceOf,
  ResourceType,
  Zone,
} from './schema';

/** Natural order of ids (`web-2` before `web-10`), used everywhere for determinism. */
export const compareIds = (a: string, b: string): number =>
  a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }) || (a < b ? -1 : a > b ? 1 : 0);

const sorted = <T extends { id: string }>(items: readonly T[]): T[] =>
  [...items].sort((x, y) => compareIds(x.id, y.id));

export const listFrames = (d: Diagram): Frame[] => sorted(Object.values(d.frames));
export const listResources = (d: Diagram): Resource[] => sorted(Object.values(d.resources));
export const listLinks = (d: Diagram): Link[] => sorted(Object.values(d.links));

export const framesOfKind = <K extends FrameKind>(d: Diagram, kind: K): FrameOf<K>[] =>
  listFrames(d).filter((f) => f.kind === kind) as FrameOf<K>[];

export const resourcesOfType = <T extends ResourceType>(d: Diagram, ...types: T[]): ResourceOf<T>[] =>
  listResources(d).filter((r) => (types as ResourceType[]).includes(r.type)) as ResourceOf<T>[];

export const getFrame = <K extends FrameKind>(d: Diagram, id: string | null | undefined, kind?: K) => {
  const f = id ? d.frames[id] : undefined;
  return (f && (!kind || f.kind === kind) ? f : undefined) as FrameOf<K> | undefined;
};

export const getResource = <T extends ResourceType>(
  d: Diagram,
  id: string | null | undefined,
  type?: T,
): ResourceOf<T> | undefined => {
  const r = id ? d.resources[id] : undefined;
  return (r && (!type || r.type === type) ? r : undefined) as ResourceOf<T> | undefined;
};

export const childFrames = (d: Diagram, parentId: string): Frame[] =>
  listFrames(d).filter((f) => f.parentId === parentId);

/** Resources whose own frame is `frameId` (not nested deeper). */
export const resourcesIn = (d: Diagram, frameId: string): Resource[] =>
  listResources(d).filter((r) => r.frameId === frameId);

/** Frame chain from the root Region down to `frameId` (inclusive). */
export const frameAncestry = (d: Diagram, frameId: string | null): Frame[] => {
  const chain: Frame[] = [];
  const seen = new Set<string>();
  let cur = frameId ? d.frames[frameId] : undefined;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentId ? d.frames[cur.parentId] : undefined;
  }
  return chain;
};

export const ancestorOfKind = <K extends FrameKind>(
  d: Diagram,
  frameId: string | null,
  kind: K,
): FrameOf<K> | undefined => frameAncestry(d, frameId).find((f) => f.kind === kind) as FrameOf<K> | undefined;

/** Whether `frameId` is `ancestorId` or nested inside it. */
export const isWithin = (d: Diagram, frameId: string | null, ancestorId: string): boolean =>
  frameAncestry(d, frameId).some((f) => f.id === ancestorId);

/** All frame ids inside `frameId` (inclusive). */
export const descendantFrameIds = (d: Diagram, frameId: string): Set<string> => {
  const out = new Set<string>([frameId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of Object.values(d.frames)) {
      if (f.parentId && out.has(f.parentId) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
};

export const regionOf = (d: Diagram): FrameOf<'region'> | undefined => framesOfKind(d, 'region')[0];

export const vpcOfFrame = (d: Diagram, frameId: string | null) => ancestorOfKind(d, frameId, 'vpc');
export const vpcOfResource = (d: Diagram, r: Resource) => vpcOfFrame(d, r.frameId);

export const zoneOfSubnet = (d: Diagram, subnetId: string): Zone | undefined =>
  ancestorOfKind(d, subnetId, 'az')?.config.zone;

export const subnetTier = (d: Diagram, subnetId: string): 'public' | 'private' | undefined =>
  getFrame(d, subnetId, 'subnet')?.config.tier;

/** Subnets a resource uses: its own frame for EC2, its `subnetIds` for spanning resources. */
export const subnetIdsOf = (d: Diagram, r: Resource): string[] => {
  if (RESOURCE_DEFINITIONS[r.type].spansSubnets) {
    const ids = (r.config as { subnetIds: readonly string[] }).subnetIds;
    return [...ids].filter((id) => getFrame(d, id, 'subnet')).sort(compareIds);
  }
  return r.frameId && getFrame(d, r.frameId, 'subnet') ? [r.frameId] : [];
};

export const zonesOf = (d: Diagram, r: Resource): Zone[] => {
  const zones = new Set<Zone>();
  for (const s of subnetIdsOf(d, r)) {
    const z = zoneOfSubnet(d, s);
    if (z) zones.add(z);
  }
  return [...zones].sort();
};

export const securityGroupIdsOf = (r: Resource): readonly string[] =>
  RESOURCE_DEFINITIONS[r.type].securable
    ? (r.config as { securityGroupIds: readonly string[] }).securityGroupIds
    : [];

export const securityGroupsOf = (d: Diagram, r: Resource): ResourceOf<'sg'>[] =>
  securityGroupIdsOf(r)
    .map((id) => getResource(d, id, 'sg'))
    .filter((g): g is ResourceOf<'sg'> => g !== undefined);

export const appsOf = (r: Resource): readonly AppId[] =>
  r.type === 'ec2' || r.type === 'asg' ? r.config.apps : [];

export const linksFrom = (d: Diagram, id: string, kind?: LinkKind): Link[] =>
  listLinks(d).filter((l) => l.from === id && (!kind || l.kind === kind));
export const linksTo = (d: Diagram, id: string, kind?: LinkKind): Link[] =>
  listLinks(d).filter((l) => l.to === id && (!kind || l.kind === kind));

export const usersOf = (d: Diagram): ResourceOf<'users'> | undefined => resourcesOfType(d, 'users')[0];
