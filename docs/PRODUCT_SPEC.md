# Product Specification

Version: 0.1  
Status: Initial product definition

## 1. Product overview

### 1.1 Concept

A mobile-first infrastructure engineer simulation game. The player takes responsibility for several fictional customer systems and must design, configure, monitor, and improve their cloud infrastructure.

Missions are based on realistic operational situations:
- A TV appearance causes traffic to increase tenfold.
- A database becomes the bottleneck during a campaign.
- A service becomes unavailable after an instance failure.
- A customer requests lower monthly infrastructure costs.
- A security review discovers overly permissive network access.
- A new business requirement requires higher availability or disaster recovery.

The game teaches practical reasoning: identify bottlenecks, understand dependencies, choose an appropriate architecture, and evaluate trade-offs among availability, performance, security, and cost.

### 1.2 Product principles

1. **Decision-making over memorization**: AWS services are tools for solving problems, not quiz answers.
2. **Multiple valid solutions**: missions should allow more than one architecture where appropriate.
3. **Consequences are visible**: architecture and configuration choices affect simulation results.
4. **Progressive complexity**: begin with existing templates; introduce blank-canvas design progressively.
5. **Mobile-first interaction**: the player should not need desktop precision or complex drag gestures.
6. **Educational honesty**: simulated values are simplified teaching models, not exact AWS guarantees.

### 1.3 Target platform

- Primary: smartphone.
- Exact technology and distribution targets are undecided.
- Layout should support portrait orientation first.
- Tablet/desktop support may be considered later.

## 2. Core gameplay loop

1. Review active customer projects.
2. Open a project and inspect the customer's requirements and current architecture.
3. Inspect monitoring data, incidents, constraints, and budget.
4. Add, remove, connect, or configure infrastructure services.
5. Validate the architecture.
6. Run a simulation.
7. Review performance, availability, security, and cost outcomes.
8. Iterate or submit the solution.
9. Receive a score, explanation, reward, and follow-up project opportunities.

The player may switch between projects. The game should create prioritization decisions, but should not require real-time reflexes. Time pressure should be represented through a controllable in-game clock, deadlines, or simulation events.

## 3. Project / contract system

Each project represents a customer environment.

A project contains:
- Customer and business profile.
- Business service description.
- Requirements and service-level objectives.
- Budget constraints.
- Existing infrastructure graph, if any.
- Current operational state.
- Active incidents and scheduled events.
- Mission history and evaluation results.

### 3.1 Concurrent projects

The player can hold multiple projects at once. Each project has independent infrastructure, metrics, incidents, and constraints.

The project list should summarize:
- Project name and business type.
- Current health/status.
- Active mission or incident.
- Budget status.
- Deadline or next scheduled event, when relevant.

Switching projects must not discard unsaved changes.

### 3.2 Project types

**Template expansion projects**
- Start with an existing infrastructure graph.
- Player diagnoses and improves the architecture.
- Suitable for onboarding and standard campaign progression.

**Free-construction projects**
- Start from an empty graph or a minimal account/network baseline.
- Player designs the architecture from requirements.
- Suitable for advanced missions.

**Sandbox**
- Optional unrestricted practice area.
- Should use the same graph and simulation engine.
- No real AWS account or cloud resources are created.

The two project types are not separate technical systems. They are different initial conditions and constraints applied to the same infrastructure graph model.

## 4. Infrastructure editor

### 4.1 Graph model

Infrastructure is represented by:
- Nodes: services/resources such as VPC, subnet, load balancer, compute, database, storage, monitoring.
- Connections: relationships such as network attachment, request routing, data access, or dependency.
- Configuration: parameters attached to each node or connection.
- Layout: visual position and grouping metadata.

The graph must distinguish visual placement from actual infrastructure relationships. A line on screen must have a defined semantic connection type.

### 4.2 Mobile interaction

Core interactions:
- Tap a node to inspect it.
- Open a bottom-sheet or full-height editor to change settings.
- Add services from a categorized service tray.
- Select a source node, then select a target node to create a connection.
- Tap a connection to inspect or edit its properties.
- Delete nodes/connections through explicit actions.
- Use fit-to-screen, zoom, and pan controls.
- Auto-layout or guided layout to keep graphs readable.

Drag-and-drop may be supported as an enhancement, but no core task may require it.

### 4.3 Editor screens

- Project header: project name, budget/health indicators, save state.
- Graph canvas: nodes, connections, grouping, selection.
- Service tray: searchable/categorized service catalog.
- Configuration panel: context-specific settings.
- Validation panel: missing dependencies and invalid configurations.
- Simulation action: starts a scenario run.

### 4.4 Service configuration

Only meaningful educational parameters should be exposed. Do not attempt to reproduce every AWS console field.

Examples:
- EC2: instance family/size abstraction, instance count, availability-zone placement.
- ALB: listener/routing abstraction, target group, health-check settings.
- Auto Scaling: minimum/desired/maximum capacity, scaling metric and thresholds.
- RDS: instance class abstraction, storage/performance tier, connection limit, Multi-AZ setting.
- VPC/Subnet: CIDR abstraction, public/private classification, AZ placement.
- Security Group: source, destination, protocol/port rule abstraction.
- CloudFront: cache policy abstraction and origin.
- CloudWatch: metrics, alarm thresholds, notification targets.

Exact parameters and educational simplifications must be documented per service.

## 5. Service catalog

The catalog should be data-driven and expandable.

Candidate service groups:

| Category | Initial candidates |
|---|---|
| Networking | VPC, Subnet, Internet Gateway, NAT Gateway, Route Table, Security Group |
| Load balancing | Application Load Balancer |
| Compute | EC2, Auto Scaling |
| Containers | ECS (later MVP expansion) |
| Database | RDS |
| Storage | S3 |
| CDN/cache | CloudFront |
| Monitoring | CloudWatch |

Do not promise that all candidates are included in the first playable release. See `MVP_SCOPE.md`.

Each service definition should describe:
- Unique service type identifier.
- Display name, category, icon key, and short explanation.
- Config schema and defaults.
- Allowed connection types and compatibility rules.
- Required dependencies and placement constraints.
- Simulation capabilities and limitations.
- Cost-model inputs.
- Validation rules.

## 6. Simulation system

### 6.1 Purpose

The simulation estimates the consequences of the player's architecture and configuration under a scenario. It is an educational model, not a production-grade cloud emulator.

### 6.2 Inputs

- Infrastructure graph and configuration.
- Scenario traffic/workload profile.
- Failure events or scheduled changes.
- Mission requirements and budget.
- Simulation duration and time-step settings.

### 6.3 Outputs

- Request throughput and queue/backlog abstraction.
- Response-time estimate.
- Error rate / failed requests.
- Compute utilization.
- Database utilization / connection pressure.
- Availability estimate.
- Security findings.
- Estimated cost for the simulated period.
- Bottleneck explanations and event timeline.

### 6.4 Modeling principles

- Model request flow through graph dependencies.
- Compute capacity, load balancing, database capacity, caching, and network constraints should have explicit simplified rules.
- A service that is not connected or correctly configured must not magically contribute capacity.
- Bottlenecks should propagate through dependencies.
- Redundancy should affect failure outcomes only when the topology and configuration support it.
- Cost should respond to resource size, count, and simulated duration.
- Security checks should inspect explicit rules and exposure paths.
- Results should explain *why* a metric failed, not only show a red status.

### 6.5 Determinism and fairness

- Same graph, same scenario, and same random seed should produce reproducible results.
- Random failures, if used, must be seeded and disclosed.
- Missions should state their success criteria and constraints.
- Avoid hidden arbitrary scoring rules.

### 6.6 Educational disclaimer

The game uses simplified abstractions. Simulated capacity, latency, availability, and cost are not exact AWS measurements and must not be presented as guarantees or authoritative pricing.

## 7. Missions and scenarios

A mission includes:
- Customer request / narrative.
- Initial infrastructure graph.
- Scenario timeline and workload.
- Constraints: budget, deadline, allowed services, or change restrictions.
- Success criteria.
- Scoring weights.
- Hints and learning explanations.

### Example mission: TV exposure traffic spike

Customer: an e-commerce business.

Situation:
- A television program will feature the store.
- Traffic is expected to rise to approximately 10 times normal volume for a limited period.
- The customer wants to avoid outages and maintain acceptable response times.
- A monthly budget ceiling applies.

Player tasks:
1. Inspect the existing architecture and monitoring.
2. Identify compute and/or database bottlenecks.
3. Choose and configure suitable changes.
4. Run the traffic-spike simulation.
5. Review the timeline and fix remaining bottlenecks.
6. Submit the solution.

Possible approaches may include horizontal scaling, caching, database improvements, or a combination. The mission should not require one specific service if multiple solutions satisfy the objectives.

## 8. Evaluation and progression

Evaluate across independent dimensions:
- Availability: did the service remain available?
- Performance: were response time and error-rate objectives met?
- Cost: did the solution stay within budget?
- Security: were exposure and access rules acceptable?
- Maintainability: is the architecture understandable and operationally manageable?

Scoring should reward meeting requirements efficiently, not simply adding the most expensive resources.

Provide:
- Overall result.
- Per-dimension score.
- Key bottleneck(s).
- What worked.
- What remains risky.
- Suggested learning topics.

Progression may unlock more complex projects and service definitions. Do not make free-construction inaccessible solely because of player level; a sandbox can be available early.

## 9. Monitoring and operations

Monitoring is a gameplay surface, not decorative UI.

Show relevant time-series or status indicators such as:
- Request rate.
- CPU utilization.
- Database connection pressure.
- Response time.
- Error rate.
- Estimated cost accumulation.

Alarms should be configurable through monitoring services in later stages. Mission events may also provide logs or incident clues.

## 10. Economy and business management

Potential long-term systems:
- Project revenue / contract reward.
- Infrastructure running cost.
- Customer satisfaction.
- Reputation.
- Multiple concurrent project prioritization.
- New contract opportunities.
- Technical debt.

These systems are secondary to the core infrastructure learning loop and should not delay the first playable MVP.

## 11. Non-goals

- Creating real AWS resources.
- Exact reproduction of AWS Console.
- Exact AWS pricing calculator.
- Full AWS service coverage at launch.
- Requiring command-line or Terraform knowledge for core play.
- Real-time multiplayer.
- Requiring fast reflexes or constant online presence.

## 12. UX and accessibility

- Portrait-first layout.
- Large touch targets.
- Avoid dense desktop-style tables on phone screens.
- Avoid drag-only workflows.
- Use clear labels and explain AWS terminology contextually.
- Provide undo or confirmation for destructive graph edits.
- Preserve project state when switching tabs/projects.
- Support readable graph zoom levels and a list/outline alternative for complex graphs.
