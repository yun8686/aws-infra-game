# MVP Scope and Acceptance Criteria

Version: 0.1

## 1. MVP objective

Deliver one complete playable loop that proves the core concept:

A player opens an existing e-commerce infrastructure, responds to a 10x traffic spike, modifies the graph and service settings, runs a simulation, and receives an explainable evaluation.

The MVP is not intended to cover all AWS services or the full business-management game.

## 2. Included in MVP

### 2.1 Project flow
- One playable customer project: e-commerce.
- Project dashboard and project detail.
- Existing infrastructure template.
- Ability to preserve configuration while navigating between editor, monitoring, and mission views.

### 2.2 Infrastructure editor
Initial service/resource set (subject to technical design review):
- VPC
- Public/Private Subnet abstraction
- Application Load Balancer
- EC2
- Auto Scaling
- RDS
- Security Group
- CloudWatch (initially as monitoring/alarms abstraction)

The first implementation may reduce the number of editable properties to keep the model manageable.

Required editor actions:
- Display a graph.
- Add supported nodes.
- Remove nodes.
- Create and remove supported connections.
- Select a node and edit its configuration.
- Validate the graph.
- Auto-layout or provide a readable default layout.
- Operate without mandatory drag-and-drop.

### 2.3 Simulation
- Baseline traffic and 10x traffic-spike scenario.
- Compute capacity abstraction.
- Load-balancer distribution abstraction.
- Database capacity/connection pressure abstraction.
- Basic failure/error and response-time estimates.
- Estimated cost comparison.
- Explainable bottleneck output.
- Reproducible results for the same inputs.

### 2.4 Mission evaluation
- Availability objective.
- Performance objective.
- Budget objective.
- Basic security objective.
- Overall result and explanations.

### 2.5 Free construction foundation
MVP must use a graph schema that supports an empty graph, even if a polished free-construction campaign is not part of the first release.

At minimum:
- Graph can be initialized empty in tests/development.
- Nodes and connections are not tied to a fixed template.
- Validation and simulation consume the same graph model for template and blank graph.

## 3. Explicitly deferred

- Multiple fully developed customer projects.
- Full campaign, reputation, contract economy, hiring.
- Multi-region and disaster recovery.
- ECS, Lambda, DynamoDB, S3, CloudFront full simulation.
- Exact AWS pricing.
- Detailed IAM policy language.
- Real AWS account integration.
- Terraform/CLI command input.
- Multiplayer and cloud sync unless separately approved.
- Monetization and ads.

## 4. Suggested first mission

### Mission: The TV traffic spike

Initial state:
- A small e-commerce application.
- Existing load balancer, compute, and database components.
- Compute capacity is insufficient for the peak.
- Database capacity may become a secondary bottleneck.

Event:
- Traffic increases to 10 times baseline for a defined simulated window.
- Traffic later returns toward normal.

Player objective:
- Keep error rate and response time within mission thresholds.
- Stay within a defined cost ceiling.
- Avoid introducing a critical security finding.

The exact numerical thresholds must be calibrated during implementation and documented as game-balance assumptions, not AWS facts.

## 5. MVP acceptance criteria

### Gameplay
- A new player can open the sample project and understand the customer request.
- The player can inspect the current architecture.
- The player can change at least one meaningful infrastructure setting.
- The player can add and connect at least one supported service/resource.
- The player can run the traffic-spike scenario.
- The player sees metrics and at least one causal explanation.
- The player can iterate and achieve a better result.

### Editor
- Core actions are available through taps.
- Dragging is not required to add or connect nodes.
- Invalid connections are rejected with understandable explanations.
- Deleting a node handles dependent connections safely.
- The graph remains readable on a phone-sized viewport.

### Simulation
- Same input graph and scenario produce reproducible results.
- Increasing compute capacity improves compute-bound outcomes.
- Increasing compute alone does not solve a database-bound bottleneck.
- Adding valid redundancy changes the modeled impact of an eligible component failure.
- Cost increases when resource count/size/duration increases.
- Disconnected or invalid components do not provide benefits.

### Quality
- Domain logic has automated unit tests.
- Core simulation rules have tests.
- No real AWS resource is created.
- Simulation assumptions are documented.
