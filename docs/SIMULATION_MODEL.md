# Simulation Model

Version: engine 1 / balance 1
Status: Phase 2 (steady topology). Failure events, Auto Scaling dynamics and Multi-AZ failover arrive in Phase 3.

> All numbers are **game-balance assumptions** chosen for teaching. They are not AWS capacity, latency or pricing figures.

Source of truth: `src/domain/simulation/` (formulas) and `src/domain/simulation/balance.ts` (numbers).

## Inputs and determinism

`simulate({ graph, scenario, seed })` is a pure function. The result carries an `inputHash` computed from the graph (semantic part only — layout is not part of the graph), scenario, seed, engine version and balance version. Identical inputs always give identical outputs. The only randomness is workload noise, drawn from a seeded PRNG (mulberry32).

The graph must pass `validateGraph` with no errors; otherwise the simulation is refused and the validation findings are returned.

## Units

| Quantity | Unit |
|---|---|
| Traffic | requests per second (rps), abstract |
| Database load | queries per second (qps), abstract |
| Time step | 60 simulated seconds |
| Cost | credits (cr), a game currency |

## Workload

A scenario defines `(minute, rps)` points; traffic is linearly interpolated between them and multiplied by `1 + noise × (2u − 1)` where `u` is the seeded random draw for the step. Each request issues `queriesPerRequest` database queries for every database the serving compute node is connected to.

## Request flow per step

1. **Entry**: traffic is split equally between the Internet node's `routes_to` targets. A target whose security groups do not allow the traffic fails all of its share (`sg_blocked`).
2. **Load balancer**: an ALB forwards only to targets that its security-group path allows *and* that have running instances (a blocked target fails health checks). Traffic is split in proportion to each target's instance count. With no eligible target, all its traffic fails (`no_healthy_targets`).
3. **Compute**: capacity = instances × per-instance capacity. Demand = arriving rps + backlog. Up to `queueSeconds` of capacity can wait in a backlog; anything beyond is dropped (`compute_saturated`). Unconnected compute receives nothing and contributes no capacity.
4. **Database** (for each `data_access` link of a serving compute node):
   - A blocked link fails those requests (`sg_blocked`).
   - Connection demand = Σ (instances × `poolSize`). If it exceeds the class limit, the excess share fails (`db_connections`). **Adding compute instances raises connection demand.**
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

Auto Scaling in Phase 2 runs at `desiredCapacity`; scaling behavior is added in Phase 3.

Every node that exists in the graph is billed, whether or not it receives traffic.

## Cost projection

- `runCost`: cost accumulated over the simulated window.
- `baselineHourly`: cost rate at the first step.
- `projectedMonthly = baselineHourly × 730 + max(0, runCost − baselineHourly × runHours)` — steady monthly cost plus the extra spent during the event.

## Outputs

- Per-step series: offered/success/error rps, error rate, latency, cost rate, per-node metrics (utilization, instances, connections, qps).
- Summary: total and failed requests, overall error rate, peak error rate, mean and p95 step latency, availability (share of steps with error rate ≤ 5%).
- Bottlenecks: contiguous windows per (cause, node) with peak pressure and failed-request count, sorted by impact. Causes: `compute_saturated`, `compute_high_utilization`, `db_capacity`, `db_high_utilization`, `db_connections`, `sg_blocked`, `no_healthy_targets`.

## Scenarios

| Id | Shape |
|---|---|
| `steady` | 50 rps for 60 min, 3% noise |
| `tv-spike` | 50 rps → ramp to 500 rps (min 30–40) → plateau to min 70 → decay to 50 by min 90 → 120 min total; 3% noise; 2 queries/request |
