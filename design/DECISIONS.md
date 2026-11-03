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

## 0004 — TypeScript + React web (PWA) first

Status: Accepted (2026-11-03)

Build with TypeScript (strict), Vite and React as a mobile-first web app / PWA. Store distribution is deferred and planned via Capacitor.

Rationale:
- Most MVP complexity is UI-independent domain logic (validation, simulation, scoring), which is plain TypeScript.
- UI is form- and diagram-heavy, where the web platform is strongest.
- Fast iteration and Playwright phone-viewport testing.

Alternatives considered: Flutter (runner-up if native store release is required first), React Native, Unity, native.

## 0005 — Custom SVG graph renderer with tier × AZ auto-layout

Status: Accepted (2026-11-03)

No general-purpose node-editor library. Nodes are laid out automatically: rows are architecture tiers (entry → edge → compute → data), columns are availability zones. Player positioning is not required.

## 0006 — Local-only persistence for MVP

Status: Accepted (2026-11-03)

Project state is stored in IndexedDB on the device. No accounts, backend, or cloud sync in MVP.

## 0007 — Portrait-only for MVP

Status: Accepted (2026-11-03)

## 0008 — Discrete time-step simulation, computed instantly, played back as a timeline

Status: Accepted (2026-11-03)

Simulation is a pure function of (graph, scenario, params, seed, catalog version). The UI plays back the result. Editing during a run is not supported in MVP.

## 0009 — Placement is a typed connection

Status: Accepted (2026-11-03)

Containment (resource → subnet → VPC) is expressed with the `placed_in` connection type. Visual grouping is derived from these connections. Layout positions are stored outside the graph so they never affect simulation input.

## 0010 — System-managed Internet entry node

Status: Accepted (2026-11-03)

Traffic enters through a non-AWS, system-managed `external.internet` node. Every playable graph, including free-construction baselines, contains exactly one. It cannot be removed by the player.

## 0011 — Service modeling choices for MVP

Status: Accepted (2026-11-03)

- EC2 node = fixed-count instance group. Auto Scaling node = instance spec + scaling policy (independent node, not attached to EC2).
- Security Group is a node, applied via `secured_by`. Rule sources: `anywhere`, `vpc`, or a reference to another SG node.
- Subnet public/private is a config field (`tier`); IGW/NAT/Route Table are deferred.
- AZ is a subnet config value using fictional names (`az-a`, `az-b`, `az-c`).
- CloudWatch is not required for scaling; it provides alarms/observability.

## 0012 — Japanese-only UI with i18n keys; custom icons

Status: Accepted (2026-11-03)

User-facing text is referenced by keys from the start. Only Japanese is provided in MVP. AWS official icons are not used; service names are shown descriptively with an educational disclaimer. Product naming is to be reviewed before release.

## 0013 — Hand-written service worker for offline play

Status: Accepted (2026-11-03)

The app is an installable PWA (manifest, icons) with a small hand-written service worker: navigations are network-first with the cached app shell as fallback; same-origin assets are cache-first (Vite assets are content-hashed). Registered in production builds only. No build plugin, to keep dependencies small. Everything (simulation, saves) runs on the device, so the game works fully offline after the first visit.

## 0014 — Keyboard operation deferred

Status: Accepted (2026-11-03)

Per product direction, keyboard operation is not a requirement for now. Existing keyboard affordances are kept but not extended or tested. Touch and screen-reader basics (accessible names, contrast, reduced motion) are checked with axe in E2E.
