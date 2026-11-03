import { resourceDef } from './catalog';
import {
  getResource,
  linksFrom,
  securityGroupIdsOf,
  securityGroupsOf,
  usersOf,
  vpcOfResource,
} from './query';
import type { Diagram, Resource, ResourceConfigMap, SgRule } from './schema';

/** The port a resource accepts inbound traffic on, if it is a traffic target. */
export const inboundPortOf = (r: Resource): number | undefined => {
  const def = resourceDef(r.type);
  return def.inboundPort
    ? (def.inboundPort as (c: ResourceConfigMap[typeof r.type]) => number)(r.config)
    : undefined;
};

const ruleAllows = (d: Diagram, rule: SgRule, sg: Resource, source: Resource, port: number): boolean => {
  if (rule.port !== 'all' && rule.port !== port) return false;
  switch (rule.source.kind) {
    case 'anywhere':
      return true;
    case 'vpc': {
      if (source.type === 'users') return false;
      const a = vpcOfResource(d, sg);
      const b = vpcOfResource(d, source);
      return a !== undefined && a.id === b?.id;
    }
    case 'sg':
      return securityGroupIdsOf(source).includes(rule.source.sgId);
  }
};

/**
 * Whether inbound traffic from `sourceId` to `targetId` is allowed by the target's security groups.
 * A target with no security group receives nothing (the game's simplification).
 */
export const isTrafficAllowed = (d: Diagram, sourceId: string, targetId: string): boolean => {
  const source = getResource(d, sourceId);
  const target = getResource(d, targetId);
  if (!source || !target) return false;
  const port = inboundPortOf(target);
  if (port === undefined) return false;
  return securityGroupsOf(d, target).some((sg) =>
    sg.config.inbound.some((rule) => ruleAllows(d, rule, sg, source, port)),
  );
};

/** Resource ids reachable from Users along traffic links, in BFS order (Users included). */
export const reachableFromUsers = (d: Diagram): Set<string> => {
  const seen = new Set<string>();
  const start = usersOf(d);
  const queue = start ? [start.id] : [];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const l of linksFrom(d, id, 'traffic')) queue.push(l.to);
  }
  return seen;
};
