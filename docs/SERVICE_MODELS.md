# Service Models (MVP)

Version: 0.1
Status: Phase 3. Simulation behavior and numbers: `docs/SIMULATION_MODEL.md`.

All services are **educational abstractions**. Parameters are deliberately reduced and do not mirror the AWS console. Capacity, latency and cost values are game-balance assumptions, not AWS facts.

Source of truth in code: `src/domain/catalog/`.

## Connection types

| Type | Semantic | Direction | Allowed pairs |
|---|---|---|---|
| `placed_in` | structural placement | child → container | Subnet → VPC, Security Group → VPC, ALB / EC2 / Auto Scaling / RDS → Subnet |
| `routes_to` | request traffic | upstream → downstream | Internet → ALB, Internet → EC2, ALB → EC2, ALB → Auto Scaling |
| `data_access` | DB queries | client → database | EC2 → RDS, Auto Scaling → RDS (config: `poolSize`) |
| `secured_by` | firewall attachment | resource → SG | ALB / EC2 / Auto Scaling / RDS → Security Group |
| `monitors` | observability | CloudWatch → target | CloudWatch → ALB / EC2 / Auto Scaling / RDS |

Visual grouping (VPC / subnet boxes, AZ lanes) is derived from `placed_in`. Layout positions are stored outside the graph.

## Services

### Internet (`external.internet`)
- Not an AWS service. Fixed entry point for scenario traffic.
- System-managed: the player cannot add or delete it. Exactly one per playable graph.

### VPC (`network.vpc`)
- Config: `cidr` (IPv4 CIDR notation, informational only; overlap is not checked in MVP).

### Subnet (`network.subnet`)
- Config: `tier` (`public` | `private`), `az` (`az-a` | `az-b` | `az-c`, fictional), `cidr`.
- Placement: exactly one VPC.
- Simplification: Internet Gateway, NAT Gateway and route tables are not modeled. `tier: public` means "reachable from the Internet when allowed by security groups".

### Security Group (`network.security_group`)
- Config: `inboundRules[]` with `port` (1–65535 or `all`) and `source` (`anywhere` | `vpc` | another security group node).
- Placement: exactly one VPC. Attached to resources via `secured_by`; resources must be in the same VPC.
- Simplifications: outbound is always allowed; protocols are not distinguished; rules are allow-only.
- A resource with no security group receives no inbound traffic.

### Application Load Balancer (`lb.alb`)
- Config: `scheme` (`internet-facing` | `internal`), `listener` (`http` → port 80, `https` → port 443), `healthCheck` (`intervalSec`, `unhealthyThreshold`).
- Placement: 1–3 subnets, at least two different AZs. Internet-facing ALBs must use public subnets.

### EC2 (`compute.ec2`)
- A **fixed-count instance group**, not a single instance.
- Config: `instanceSize` (`small` | `medium` | `large` | `xlarge`), `instanceCount` (1–20).
- Placement: 1–3 subnets; instances are spread across them in the simulation.
- Application port: 80.
- When targeted directly from the Internet, all subnets must be public.

### Auto Scaling (`compute.autoscaling`)
- An independent node holding the instance spec and scaling policy (EC2 nodes are not attached to it).
- Config: `instanceSize`, `minCapacity` ≤ `desiredCapacity` ≤ `maxCapacity` (1–50), `targetCpuPct` (10–90), `warmupSec`.
- Scaling does not require a CloudWatch node. `warmupSec` is the time before a new instance is in service (minimum 60 s).
- Replaces failed instances automatically; fixed EC2 groups do not.
- Application port: 80.

### RDS (`database.rds`)
- Config: `instanceClass` (`db.small` | `db.medium` | `db.large` | `db.xlarge`), `storageTier` (`standard` | `provisioned`), `multiAz`.
- Connection limit is derived from the instance class (Phase 2 balance table).
- Placement: 1–3 subnets (DB subnet group abstraction). `multiAz: true` requires subnets in two AZs.
- Database port: 5432.

### CloudWatch (`monitoring.cloudwatch`)
- Config: `alarms[]` with `metric` (`cpu` | `errorRate` | `latency` | `dbConnections`) and `threshold`.
- Provides alarms and observability; not required for scaling.

## Validation

Findings are structured (`code`, `severity`, `category`, affected node/connection IDs, `params`, optional `riskLevel`). Text is resolved from i18n keys (`src/data/i18n/ja/findings.ts`).

- **error**: simulation cannot run (e.g. no entry, invalid config, invalid placement, no request path).
- **warning**: simulation runs but outcome or score may suffer (e.g. unreachable compute, traffic blocked by a security group, security exposure).
- **info**: advisory.

Security findings carry a `riskLevel`:

| Code | Risk |
|---|---|
| DB port (5432) open to `anywhere` | critical |
| All ports open to `anywhere` | critical |
| Admin port (22 / 3389) open to `anywhere` | major |
| RDS placed in a public subnet | major |
| EC2 receives Internet traffic directly (no load balancer) | minor |
