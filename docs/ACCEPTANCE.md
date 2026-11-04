# MVP Acceptance Criteria — Traceability

Maps every criterion in `docs/MVP_SCOPE.md` §5 to the automated tests that verify it.
Run: `npm run check` (unit/integration) and `npm run test:e2e` (phone-viewport E2E, 375×812).

## Gameplay

| Criterion | Verified by |
|---|---|
| A new player can open the sample project and understand the customer request | `e2e/app.spec.ts` "a new player can take the TV spike job and read the brief"; `e2e/quality.spec.ts` guides and hints. *Comprehension itself still needs a human playtest.* |
| The player can inspect the current architecture | `e2e/app.spec.ts` "tabs keep project state…" (tap an icon → sheet); `features/diagram-layout.test.ts` (frame views) |
| The player can change at least one meaningful infrastructure setting | `e2e/editor.spec.ts` "mission 1 solved through the diagram…" (scaling, database class); `e2e/monitor.spec.ts` (instance size) |
| The player can add and connect at least one supported service | `e2e/editor.spec.ts` "draw a working architecture from an empty Region…" and "mission 1 solved through the diagram…" |
| The player can run the traffic-spike scenario | `e2e/app.spec.ts`, `e2e/editor.spec.ts`, `e2e/monitor.spec.ts` |
| The player sees metrics and at least one causal explanation | `e2e/monitor.spec.ts`; `e2e/app.spec.ts` (cause text in results) |
| The player can iterate and achieve a better result | `e2e/editor.spec.ts` (template fails → diagram changes → 目標達成); `game/missions.test.ts` |

## Editor

| Criterion | Verified by |
|---|---|
| Core actions are available through taps | all `e2e/*.spec.ts` use `tap()` on a touch phone profile |
| Dragging is not required to add or connect resources | `e2e/editor.spec.ts` (frames, resources, links, delete — all taps) |
| Invalid connections are rejected with understandable explanations | `model/commands.test.ts` (links, candidates); connect mode only offers valid targets and explains others in a toast |
| Deleting a resource handles dependents safely | `model/commands.test.ts` removal (frame cascade, subnet / SG reference cleanup, locks); `e2e/editor.spec.ts` (locked database blocks removing its AZ) |
| The diagram remains readable on a phone-sized viewport | `features/diagram-layout.test.ts` (frame drill-down, fits the width, arrows top to bottom); `e2e/app.spec.ts` (no horizontal scroll) |

## Simulation

| Criterion | Verified by |
|---|---|
| Same input diagram and scenario produce reproducible results | `sim/simulation.test.ts` determinism; `sim/failures.test.ts` determinism with events; `game/missions.test.ts` "is reproducible" |
| Increasing compute capacity improves compute-bound outcomes | `sim/simulation.test.ts` |
| Increasing compute alone does not solve a database-bound bottleneck | `sim/simulation.test.ts`; `game/missions.test.ts` |
| Adding valid redundancy changes the modeled impact of an eligible component failure | `sim/failures.test.ts` (AZ outage, Multi-AZ failover, Auto Scaling replacement, health checks) |
| Cost increases when resource count/size/duration increases | `sim/simulation.test.ts` |
| Disconnected or invalid components do not provide benefits | `sim/simulation.test.ts` (disconnected compute); `model/validate.test.ts`, `game/missions.test.ts` (invalid diagrams refused) |

## Mission evaluation

| Criterion | Verified by |
|---|---|
| Availability, performance, budget and basic security objectives | `game/scoring.test.ts`; `game/missions.test.ts` |
| Overall result and explanations | `game/scoring.test.ts`; `e2e/monitor.spec.ts` (grouped causes with links) |

## Quality

| Criterion | Verified by |
|---|---|
| Domain logic has automated unit tests | `tests/model/*`, `tests/sim/*`, `tests/game/*`, `tests/app/*` |
| Core simulation rules have tests | `sim/simulation.test.ts`, `sim/failures.test.ts`, `sim/multi-app.test.ts` |
| No real AWS resource is created | No network/cloud SDK dependency; the simulation is a pure local function (ADR 0003, 0008); works offline (`e2e/quality.spec.ts`) |
| Simulation assumptions are documented | `docs/SIMULATION_MODEL.md`, `docs/SERVICE_MODELS.md`, `docs/SCORING.md` |

## Beyond the MVP list

- Free construction uses the same diagram model, commands, validation, simulation and evaluation: `game/missions.test.ts` ("a diagram drawn from scratch evaluates like the same template"), `e2e/editor.spec.ts`.
- Autosave and unreadable saves (deleted at start-up, count shown once): `app/projects.test.ts`; persistence across reloads: `e2e/app.spec.ts`.
- Accessibility: axe serious/critical violations = 0 on the main screens (`e2e/quality.spec.ts`). Keyboard operation is out of scope for now (ADR 0014).

## Known limitations

- Edits made less than ~0.3 s before the page is closed may not be saved; a flush is attempted on page hide but browsers do not guarantee completion.
- Comprehension and difficulty need a human playtest; balance numbers are game assumptions (`docs/SCORING.md`).
