# Missions and Scoring

Version: 1
Source of truth: `src/domain/missions/`, `src/domain/scoring/evaluate.ts`, `src/data/missions/`.

All thresholds are **game-balance values** and are shown to the player. There are no hidden criteria.

## Mission definition

| Field | Meaning |
|---|---|
| `initialGraph` | `{ kind: 'template', templateId }` or `{ kind: 'baseline' }` — the only difference between template expansion and free construction |
| `scenarioId`, `seed` | Disclosed workload and failure events; the seed makes every run reproducible |
| `constraints.allowedServiceTypes` | Services the player may add (all if omitted) |
| `constraints.lockedNodes` | `no-delete` (configurable, not removable) or `read-only` |
| `objectives` | `maxErrorRate`, `maxP95LatencyMs`, `minAvailability`, `monthlyBudget` |
| `scoringWeights` | Weight per dimension for the overall score |

Flow: `startMission` → edit commands with the mission's edit policy → `runMission` (validate → simulate → evaluate).

## Dimensions

A mission passes only if **every** dimension passes. Scores are 0–100.

| Dimension | Pass condition | Score |
|---|---|---|
| Availability | `availability ≥ minAvailability` | 100 when passed; otherwise falls linearly to 0 at 20 points below the target |
| Performance | `errorRate ≤ maxErrorRate` **and** `p95 ≤ maxP95LatencyMs` | Worse of: error score (0 at +10 points over target), latency score (0 at 2× target) |
| Cost | `projectedMonthly ≤ monthlyBudget` | Within budget: 60 + up to 40 for headroom (full at ≤ 50% of budget). Over budget: 60 → 0 at 150% of budget |
| Security | No `critical` security finding | Critical → 0; otherwise 100 − 25 per major − 10 per minor |

Overall score = weighted mean of dimension scores, rounded. The cost dimension rewards efficient solutions, so adding the most expensive resources does not maximize the score.

Maintainability is not scored in the MVP.

## Feedback

- `keyBottlenecks`: up to three simulation bottlenecks that caused failed requests.
- `learningTopics`: derived from those bottlenecks (e.g. `db_connections` → connection pooling, `unhealthy_target` → health checks), plus cost optimization when over budget and security groups when security findings exist.

## Mission 1: TV traffic spike (`tv-spike`)

- Start: `ecommerce-starter` template (two small EC2 instances `web-1`/`web-2` in az-a, a small single-AZ database). `rds-1` is `no-delete` (the customer's data must be kept).
- Scenario: `tv-spike-incident`, seed 7.
- Objectives: error rate ≤ 1%, p95 ≤ 400 ms, availability ≥ 97%, monthly budget ≤ 16,000 cr.
- Weights: availability 3, performance 3, cost 2, security 2.

Calibration (verified by `tests/integration/missions.test.ts`):

| Architecture | Result |
|---|---|
| Template as is | Fails availability and performance (compute saturated) |
| 12 EC2 instances only | Fails (database connections and capacity) |
| 12 EC2 instances + db.large (static over-provisioning) | Meets SLOs, **fails budget** (~18,980 cr) |
| Reference A: Auto Scaling small 2–14 @60% + db.large | Passes (~11,700 cr) |
| Reference B: Auto Scaling medium 2–8 @50% + db.large | Passes (~13,150 cr) |
| Reference A + DB port open to anywhere | Fails security |
| 12 EC2 instances with their database links removed (playtest exploit, fixed in engine 3) | Fails (`no_database`) |
| Reference A with the default warm-up (180 s) | Narrowly fails availability (scale-out too slow for the ramp) — an intended iteration step |

## Mission 2: ショップと受注管理の同居 (`two-apps`)

- Start: `ecommerce-two-apps` — the mission 1 starter, with both EC2 instances running the shop and order management.
- Scenario: `tv-spike-two-apps`, seed 11. Shop: the TV spike (50 → 500 rps). Order management: 10 rps steady, 3× CPU per request, 3 queries per request. One instance fails at minute 55.
- Objectives per app: shop — error rate ≤ 1%, p95 ≤ 400 ms, availability ≥ 97%; order management — error rate ≤ 1%, **p95 ≤ 300 ms**, availability ≥ 98%. Budget ≤ 16,000 cr (whole project). Availability and performance dimensions take the worst app.

Calibration (verified by `tests/integration/mission-two-apps.test.ts`):

| Architecture | Result |
|---|---|
| Template as is | Fails both apps |
| Shop on Auto Scaling small 2–14 @60%; orders on two small EC2 in different AZs; db.large | **Passes** (~13,150 cr) |
| Both apps on one Auto Scaling group small 2–16 @60%; db.large | Fails order-management latency (noisy neighbour) → learning topic 負荷の分離 |
| Both apps on one group with headroom (min 3, max 20, @40%); db.large | Passes (~12,400 cr) — a tuned alternative |
| 14 shared fixed EC2 + db.large | Fails the budget |
