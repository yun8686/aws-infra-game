import {
  addResource,
  connect,
  disconnect,
  duplicateResource,
  listLinks,
  moveResource,
  remove,
  resourcesOfType,
  updateConfig,
  type Diagram,
  type EditPolicy,
} from '../../src/model';
import { must } from '../model/builders';

// Locks only prevent removal, so config changes need no policy; the extra parameter keeps call sites uniform.
export const setConfig = (d: Diagram, id: string, patch: Record<string, unknown>, _policy?: EditPolicy) => {
  const cur = (d.resources[id]?.config ?? d.frames[id]?.config) as Record<string, unknown>;
  return must(updateConfig(d, id, { ...cur, ...patch })).diagram;
};

const webIds = (d: Diagram) => resourcesOfType(d, 'ec2').map((r) => r.id);

/** Exactly `count` EC2 web servers ("同じ設定でもう1台"), new ones round-robin over `subnets`. */
export const setWebServers = (
  d: Diagram,
  count: number,
  options: { subnets?: readonly string[]; size?: string; policy?: EditPolicy } = {},
): Diagram => {
  const subnets = options.subnets ?? ['subnet-3'];
  const policy = options.policy ?? {};
  let g = d;
  while (webIds(g).length < count) {
    const first = webIds(g)[0];
    if (!first) throw new Error('no web server to copy');
    const subnet = subnets[webIds(g).length % subnets.length] as string;
    g = must(duplicateResource(g, first, subnet, policy)).diagram;
  }
  while (webIds(g).length > count) g = must(remove(g, webIds(g).at(-1) as string, policy)).diagram;
  if (options.size) for (const id of webIds(g)) g = setConfig(g, id, { size: options.size }, policy);
  return g;
};

export const ASG_SMALL = { size: 'small', min: 2, desired: 2, max: 14, targetCpuPct: 60, warmupSec: 120 };

/** Add an Auto Scaling group across both private subnets, behind the ALB and connected to the DB. */
export const addAutoScaling = (d: Diagram, config: Record<string, unknown>, policy: EditPolicy = {}) => {
  const added = must(
    addResource(
      d,
      'asg',
      'vpc-1',
      { config: { ...ASG_SMALL, securityGroupIds: ['sg-2'], ...config } as never },
      policy,
    ),
  );
  let g = must(connect(added.diagram, 'traffic', 'alb-1', added.id)).diagram;
  g = must(connect(g, 'data', added.id, 'db-1')).diagram;
  return { diagram: g, asgId: added.id };
};

const withoutWebServers = (d: Diagram, policy: EditPolicy) =>
  webIds(d).reduce((g, id) => must(remove(g, id, policy)).diagram, d);

/** Replace the template's fixed web tier with an Auto Scaling group. */
export const replaceWebWithAutoScaling = (
  d: Diagram,
  config: Record<string, unknown>,
  policy: EditPolicy = {},
) => withoutWebServers(addAutoScaling(d, config, policy).diagram, policy);

/** Reference solution A: elastic small instances + larger database. */
export const solutionA = (d: Diagram, policy: EditPolicy = {}) =>
  setConfig(replaceWebWithAutoScaling(d, {}, policy), 'db-1', { instanceClass: 'db.large' }, policy);

/** Reference solution B: fewer, larger elastic instances with more headroom + larger database. */
export const solutionB = (d: Diagram, policy: EditPolicy = {}) =>
  setConfig(
    replaceWebWithAutoScaling(d, { size: 'medium', max: 8, targetCpuPct: 50 }, policy),
    'db-1',
    { instanceClass: 'db.large' },
    policy,
  );

/** Meets the SLOs with static over-provisioning, but costs more than the budget allows. */
export const overProvisioned = (d: Diagram) =>
  setConfig(setWebServers(d, 12), 'db-1', { instanceClass: 'db.large' });

export const withoutDatabaseLinks = (d: Diagram) =>
  listLinks(d)
    .filter((l) => l.kind === 'data')
    .reduce((g, l) => must(disconnect(g, l.id)).diagram, d);

/** Mission 2 reference: shop on an elastic group, orders on its own two instances in two AZs. */
export const twoAppsSeparated = (d: Diagram, policy: EditPolicy = {}) => {
  let g = addAutoScaling(d, { apps: ['shop'] }, policy).diagram;
  g = setConfig(g, 'web-1', { apps: ['orders'] }, policy);
  g = setConfig(g, 'web-2', { apps: ['orders'] }, policy);
  g = must(moveResource(g, 'web-2', 'subnet-4')).diagram;
  return setConfig(g, 'db-1', { instanceClass: 'db.large' }, policy);
};

/** Mission 2 alternative: keep both apps together but with lots of headroom. */
export const twoAppsColocatedWithHeadroom = (d: Diagram, policy: EditPolicy = {}) =>
  setConfig(
    replaceWebWithAutoScaling(
      d,
      { apps: ['shop', 'orders'], min: 3, desired: 3, max: 20, targetCpuPct: 40 },
      policy,
    ),
    'db-1',
    { instanceClass: 'db.large' },
    policy,
  );

/** Mission 2 naive: both apps on a normally tuned elastic group. */
export const twoAppsColocated = (d: Diagram, policy: EditPolicy = {}) =>
  setConfig(
    replaceWebWithAutoScaling(d, { apps: ['shop', 'orders'], max: 16 }, policy),
    'db-1',
    { instanceClass: 'db.large' },
    policy,
  );
