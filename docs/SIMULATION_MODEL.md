# Simulation Model

Version: engine 5 / balance 2
Status: Rebuild (ADR 0018). Engine 5 is engine 4 on the diagram model: same formulas, balance and scenarios.

> All numbers are **game-balance assumptions** chosen for teaching. They are not AWS capacity, latency or pricing figures.

Source of truth: `src/sim/` (formulas; `compile.ts` turns the diagram into the execution model) and `src/sim/balance.ts` (numbers). Scenarios: `src/content/scenarios.ts`.

## Inputs and determinism

`simulate({ diagram, scenario, seed })` is a pure function. The result carries an `inputHash` computed from the diagram, scenario, seed, engine version and balance version. Identical inputs always give identical outputs. The only randomness is workload noise, drawn from a seeded PRNG (mulberry32).

The diagram must pass `validateDiagram` with no errors; otherwise the simulation is refused and the validation findings are returned.

Failure events are part of the scenario and are **disclosed** to the player. When an event picks a random instance, it uses a second PRNG stream derived from the seed, so adding or removing events never changes the workload noise.

## Units

| Quantity | Unit |
|---|---|
| Traffic | requests per second (rps), abstract |
| Database load | queries per second (qps), abstract |
| Time step | 60 simulated seconds |
| Cost | credits (cr), a game currency |

## Workload

A scenario defines `(minute, rps)` points; traffic is linearly interpolated between them and multiplied by `1 + noise × (2u − 1)` where `u` is the seeded random draw for the step. Each request issues `queriesPerRequest` database queries for every database the serving compute node is connected to.

## Applications (engine 4, ADR 0016)

A scenario may define several applications. Each has its own workload, `queriesPerRequest` and `cpuPerRequest` (CPU units per request; a shop request is 1). A single-app scenario is the `shop` app with the top-level workload and `cpuPerRequest = 1`, which reproduces engine 3 exactly. One noise draw is made per app per step, in scenario order.

Servers run the apps listed in their config. Routing happens per app: the Internet splits an app's traffic over the entry routes that lead to a server running it, and a load balancer sends it only to targets running it (`no_app_target` when none). On a server, all apps share capacity measured in CPU units; when demand exceeds capacity, every app is served the same fraction, and the backlog and dropped requests are shared in proportion. Compute latency is `computeMs × cpuPerRequest × q(ρ)`, so heavy requests on a busy shared server slow down the most. Results include per-app step metrics and summaries, and bottlenecks name the affected apps.

## Request flow per step

1. **Entry**: traffic is split equally between the Users' `traffic` link targets. A target whose security groups do not allow the traffic fails all of its share (`sg_blocked`).
2. **Load balancer**: an ALB forwards only to targets that its security-group path allows (a blocked target fails health checks). Traffic is split in proportion to each target's *routable* instances: running instances plus failed instances that health checks have not caught yet. Detection takes `intervalSec × unhealthyThreshold`. Requests sent to an undetected failed instance fail (`unhealthy_target`). With nothing routable, all its traffic fails (`no_healthy_targets`).
   - Direct Users → server routing has no health checks: a failed server keeps receiving its share until the end of the run.
3. **Compute**: capacity = running instances × per-instance capacity. Pending (booting) instances do not serve traffic. Demand = arriving rps + backlog. Up to `queueSeconds` of capacity can wait in a backlog; anything beyond is dropped (`compute_saturated`). Unconnected compute receives nothing and contributes no capacity.
4. **Database**. When the scenario issues queries (`queriesPerRequest > 0`), the application needs a database: a serving compute resource with no `data` link fails every request it serves (`no_database`). Then, for each `data` link:
   - A blocked link fails those requests (`sg_blocked`).
   - A database that is down fails every request that needs it (`db_unavailable`).
   - Connection demand = Σ (running instances × `poolSize`). If it exceeds the class limit, the excess share fails (`db_connections`). **Adding compute instances raises connection demand.**
   - Query load above capacity fails proportionally (`db_capacity`).
5. **Latency** for successful requests: `ALB base + compute base × q(ρc) + backlog wait + Σ db base × queriesPerRequest × q(ρdb)`, where `q(ρ) = 1 / (1 − min(ρ, 0.9))`. Overall latency is the success-weighted mean; it is capped at the timeout.

## Capacity and cost table (balance 1)

| Resource | Capacity | Connections | Cost / hour |
|---|---|---|---|
| EC2 / ASG instance small | 50 rps | — | 1 cr |
| medium | 100 rps | — | 2 cr |
| large | 200 rps | — | 4 cr |
| xlarge | 400 rps | — | 8 cr |
| RDS db.small | 300 qps | 60 | 3 cr |
| db.medium | 600 qps | 120 | 6 cr |
| db.large | 1200 qps | 250 | 12 cr |
| db.xlarge | 2400 qps | 500 | 24 cr |
| RDS `provisioned` storage | ×1.5 capacity | — | ×1.5 |
| RDS Multi-AZ | (failover in Phase 3) | — | ×2 |
| ALB | not a bottleneck in MVP | — | 2 cr |
| CloudWatch | — | — | 0.5 cr + 0.1 cr per alarm |
| VPC / Subnet / Security Group | — | — | free |

Base latencies: ALB 5 ms, compute 30 ms, database 4 ms per query. Timeout 5000 ms. Backlog limit 5 s of capacity.

Every resource that exists in the diagram is billed, whether or not it receives traffic. Compute groups are billed for running + pending instances.

## Instances and failures

An EC2 resource is a single instance in its subnet; its AZ is the `zone` of the subnet's AZ frame. Auto Scaling instances are spread across the zones of the group's `subnetIds`.

| Event | EC2 instance (one per node, ADR 0015) | Auto Scaling group |
|---|---|---|
| `instance_failure` | The instance stays failed for the rest of the run | Detected after 60 s, terminated and replaced |
| `az_outage` | Fails if in the AZ; reboots (120 s) when the AZ returns | Detected after 60 s, replaced in healthy AZs |

New Auto Scaling instances become ready after `max(60 s, warmupSec)`. Launches go to the healthy AZ with the fewest instances; if no subnet AZ is healthy, nothing launches.

### Auto Scaling policy (target tracking)

After each step: `proposed = ceil(routedRps / (capacityPerInstance × targetCpuPct))`, clamped to `[min, max]`. `routedRps` includes requests lost to failed instances, so failures do not hide demand.
- Scale out when `proposed > desired` (cooldown 60 s).
- Scale in when `proposed < desired`, at most every 300 s.
- On scale in, failed instances are terminated first, then the newest pending, then the newest running.

### Database availability

The primary runs in the zone of the database's own subnet; a Multi-AZ standby in the zone of `standbySubnetId`.

| Event | Multi-AZ | Single-AZ |
|---|---|---|
| `db_failure` | 120 s failover to the standby AZ | Down 900 s |
| `az_outage` of the primary AZ | 120 s failover (if the standby AZ is healthy) | Down for the outage + 300 s |

Multi-AZ doubles the database cost. Load balancers are assumed to survive a single-AZ outage (validation requires two AZs).

## Cost projection

- `runCost`: cost accumulated over the simulated window.
- `baselineHourly`: cost rate at the first step.
- `projectedMonthly = baselineHourly × 730 + max(0, runCost − baselineHourly × runHours)` — steady monthly cost plus the extra spent during the event.

## Outputs

- Per-step series: offered/success/error rps, error rate, latency, cost rate, per-node metrics (utilization, instances, connections, qps).
- Summary: total and failed requests, overall error rate, peak error rate, mean and p95 step latency, availability (share of steps with error rate ≤ 5%).
- Bottlenecks: windows per (cause, node) with peak pressure and failed-request count, sorted by impact (gaps of ≤ 2 steps are merged). Causes: `compute_saturated`, `compute_high_utilization`, `compute_unavailable`, `unhealthy_target`, `no_healthy_targets`, `db_capacity`, `db_high_utilization`, `db_connections`, `db_unavailable`, `no_database`, `sg_blocked`.
- Timeline: scenario events and the system's reactions (failure detected, launches, instance ready, scale out/in, DB failover/recovery).

## Scenarios

| Id | Shape |
|---|---|
| `steady` | 50 rps for 60 min, 3% noise |
| `tv-spike` | 50 rps → ramp to 500 rps (min 30–40) → plateau to min 70 → decay to 50 by min 90 → 120 min total; 3% noise; 2 queries/request |
| `tv-spike-incident` | `tv-spike` + one random running instance fails at minute 55 (mission 1) |
| `az-a-outage` | 80 rps steady for 60 min; AZ `az-a` down from minute 15 for 20 min |
