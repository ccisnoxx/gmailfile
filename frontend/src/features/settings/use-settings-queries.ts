import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, type QueryClient } from '@tanstack/react-query';
import {
  accountsList,
  auditsIntegrity,
  auditsList,
  authWebauthnCredentialsList,
  backupStatus,
  sessionsList,
  settingsGet,
  systemVersion,
  type SessionResponse,
} from '@/api/generated';
import { purgeProtectedSettingsQueries } from '@/lib/query-cache-policy';
import {
  mapApiAuditToEntry,
  mapApiBackupStatus,
  mapApiSessionToRow,
  mapApiWebAuthnCredential,
  MOCK_AUDIT_INTEGRITY,
} from './mock-fixtures';
import {
  extractErrorInfo,
  isFatalSessionErrorCode,
  isReauthActive,
} from './settings-data-helpers';
import type {
  ActiveSessionRow,
  AdminSecurityInfo,
  AuditIntegrityInfo,
  AuditLogEntry,
  BackupRestoreInfo,
  CardStateMode,
  RetentionPolicyInfo,
  SystemRuntimeInfo,
  TotpSecurityInfo,
  WebAuthnCredentialRow,
} from './types';

export type UseSettingsQueriesOptions = {
  isLive: boolean;
  session?: SessionResponse;
  onFailure?: (error: unknown) => void;
  uiStateOverride?: CardStateMode;
  queryClient: QueryClient;
  mockAdmin: AdminSecurityInfo;
  mockTotp: TotpSecurityInfo;
  mockSessions: ActiveSessionRow[];
  mockBackup: BackupRestoreInfo;
  mockAudits: AuditLogEntry[];
  mockRetention: RetentionPolicyInfo;
  mockRuntime: SystemRuntimeInfo;
  mockWebAuthn: WebAuthnCredentialRow[];
  backupRunning: boolean;
  liveTotpRemaining: number | null;
  nowMs: number;
};

export function useSettingsQueries({
  isLive,
  session,
  onFailure,
  uiStateOverride,
  queryClient,
  mockAdmin,
  mockTotp,
  mockSessions,
  mockBackup,
  mockAudits,
  mockRetention,
  mockRuntime,
  mockWebAuthn,
  backupRunning,
  liveTotpRemaining,
  nowMs,
}: UseSettingsQueriesOptions) {
  // Live API queries (仅包含非敏感只读元数据)
  const sessionsQuery = useQuery({
    queryKey: ['settings-sessions'],
    enabled: isLive,
    retry: false,
    queryFn: async ({ signal }) =>
      (
        await sessionsList({
          query: { page: 1, page_size: 20 },
          signal,
          throwOnError: true,
        })
      ).data,
  });

  const auditsQuery = useQuery({
    queryKey: ['settings-audits'],
    enabled: isLive,
    retry: false,
    queryFn: async ({ signal }) =>
      (
        await auditsList({
          query: { page: 1, page_size: 30 },
          signal,
          throwOnError: true,
        })
      ).data,
  });

  const integrityQuery = useQuery({
    queryKey: ['settings-audit-integrity'],
    enabled: isLive,
    retry: false,
    queryFn: async ({ signal }) =>
      (await auditsIntegrity({ signal, throwOnError: true })).data,
  });

  const backupQuery = useQuery({
    queryKey: ['settings-backup-status'],
    enabled: isLive,
    retry: false,
    queryFn: async ({ signal }) =>
      (await backupStatus({ signal, throwOnError: true })).data,
  });

  const systemQuery = useQuery({
    queryKey: ['settings-system-meta'],
    enabled: isLive,
    retry: false,
    queryFn: async ({ signal }) => {
      const [ver, cfg] = await Promise.all([
        systemVersion({ signal, throwOnError: true }),
        settingsGet({ signal, throwOnError: true }),
      ]);
      return { version: ver.data, settings: cfg.data };
    },
  });

  const trashQuery = useQuery({
    queryKey: ['settings-trash-count'],
    enabled: isLive,
    retry: false,
    queryFn: async ({ signal }) =>
      (
        await accountsList({
          query: { deleted: true, page: 1, page_size: 1 },
          signal,
          throwOnError: true,
        })
      ).data.total ?? 0,
  });

  const webauthnQuery = useQuery({
    queryKey: ['settings-webauthn-credentials'],
    enabled: isLive,
    retry: false,
    queryFn: async ({ signal }) =>
      (
        await authWebauthnCredentialsList({
          signal,
          throwOnError: true,
        })
      ).data,
  });

  // 离开设置页卸载时取消在途请求并清理设置只读缓存，缩短元数据内存驻留窗口
  useEffect(() => {
    if (!isLive) return;
    return () => {
      purgeProtectedSettingsQueries(queryClient);
    };
  }, [isLive, queryClient]);

  // 将只读查询中出现的会话失效 / MFA / CSRF 致命错误转发给全局认证状态机
  const reportedQueryErrorRef = useRef<unknown>(null);
  useEffect(() => {
    if (!isLive || !onFailure) return;
    const firstError =
      sessionsQuery.error ??
      auditsQuery.error ??
      integrityQuery.error ??
      backupQuery.error ??
      systemQuery.error ??
      trashQuery.error ??
      webauthnQuery.error;
    if (!firstError || firstError === reportedQueryErrorRef.current) return;
    const info = extractErrorInfo(firstError);
    if (isFatalSessionErrorCode(info.code)) {
      reportedQueryErrorRef.current = firstError;
      onFailure(firstError);
    }
  }, [
    auditsQuery.error,
    backupQuery.error,
    integrityQuery.error,
    isLive,
    onFailure,
    sessionsQuery.error,
    systemQuery.error,
    trashQuery.error,
    webauthnQuery.error,
  ]);

  const retryAll = useCallback(() => {
    if (!isLive) return;
    void Promise.all([
      sessionsQuery.refetch(),
      auditsQuery.refetch(),
      integrityQuery.refetch(),
      backupQuery.refetch(),
      systemQuery.refetch(),
      trashQuery.refetch(),
      webauthnQuery.refetch(),
    ]);
  }, [
    auditsQuery,
    backupQuery,
    integrityQuery,
    isLive,
    sessionsQuery,
    systemQuery,
    trashQuery,
    webauthnQuery,
  ]);

  const adminSecurity: AdminSecurityInfo = useMemo(() => {
    if (!isLive || !session) return mockAdmin;
    return {
      username: 'admin',
      statusLabel: '会话认证有效',
      healthy: true,
      passwordStrengthLabel: '强口令策略（≥16 位）',
      passwordChangedAt: '由服务端安全存储维护',
      policies: ['最小长度 16 位', '检查泄露密码', '建议使用密码短语'],
      reverifiedUntil: session.reauthenticated_until ?? null,
      mfaReverifiedUntil: session.mfa_reauthenticated_until ?? null,
      stepUpTotpRequired: Boolean(session.step_up_totp_required),
    };
  }, [isLive, mockAdmin, session]);

  const totpSecurity: TotpSecurityInfo = useMemo(() => {
    if (!isLive) return mockTotp;
    const enabled = Boolean(session?.totp_enabled);
    return {
      enabled,
      bound: enabled,
      authenticatorApps: 'Google Authenticator / Microsoft Authenticator 等',
      recoveryCodesTotal: 10,
      recoveryCodesRemaining: liveTotpRemaining,
      demoCode: '••••••',
    };
  }, [isLive, liveTotpRemaining, mockTotp, session?.totp_enabled]);

  const webauthnCredentials: WebAuthnCredentialRow[] = useMemo(() => {
    if (uiStateOverride === 'empty') return [];
    if (!isLive) return mockWebAuthn;
    return Array.isArray(webauthnQuery.data)
      ? webauthnQuery.data.map(mapApiWebAuthnCredential)
      : [];
  }, [isLive, mockWebAuthn, uiStateOverride, webauthnQuery.data]);

  const webauthnState: CardStateMode = useMemo(() => {
    if (uiStateOverride) return uiStateOverride;
    if (!isLive) return 'ready';
    if (webauthnQuery.isPending) return 'loading';
    if (webauthnQuery.isError) return 'error';
    return 'ready';
  }, [isLive, uiStateOverride, webauthnQuery.isError, webauthnQuery.isPending]);

  const sessions: ActiveSessionRow[] = useMemo(() => {
    if (uiStateOverride === 'empty') return [];
    if (!isLive) return mockSessions;
    return (sessionsQuery.data?.items ?? []).map(mapApiSessionToRow);
  }, [isLive, mockSessions, sessionsQuery.data?.items, uiStateOverride]);

  const sessionsState: CardStateMode = useMemo(() => {
    if (uiStateOverride) return uiStateOverride;
    if (!isLive) return sessions.length === 0 ? 'empty' : 'ready';
    if (sessionsQuery.isPending) return 'loading';
    if (sessionsQuery.isError) return 'error';
    return sessions.length === 0 ? 'empty' : 'ready';
  }, [
    isLive,
    sessions.length,
    sessionsQuery.isError,
    sessionsQuery.isPending,
    uiStateOverride,
  ]);

  const backup: BackupRestoreInfo = useMemo(() => {
    if (!isLive) {
      return backupRunning
        ? { ...mockBackup, state: 'running', statusLabel: '正在备份' }
        : mockBackup;
    }
    if (!backupQuery.data) {
      return {
        state: 'unconfigured',
        statusLabel: backupQuery.isPending ? '读取中' : '状态未知',
        lastBackupAt: null,
        method: 'pg_dump + age 加密',
        scope: '数据库、标签、配置、审计日志',
        lastRestoreVerifiedAt: null,
        restoreVerifySummary: '请通过服务器端恢复演练脚本验证',
        offsiteState: 'unconfigured',
        archives: [],
      };
    }
    return mapApiBackupStatus(backupQuery.data);
  }, [
    backupQuery.data,
    backupQuery.isPending,
    backupRunning,
    isLive,
    mockBackup,
  ]);

  const backupState: CardStateMode = useMemo(() => {
    if (uiStateOverride) return uiStateOverride;
    if (!isLive) return 'ready';
    if (backupQuery.isPending) return 'loading';
    if (backupQuery.isError) return 'error';
    if (backup.state === 'unconfigured' || backup.state === 'never_run') {
      return 'empty';
    }
    return 'ready';
  }, [
    backup.state,
    backupQuery.isError,
    backupQuery.isPending,
    isLive,
    uiStateOverride,
  ]);

  const audits: AuditLogEntry[] = useMemo(() => {
    if (uiStateOverride === 'empty') return [];
    if (!isLive) return mockAudits;
    return (auditsQuery.data?.items ?? []).map(mapApiAuditToEntry);
  }, [auditsQuery.data?.items, isLive, mockAudits, uiStateOverride]);

  const auditsState: CardStateMode = useMemo(() => {
    if (uiStateOverride) return uiStateOverride;
    if (!isLive) return audits.length === 0 ? 'empty' : 'ready';
    if (auditsQuery.isPending) return 'loading';
    if (auditsQuery.isError) return 'error';
    return audits.length === 0 ? 'empty' : 'ready';
  }, [
    audits.length,
    auditsQuery.isError,
    auditsQuery.isPending,
    isLive,
    uiStateOverride,
  ]);

  const auditIntegrity: AuditIntegrityInfo | null = useMemo(() => {
    if (!isLive) {
      return {
        ...MOCK_AUDIT_INTEGRITY,
        totalEvents: Math.max(
          MOCK_AUDIT_INTEGRITY.totalEvents,
          mockAudits.length,
        ),
        latestSeq: mockAudits[0]?.seq ?? MOCK_AUDIT_INTEGRITY.latestSeq,
        latestHashShort:
          mockAudits[0]?.hashShort ?? MOCK_AUDIT_INTEGRITY.latestHashShort,
        retentionDays: mockRetention.auditRetentionDays,
      };
    }
    if (!integrityQuery.data) return null;
    return {
      valid: integrityQuery.data.valid,
      totalEvents: integrityQuery.data.total_events,
      latestSeq: integrityQuery.data.latest_seq,
      latestHashShort: integrityQuery.data.latest_hash
        ? integrityQuery.data.latest_hash.slice(0, 12)
        : null,
      retentionDays: integrityQuery.data.retention_days,
      brokenSeq: integrityQuery.data.broken_seq,
      reason: integrityQuery.data.reason,
    };
  }, [
    integrityQuery.data,
    isLive,
    mockAudits,
    mockRetention.auditRetentionDays,
  ]);

  const retention: RetentionPolicyInfo = useMemo(() => {
    if (!isLive) return mockRetention;
    return {
      auditRetentionDays: integrityQuery.data?.retention_days ?? 365,
      auditUsedGb: 0,
      auditUsedPercent: 0,
      auditQuotaGb: 0,
      backupRetentionDays: null,
      backupUsedGb: 0,
      backupUsedPercent: 0,
      backupQuotaGb: 0,
      storageMetricsAvailable: false,
    };
  }, [integrityQuery.data?.retention_days, isLive, mockRetention]);

  const retentionState: CardStateMode = useMemo(() => {
    if (uiStateOverride) return uiStateOverride;
    if (!isLive) return 'ready';
    if (integrityQuery.isPending && systemQuery.isPending) return 'loading';
    if (integrityQuery.isError && systemQuery.isError) return 'error';
    return 'ready';
  }, [
    integrityQuery.isError,
    integrityQuery.isPending,
    isLive,
    systemQuery.isError,
    systemQuery.isPending,
    uiStateOverride,
  ]);

  const auditIntegrityState: CardStateMode = useMemo(() => {
    if (uiStateOverride) return uiStateOverride;
    if (!isLive) return 'ready';
    if (integrityQuery.isPending) return 'loading';
    if (integrityQuery.isError) return 'error';
    return 'ready';
  }, [
    integrityQuery.isError,
    integrityQuery.isPending,
    isLive,
    uiStateOverride,
  ]);

  const runtimeState: CardStateMode = useMemo(() => {
    if (uiStateOverride) return uiStateOverride;
    if (!isLive) return 'ready';
    if (systemQuery.isPending) return 'loading';
    if (systemQuery.isError) return 'error';
    return 'ready';
  }, [isLive, systemQuery.isError, systemQuery.isPending, uiStateOverride]);

  const runtime: SystemRuntimeInfo = useMemo(() => {
    if (!isLive) {
      const healthy =
        mockBackup.state !== 'failed' && mockBackup.state !== 'stale';
      return {
        ...mockRuntime,
        healthy,
        statusText: healthy
          ? '系统正常运行'
          : mockBackup.state === 'stale'
            ? '备份已过期'
            : '存在待处理告警',
      };
    }
    const backupBad =
      backup.state === 'failed' ||
      backup.state === 'stale' ||
      backupQuery.isError ||
      auditIntegrity?.valid === false;
    return {
      healthy: !backupBad,
      statusText: !backupBad
        ? '系统正常运行'
        : backup.state === 'stale' &&
            !backupQuery.isError &&
            auditIntegrity?.valid !== false
          ? '备份已过期'
          : '存在待处理告警',
      appVersion: systemQuery.data?.version.version
        ? `v${systemQuery.data.version.version}`
        : '—',
      schemaVersion: systemQuery.data?.version.schema_version ?? '—',
      idleMinutes: systemQuery.data?.settings.idle_minutes ?? 15,
      maxIdleMinutes: systemQuery.data?.settings.max_idle_minutes ?? 720,
      trashCount: typeof trashQuery.data === 'number' ? trashQuery.data : 0,
    };
  }, [
    auditIntegrity?.valid,
    backup.state,
    backupQuery.isError,
    isLive,
    mockBackup.state,
    mockRuntime,
    systemQuery.data,
    trashQuery.data,
  ]);

  const isRecentlyVerified = useMemo(() => {
    const ts = adminSecurity.stepUpTotpRequired
      ? adminSecurity.mfaReverifiedUntil
      : adminSecurity.reverifiedUntil;
    return isReauthActive(ts, nowMs);
  }, [
    adminSecurity.mfaReverifiedUntil,
    adminSecurity.reverifiedUntil,
    adminSecurity.stepUpTotpRequired,
    nowMs,
  ]);

  return {
    adminSecurity,
    totpSecurity,
    webauthnCredentials,
    webauthnState,
    webauthnError:
      uiStateOverride === 'error'
        ? '无法加载通行密钥列表，请检查认证服务连接。'
        : webauthnQuery.error
          ? extractErrorInfo(webauthnQuery.error).message
          : null,
    sessions,
    sessionsState,
    sessionsError:
      uiStateOverride === 'error'
        ? '无法获取活动会话列表，请检查认证服务连接。'
        : sessionsQuery.error
          ? extractErrorInfo(sessionsQuery.error).message
          : null,
    backup,
    backupState,
    backupError:
      uiStateOverride === 'error'
        ? '无法读取加密备份状态，请检查备份服务与状态文件。'
        : backupQuery.error
          ? extractErrorInfo(backupQuery.error).message
          : null,
    audits,
    auditsState,
    auditsError:
      uiStateOverride === 'error'
        ? '无法加载审计日志，请稍后手动重试。'
        : auditsQuery.error
          ? extractErrorInfo(auditsQuery.error).message
          : null,
    auditIntegrity,
    auditIntegrityState,
    retention,
    retentionState,
    retentionError:
      uiStateOverride === 'error'
        ? '无法加载保留策略配置。'
        : integrityQuery.error && systemQuery.error
          ? extractErrorInfo(integrityQuery.error).message
          : null,
    runtime,
    runtimeState,
    isRecentlyVerified,
    retryAll,
    sessionsItems: sessionsQuery.data?.items,
    serverIdleMinutes: systemQuery.data?.settings.idle_minutes,
  };
}
