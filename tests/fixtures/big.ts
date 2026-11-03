import {
  REGION_ID,
  USERS_ID,
  addFrame,
  addResource,
  connect,
  createBaseDiagram,
  type Diagram,
  type EditResult,
} from '../../src/model';

const must = (r: EditResult): { diagram: Diagram; id: string } => {
  if (!r.ok) throw new Error(r.finding.code);
  return r;
};

/** A crowded diagram: 3 AZs, 4 servers per private subnet, ALB, Auto Scaling, Multi-AZ RDS, 4 SGs. */
export const bigDiagram = (): Diagram => {
  let d = createBaseDiagram();
  const step = (r: EditResult) => {
    const x = must(r);
    d = x.diagram;
    return x.id;
  };
  const vpc = step(addFrame(d, 'vpc', REGION_ID, { name: 'production-vpc' }));
  step(addResource(d, 'igw', vpc));
  const priv: string[] = [];
  for (let i = 0; i < 3; i++) {
    const az = step(addFrame(d, 'az', vpc));
    step(addFrame(d, 'subnet', az, { config: { tier: 'public' } }));
    priv.push(step(addFrame(d, 'subnet', az, { config: { tier: 'private' } })));
  }
  const sgs = ['alb', 'web', 'db', 'admin'].map((n) =>
    step(addResource(d, 'sg', vpc, { name: `${n}-security-group` })),
  );
  const alb = step(
    addResource(d, 'alb', vpc, { name: 'frontend-load-balancer', config: { securityGroupIds: [sgs[0]!] } }),
  );
  const asg = step(addResource(d, 'asg', vpc, { config: { securityGroupIds: [sgs[1]!] } }));
  const db = step(
    addResource(d, 'rds', priv[0]!, {
      config: { multiAz: true, standbySubnetId: priv[1]!, securityGroupIds: [sgs[2]!] },
    }),
  );
  step(connect(d, 'traffic', USERS_ID, alb));
  step(connect(d, 'traffic', alb, asg));
  step(connect(d, 'data', asg, db));
  for (const s of priv) {
    for (let k = 0; k < 4; k++) {
      const web = step(addResource(d, 'ec2', s, { config: { securityGroupIds: [sgs[1]!] } }));
      step(connect(d, 'traffic', alb, web));
      step(connect(d, 'data', web, db));
    }
  }
  return d;
};
