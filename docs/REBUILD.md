# Rebuild: building an AWS architecture diagram

Version: 0.1 (2026-11-03)
Status: Approved by the owner. Implementation in progress (R1–R6). Decision record: ADR 0018.

The game is rebuilt so that the player's core activity is **drawing a standard AWS architecture diagram**: nested group frames (AWS Cloud › Region › VPC › Availability Zone › Subnet) with official AWS Architecture Icons. The player drills into a frame by tapping it, adds resources inside the open frame, connects them, configures them, and runs the same deterministic simulation and evaluation as before.

The previous implementation (graph of typed connections, `src/domain`) stays in git history. Principles carried over: determinism, educational abstraction (numbers are not AWS facts), one model and one engine for template and free-build modes, domain logic independent of UI, tests for validation, simulation, missions and scoring.

## 1. Data model (`src/model`)

```text
Diagram
  frames:    Region › VPC › AZ › Subnet  (each frame has one parent frame; the Region is the root,
                                         the AWS Cloud frame is drawn around it and is implicit)
  resources: each has exactly one frame (`frameId`), or none for the Users/Internet entry
  links:     traffic (request path) and data (database access) only
```

| Frame | Parent | Settings |
|---|---|---|
| Region | — (one per diagram, system-managed) | — |
| VPC | Region | `cidr` (informational) |
| AZ | VPC | `zone` (`az-a` / `az-b` / `az-c`, fictional, unique within the VPC) |
| Subnet | AZ | `tier` (`public` / `private`), `cidr` |

Real AWS: an AZ belongs to the Region and a VPC spans AZs. Architecture diagrams draw AZ boxes inside the VPC box, and the game follows the diagram convention. The AZ frame inside a VPC therefore means "the part of this VPC in that zone".

| Resource | Placed in (`frameId`) | Spans subnets (`subnetIds`) | Notes |
|---|---|---|---|
| Users (Internet) | outside the cloud | — | System-managed, exactly one. Traffic entry. |
| EC2 instance | Subnet | — | One instance (ADR 0015). Runs `apps` (ADR 0016). |
| Application Load Balancer | VPC | ≥ 2 AZs; public if internet-facing | |
| Auto Scaling group | VPC | ≥ 1 | Instance spec + target tracking. |
| RDS database | VPC | DB subnet group; Multi-AZ needs 2 AZs | |
| Security group | VPC | — | Attached by resources (`securityGroupIds`), not drawn as links. |
| CloudWatch | Region | — | At most one. Alarms / observability. |

Resources that span subnets live in the VPC frame and list their subnets as a setting, matching how they are drawn in AWS diagrams (a load balancer across the public subnets). All `subnetIds` and `securityGroupIds` must be inside the resource's VPC.

Links: `traffic` (Users → ALB / EC2, ALB → EC2 / Auto Scaling) and `data` (EC2 / Auto Scaling → RDS, setting `poolSize`). There are no placement or attachment links.

Identifiers are generated as `<prefix>-<n>` (the next free number). Default names follow AWS naming habits (`web-1`, `public-a`, `vpc-1`) and can be renamed. Diagram order is the natural sort of ids.

## 2. Edit commands

All edits are pure functions `command(diagram, args, policy) → { ok, diagram, id } | { ok: false, finding }`.

- `addFrame(kind, parentId)`: VPC in a Region, AZ in a VPC (next unused zone), Subnet in an AZ.
- `addResource(type, frameId)`: allowed frames per type as above. Spanning resources get suggested subnets (ALB: public subnets, one per AZ; Auto Scaling / RDS: private subnets, one per AZ).
- `updateConfig(id, config)`: the config is validated by the type's schema; subnet and security-group references must be inside the resource's VPC. Invalid input is rejected, so a stored diagram is always schema-valid.
- `rename`, `moveResource` (an EC2 instance to another subnet of the same VPC), `duplicateResource` (same settings and links, another subnet).
- `connect(kind, from, to)`, `disconnect(linkId)`.
- `remove(id)`: removing a frame removes everything inside it. Removing a subnet or security group also removes it from every `subnetIds`, `securityGroupIds` and security-group rule that referenced it. Links of removed resources are removed.
- Mission policy: locked resources cannot be changed or removed; `allowedTypes` limits what can be added. The Region and Users are system-managed.

## 3. Validation

Validation runs on every edit and before a simulation. Findings are structured (`code`, `severity`, `targetIds`, `params`, `riskLevel`) and their text lives in i18n. Errors block the simulation.

- **error**: missing entry, structure mismatch (wrong frame kind, dangling reference), missing or invalid subnets for a spanning resource, ALB needs two AZs, internet-facing ALB needs public subnets, Multi-AZ RDS needs two AZs, Users → private EC2, Users → internal ALB, no request path, duplicate AZ zone.
- **warning**: no security group, traffic blocked by a security group, ALB without targets, unreachable server, unused database, server without a database, app not served by any server.
- **info**: all serving servers in one AZ.
- **security** (warning with risk level): DB port / all ports / admin port open to anywhere, database in a public subnet, server exposed directly to the Internet.

## 4. Simulation, missions, scoring (`src/sim`, `src/game`)

The simulation compiles the diagram into the same execution structures as engine 4 (entry routes, load balancers with health checks, compute groups with apps and Auto Scaling, databases with Multi-AZ). Formulas, balance numbers and scenarios carry over unchanged (`docs/SIMULATION_MODEL.md`); only the input model changes, so the engine version becomes 5. AZ of an instance = the `zone` of its subnet's AZ frame.

Missions are recreated with the same intent and reference-solution tests:

1. **テレビ放送のアクセス急増** — starter: VPC with public/private subnets in two AZs, an ALB, two EC2 in one AZ, a locked RDS.
2. **ショップと受注管理の同居** — two apps with per-app objectives.
3. **サンドボックス** — empty Region; the player draws everything.

## 5. Presentation (`src/features`)

- **Diagram view**: the open frame fills the screen with its direct children: child frames as boxes (with a count summary and their resources' icons) and resources as official icons with labels. Spanning resources are drawn across the subnets they use when the VPC is open, and as a "this subnet is used by …" chip when a subnet is open.
- **Breadcrumb**: AWS Cloud › Region › vpc-1 › AZ a › public-a. Tapping any level opens it.
- **Arrows**: drawn between items visible in the open frame. A link to something outside the open frame ends at the frame edge with the other end's name.
- **Adding**: "＋ 追加" lists only what can be placed in the open frame.
- **Connecting**: from a resource's sheet, "接続" highlights valid targets; tap one.
- **Settings**: a bottom sheet per resource or frame, with placement fields (subnets, security groups) as tap-to-toggle chips.
- No drag-and-drop.

Official icons come from the AWS Architecture Icons package (release 2026-07-31). The subset used is committed under `src/assets/aws-icons/` with its source noted in `src/assets/aws-icons/SOURCE.md`. A single module maps resource and frame kinds to icon files so the set can be swapped.

## 6. Persistence

Saves use a new IndexedDB schema version. Saves from the previous model are not migrated (prototype). Projects are re-created from missions.
