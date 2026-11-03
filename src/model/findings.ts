export const FINDING_CODES = [
  // structure (only reachable through hand-made content or corrupted saves)
  'structure.wrong_frame',
  'structure.dangling_reference',
  'structure.duplicate_zone',
  'structure.region_count',
  // entry / counts
  'entry.missing',
  'entry.multiple',
  'diagram.max_per_diagram',
  // placement
  'placement.subnets_required',
  'placement.alb_requires_two_azs',
  'placement.internet_facing_requires_public_subnet',
  'placement.rds_multi_az_requires_two_azs',
  'placement.internet_target_requires_public_subnet',
  'placement.single_az_compute',
  // links
  'link.not_allowed',
  // dependencies
  'dependency.no_request_path',
  'dependency.internal_alb_from_internet',
  'dependency.alb_no_targets',
  'dependency.unreachable_compute',
  'dependency.unused_database',
  'dependency.no_security_group',
  'dependency.traffic_blocked_by_security_group',
  'dependency.compute_without_database',
  'dependency.app_not_served',
  // security
  'security.db_port_open_to_internet',
  'security.all_ports_open_to_internet',
  'security.admin_port_open_to_internet',
  'security.db_in_public_subnet',
  'security.compute_directly_exposed',
  // edit command rejections
  'edit.not_found',
  'edit.locked',
  'edit.system_managed',
  'edit.type_not_allowed',
  'edit.wrong_frame',
  'edit.invalid_config',
  'edit.outside_vpc',
  'edit.link_not_allowed',
  'edit.link_duplicate',
  'edit.max_reached',
  'edit.no_free_zone',
] as const;
export type FindingCode = (typeof FINDING_CODES)[number];

export type Severity = 'error' | 'warning' | 'info';
export type RiskLevel = 'critical' | 'major' | 'minor';

/** A structured validation result. Text is resolved from i18n using `code` and `params`. */
export interface Finding {
  readonly code: FindingCode;
  readonly severity: Severity;
  /** Frames, resources or links the finding is about (first = primary). */
  readonly targetIds: readonly string[];
  readonly params?: Readonly<Record<string, string | number>>;
  readonly riskLevel?: RiskLevel;
}

export const finding = (
  code: FindingCode,
  severity: Severity,
  targetIds: readonly string[] = [],
  extra: { params?: Record<string, string | number>; riskLevel?: RiskLevel } = {},
): Finding => ({
  code,
  severity,
  targetIds,
  ...(extra.params ? { params: extra.params } : {}),
  ...(extra.riskLevel ? { riskLevel: extra.riskLevel } : {}),
});

export const hasErrors = (findings: readonly Finding[]): boolean =>
  findings.some((f) => f.severity === 'error');
export const isSecurityFinding = (f: Finding): boolean => f.code.startsWith('security.');
