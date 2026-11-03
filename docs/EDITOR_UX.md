# Editor UX — drawing the architecture diagram

Status: Rebuild (ADR 0018). Code: `src/features/editor/`, `src/features/diagram/`.

## Principles

- Every operation is a tap; nothing needs dragging (ADR 0002). Keyboard operation is out of scope for now (ADR 0014).
- The player draws a standard AWS architecture diagram: AWS Cloud › Region › VPC › AZ › Subnet frames with the official AWS Architecture Icons.

## Navigating

- The editor opens on the VPC (or the Region when there is none). **Tap a frame** (VPC, AZ, subnet) to open it; the **breadcrumb** (リージョン › shop-vpc › AZ a › private-a) goes back out. The open frame is kept per project while switching tabs.
- **Region view**: Users above the AWS Cloud box; each VPC is a box with a preview of what it contains (icons × count).
- **VPC view**: AZ columns, subnets as rows (public first). EC2 instances are icons inside their subnet. Load balancers, Auto Scaling groups and databases are **bands** across the subnets they use; security groups and resources whose subnets are on different rows sit in the "VPC 共通" area.
- **AZ / subnet view**: the subnets with their contents in request order — load balancer bands, then servers, then databases.
- **Arrows**: traffic solid, database access dashed. Arrows into bands run straight up or down. A neighbour outside the open frame is named at the frame edge ("shop-alb から").

## Building

- **＋ 追加** lists only what can be placed in the open frame: Region → VPC, CloudWatch; VPC → AZ, ALB, Auto Scaling, RDS, security group; AZ → public / private subnet; subnet → EC2.
- New load balancers, Auto Scaling groups and databases get suggested subnets (one per AZ; public for an internet-facing ALB, private otherwise).
- **Resource sheet** (tap an icon): findings for it; **→ つなぐ** buttons for the links it can start; its links (with pool size for database links and a × to disconnect); settings as tap-to-toggle choices and steppers (size, apps, subnets, security groups, scaling, health checks, Multi-AZ, rules); name; **同じ設定でもう1台** for EC2; delete.
- **Connect mode**: valid targets are highlighted on the diagram and listed in a compact sheet, so a target outside the open frame can still be chosen. Each tap adds a link; close to finish.
- **Frame settings** (⚙ under the breadcrumb): subnet tier, AZ zone, name; delete the frame with everything inside it.
- **Delete** shows what goes with it (frames, resources, links). Locked resources (mission) cannot be deleted; neither can the subnets or security groups they use.
- **Undo / redo** in the toolbar and in each toast.
- **構成チェック** (⛔ errors / ⚠ warnings / ✓): tapping a finding opens the frame of the resource and its sheet.

## Accessibility

- Diagram items are buttons whose accessible name is their visible text (name, plus service or status for bands and monitored items); extra state is in `<desc>`.
- The whole area of a frame is tappable, not only its outline. Touch targets in sheets are at least 44 px.
