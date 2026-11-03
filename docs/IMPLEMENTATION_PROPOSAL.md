# Implementation Proposal

Version: 0.1
Status: Approved (2026-11-03)

この文書は仕様レビューの結果と、承認済みの実装方針をまとめたもの。個別の決定は `design/DECISIONS.md` の ADR を正とする。

## 1. 仕様の矛盾・不足と解決方針

| # | 論点 | 決定 |
|---|---|---|
| A1 | トラフィック入口が未定義 | システム管理ノード `external.internet` を導入。自由構築の初期グラフにも含め、削除不可（ADR 0010） |
| A2 | 配置（VPC⊃Subnet⊃EC2）と視覚グルーピングの区別 | 配置は型付き接続 `placed_in` で表す。グループ枠は接続から描画する（ADR 0009） |
| A3 | EC2 と Auto Scaling の重複 | EC2 = 固定台数のインスタンス群。ASG = インスタンス仕様＋スケーリングポリシーを持つ独立ノード（ADR 0011） |
| A4 | Security Group の表現 | SG はノード。`secured_by` 接続で適用。ルール送信元は `anywhere` / `vpc` / SG参照（ADR 0011） |
| A5 | IGW/NAT/Route Table なしでの public/private | MVPでは Subnet 設定 `tier: public \| private` で抽象化 |
| A6 | 冗長化の受け入れ条件と初回ミッションの不一致 | スパイク中に障害イベントを含めたシナリオを用意 |
| A7 | 月額予算とシミュレーション期間コストの不整合 | 月額見積 = 平常時コストレート × 730h + イベント期間の追加コスト |
| A8 | Auto Scaling の遅延表現 | 離散タイムステップ方式（ADR 0008） |
| B1 | 保守性の評価方法が未定義 | MVP では情報表示のみ、スコアには含めない |
| B2 | 変更制限の表現 | グラフではなくミッションのオーバーレイ（`lockedNodes`, `allowedServices`） |
| B3 | CloudWatch の役割 | ASG のスケーリングは CloudWatch なしでも動作。CloudWatch はアラーム・監視性に効く |
| B4 | セキュリティルールの粒度 | MVP: DB が public subnet / DB ポートが `anywhere` に公開 / 管理ポートが `anywhere` に公開 |
| B5 | 保存方式 | 下書き自動保存＋明示的な「提出」スナップショット。Undo はコマンド履歴 |
| B6 | UI 言語 | 日本語のみ。i18n キー構造は最初から用意（ADR 0012） |
| B7 | 複数解の保証 | 各ミッションに2つ以上の参照解を用意し、テストで合格を保証 |

## 2. 技術スタック（ADR 0004）

- TypeScript (strict) / Vite / React — Web(PWA) ファースト、ストア配布は後で Capacitor
- 状態管理: Zustand（UI状態のみ。ドメインは純粋関数）
- スキーマ検証: Zod（サービス設定、コンテンツJSON）
- 永続化: IndexedDB（ローカルのみ、ADR 0006）
- グラフ描画: 自前 SVG ＋ 層×AZ グリッドの自動レイアウト（ADR 0005）
- テスト: Vitest（ドメイン）、Playwright（スマホビューポートE2E）

## 3. モジュール構成

```text
src/
  domain/            # UI 非依存。React を import してはならない
    graph/           # グラフ型・ID・編集コマンド
    catalog/         # サービス定義・接続ルール（データ駆動）
    validation/      # 構造化された検証 finding
    simulation/      # (フェーズ2) 決定的タイムステップエンジン
    scoring/         # (フェーズ3) 評価
    missions/        # (フェーズ3) ミッション・制約オーバーレイ
  data/              # テンプレート・シナリオ・ミッションのコンテンツ
  app/ features/ shared/  # (フェーズ4以降) プレゼンテーション
tests/unit, tests/integration, tests/fixtures
```

境界は ESLint の `no-restricted-imports` で強制する（`src/domain` から `react` 等を import 禁止）。

## 4. テンプレート型と自由構築型の統一

```
Mission = { initialGraph, constraints, scenarioId, objectives, scoringWeights }
startProject(mission) → workingGraph = clone(initialGraph)
編集コマンド → validate() → simulate() → evaluate()   ← 全モード共通
```

- 自由構築: `initialGraph` は `external.internet` のみの最小ベースライン
- サンドボックス: 目標なし・全サービス許可のミッション
- エンジン側にモード分岐を持たない

## 5. MVP 実装工程

| Phase | 内容 |
|---|---|
| 0 | ADR 記録、雛形、CI |
| 1 | グラフ・カタログ・編集コマンド・検証（UI非依存）＋テスト |
| 1.5 | 375px 幅でのテンプレート読み取り専用描画スパイク |
| 2 | シミュレーション v1（負荷・LB・計算・DB・コスト） |
| 3 | 障害イベント・ASG・Multi-AZ・セキュリティ・評価、参照解テスト |
| 4 | アプリシェル、ダッシュボード、ブリーフィング、IndexedDB 自動保存 |
| 5 | エディタ（描画・ボトムシート・追加/接続/削除・Undo・検証パネル・一覧表示） |
| 6 | 結果/監視画面（タイムライン、ボトルネック→ノード） |
| 7 | チュートリアル、バランス調整、PWA、E2E |

## 6. 未決（リリース前に判断）

- 製品名に「AWS」を含めるか（商標確認）
- ストア配布の時期と Capacitor 化
