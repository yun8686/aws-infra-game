/**
 * The only module that references the official AWS Architecture Icons (src/assets/aws-icons/SOURCE.md).
 * Icons are inlined as data URIs so the single-file playtest build needs no extra assets.
 */
import cloud from '../../assets/aws-icons/group-aws-cloud.svg?raw';
import cloudDark from '../../assets/aws-icons/group-aws-cloud-dark.svg?raw';
import region from '../../assets/aws-icons/group-region.svg?raw';
import vpc from '../../assets/aws-icons/group-vpc.svg?raw';
import publicSubnet from '../../assets/aws-icons/group-public-subnet.svg?raw';
import privateSubnet from '../../assets/aws-icons/group-private-subnet.svg?raw';
import asgGroup from '../../assets/aws-icons/group-auto-scaling.svg?raw';
import ec2 from '../../assets/aws-icons/service-ec2.svg?raw';
import autoScaling from '../../assets/aws-icons/service-ec2-auto-scaling.svg?raw';
import rds from '../../assets/aws-icons/service-rds.svg?raw';
import cloudwatch from '../../assets/aws-icons/service-cloudwatch.svg?raw';
import elb from '../../assets/aws-icons/service-elb.svg?raw';
import igw from '../../assets/aws-icons/resource-internet-gateway.svg?raw';
import users from '../../assets/aws-icons/general-users.svg?raw';
import usersDark from '../../assets/aws-icons/general-users-dark.svg?raw';
import shield from '../../assets/aws-icons/general-shield.svg?raw';
import shieldDark from '../../assets/aws-icons/general-shield-dark.svg?raw';
import type { ResourceType } from '../../model';

const uri = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export interface IconSource {
  readonly light: string;
  readonly dark: string;
}
const same = (svg: string): IconSource => ({ light: uri(svg), dark: uri(svg) });

export const RESOURCE_ICONS: Readonly<Record<ResourceType, IconSource>> = {
  users: { light: uri(users), dark: uri(usersDark) },
  igw: same(igw),
  alb: same(elb),
  ec2: same(ec2),
  asg: same(autoScaling),
  rds: same(rds),
  sg: { light: uri(shield), dark: uri(shieldDark) },
  cloudwatch: same(cloudwatch),
};

export const GROUP_ICONS = {
  cloud: { light: uri(cloud), dark: uri(cloudDark) },
  region: same(region),
  vpc: same(vpc),
  publicSubnet: same(publicSubnet),
  privateSubnet: same(privateSubnet),
  autoScaling: same(asgGroup),
  /** AWS has no AZ icon (AZs are dashed boxes in diagrams); a dashed box in the AZ colour. */
  availabilityZone: same(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect x="4" y="6" width="32" height="28" rx="3" fill="none" stroke="#147EBA" stroke-width="2.5" stroke-dasharray="5 3"/></svg>',
  ),
} as const satisfies Record<string, IconSource>;
