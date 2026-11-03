# Claude Code Project Instructions

## Project mission

Build a mobile-first cloud infrastructure management simulation game. The player acts as an infrastructure engineer managing multiple customer environments. Gameplay focuses on diagnosis, architecture decisions, configuration, simulation, and operational trade-offs—not AWS trivia quizzes.

## Mandatory first steps

1. Read `README.md` and all files in `docs/`.
2. Do not start implementation immediately.
3. Identify contradictions, missing requirements, risky assumptions, and decisions that block implementation.
4. Present a concise implementation proposal and ask for approval on unresolved high-impact decisions.
5. Do not silently choose a major technology stack, framework, persistence layer, monetization model, or target OS strategy.

## Product constraints

- Mobile-first UX. Core operations must be possible with taps; drag-and-drop is optional, never mandatory.
- Infrastructure is represented as a graph of nodes and connections.
- Node selection opens an editable configuration panel, preferably a bottom sheet on phones.
- Standard missions start from a provided infrastructure template and ask the player to extend or repair it.
- Advanced missions and sandbox mode support building from an empty graph.
- Both modes use the same graph schema, validation, and simulation engine.
- Multiple customer projects can exist concurrently.
- The game simulates cloud behavior locally/in-game. Do not create or modify real AWS resources.
- AWS service behavior must be modeled as an educational abstraction. Never imply that the simulation is an exact AWS capacity or pricing calculator.

## Engineering principles

- Keep domain logic independent from UI components.
- Separate service definitions, graph validation, simulation, mission rules, scoring, and presentation.
- Use deterministic simulation inputs where practical so scenarios are reproducible and testable.
- Make simulation assumptions explicit and documented.
- Validate graph changes before running a simulation.
- Prefer data-driven service definitions over hard-coded UI-specific logic.
- Add automated tests for graph validation, simulation calculations, mission completion, and scoring.
- Do not implement unsupported AWS features merely to make the UI look complete.
- Avoid premature microservices or backend infrastructure unless a confirmed requirement needs them.

## Workflow

- Before changing files, state the intended scope.
- Implement in small, reviewable steps.
- Run relevant tests and static checks after changes.
- Update documentation when behavior or assumptions change.
- Do not claim a feature is complete unless its acceptance criteria and tests are satisfied.

## Initial task

Review the specifications and produce:
1. A list of blocking decisions.
2. A proposed technology stack with rationale and alternatives.
3. A proposed folder/module architecture.
4. An MVP implementation sequence.
5. Risks and test strategy.

Wait for user approval before implementing the application.
