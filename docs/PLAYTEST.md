# Playtest Plan — Mission 1 (TV traffic spike)

Version: 1 (2026-11-03)

## Goals

Answer with real players what automated tests cannot:

1. Do players **understand the customer request** and the objectives from the briefing alone?
2. Can they **find the cause** of a failure from the results and monitor tabs?
3. Can they **operate the editor on a phone** without help (add, place, connect, delete, configure)?
4. Is the **difficulty** right? In particular: is "default Auto Scaling warm-up narrowly misses availability" a good lesson or a frustration?
5. Is anything **misleading about AWS**? (The game must read as a simplified model, not as AWS facts.)

## Participants

- 5–6 people: 3 AWS beginners (no hands-on AWS), 2–3 junior infrastructure/backend engineers.
- Their own smartphone, portrait. No prior explanation of the game.

## Setup

```bash
npm install
npm run playtest        # builds and serves on the local network, port 4173
```

Open `http://<this computer's LAN IP>:4173/` on the phone (same Wi-Fi). Each phone keeps its own save (IndexedDB).

### Remote testers: private Claude artifact link

```bash
npm run build:artifact   # writes dist-artifact/infra-manager.html (JS and CSS inlined)
```

The page is published as a Claude artifact; it starts private and the owner chooses whom to share it with. Differences from the normal build: no offline/PWA support (service workers are not available in artifacts) and each tester's saves stay in their own browser. Deleting a project uses an in-page confirmation because the artifact frame suppresses `confirm()`.
To reset a phone between participants: delete the project from the list, or clear site data.

## Session (≈ 35 min)

1. **Intro (2 min)** — "This is a prototype of a cloud infrastructure game. Please think aloud. We are testing the game, not you." Do not explain the UI.
2. **Free play (25 min)** — Task card: "You have been asked to handle the 'TV放映によるアクセス急増' job. Try to meet the customer's goals." Stop at success or 25 minutes.
   - Do not help unless the participant is stuck for 3+ minutes; note every intervention.
3. **Sandbox glance (3 min)** — "Open the sandbox. What do you think you can do here?" (no need to build).
4. **Questionnaire (5 min)** — below.

## Observation sheet (one per participant)

| Item | Record |
|---|---|
| Participant type | beginner / junior engineer |
| Time to first simulation run | mm:ss |
| Attempts (shown on the project card as 挑戦回数) | n |
| Passed? Time to pass | yes/no, mm:ss |
| Final architecture | e.g. ASG small 2–14 + db.large |
| Opened 監視 tab? Used it to find the cause? | |
| Used 構成チェック / outline view / undo? | |
| Stuck points (screen, what they tried, how long) | |
| Misread terms or numbers | |
| Interventions by facilitator | |
| Moments of delight / frustration (quotes) | |
| Touch problems (missed taps, sheet covering content, scrolling) | |

## Questionnaire (5-point scale: 1 = strongly disagree … 5 = strongly agree)

1. 顧客が何を求めているか分かった。
2. 何が原因で目標未達になったのか分かった。
3. スマホで構成を変更するのは簡単だった。
4. 難しすぎず、簡単すぎなかった。
5. 結果の説明（原因・ヒント）は次に何をすべきかの役に立った。
6. 実際の AWS の仕組みを考えるきっかけになった。
7. 表示された数値が実際の AWS の性能や料金だと思った。（※ 低いほど良い）
8. 別の案件も遊んでみたい。

Free text: 一番わかりにくかったところ／もっと欲しい機能。

## Success criteria for this round

- ≥ 4 of 5 participants run a simulation within 5 minutes without help.
- ≥ 3 of 5 pass the mission within 25 minutes; ≤ 1 facilitator intervention per participant on average.
- Average ≥ 4 on Q1, Q2, Q3; average ≤ 2 on Q7.

## How results feed back

Log each issue in a table (screen, observation, severity: blocker / major / minor, count of participants). Fix blockers before the next round; balance changes go through `npm run sim -- --mission tv-spike` and the reference-solution tests (`tests/integration/missions.test.ts`), and are recorded in `docs/SCORING.md`.

## Pre-playtest review by the developer (2026-11-03)

A scripted novice walkthrough and an exploit search were run before involving people.

| # | Finding | Severity | Resolution |
|---|---|---|---|
| 1 | Disconnecting the web tier from its database let 12 small servers pass the mission at 12,410 cr — the app "worked" without its database | Blocker (violates "unconnected services must not help") | Engine 3: servers without a database link fail requests when the scenario needs a database (`no_database`); validation warning; regression test |
| 2 | Connection pool size 1 avoids the connection limit at no cost | Minor (database capacity still binds, so no shortcut today) | Not changed; revisit if a future mission makes it exploitable |
| 3 | The briefing showed all hints while the results revealed them progressively | Major (inconsistent, spoils the puzzle) | Briefing shows only a first step; hints are revealed per failed attempt |
| 4 | The first revealed hint repeated "run it first" after the player had already run it | Major | Hints rewritten to be actionable: read the monitor, consider Auto Scaling, the four required Auto Scaling connections |
| 5 | Placing servers in a single AZ gave no feedback | Minor | Info-level advisory `placement.single_az_compute`, shown in the node sheet and the check panel |
| 6 | Naive "12 servers" attempt fails with database connection errors from minute 0 — clear cause shown, hint mentions connections | OK | — |
| 7 | After adding Auto Scaling, the node sheet lists missing request path and security group | OK | — |

## Round 1 feedback (owner, 2026-11-03)

| # | Feedback | Resolution |
|---|---|---|
| 1 | 設定内容の把握が難しい — settings were only visible by opening each form | One-line setting summary on every box; plain-language overview at the top of the node sheet (placement, counts per AZ, redundancy, security groups with rules, connections); related security groups and subnets highlighted on selection; summaries in the list view |
| 2 | EC2 がサブネットをまたいで配置している表現になっている — multi-subnet resources were drawn as one box spanning AZ columns | Servers drawn once per AZ and linked; database primary/standby drawn in their own AZs |
| 3 | ALB は AZ の外に配置しているイメージ | Explained that an ALB is a regional managed service with a node in each selected subnet. Chosen representation (B): ALB inside the VPC, above the AZ/subnet boxes, with dotted placement lines to its public subnets |

| 4 | EC2 の設定が分かりにくい。EC2 を複数サブネットに配置することは実際には発生しないし、EC2 の台数を増減させることも実際にはできない | ADR 0015: an EC2 node is one instance in one subnet with only a size setting; "同じ設定でもう1台" launches another (copies settings and connections, then asks for the subnet); automatic count changes are Auto Scaling only; monitoring summarises EC2 instances; template uses web-1/web-2. Mission calibration unchanged (reference-solution tests pass) |

| 5 | EC2 で動かすアプリを選択できたほうが良い。1つの案件で2種類のアプリを動かし、同じサーバーにするか分けるかの判断を求められる | ADR 0016: servers choose apps; apps share CPU on a server; per-app routing, metrics and objectives; mission 2 (ショップと受注管理の同居) where naive co-location fails order-management latency, separation passes, generous headroom is a tuned alternative |

Open questions for human players: whether the four-connection Auto Scaling setup is discoverable without hint 3, whether "availability" (share of minutes with ≤ 5% errors) is understood, and whether 180 s default warm-up feels fair.
