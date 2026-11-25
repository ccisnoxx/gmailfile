export type SettingsSectionKey =
  'security' | 'backup' | 'audit' | 'appearance' | 'system';

export const SETTINGS_SECTIONS: readonly {
  key: SettingsSectionKey;
  label: string;
  description: string;
}[] = [
  {
    key: 'security',
    label: '安全与认证',
    description: '管理员口令策略、TOTP 双因素认证与活动会话控制',
  },
  {
    key: 'backup',
    label: '备份与恢复',
    description: '加密快照状态、立即备份与恢复完整性演练验证',
  },
  {
    key: 'audit',
    label: '审计与合规',
    description: '防篡改哈希链审计日志检索与合规保留策略',
  },
  {
    key: 'appearance',
    label: '界面与体验',
    description: '共享导航栏毛玻璃透明度与桌面显示偏好',
  },
  {
    key: 'system',
    label: '系统与维护',
    description: '运行状态、会话自动锁定与数据生命周期维护',
  },
] as const;

export function isSettingsSectionKey(
  value?: string | null,
): value is SettingsSectionKey {
  return SETTINGS_SECTIONS.some((section) => section.key === value);
}

export type CardStateMode = 'ready' | 'loading' | 'error' | 'empty';

export type AdminSecurityInfo = {
  username: string;
  statusLabel: string;
  healthy: boolean;
  passwordStrengthLabel: string;
  passwordChangedAt: string;
  policies: readonly string[];
  reverifiedUntil: string | null;
  mfaReverifiedUntil: string | null;
  stepUpTotpRequired: boolean;
};

export type TotpSecurityInfo = {
  enabled: boolean;
  bound: boolean;
  authenticatorApps: string;
  recoveryCodesTotal: number;
  recoveryCodesRemaining: number | null;
  /** 仅用于右侧视觉展示的抽象演示验证码，绝非真实 TOTP Secret 或真实口令 */
  demoCode: string;
};

export type ActiveSessionRow = {
  id: string;
  deviceBrowser: string;
  current: boolean;
  ipAddress: string;
  loginAt: string;
  lastActiveAt: string;
  state: 'valid' | 'idle_expired' | 'absolute_expired' | 'revoked';
};

export type BackupArchiveItem = {
  id: string;
  filename: string;
  createdAt: string;
  sizeLabel: string;
  method: string;
  checksumShort: string;
};

export type BackupRestoreInfo = {
  state:
    'success' | 'running' | 'failed' | 'stale' | 'never_run' | 'unconfigured';
  statusLabel: string;
  lastBackupAt: string | null;
  method: string;
  scope: string;
  lastRestoreVerifiedAt: string | null;
  restoreVerifySummary: string;
  offsiteState: 'unconfigured' | 'pending' | 'success' | 'failed';
  archives: BackupArchiveItem[];
};

export type AuditObjectType =
  'all' | 'session' | 'account' | 'backup' | 'export' | 'settings';

export type AuditTimeRange = 'all' | '24h' | '7d' | '30d';

export type AuditLogEntry = {
  id: string;
  seq: number;
  createdAt: string;
  createdAtIso: string;
  eventType: string;
  eventLabel: string;
  objectType: Exclude<AuditObjectType, 'all'>;
  objectLabel: string;
  result: 'success' | 'failed';
  ipAddress: string;
  hashShort?: string;
};

export type AuditIntegrityInfo = {
  valid: boolean;
  totalEvents: number;
  latestSeq: number | null;
  latestHashShort: string | null;
  retentionDays: number;
  brokenSeq?: number | null;
  reason?: string | null;
};

export type RetentionPolicyInfo = {
  auditRetentionDays: number;
  auditUsedGb: number;
  auditUsedPercent: number;
  auditQuotaGb: number;
  backupRetentionDays: number | null;
  backupUsedGb: number;
  backupUsedPercent: number;
  backupQuotaGb: number;
  storageMetricsAvailable?: boolean;
};

export type SystemRuntimeInfo = {
  healthy: boolean;
  statusText: string;
  appVersion: string;
  schemaVersion: string;
  idleMinutes: number;
  maxIdleMinutes: number;
  trashCount: number;
};

export type RestoreCheckItem = {
  id: string;
  label: string;
  description: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  detail?: string;
};

export type RestoreVerifyReport = {
  archive: BackupArchiveItem;
  passed: boolean;
  verifiedAt: string;
  durationMs: number;
  sampledRows: number;
  checks: RestoreCheckItem[];
  errorMessage?: string;
};

export type SensitiveVerifyPayload = {
  password?: string;
  totpCode?: string;
};

export type SettingsActionResult =
  | { ok: true; message?: string; csrfToken?: string }
  | { ok: false; error: string; requireReauth?: boolean };

export type SettingsMutationHandlers = {
  reverify: (
    password: string,
    totpCode?: string,
  ) => Promise<SettingsActionResult>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
    totpCode?: string,
  ) => Promise<SettingsActionResult>;
  regenerateRecoveryCodes: (
    currentPassword: string,
    totpCode: string,
  ) => Promise<
    | { ok: true; codes: string[]; message?: string }
    | { ok: false; error: string; requireReauth?: boolean }
  >;
  terminateSession: (
    sessionId: string,
    verify?: SensitiveVerifyPayload,
  ) => Promise<SettingsActionResult>;
  logoutOtherSessions: (
    verify?: SensitiveVerifyPayload,
  ) => Promise<SettingsActionResult>;
  runImmediateBackup: () => Promise<SettingsActionResult>;
  runRestoreVerification: (
    archive: BackupArchiveItem,
  ) => Promise<RestoreVerifyReport>;
  updateRetentionPolicy: (
    next: {
      auditRetentionDays: number;
      backupRetentionDays: number;
      idleMinutes?: number;
    },
    verify?: SensitiveVerifyPayload,
  ) => Promise<SettingsActionResult>;
  retryAll: () => void;
};
