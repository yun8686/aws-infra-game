import type { ConnectionId, NodeId } from '../graph/types';

export const FINDING_CODES = [
  // structure
  'graph.id_mismatch',
  'graph.dangling_connection',
  'node.unknown_service',
  'connection.unknown_type',
  // config
  'node.invalid_config',
  'connection.invalid_config',
  // connection rules
  'connection.self_loop',
  'connection.not_allowed',
  'connection.duplicate',
  'connection.too_many',
  // placement
  'placement.missing',
  'placement.too_many',
  'placement.mixed_vpc',
  'placement.security_group_vpc_mismatch',
  'placement.alb_requires_two_azs',
  'placement.rds_multi_az_requires_two_azs',
  'placement.internet_facing_requires_public_subnet',
  'placement.internet_target_requires_public_subnet',
  // entry / dependencies
  'entry.missing',
  'entry.multiple',
  'graph.max_per_graph',
  'dependency.no_request_path',
  'dependency.internal_alb_from_internet',
  'dependency.alb_no_targets',
  'dependency.unreachable_compute',
  'dependency.orphaned_resource',
  'dependency.no_security_group',
  'dependency.traffic_blocked_by_security_group',
  'dependency.security_group_rule_dangling_reference',
  'dependency.compute_without_database',
  'placement.single_az_compute',
  // security
  'security.db_port_open_to_internet',
  'security.all_ports_open_to_internet',
  'security.admin_port_open_to_internet',
  'security.db_in_public_subnet',
  'security.compute_directly_exposed',
  // edit command rejections
  'edit.node_not_found',
  'edit.connection_not_found',
  'edit.node_locked',
  'edit.system_managed',
  'edit.service_not_allowed',
] as const;
export type FindingCode = (typeof FINDING_CODES)[number];

export type Severity = 'error' | 'warning' | 'info';
export type FindingCategory =
  'structure' | 'config' | 'connection' | 'placement' | 'dependency' | 'security' | 'mission' | 'edit';
export type RiskLevel = 'critical' | 'major' | 'minor';

/** A structured validation result. Text is resolved from i18n using `code` and `params`. */
export interface Finding {
  readonly code: FindingCode;
  readonly severity: Severity;
  readonly category: FindingCategory;
  readonly nodeIds: readonly NodeId[];
  readonly connectionIds: readonly ConnectionId[];
  readonly params?: Readonly<Record<string, string | number>>;
  readonly riskLevel?: RiskLevel;
}

export const finding = (
  code: FindingCode,
  severity: Severity,
  category: FindingCategory,
  refs: { nodeIds?: readonly NodeId[]; connectionIds?: readonly ConnectionId[] } = {},
  extra: { params?: Record<string, string | number>; riskLevel?: RiskLevel } = {},
): Finding => ({
  code,
  severity,
  category,
  nodeIds: refs.nodeIds ?? [],
  connectionIds: refs.connectionIds ?? [],
  ...(extra.params ? { params: extra.params } : {}),
  ...(extra.riskLevel ? { riskLevel: extra.riskLevel } : {}),
});

export const hasErrors = (findings: readonly Finding[]): boolean =>
  findings.some((f) => f.severity === 'error');
