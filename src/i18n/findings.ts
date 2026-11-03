import type { FindingCode } from '../model';
import { appName } from './apps';
import { RESOURCE_LABEL } from './resources';

export interface FindingText {
  readonly message: string;
  readonly explanation: string;
  readonly remediation: string;
}

const editRefresh = {
  explanation: 'すでに削除されている可能性があります。',
  remediation: '画面を更新してください。',
};

/** Japanese text for every finding code. `{name}` placeholders are filled from finding params. */
export const FINDING_TEXT_JA: { readonly [K in FindingCode]: FindingText } = {
  'structure.wrong_frame': {
    message: '置ける枠が正しくありません',
    explanation: '保存データまたはコンテンツで、リソースや枠が本来置けない場所にあります。',
    remediation: 'このリソースを削除して、正しい枠の中に置き直してください。',
  },
  'structure.dangling_reference': {
    message: '存在しないものを参照しています',
    explanation: '削除されたサブネット・セキュリティグループ・リソースを参照しています。',
    remediation: '設定を開いて参照先を選び直すか、削除してください。',
  },
  'structure.duplicate_zone': {
    message: '同じAZ（{zone}）が2つあります',
    explanation: '1つのVPCの中で、同じアベイラビリティーゾーンの枠は1つだけです。',
    remediation: '片方のAZを別のゾーンに変更するか削除してください。',
  },
  'structure.region_count': {
    message: 'リージョンは1つだけ必要です',
    explanation: 'このゲームでは1つのリージョンの中に構成を作ります。',
    remediation: 'データを再読み込みしてください。',
  },
  'entry.missing': {
    message: 'ユーザー（入口）がありません',
    explanation: 'アクセスがどこから来るかが定義されていません。',
    remediation: 'ミッションから構成を作り直してください。',
  },
  'entry.multiple': {
    message: 'ユーザー（入口）が複数あります',
    explanation: '入口は1つだけです。',
    remediation: '余分な入口を削除してください。',
  },
  'diagram.max_per_diagram': {
    message: '{type} はこれ以上置けません（最大 {max}）',
    explanation: 'このサービスは1つの構成に置ける数が決まっています。',
    remediation: '既存のものを使ってください。',
  },
  'placement.subnets_required': {
    message: '使うサブネットが選ばれていません',
    explanation:
      'ロードバランサー・Auto Scaling・データベースは、どのサブネットで動くかを選ぶ必要があります。',
    remediation: '設定の「使うサブネット」で選んでください。',
  },
  'placement.alb_requires_two_azs': {
    message: 'ロードバランサーは2つ以上のAZのサブネットが必要です',
    explanation: 'ALBは複数のAZに置くことで、片方のAZの障害時も動き続けます。',
    remediation: '別のAZのサブネットも「使うサブネット」に追加してください。',
  },
  'placement.internet_facing_requires_public_subnet': {
    message: 'インターネット向けALBはパブリックサブネットに置く必要があります',
    explanation: 'プライベートサブネットはインターネットから直接到達できません。',
    remediation: 'パブリックサブネットだけを選んでください。',
  },
  'placement.rds_multi_az_requires_two_azs': {
    message: 'スタンバイはプライマリと別のAZに置く必要があります',
    explanation: 'AZ 障害に備えるため、スタンバイはプライマリと別のAZのサブネットに置きます。',
    remediation: '「スタンバイを置くサブネット」で別のAZのサブネットを選んでください。',
  },
  'placement.rds_standby_required': {
    message: 'Multi-AZ のスタンバイを置くサブネットが選ばれていません',
    explanation: 'Multi-AZ では、別のAZのサブネットにスタンバイ（待機用のデータベース）を置きます。',
    remediation: '設定の「スタンバイを置くサブネット」で、別のAZのサブネットを選んでください。',
  },
  'placement.igw_required': {
    message: 'この VPC にインターネットゲートウェイがありません',
    explanation:
      'インターネットからの通信は、VPC に付けたインターネットゲートウェイ（IGW）を通って入ります。IGW がないと、ユーザーのアクセスは VPC に届きません。',
    remediation: 'VPC を開いて「＋ 追加」からインターネットゲートウェイを追加してください。',
  },
  'placement.internet_target_requires_public_subnet': {
    message: 'ユーザーから直接受けるサーバーはパブリックサブネットが必要です',
    explanation: 'プライベートサブネットのサーバーにはインターネットから届きません。',
    remediation: 'ロードバランサー経由にするか、パブリックサブネットに移してください。',
  },
  'placement.single_az_compute': {
    message: 'リクエストを受けるサーバーが、すべて同じAZにあります',
    explanation: 'そのAZで障害が起きると、すべてのサーバーが止まります。',
    remediation:
      '別のAZのサブネットにもサーバーを置くと、AZ障害に強くなります（EC2 は「同じ設定でもう1台」、Auto Scaling は使うサブネットの追加）。',
  },
  'link.not_allowed': {
    message: 'この組み合わせはつなげません',
    explanation: 'この接続は、選んだ2つのサービスの間では意味を持ちません。',
    remediation: 'この接続を削除してください。',
  },
  'dependency.no_request_path': {
    message: 'ユーザーからサーバーへの経路がありません',
    explanation: 'リクエストを処理するサーバーにアクセスが届かないため、シミュレーションできません。',
    remediation: 'ユーザー → ロードバランサー → サーバーとつないでください。',
  },
  'dependency.internal_alb_from_internet': {
    message: '内部向けALBにユーザーからつないでいます',
    explanation: '内部向け（internal）のALBはインターネットから到達できません。',
    remediation: 'ALBをインターネット向けに変更してください。',
  },
  'dependency.alb_no_targets': {
    message: 'ロードバランサーに転送先がありません',
    explanation: '転送先のないALBはリクエストを処理できず、エラーを返します。',
    remediation: 'ALBからサーバーまたはAuto Scalingへつないでください。',
  },
  'dependency.unreachable_compute': {
    message: 'このサーバーにはリクエストが届きません',
    explanation: '経路につながっていないサーバーは処理能力に寄与しませんが、コストはかかります。',
    remediation: 'ロードバランサーからつなぐか、不要なら削除してください。',
  },
  'dependency.unused_database': {
    message: 'どのサーバーからも使われていないデータベースです',
    explanation: '使われていないリソースは効果がなく、コストだけがかかります。',
    remediation: 'サーバーからデータベースへつなぐか、不要なら削除してください。',
  },
  'dependency.no_security_group': {
    message: 'セキュリティグループが付いていません',
    explanation: 'このゲームでは、セキュリティグループのないリソースは受信通信をすべて拒否します。',
    remediation: '設定の「セキュリティグループ」で、適切なルールを持つものを選んでください。',
  },
  'dependency.traffic_blocked_by_security_group': {
    message: 'セキュリティグループが通信を遮断しています',
    explanation: 'つながってはいますが、受け側のセキュリティグループのルールがこの通信を許可していません。',
    remediation: '送信元とポートに合う受信ルールを追加してください。',
  },
  'dependency.compute_without_database': {
    message: 'このサーバーはデータベースにつながっていません',
    explanation:
      'このアプリはデータベースが必要です。つながっていないサーバーに届いたリクエストは失敗します。',
    remediation: 'サーバーからデータベースへつないでください。',
  },
  'dependency.app_not_served': {
    message: '「{app}」を動かしているサーバーがありません',
    explanation: 'このアプリへのリクエストを受けられるサーバーがないため、すべて失敗します。',
    remediation: 'サーバー（EC2 / Auto Scaling）の「動かすアプリ」で選んでください。',
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
    remediation: 'プライベートサブネットに置いてください（設定の「置くサブネット」）。',
  },
  'security.compute_directly_exposed': {
    message: 'サーバーがインターネットに直接公開されています',
    explanation: 'ロードバランサーを経由しないため、分散や保護ができません。',
    remediation: 'ロードバランサー経由の構成にしてください。',
  },
  'edit.not_found': { message: '対象が見つかりません', ...editRefresh },
  'edit.locked': {
    message: 'このリソースは顧客の要望で削除できません',
    explanation:
      '顧客データを守るため、このリソース（とそれが使うサブネット・セキュリティグループ）は残す必要があります。設定の変更はできます。',
    remediation: '他のリソースで要件を満たしてください。',
  },
  'edit.system_managed': {
    message: 'これは追加・削除できません',
    explanation: 'リージョンとユーザー（入口）は常に1つ存在します。',
    remediation: '他のものを編集してください。',
  },
  'edit.type_not_allowed': {
    message: 'このミッションでは {type} を使えません',
    explanation: 'ミッションの条件で利用できるサービスが制限されています。',
    remediation: '追加メニューに表示されるものを使ってください。',
  },
  'edit.wrong_frame': {
    message: 'この枠の中には置けません',
    explanation: '置ける場所はサービスごとに決まっています（例：EC2・RDS はサブネット、ALB・IGW は VPC）。',
    remediation: '置きたい枠を開いてから追加してください。',
  },
  'edit.invalid_config': {
    message: '設定値が不正です（{field}）',
    explanation: '設定がサービスの許容範囲を満たしていません。',
    remediation: '値を見直してください。',
  },
  'edit.outside_vpc': {
    message: '別のVPCのものは使えません',
    explanation: 'サブネットやセキュリティグループは、同じVPCの中のものだけを使えます。',
    remediation: '同じVPCの中から選んでください。',
  },
  'edit.link_not_allowed': {
    message: 'この組み合わせはつなげません',
    explanation: 'つなげられる相手はサービスごとに決まっています。',
    remediation: '強調表示された相手を選んでください。',
  },
  'edit.link_duplicate': {
    message: 'すでにつながっています',
    explanation: '同じ2つのリソースは1回だけつなげます。',
    remediation: '既存の接続を使ってください。',
  },
  'edit.max_reached': {
    message: '{type} はこれ以上置けません（最大 {max}）',
    explanation: 'このサービスは1つの構成に置ける数が決まっています。',
    remediation: '既存のものを使ってください。',
  },
  'edit.no_free_zone': {
    message: 'このVPCにはこれ以上AZを追加できません',
    explanation: 'このゲームではAZは a / b / c の3つです。',
    remediation: '既存のAZの中にサブネットを追加してください。',
  },
};

export const formatFindingText = (
  template: string,
  params: Readonly<Record<string, string | number>> = {},
): string =>
  template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (!(key in params)) return whole;
    const v = String(params[key]);
    if (key === 'app') return appName(v);
    if (key === 'type') return v in RESOURCE_LABEL ? RESOURCE_LABEL[v as keyof typeof RESOURCE_LABEL] : v;
    return v;
  });
