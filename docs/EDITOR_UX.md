# Infrastructure Editor UX (MVP)

Status: Phase 5. Code: `src/features/infrastructure-editor/`.

Every core operation works with taps only (ADR 0002). Dragging is never required.

## Layout (portrait phone)

- Toolbar: **＋ 追加** (add service), **構成チェック** badge (⛔ errors / ⚠ warnings / ✓ OK), **一覧 / 図** toggle, undo ↶, redo ↷.
- Canvas: drill-down (ADR 0017). The **overview** shows Internet → load balancer → servers (one box per set of apps) → database with one arrow between layers and a summary in each box; tap a layer to open it (breadcrumb 「全体 › サーバー」 to go back), or tap a single-resource layer to open its settings. Inside a layer the resources are drawn in the tier × AZ layout (ADR 0005) with the neighbouring layers named as 「↑ … から」「↓ … へ」. 「ネットワーク・セキュリティ」 opens the placement map. Zoom: 標準 / ×1.5 / ×2, panning by native scrolling.
  - Servers (EC2, Auto Scaling) are drawn **once per AZ** they are placed in, joined by a dotted line, so nothing appears to straddle subnets. A Multi-AZ database shows its primary and a dashed standby; a single-AZ database is drawn only in its primary AZ. Load balancers are regional managed services: they are drawn inside the VPC but above the AZ/subnet boxes, with dotted placement lines to the public subnets they use (AWS still places a load balancer node in each of those subnets, which is why at least two AZs are required).
  - Bands follow where resources actually are: a server placed in a public subnet is drawn in the public band.
  - Every box carries a one-line summary of its key settings (e.g. `small × 2台`, `small・2〜14台`, `db.large・プライマリ`, `HTTP・インターネット向け`).
  - Selecting a resource emphasises its security groups and subnets.
- Node sheet starts with an **overview** in plain language: placement, instance counts per AZ, redundancy, protecting security groups with their inbound rules, request sources/targets, database and pool size.
- Bottom sheet: one at a time, non-modal, expandable via the grip button. Selecting a resource scrolls it into view above the sheet.
- Toast with **元に戻す** after add / connect / delete.

## Operations

| Task | Taps |
|---|---|
| Inspect / configure | Tap a node, chip, subnet or VPC area, or an item in the list view → sheet with fields generated from `config/fieldSpecs.ts` |
| Add a service | ＋ 追加 → pick from categories (system and mission-disallowed services are hidden) → for services that need placement, the **配置先を選択** step opens immediately |
| Connect | Node sheet → 接続を追加 → valid targets are highlighted on the canvas and listed in the sheet; invalid ones are dimmed and explain why when tapped. Direction is inferred, so tap order does not matter. If several connection types fit, a chooser appears |
| Edit a connection | Tap a traffic/data line, or a connection in the node sheet |
| Choose apps (multi-app missions) | EC2 / Auto Scaling sheet → **動かすアプリ** checkboxes (the last app cannot be removed); boxes show the apps line, e.g. `ショップ・受注` |
| Add another identical server | EC2 sheet → **＋ 同じ設定でもう1台** → choose its subnet (size, security groups, load balancer and database connections are copied) |
| Delete | Node sheet → 削除 → confirmation lists connections and security-group rules removed with it → undo available |
| Fix problems | 構成チェック → tap a finding → its resource opens |

## Editing rules

- All edits go through domain commands with the mission's edit policy; rejected edits never change the graph.
- Form changes use a draft: a valid value is applied immediately (one undo step); an invalid combination (e.g. min > max capacity) stays visible with an explanation until fixed.
- Locked resources show 🔒; delete is disabled with the reason shown.
- Errors block simulation; warnings do not.
