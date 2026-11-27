import type {
  AuditItem,
  BackupStatus,
  SessionItem,
  WebAuthnCredentialItem,
} from '@/api/generated';
import type {
  ActiveSessionRow,
  AdminSecurityInfo,
  AuditIntegrityInfo,
  AuditLogEntry,
  AuditObjectType,
  BackupArchiveItem,
  BackupRestoreInfo,
  RestoreCheckItem,
  RetentionPolicyInfo,
  SystemRuntimeInfo,
  TotpSecurityInfo,
  WebAuthnCredentialRow,
} from './types';

export function formatSettingsDateTime(
  value?: string | null,
  includeSeconds = false,
): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const hh = pad(date.getHours());
  const mm = pad(date.getMinutes());
  if (!includeSeconds) return `${y}-${m}-${d} ${hh}:${mm}`;
  const ss = pad(date.getSeconds());
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
}

export const MOCK_ADMIN_SECURITY: AdminSecurityInfo = {
  username: 'admin',
  statusLabel: '安全状态良好',
  healthy: true,
  passwordStrengthLabel: '强（16+ 位）',
  passwordChangedAt: '2026-10-18 14:20',
  policies: ['最小长度 16 位', '检查泄露密码', '建议使用密码短语'],
  reverifiedUntil: null,
  mfaReverifiedUntil: null,
  stepUpTotpRequired: true,
};

export const MOCK_TOTP_SECURITY: TotpSecurityInfo = {
  enabled: true,
  bound: true,
  authenticatorApps: 'Google Authenticator / Microsoft Authenticator 等',
  recoveryCodesTotal: 10,
  recoveryCodesRemaining: 10,
  demoCode: '482 917',
};

export function createMockActiveSessions(): ActiveSessionRow[] {
  return [
    {
      id: 'sess-macos-safari-current',
      deviceBrowser: 'macOS · Safari',
      current: true,
      ipAddress: '192.168.1.24',
      loginAt: '2026-11-25 09:12',
      lastActiveAt: '刚刚',
      state: 'valid',
    },
    {
      id: 'sess-win-chrome-other',
      deviceBrowser: 'Windows · Chrome',
      current: false,
      ipAddress: '192.168.1.87',
      loginAt: '2026-11-24 21:40',
      lastActiveAt: '18 分钟前',
      state: 'valid',
    },
  ];
}

export function createMockBackupArchives(): BackupArchiveItem[] {
  return [
    {
      id: 'bkp-20261125-0230',
      filename: 'gmailfile_20261125_023000.pgdump.age',
      createdAt: '2026-11-25 02:30',
      sizeLabel: '64.2 MB',
      method: 'pg_dump + age 加密',
      checksumShort: 'sha256:9f4a…2c81',
    },
    {
      id: 'bkp-20261124-0230',
      filename: 'gmailfile_20261124_023000.pgdump.age',
      createdAt: '2026-11-24 02:30',
      sizeLabel: '63.8 MB',
      method: 'pg_dump + age 加密',
      checksumShort: 'sha256:4d1e…7b05',
    },
    {
      id: 'bkp-20261123-0230',
      filename: 'gmailfile_20261123_023000.pgdump.age',
      createdAt: '2026-11-23 02:30',
      sizeLabel: '63.1 MB',
      method: 'pg_dump + age 加密',
      checksumShort: 'sha256:7a83…1f94',
    },
  ];
}

export function createMockBackupRestore(): BackupRestoreInfo {
  return {
    state: 'success',
    statusLabel: '备份正常',
    lastBackupAt: '2026-11-25 02:30',
    method: 'pg_dump + age 加密',
    scope: '数据库、标签、配置、审计日志',
    lastRestoreVerifiedAt: '2026-11-24 03:15',
    restoreVerifySummary: '结构、约束与抽样解密',
    offsiteState: 'success',
    archives: createMockBackupArchives(),
  };
}

export function createMockAuditLogs(): AuditLogEntry[] {
  const now = Date.now();
  const hoursAgo = (h: number) => new Date(now - h * 3600_000).toISOString();
  return [
    {
      id: 'aud-mock-1048',
      seq: 1048,
      createdAt: '2026-11-25 09:12',
      createdAtIso: hoursAgo(2),
      eventType: 'auth_login_succeeded',
      eventLabel: '登录成功',
      objectType: 'session',
      objectLabel: 'admin · macOS Safari',
      result: 'success',
      ipAddress: '192.168.1.24',
      hashShort: 'c9e4f1a28b10',
    },
    {
      id: 'aud-mock-1047',
      seq: 1047,
      createdAt: '2026-11-25 08:45',
      createdAtIso: hoursAgo(5),
      eventType: 'account_updated',
      eventLabel: '修改账号',
      objectType: 'account',
      objectLabel: 'dev.tools@gmail.com',
      result: 'success',
      ipAddress: '192.168.1.24',
      hashShort: '7b30d84e19c3',
    },
    {
      id: 'aud-mock-1046',
      seq: 1046,
      createdAt: '2026-11-25 02:30',
      createdAtIso: hoursAgo(12),
      eventType: 'backup_completed',
      eventLabel: '自动备份',
      objectType: 'backup',
      objectLabel: 'pg_dump + age 归档',
      result: 'success',
      ipAddress: '127.0.0.1',
      hashShort: '51af209c44e7',
    },
    {
      id: 'aud-mock-1045',
      seq: 1045,
      createdAt: '2026-11-24 18:16',
      createdAtIso: hoursAgo(28),
      eventType: 'csv_exported',
      eventLabel: '导出 CSV',
      objectType: 'export',
      objectLabel: '账号清单（128 条）',
      result: 'success',
      ipAddress: '192.168.1.24',
      hashShort: 'a408c71d22f5',
    },
    {
      id: 'aud-mock-1044',
      seq: 1044,
      createdAt: '2026-11-22 11:08',
      createdAtIso: hoursAgo(96),
      eventType: 'settings_updated',
      eventLabel: '更新安全策略',
      objectType: 'settings',
      objectLabel: '自动锁定 · 15 分钟',
      result: 'success',
      ipAddress: '192.168.1.24',
      hashShort: '8e12b3f096d1',
    },
  ];
}

export const MOCK_AUDIT_INTEGRITY: AuditIntegrityInfo = {
  valid: true,
  totalEvents: 1048,
  latestSeq: 1048,
  latestHashShort: 'c9e4f1a28b10',
  retentionDays: 730,
};

export function createMockRetentionPolicy(): RetentionPolicyInfo {
  return {
    auditRetentionDays: 730,
    auditUsedGb: 1.28,
    auditUsedPercent: 32,
    auditQuotaGb: 4.0,
    backupRetentionDays: 90,
    backupUsedGb: 5.64,
    backupUsedPercent: 56,
    backupQuotaGb: 10.0,
  };
}

export function createMockSystemRuntime(): SystemRuntimeInfo {
  return {
    healthy: true,
    statusText: '系统正常运行',
    appVersion: 'v1.2.0',
    schemaVersion: '0005',
    idleMinutes: 15,
    maxIdleMinutes: 720,
    trashCount: 3,
  };
}

export function createMockWebAuthnCredentials(): WebAuthnCredentialRow[] {
  return [
    {
      id: 'cred-mock-macbook-01',
      label: 'MacBook Pro Touch ID',
      transports: ['internal', 'hybrid'],
      discoverable: true,
      backupEligible: true,
      backupState: true,
      createdAt: '2026-11-20 10:15',
      lastUsedAt: '2026-11-25 09:12',
    },
  ];
}

export function mapApiWebAuthnCredential(
  item: WebAuthnCredentialItem,
): WebAuthnCredentialRow {
  return {
    id: item.id,
    label: item.label,
    transports: item.transports ?? [],
    discoverable: item.discoverable,
    backupEligible: item.backup_eligible,
    backupState: item.backup_state,
    createdAt: formatSettingsDateTime(item.created_at),
    lastUsedAt: item.last_used_at
      ? formatSettingsDateTime(item.last_used_at)
      : null,
  };
}

export const RESTORE_VERIFICATION_CHECKLIST: readonly Omit<
  RestoreCheckItem,
  'status'
>[] = [
  {
    id: 'age-decrypt',
    label: 'age 密文包校验与解包',
    description: '验证归档文件完整性与 age 公私钥解封流可读性',
  },
  {
    id: 'schema-structure',
    label: '数据库结构与迁移版本校验',
    description: '核对全部业务表结构与 Alembic Schema 0004 一致',
  },
  {
    id: 'constraints',
    label: '唯一索引与外键约束校验',
    description: '确认邮箱唯一约束、标签关联与软删除引用无冲突',
  },
  {
    id: 'sample-decrypt',
    label: '抽样记录 AES-256-GCM 解密校验',
    description:
      '在临时沙箱对抽样密文凭据执行完整性认证解密（不落盘、不回显明文）',
  },
];

export function generateDemoRecoveryCodes(): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const pick = (len: number) => {
    const bytes = new Uint8Array(len);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < len; i += 1) bytes[i] = (i * 37 + 11) % 255;
    }
    let out = '';
    for (let i = 0; i < len; i += 1) {
      out += alphabet[bytes[i] % alphabet.length];
    }
    return out;
  };
  return Array.from({ length: 10 }, () => `${pick(4)}-${pick(4)}-${pick(4)}`);
}

const API_EVENT_LABELS: Record<
  string,
  { label: string; objectType: Exclude<AuditObjectType, 'all'> }
> = {
  auth_login_succeeded: { label: '登录成功', objectType: 'session' },
  login_success: { label: '登录成功', objectType: 'session' },
  auth_logout: { label: '退出登录', objectType: 'session' },
  session_revoked: { label: '终止会话', objectType: 'session' },
  sessions_revoked_others: { label: '退出其他会话', objectType: 'session' },
  account_created: { label: '创建账号', objectType: 'account' },
  account_updated: { label: '修改账号', objectType: 'account' },
  account_archived: { label: '归档账号', objectType: 'account' },
  account_deleted: { label: '删除账号', objectType: 'account' },
  account_permanently_deleted: { label: '永久删除账号', objectType: 'account' },
  permanent_delete_confirmation_failed: {
    label: '批量永久删除确认失败',
    objectType: 'account',
  },
  account_restored: { label: '恢复账号', objectType: 'account' },
  password_revealed: { label: '查看凭据', objectType: 'account' },
  backup_completed: { label: '自动备份', objectType: 'backup' },
  csv_exported: { label: '导出 CSV', objectType: 'export' },
  sensitive_exported: { label: '导出加密凭据包', objectType: 'export' },
  csv_imported: { label: '导入 CSV', objectType: 'export' },
  data_keys_rotated: { label: '轮换数据密钥', objectType: 'settings' },
  settings_updated: { label: '修改系统配置', objectType: 'settings' },
  settings_changed: { label: '修改系统配置', objectType: 'settings' },
  password_changed: { label: '修改管理员密码', objectType: 'settings' },
  totp_recovery_regenerated: {
    label: '重新生成恢复码',
    objectType: 'settings',
  },
  totp_disabled: {
    label: '停用 TOTP 验证器',
    objectType: 'settings',
  },
  webauthn_registered: {
    label: '绑定通行密钥',
    objectType: 'settings',
  },
  webauthn_renamed: {
    label: '重命名通行密钥',
    objectType: 'settings',
  },
  webauthn_revoked: {
    label: '移除通行密钥',
    objectType: 'settings',
  },
  webauthn_clone_suspected: {
    label: '检测到可疑克隆密钥',
    objectType: 'session',
  },
};

export function mapApiSessionToRow(
  item: SessionItem,
  _index = 0,
): ActiveSessionRow {
  const deviceLabel =
    item.device_label && item.device_label !== '未知设备'
      ? item.device_label
      : item.current
        ? '当前浏览器会话'
        : '未知设备';
  return {
    id: item.id,
    deviceBrowser: deviceLabel,
    deviceType: item.device_type ?? 'unknown',
    browser: item.browser ?? 'Unknown',
    os: item.os ?? 'Unknown',
    current: item.current,
    ipAddress: item.ip_address || '未知来源',
    loginAt: formatSettingsDateTime(item.created_at),
    lastActiveAt: item.current
      ? '刚刚'
      : formatSettingsDateTime(item.last_seen_at),
    idleExpiresAt: formatSettingsDateTime(item.idle_expires_at),
    expiresAt: formatSettingsDateTime(item.expires_at),
    mfaReauthenticated: Boolean(item.mfa_reauthenticated),
    state: item.state,
  };
}

export function mapApiAuditToEntry(item: AuditItem): AuditLogEntry {
  const mapped = API_EVENT_LABELS[item.event_type];
  const failed =
    item.event_type.includes('failed') || item.event_type.includes('denied');
  const objectLabel =
    item.operation ||
    (item.account_id ? `账号 ${item.account_id.slice(0, 8)}` : null) ||
    (item.session_id ? `会话 ${item.session_id.slice(0, 8)}` : null) ||
    '系统级操作';

  return {
    id: item.id,
    seq: item.seq,
    createdAt: formatSettingsDateTime(item.created_at),
    createdAtIso: item.created_at,
    eventType: item.event_type,
    eventLabel: mapped?.label ?? item.operation ?? item.event_type,
    objectType:
      mapped?.objectType ?? (item.account_id ? 'account' : 'settings'),
    objectLabel,
    result: failed ? 'failed' : 'success',
    ipAddress: item.ip_address || '—',
    hashShort: item.event_hash.slice(0, 12),
  };
}

export function mapApiBackupStatus(data: BackupStatus): BackupRestoreInfo {
  const labels: Record<BackupStatus['state'], string> = {
    success: '备份正常',
    running: '正在备份',
    failed: '备份失败',
    stale: '备份已过期',
    never_run: '尚未运行',
    unconfigured: '未配置',
  };
  return {
    state: data.state,
    statusLabel: labels[data.state] ?? '状态未知',
    lastBackupAt: data.last_success_at
      ? formatSettingsDateTime(data.last_success_at)
      : null,
    method: 'pg_dump + age 加密',
    scope: '数据库、标签、配置、审计日志',
    lastRestoreVerifiedAt: null,
    restoreVerifySummary: '请通过服务器端恢复演练脚本验证',
    offsiteState: data.offsite ?? 'unconfigured',
    archives: [],
  };
}
