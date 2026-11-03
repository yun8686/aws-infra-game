# Technical Design — Initial Direction

Version: 0.1  
Status: Architecture principles; stack not yet selected.

## 1. Architecture goals

- Mobile-first application.
- Domain logic independent of UI framework.
- Shared graph model for template and free-construction modes.
- Data-driven AWS-like service catalog.
- Deterministic, testable simulation.
- Easy addition of new service models and mission scenarios.
- No dependency on real AWS infrastructure for gameplay.

## 2. Conceptual modules

### Presentation
- Project dashboard
- Mission briefing
- Infrastructure graph editor
- Service configuration sheet
- Monitoring dashboard
- Simulation results
- Progression / project management

### Domain
- Project
- InfrastructureGraph
- InfrastructureNode
- InfrastructureConnection
- ServiceDefinition
- Mission
- Scenario
- SimulationRun
- EvaluationResult

### Application services
- Load/save project state
- Apply graph edits
- Validate graph
- Run simulation
- Evaluate mission
- Generate explanations

### Simulation
- Workload generator
- Request-flow evaluator
- Compute capacity model
- Load-balancing model
- Database capacity model
- Failure/event processor
- Cost estimator
- Security rule evaluator
- Metrics aggregator

### Content
- Service catalog definitions
- Project templates
- Mission definitions
- Scenario profiles
- Educational explanations

## 3. Suggested repository structure

Final structure should be adapted after the technology stack is approved.

```text
src/
  app/                  # application entry and navigation
  features/
    projects/
    missions/
    infrastructure-editor/
    monitoring/
    simulation-results/
  domain/
    graph/
    services/
    missions/
    simulation/
    scoring/
  data/
    service-catalog/
    templates/
    scenarios/
  shared/
    ui/
    utilities/
tests/
  unit/
  integration/
  fixtures/
docs/
design/
assets/
```

## 4. Graph data model

Conceptual TypeScript shape:

```ts
type NodeId = string;
type ConnectionId = string;

type Point = {
  x: number;
  y: number;
};

type InfrastructureNode = {
  id: NodeId;
  serviceType: string;
  config: Record<string, unknown>;
  position: Point;
  metadata?: Record<string, unknown>;
};

type InfrastructureConnection = {
  id: ConnectionId;
  sourceNodeId: NodeId;
  targetNodeId: NodeId;
  connectionType: string;
  config?: Record<string, unknown>;
};

type InfrastructureGraph = {
  schemaVersion: number;
  nodes: InfrastructureNode[];
  connections: InfrastructureConnection[];
};
```

Important:
- `position` is presentation metadata, not infrastructure semantics.
- Connection type must express the meaning of the relationship.
- Config must be validated against the relevant service definition.
- Graph schema must be versioned for future migrations.
- Avoid untyped arbitrary configuration at runtime; validate it through service-specific schemas.

## 5. Service definition model

A service definition should be data-driven and include:
- `type`
- display metadata
- default configuration
- configuration validation schema
- allowed outgoing/incoming connection types
- dependencies and placement constraints
- simulation adapter/model identifier
- cost model identifier
- security checks
- educational description and hints

Do not put all service behavior into UI components.

## 6. Graph validation

Validation should return structured findings, not only a boolean.

Finding fields may include:
- severity: info / warning / error
- code
- affected node/connection IDs
- short message
- explanation
- suggested remediation

Validation categories:
- Missing required dependencies.
- Unsupported connection type.
- Invalid source/target relationship.
- Invalid or missing configuration.
- Invalid network placement.
- Security exposure.
- Orphaned resources.
- Mission-specific constraints.

Separate hard errors (simulation cannot run) from warnings (simulation can run but may score poorly).

## 7. Simulation architecture

Recommended pipeline:

1. Validate graph.
2. Load scenario and workload profile.
3. Build an execution/dependency representation from graph.
4. Apply workload over discrete time steps or scenario phases.
5. Calculate service capacity and queue/pressure.
6. Propagate bottlenecks and failures through dependencies.
7. Calculate metrics and estimated cost.
8. Evaluate security findings.
9. Compare results with mission objectives.
10. Produce explanations linked to graph nodes and scenario events.

Start with a deliberately small model. Do not build a general-purpose cloud emulator.

### Determinism

Simulation input should include a seed if randomness is used. Results should be reproducible from:
- graph version/configuration
- scenario version
- simulation parameters
- seed

### Model boundaries

Use explicit game parameters such as abstract request units, capacity units, and cost points. Do not imply they are direct AWS performance or pricing figures.

## 8. Persistence

Persistence technology is undecided.

The first playable MVP may use local persistence if that is sufficient for the chosen platform. Cloud accounts, synchronization, authentication, and backend services should be justified by requirements rather than assumed.

## 9. Testing strategy

- Unit tests: graph operations and validation.
- Unit tests: service configuration schemas.
- Unit tests: each simulation model.
- Integration tests: graph → simulation → evaluation.
- Scenario regression tests: known graph/scenario pairs and expected metric ranges.
- UI tests: phone viewport, tap workflows, bottom-sheet behavior.
- Property/invariant tests where useful: invalid references are never accepted; same seed/input is reproducible.

## 10. Technical decisions still open

See `OPEN_QUESTIONS.md`. Do not finalize stack or architecture details until reviewed.
