# MVP Acceptance Criteria — Traceability

Maps every criterion in `docs/MVP_SCOPE.md` §5 to the automated tests that verify it.
Run: `npm run check` (unit/integration) and `npm run test:e2e` (phone-viewport E2E, 375×812).

## Gameplay

| Criterion | Verified by |
|---|---|
| A new player can open the sample project and understand the customer request | `e2e/app.spec.ts` "a new player can take the TV spike job and read the brief"; `e2e/quality.spec.ts` guides and hints. *Comprehension itself still needs a human playtest.* |
| The player can inspect the current architecture | `e2e/app.spec.ts` "tabs keep project state…" (tap a node → sheet) |
| The player can change at least one meaningful infrastructure setting | `e2e/editor.spec.ts` "change a setting, see the cost estimate move, and undo it" |
| The player can add and connect at least one supported service | `e2e/editor.spec.ts` "solve the TV spike mission with taps only" |
| The player can run the traffic-spike scenario | `e2e/app.spec.ts`, `e2e/editor.spec.ts`, `e2e/monitor.spec.ts` |
| The player sees metrics and at least one causal explanation | `e2e/monitor.spec.ts`; `e2e/app.spec.ts` (cause text in results) |
| The player can iterate and achieve a better result | `e2e/editor.spec.ts` (first run fails availability → change warm-up → passes); `integration/missions.test.ts` |

## Editor

| Criterion | Verified by |
|---|---|
| Core actions are available through taps | all `e2e/*.spec.ts` use `tap()` on a touch phone profile |
| Dragging is not required to add or connect nodes | `e2e/editor.spec.ts` (add, place, connect, delete without drag) |
| Invalid connections are rejected with understandable explanations | `unit/graph-commands.test.ts`, `unit/candidates.test.ts`; `e2e/editor.spec.ts` "invalid connections are explained…" |
| Deleting a node handles dependent connections safely | `unit/graph-commands.test.ts` removeNode (cascade, SG rule cleanup, locks); `e2e/editor.spec.ts` (confirmation lists connections) |
| The graph remains readable on a phone-sized viewport | `unit/tier-layout.test.ts` (3 AZs fit 375 px, no overlap, ≥ 44 px targets); `e2e/app.spec.ts` (no horizontal scroll) |

## Simulation

| Criterion | Verified by |
|---|---|
| Same input graph and scenario produce reproducible results | `unit/simulation.test.ts` determinism; `unit/failures.test.ts` determinism with events; `integration/missions.test.ts` "is reproducible" |
| Increasing compute capacity improves compute-bound outcomes | `unit/simulation.test.ts` |
| Increasing compute alone does not solve a database-bound bottleneck | `unit/simulation.test.ts`; `integration/missions.test.ts` |
| Adding valid redundancy changes the modeled impact of an eligible component failure | `unit/failures.test.ts` (AZ outage, Multi-AZ failover, Auto Scaling replacement, health checks) |
| Cost increases when resource count/size/duration increases | `unit/simulation.test.ts` |
| Disconnected or invalid components do not provide benefits | `unit/simulation.test.ts` (disconnected compute); `unit/validation.test.ts` (invalid graphs refused) |

## Mission evaluation

| Criterion | Verified by |
|---|---|
| Availability, performance, budget and basic security objectives | `unit/scoring.test.ts`; `integration/missions.test.ts` |
| Overall result and explanations | `unit/scoring.test.ts`; `e2e/monitor.spec.ts` (grouped causes with links) |

## Quality

| Criterion | Verified by |
|---|---|
| Domain logic has automated unit tests | `tests/unit/*` (graph, catalog, validation, simulation, scoring, projects) |
| Core simulation rules have tests | `unit/simulation.test.ts`, `unit/failures.test.ts` |
| No real AWS resource is created | No network/cloud SDK dependency; the simulation is a pure local function (ADR 0003, 0008); works offline (`e2e/quality.spec.ts`) |
| Simulation assumptions are documented | `docs/SIMULATION_MODEL.md`, `docs/SERVICE_MODELS.md`, `docs/SCORING.md` |

## Beyond the MVP list

- Free construction uses the same graph, commands, validation, simulation and evaluation: `integration/shared-pipeline.test.ts`, `integration/missions.test.ts`.
- Autosave and corrupt-save handling: `unit/projects.test.ts`; persistence across reloads: `e2e/app.spec.ts`.
- Accessibility: axe serious/critical violations = 0 on the main screens (`e2e/quality.spec.ts`). Keyboard operation is out of scope for now (ADR 0014).

## Known limitations

- Edits made less than ~0.3 s before the page is closed may not be saved; a flush is attempted on page hide but browsers do not guarantee completion.
- Comprehension and difficulty need a human playtest; balance numbers are game assumptions (`docs/SCORING.md`).
