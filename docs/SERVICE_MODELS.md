# Service Models

Version: 0.2 (diagram model, ADR 0018)
Status: Rebuild. Simulation behavior and numbers: `docs/SIMULATION_MODEL.md`. Design: `docs/REBUILD.md`.

All services are **educational abstractions**. Parameters are deliberately reduced and do not mirror the AWS console. Capacity, latency and cost values are game-balance assumptions, not AWS facts.

Source of truth in code: `src/model/` (schema, catalog, commands, validation).

## Frames

Frames are the boxes of an AWS architecture diagram. Each has one parent; the Region is the root and the AWS Cloud box is drawn around it.

| Frame | Inside | Settings | Notes |
|---|---|---|---|
| Region | — | — | One per diagram, system-managed. |
| VPC | Region | `cidr` | Informational only; overlap is not checked. |
| AZ | VPC | `zone` (`az-a` / `az-b` / `az-c`, fictional) | Unique per VPC. Drawn inside the VPC as in AWS diagrams (in AWS an AZ belongs to the Region; the box means "the part of this VPC in that zone"). |
| Subnet | AZ | `tier` (`public` / `private`), `cidr` | Internet Gateway, NAT Gateway and route tables are not modeled: `public` means "reachable from the Internet when security groups allow it". |

## Resources

| Resource | Placed in | Settings |
|---|---|---|
| Users | outside the cloud | System-managed entry for scenario traffic, exactly one. |
| Internet Gateway | VPC | — At most one per VPC. Traffic from Users into a VPC needs it (validation error otherwise). Drawn on the VPC's top border. Route tables are not modeled. |
| EC2 instance | Subnet | `size` (`small`…`xlarge`), `apps`, `securityGroupIds`. One instance (ADR 0015); more servers are more EC2 resources ("同じ設定でもう1台"). Port 80. |
| Application Load Balancer | VPC | `scheme`, `listener` (http 80 / https 443), `healthCheck` (`intervalSec`, `unhealthyThreshold`), `subnetIds` (≥ 2 AZs; public if internet-facing), `securityGroupIds`. |
| Auto Scaling group | VPC | `size`, `min` ≤ `desired` ≤ `max` (1–50), `targetCpuPct`, `warmupSec`, `apps`, `subnetIds`, `securityGroupIds`. Holds its own instances; replaces failed ones. Port 80. |
| RDS database | Subnet (the primary) | `instanceClass`, `storageTier`, `multiAz`, `standbySubnetId` (required with Multi-AZ, another AZ of the same VPC), `securityGroupIds`. Port 5432. The DB subnet group is not modeled separately: the primary's subnet and the standby's subnet are what is drawn. |
| Security group | VPC | `inbound[]`: `port` (1–65535 or `all`) and source (`anywhere`, `vpc`, or another security group). Outbound always allowed; allow-only rules. A resource with no security group receives nothing. |
| CloudWatch | Region | `alarms[]`. At most one. Observability; not needed for scaling. |

Load balancers and Auto Scaling groups sit in the VPC frame and list the subnets they span, as they are drawn in AWS diagrams. Every referenced subnet and security group must be in the resource's VPC.

## Links

| Kind | From → to | Settings |
|---|---|---|
| `traffic` | Users → ALB / EC2, ALB → EC2 / Auto Scaling | — |
| `data` | EC2 / Auto Scaling → RDS | `poolSize` (connections per instance) |

There are no placement or attachment links; placement is the frame (or `subnetIds`), security groups are a setting.

## Mission policy

- `lockedIds`: resources the customer requires. They can be reconfigured but not removed, and the subnets / security groups they use cannot be removed either.
- `allowedTypes`: limits what can be added.

## Validation

Findings are structured (`code`, `severity`, `targetIds`, `params`, optional `riskLevel`). Text: `src/i18n/findings.ts`.

- **error**: the simulation cannot run (structure problems, missing subnets, ALB without two AZs, internet-facing ALB in a private subnet, Multi-AZ without a standby subnet in another AZ, Users → a VPC without an Internet Gateway, Users → private EC2 or internal ALB, no request path).
- **warning**: runs but suffers (no security group, traffic blocked by a security group, ALB without targets, unreachable server, unused database, server without a database, app not served).
- **info**: every serving server in one AZ.

The `anywhere` source is shown as **Anywhere-IPv4 (0.0.0.0/0)**, as in the AWS console. Findings about it say the port is allowed from all IPv4 addresses, not "open to the Internet": whether the Internet can actually reach the resource also depends on the subnet, Internet Gateway and public IP, and the rule is flagged either way (it becomes exposed when the placement changes).

Security findings carry a `riskLevel`:

| Code | Risk |
|---|---|
| DB port (5432) open to `anywhere` | critical |
| All ports open to `anywhere` | critical |
| Admin port (22 / 3389) open to `anywhere` | major |
| RDS primary or standby in a public subnet | major |
| EC2 receives traffic directly from Users (no load balancer) | minor |
