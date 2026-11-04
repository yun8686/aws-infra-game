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

- ~~EC2 node = fixed-count instance group.~~ Superseded by ADR 0015. Auto Scaling node = instance spec + scaling policy (independent node, not attached to EC2).
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

## 0015 — An EC2 node is one instance in one subnet

Status: Accepted (2026-11-03). Supersedes the EC2 part of ADR 0011.

Playtest feedback: a configurable instance count and placement in several subnets do not exist for a real EC2 instance and made the configuration hard to understand. An EC2 node now represents exactly one instance: its only setting is the instance size and it is placed in exactly one subnet. More fixed servers are separate EC2 nodes, created quickly with "同じ設定でもう1台" (copies size, security groups, load-balancer and database connections; the player chooses the subnet). Changing the number of instances automatically is the job of Auto Scaling.

Consequences: the e-commerce template has two EC2 nodes (web-1, web-2) in the same AZ; monitoring summarises all EC2 instances as one series; saves made before this change lose the old instance count and EC2 nodes placed in several subnets show a placement error (prototype saves are not migrated).

## 0016 — Applications on servers: co-locate or separate

Status: Accepted (2026-11-03)

Playtest feedback: choosing which application a server runs creates a real design decision when a customer runs two applications — share servers (cheaper) or separate them (isolation, more servers).

- A small application catalog (`shop`, `orders`). EC2 and Auto Scaling configs have `apps` (at least one; older configs default to `shop`).
- Scenarios may define several apps, each with its own traffic, queries per request and CPU cost per request. Single-app scenarios are the shop with the top-level workload, so mission 1 behaves exactly as before.
- Load balancers send each app's requests only to servers that run it; an app no reachable server runs fails (`no_app_target`) and validation warns (`dependency.app_not_served`).
- Server capacity is counted in CPU units (one shop request = 1). Apps on the same server compete for it, so a surge of one app slows or drops the other (noisy neighbour). Auto Scaling scales on CPU units.
- Missions may set availability and performance objectives per app (`appObjectives`); the budget and security stay project-wide. A latency miss on a shared server adds the learning topic "負荷の分離".
- Mission 2 (ショップと受注管理の同居) is added; mission 1 stays single-app as the introduction. The UI shows the app choice only when a mission has more than one app.

## 0017 — Drill-down diagram: layers first, details on demand

Status: Accepted (2026-11-03). Refines ADR 0005.

Playtest feedback: with several servers stacked in one AZ column, request arrows crossed boxes and were hard to follow. The editor and monitor now open on a **layered overview**: Internet → load balancer → servers → database, one box per layer and one arrow between layers. Servers are grouped by the set of applications they run (ADR 0016), so separated apps show as separate boxes with their own arrows. Each box summarises its contents (counts per AZ, Auto Scaling range, database class and redundancy).

Opening a layer shows only its resources in the tier × AZ layout (all AZ columns kept for context, so an empty AZ is visible), with the neighbouring layers named above and below instead of crossing arrows. A "ネットワーク・セキュリティ" box opens the placement map (all resources, subnets and security groups, without traffic arrows). Single-resource layers open their settings directly. Findings, route focus and placement completion drill into the right layer; choosing a subnet shows the placement map.

Addendum (2026-11-03, playtest): the overview also has one card per **subnet** under 「サブネットごとに見る」, laid out as a grid (columns = AZs, rows = public then private). Opening a subnet shows the resources placed in it side by side, so a server and a database in the same subnet sit next to each other. A load balancer shows in each public subnet it uses, an Auto Scaling group in each subnet it spans, and a Multi-AZ database as primary or standby depending on the subnet. No traffic arrows are drawn in the subnet view; the request path lives in the overview. (An intermediate per-AZ version was replaced by per-subnet cards at the owner's request.)

## 0018 — Rebuild around an AWS architecture diagram

Status: Accepted (2026-11-03). Supersedes ADR 0005 (layout), 0009 (placement as connections), 0012 (icon part), 0017 (layered drill-down). Design: `docs/REBUILD.md`.

The owner asked to rebuild the experience so the player draws a standard AWS architecture diagram. Frames that enclose things in AWS diagrams become the unit of navigation and editing.

- **Model**: frames Region › VPC › AZ › Subnet, each with one parent. Resources have exactly one frame. EC2 sits in a subnet. Load balancers, Auto Scaling groups and databases sit in the VPC and list the subnets they span. Security groups are attached through a resource setting. CloudWatch sits in the Region. Links are only `traffic` and `data`.
- **Navigation**: tap a frame to open it; a breadcrumb goes back out. Resources are added inside the open frame.
- **Icons**: official AWS Architecture Icons, used under AWS's terms for architecture diagrams (the owner confirmed). The UI and docs keep the educational-abstraction disclaimer.
- **Internals**: rewritten in `src/model`, `src/sim`, `src/game`. The simulation formulas, balance and scenarios carry over (engine 5 = engine 4 behaviour on the new model).
- **Saves**: previous saves are not migrated.

Addendum (2026-11-03, owner feedback):
- **RDS sits in one subnet** (its primary), like EC2. Multi-AZ adds `standbySubnetId` in another AZ; the diagram shows primary and standby icons joined by a sync line. The DB subnet group is not modeled separately ("a database spanning subnets" felt wrong in the diagram).
- **Internet Gateway** is a resource the player adds to a VPC (one per VPC). Traffic from Users into a VPC requires it; it is drawn on the VPC's top border and users' arrows pass through it. Route tables and NAT remain out of scope.
- Diagram readability: servers that do not fit one row in the VPC view are drawn as "EC2 ×n" (opens the subnet); stubs to several outside neighbours are merged; security group attachments are highlighted and counted.

Addendum (2026-11-04, owner request): saves that cannot be parsed (older prototype formats) are deleted at start-up instead of being kept; the project list says once how many were removed.
