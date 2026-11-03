import type { FindingCode } from '../../../domain/validation/findings';

export interface FindingText {
  readonly message: string;
  readonly explanation: string;
  readonly remediation: string;
}

/** Japanese text for every finding code. `{name}` placeholders are filled from finding params. */
export const FINDING_TEXT_JA: { readonly [K in FindingCode]: FindingText } = {
  'graph.id_mismatch': {
    message: 'データのIDが一致しません',
    explanation: '保存データまたはコンテンツの内部IDが壊れています。',
    remediation: 'データを再読み込みしてください。',
  },
  'graph.dangling_connection': {
    message: '存在しないリソースへの接続があります',
    explanation: '接続の片方のリソースが見つかりません。',
    remediation: 'この接続を削除してください。',
  },
  'node.unknown_service': {
    message: '未対応のサービス種別です（{serviceType}）',
    explanation: 'このバージョンでは扱えないサービスが含まれています。',
    remediation: 'このリソースを削除してください。',
  },
  'connection.unknown_type': {
    message: '未対応の接続種別です（{connectionType}）',
    explanation: 'このバージョンでは扱えない接続が含まれています。',
    remediation: 'この接続を削除してください。',
  },
  'node.invalid_config': {
    message: '設定値が不正です（{field}）',
    explanation: '設定がサービスの許容範囲を満たしていません。',
    remediation: '設定パネルで値を見直してください。',
  },
  'connection.invalid_config': {
    message: '接続の設定値が不正です（{field}）',
    explanation: '接続の設定が許容範囲を満たしていません。',
    remediation: '接続の設定を見直してください。',
  },
  'connection.self_loop': {
    message: '自分自身には接続できません',
    explanation: '接続には異なる2つのリソースが必要です。',
    remediation: '別のリソースを接続先に選んでください。',
  },
  'connection.not_allowed': {
    message: 'この組み合わせは接続できません',
    explanation: 'この接続の種類は、選んだ2つのサービスの間では意味を持ちません。',
    remediation: '接続可能として強調表示されたリソースを選んでください。',
  },
  'connection.duplicate': {
    message: '同じ接続がすでにあります',
    explanation: '同じリソース間に同じ種類の接続は1本だけ作れます。',
    remediation: '既存の接続を使ってください。',
  },
  'connection.too_many': {
    message: '接続数が上限（{max}）を超えています',
    explanation: 'この種類の接続は1つのリソースから作れる数に上限があります。',
    remediation: '不要な接続を削除してください。',
  },
  'placement.missing': {
    message: '配置先が設定されていません',
    explanation: 'このリソースはネットワーク内のどこに置くかを決める必要があります。',
    remediation: '配置先（サブネットまたはVPC）に接続してください。',
  },
  'placement.too_many': {
    message: '配置先が多すぎます（最大 {max}）',
    explanation: 'このリソースを置ける場所の数には上限があります。',
    remediation: '配置先を減らしてください。',
  },
  'placement.mixed_vpc': {
    message: '異なるVPCにまたがって配置されています',
    explanation: '1つのリソースは1つのVPCの中にしか置けません。',
    remediation: '同じVPCのサブネットだけを配置先にしてください。',
  },
  'placement.security_group_vpc_mismatch': {
    message: 'セキュリティグループのVPCが異なります',
    explanation: 'セキュリティグループは同じVPCのリソースにしか適用できません。',
    remediation: '同じVPCのセキュリティグループを選んでください。',
  },
  'placement.alb_requires_two_azs': {
    message: 'ロードバランサーは2つ以上のAZに配置が必要です',
    explanation: 'ALBは複数のAZに置くことで、片方のAZの障害時も動き続けます。',
    remediation: '別のAZのサブネットを配置先に追加してください。',
  },
  'placement.rds_multi_az_requires_two_azs': {
    message: 'Multi-AZ には2つのAZのサブネットが必要です',
    explanation: 'スタンバイを別のAZに置くため、2つのAZのサブネットが必要です。',
    remediation: '別のAZのサブネットを追加するか、Multi-AZ をオフにしてください。',
  },
  'placement.internet_facing_requires_public_subnet': {
    message: 'インターネット向けALBはパブリックサブネットに置く必要があります',
    explanation: 'プライベートサブネットはインターネットから直接到達できません。',
    remediation: 'パブリックサブネットだけを配置先にしてください。',
  },
  'placement.internet_target_requires_public_subnet': {
    message: 'インターネットから直接受けるサーバーはパブリックサブネットが必要です',
    explanation: 'プライベートサブネットのサーバーにはインターネットから届きません。',
    remediation: 'ロードバランサー経由にするか、パブリックサブネットに配置してください。',
  },
  'entry.missing': {
    message: 'トラフィックの入口（Internet）がありません',
    explanation: 'ユーザーからのアクセスがどこから来るかが定義されていません。',
    remediation: '入口ノードを含む構成から始めてください。',
  },
  'entry.multiple': {
    message: '入口（Internet）が複数あります',
    explanation: '入口は1つだけ配置できます。',
    remediation: '余分な入口を削除してください。',
  },
  'graph.max_per_graph': {
    message: 'このサービスはこれ以上追加できません（最大 {max}）',
    explanation: 'このサービスは1つの構成に置ける数が決まっています。',
    remediation: '既存のものを使ってください。',
  },
  'dependency.no_request_path': {
    message: 'インターネットからサーバーへの経路がありません',
    explanation: 'リクエストを処理するサーバーにトラフィックが届かないため、シミュレーションできません。',
    remediation: 'Internet → ロードバランサー → サーバーの経路を接続してください。',
  },
  'dependency.internal_alb_from_internet': {
    message: '内部向けALBにインターネットから接続しています',
    explanation: '内部向け（internal）のALBはインターネットから到達できません。',
    remediation: 'ALBをインターネット向けに変更してください。',
  },
  'dependency.alb_no_targets': {
    message: 'ロードバランサーに転送先がありません',
    explanation: '転送先のないALBはリクエストを処理できず、エラーを返します。',
    remediation: 'ALBからサーバーまたはAuto Scalingに接続してください。',
  },
  'dependency.unreachable_compute': {
    message: 'このサーバーにはリクエストが届きません',
    explanation: '経路につながっていないサーバーは処理能力に寄与しませんが、コストはかかります。',
    remediation: 'ロードバランサーから接続するか、不要なら削除してください。',
  },
  'dependency.orphaned_resource': {
    message: 'どこからも利用されていないリソースです',
    explanation: '使われていないリソースは効果がなく、コストだけがかかります。',
    remediation: '必要な接続を追加するか、削除してください。',
  },
  'dependency.no_security_group': {
    message: 'セキュリティグループが適用されていません',
    explanation: 'このゲームでは、セキュリティグループのないリソースは受信通信をすべて拒否します。',
    remediation: '適切なルールを持つセキュリティグループを適用してください。',
  },
  'dependency.traffic_blocked_by_security_group': {
    message: 'セキュリティグループが通信を遮断しています',
    explanation: '接続はありますが、受け側のセキュリティグループのルールがこの通信を許可していません。',
    remediation: '送信元とポートに合う受信ルールを追加してください。',
  },
  'dependency.security_group_rule_dangling_reference': {
    message: '存在しないセキュリティグループを参照するルールがあります',
    explanation: '参照先が削除されたため、このルールは機能しません。',
    remediation: 'ルールを削除するか、参照先を選び直してください。',
  },
  'security.db_port_open_to_internet': {
    message: 'データベースのポートが全世界に公開されています',
    explanation: '誰でもデータベースへの接続を試みられる状態です。重大なリスクです。',
    remediation: '送信元をアプリケーションサーバーのセキュリティグループに限定してください。',
  },
  'security.all_ports_open_to_internet': {
    message: 'すべてのポートが全世界に公開されています',
    explanation: '不要なサービスまで外部から到達可能になります。重大なリスクです。',
    remediation: '必要なポートだけを許可してください。',
  },
  'security.admin_port_open_to_internet': {
    message: '管理用ポート（{port}）が全世界に公開されています',
    explanation: '不正ログインの試行を受けやすくなります。',
    remediation: '送信元を限定するか、ルールを削除してください。',
  },
  'security.db_in_public_subnet': {
    message: 'データベースがパブリックサブネットにあります',
    explanation: 'データベースは外部から到達できない場所に置くのが基本です。',
    remediation: 'プライベートサブネットに配置してください。',
  },
  'security.compute_directly_exposed': {
    message: 'サーバーがインターネットに直接公開されています',
    explanation: 'ロードバランサーを経由しないため、分散や保護ができません。',
    remediation: 'ロードバランサー経由の構成にしてください。',
  },
  'edit.node_not_found': {
    message: 'リソースが見つかりません',
    explanation: 'すでに削除されている可能性があります。',
    remediation: '画面を更新してください。',
  },
  'edit.connection_not_found': {
    message: '接続が見つかりません',
    explanation: 'すでに削除されている可能性があります。',
    remediation: '画面を更新してください。',
  },
  'edit.node_locked': {
    message: 'このリソースはミッションの条件で変更できません',
    explanation: '顧客の要望により、このリソースは維持する必要があります。',
    remediation: '他のリソースで要件を満たしてください。',
  },
  'edit.system_managed': {
    message: 'このノードは追加・削除できません',
    explanation: 'Internet ノードはシナリオのトラフィックの入口で、常に1つ存在します。',
    remediation: '他のリソースを編集してください。',
  },
  'edit.service_not_allowed': {
    message: 'このミッションではこのサービスを使えません',
    explanation: 'ミッションの条件で利用できるサービスが制限されています。',
    remediation: 'サービス一覧に表示されるものを使ってください。',
  },
};

export const formatFindingText = (
  template: string,
  params: Readonly<Record<string, string | number>> = {},
): string =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => (key in params ? String(params[key]) : whole));
