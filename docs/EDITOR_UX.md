# Editor UX — drawing the architecture diagram

Status: Rebuild (ADR 0018). Code: `src/features/editor/`, `src/features/diagram/`.

## Principles

- Every operation is a tap; nothing needs dragging (ADR 0002). Keyboard operation is out of scope for now (ADR 0014).
- The player draws a standard AWS architecture diagram: AWS Cloud › Region › VPC › AZ › Subnet frames with the official AWS Architecture Icons.

## Navigating

- The editor opens on the VPC (or the Region when there is none). **Tap a frame** (VPC, AZ, subnet) to open it; the **breadcrumb** (リージョン › shop-vpc › AZ a › private-a) goes back out. The open frame is kept per project while switching tabs.
- **Region view**: Users above the AWS Cloud box; each VPC is a box with a preview of what it contains (icons × count).
- **VPC view**: the Internet Gateway on the VPC's top border (users' arrows pass through it), AZ columns, subnets as rows (public first). EC2 instances and databases are icons inside their subnet; servers that do not fit one row become one "EC2 ×n" icon that opens the subnet. A Multi-AZ database shows its primary and standby (プライマリ / スタンバイ) joined by a dotted sync line; database arrows go to the primary. Load balancers and Auto Scaling groups are **bands** across the subnets they use; security groups (with how many resources each is attached to) and spanning resources whose subnets are on different rows sit in the "VPC 共通" area.
- **AZ / subnet view**: the subnets with their contents in request order — load balancer bands, EC2 instances, Auto Scaling bands, databases.
- **Arrows**: traffic solid, database access dashed. Arrows into bands run straight up or down. A neighbour outside the open frame is named at the frame edge ("shop-alb から"); several outside neighbours of one item are merged ("web-5 ほか7件 へ"), and outgoing stubs run down the right edge.

## Building

- **＋ 追加** lists only what can be placed in the open frame: Region → VPC, CloudWatch; VPC → AZ, Internet Gateway, ALB, Auto Scaling, security group; AZ → public / private subnet; subnet → EC2, RDS.
- New load balancers and Auto Scaling groups get suggested subnets (one per AZ; public for an internet-facing ALB, private otherwise). Turning on Multi-AZ for a database suggests a standby subnet of the same tier in another AZ.
- **Resource sheet** (tap an icon): findings for it; **→ つなぐ** buttons for the links it can start; its links (with pool size for database links and a × to disconnect); settings as tap-to-toggle choices and steppers (size, apps, subnets, security groups, scaling, health checks, Multi-AZ, rules); name; **同じ設定でもう1台** for EC2; delete.
- **Connect mode** replaces the toolbar with a banner ("asg-1 からつなぐデータベースをタップ", 完了) so the whole diagram stays visible: valid targets are highlighted and also listed as chips, so a target outside the open frame can still be chosen. Each tap adds a link.
- **Security groups**: selecting a resource highlights its security groups; selecting a security group highlights the resources using it and lists them in its sheet.
- **Sticky bar**: one compact bar (undo, redo, 構成チェック, ＋ 追加; breadcrumb with ⚙ for the open frame's settings).
- **Frame settings** (⚙ next to the breadcrumb): subnet tier, AZ zone, name; delete the frame with everything inside it.
- **Delete** shows what goes with it (frames, resources, links). Locked resources (mission) cannot be deleted; neither can the subnets or security groups they use.
- **Undo / redo** in the toolbar and in each toast.
- **構成チェック** (⛔ errors / ⚠ warnings / ✓): tapping a finding opens the frame of the resource and its sheet.

## Accessibility

- Diagram items are buttons whose accessible name is their visible text (name, plus service or status for bands and monitored items); extra state is in `<desc>`.
- The whole area of a frame is tappable, not only its outline. Touch targets in sheets are at least 44 px.
