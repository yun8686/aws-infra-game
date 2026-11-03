# AWS Infrastructure Manager

スマートフォン向けの、インフラエンジニア育成シミュレーションゲーム。

プレイヤーは複数の顧客案件を担当し、AWSに似たクラウドサービス群を使ってインフラを設計・構築・運用する。アクセス急増、障害、セキュリティ要求、コスト削減などのミッションを解決する。

## このリポジトリの状態

このフォルダは **Claude Codeによる開発開始用の仕様・設計ベース** です。アプリケーション本体はまだ実装していません。

## 最初に読むファイル

1. `CLAUDE.md` — Claude Code向けの開発指示
2. `docs/PRODUCT_SPEC.md` — ゲーム仕様書
3. `docs/MVP_SCOPE.md` — MVPの範囲と受け入れ条件
4. `docs/TECHNICAL_DESIGN.md` — 技術設計の方針
5. `docs/OPEN_QUESTIONS.md` — 未決定事項

## 開発開始時の指示例

Claude Codeに次のように依頼してください。

> CLAUDE.mdとdocs配下の仕様書をすべて読んでください。まだ実装は始めず、仕様の矛盾・不足・技術的リスクを洗い出し、質問と推奨案を提示してください。

仕様確認後、技術スタックを決定してから実装に進みます。

## 開発

```bash
npm install
npm run dev      # 開発サーバー
npm run check    # 型チェック・lint・整形チェック・テスト
npm run test:e2e # スマホ画面サイズでの E2E テスト（Playwright）
npm run playtest # 同じ Wi-Fi のスマホから遊べるように起動（手順は docs/PLAYTEST.md）
npm run sim -- --scenario tv-spike --set db-1.instanceClass=db.large  # シミュレーションをコマンドラインで実行
npm run sim -- --mission tv-spike                                  # ミッションの条件で実行して評価
```

- ドメインロジック（`src/model/` 構成図モデル、`src/sim/` シミュレーション、`src/game/` ミッション・評価）は UI に依存しない純粋な TypeScript です。設計は `docs/REBUILD.md` を参照してください。
- 構成図のアイコンは AWS 公式の Architecture Icons を使用しています（`src/assets/aws-icons/SOURCE.md`）。
- サービスごとのモデルと簡略化の内容は `docs/SERVICE_MODELS.md` を参照してください。
- シミュレーションの計算式とバランス値は `docs/SIMULATION_MODEL.md` を参照してください。
- ミッションの定義と採点ルールは `docs/SCORING.md` を参照してください。
- 案件データはブラウザの IndexedDB に自動保存されます（サーバーには送信しません）。
- MVP の受け入れ条件とテストの対応表は `docs/ACCEPTANCE.md` を参照してください。
- ビルドした版はホーム画面に追加でき、初回表示後はオフラインでも遊べます（PWA）。
- 構成エディタの操作仕様は `docs/EDITOR_UX.md`、監視・結果画面は `docs/MONITORING_UX.md` を参照してください。
- 承認済みの実装方針は `docs/IMPLEMENTATION_PROPOSAL.md` と `design/DECISIONS.md` にあります。
