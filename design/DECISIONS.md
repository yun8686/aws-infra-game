# Architecture Decision Log

## 0001 — Shared graph model for all construction modes

Status: Accepted

Both template expansion and free construction use the same InfrastructureGraph model, validation pipeline, and simulation engine.

Rationale:
- Avoid duplicated systems.
- Allow a template project to evolve into a fully customized architecture.
- Enable sandbox mode without a separate implementation.

## 0002 — Tap-first mobile editor

Status: Accepted

Dragging may be supported, but core operations must work through taps and explicit actions.

Rationale:
- Touch precision is limited on phones.
- Drag-only workflows are difficult to discover and error-prone.
- Tap-to-select and tap-to-connect are accessible and testable.

## 0003 — Simulation is an educational abstraction

Status: Accepted

The game does not create real AWS resources and does not claim exact AWS performance or pricing.

Rationale:
- Keeps gameplay safe, affordable, and deterministic.
- Makes balancing and scenario authoring possible.
- Avoids misleading learners about production guarantees.
