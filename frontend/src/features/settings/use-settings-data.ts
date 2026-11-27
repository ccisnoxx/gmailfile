import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { SessionResponse } from '@/api/generated';
import {
  createMockActiveSessions,
  createMockAuditLogs,
  createMockBackupRestore,
  createMockRetentionPolicy,
  createMockSystemRuntime,
  createMockWebAuthnCredentials,
  formatSettingsDateTime,
  MOCK_ADMIN_SECURITY,
  MOCK_TOTP_SECURITY,
} from './mock-fixtures';
import type {
  ActiveSessionRow,
  AdminSecurityInfo,
  AuditIntegrityInfo,
  AuditLogEntry,
  BackupRestoreInfo,
  CardStateMode,
  RetentionPolicyInfo,
  SettingsMutationHandlers,
  SystemRuntimeInfo,
  TotpSecurityInfo,
  WebAuthnCredentialRow,
} from './types';
import { useSettingsAuthActions } from './use-settings-auth-actions';
import { useSettingsOpsActions } from './use-settings-ops-actions';
import { useSettingsQueries } from './use-settings-queries';

export { isReauthActive } from './settings-data-helpers';

export type UseSettingsDataOptions = {
  mode: 'live' | 'mock';
  session?: SessionResponse;
  onSession?: (next: SessionResponse) => void;
  onFailure?: (error: unknown) => void;
  onRefreshSession?: () => void;
  onSignedOut?: (revocation: Promise<unknown>) => void;
  uiStateOverride?: CardStateMode;
  simulateActionFailure?: boolean;
};

export type SettingsDataBundle = {
  adminSecurity: AdminSecurityInfo;
  totpSecurity: TotpSecurityInfo;
  webauthnCredentials: WebAuthnCredentialRow[];
  webauthnState: CardStateMode;
  webauthnError: string | null;
  sessions: ActiveSessionRow[];
  sessionsState: CardStateMode;
  sessionsError: string | null;
  backup: BackupRestoreInfo;
  backupState: CardStateMode;
  backupError: string | null;
  backupRunning: boolean;
  audits: AuditLogEntry[];
  auditsState: CardStateMode;
  auditsError: string | null;
  auditIntegrity: AuditIntegrityInfo | null;
  auditIntegrityState: CardStateMode;
  retention: RetentionPolicyInfo;
  retentionState: CardStateMode;
  retentionError: string | null;
  runtime: SystemRuntimeInfo;
  runtimeState: CardStateMode;
  isRecentlyVerified: boolean;
  handlers: SettingsMutationHandlers;
};

export function useSettingsData({
  mode,
  session,
  onSession,
  onFailure,
  onRefreshSession,
  onSignedOut,
  uiStateOverride,
  simulateActionFailure = false,
}: UseSettingsDataOptions): SettingsDataBundle {
  const queryClient = useQueryClient();
  const isLive = mode === 'live' && Boolean(session);

  // Mock / 本地状态（仅存放非敏感配置和演示数据，绝不缓存凭据）
  const [mockAdmin, setMockAdmin] = useState<AdminSecurityInfo>(() => ({
    ...MOCK_ADMIN_SECURITY,
  }));
  const [mockTotp, setMockTotp] = useState<TotpSecurityInfo>(() => ({
    ...MOCK_TOTP_SECURITY,
  }));
  const [mockSessions, setMockSessions] = useState<ActiveSessionRow[]>(() =>
    createMockActiveSessions(),
  );
  const [mockBackup, setMockBackup] = useState<BackupRestoreInfo>(() =>
    createMockBackupRestore(),
  );
  const [mockAudits, setMockAudits] = useState<AuditLogEntry[]>(() =>
    createMockAuditLogs(),
  );
  const [mockRetention, setMockRetention] = useState<RetentionPolicyInfo>(() =>
    createMockRetentionPolicy(),
  );
  const [mockRuntime, setMockRuntime] = useState<SystemRuntimeInfo>(() =>
    createMockSystemRuntime(),
  );
  const [mockWebAuthn, setMockWebAuthn] = useState<WebAuthnCredentialRow[]>(
    () => createMockWebAuthnCredentials(),
  );
  const [backupRunning, setBackupRunning] = useState(false);

  const [liveTotpRemaining, setLiveTotpRemaining] = useState<number | null>(
    null,
  );
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  const latestCsrfRef = useRef<string | undefined>(session?.csrf_token);
  latestCsrfRef.current = session?.csrf_token ?? latestCsrfRef.current;

  const headersWithCsrf = useCallback(
    (csrfOverride?: string) => {
      const token =
        csrfOverride ?? latestCsrfRef.current ?? session?.csrf_token;
      return token ? { 'X-CSRF-Token': token } : undefined;
    },
    [session?.csrf_token],
  );

  const prependMockAudit = useCallback(
    (
      eventType: string,
      eventLabel: string,
      objectType: AuditLogEntry['objectType'],
      objectLabel: string,
      result: 'success' | 'failed' = 'success',
    ) => {
      const nowIso = new Date().toISOString();
      setMockAudits((prev) => {
        const nextSeq = (prev[0]?.seq ?? 1048) + 1;
        return [
          {
            id: `aud-local-${Date.now()}-${nextSeq}`,
            seq: nextSeq,
            createdAt: formatSettingsDateTime(nowIso),
            createdAtIso: nowIso,
            eventType,
            eventLabel,
            objectType,
            objectLabel,
            result,
            ipAddress: '192.168.1.24',
            hashShort: Math.random().toString(16).slice(2, 14).padEnd(12, '0'),
          },
          ...prev,
        ];
      });
    },
    [],
  );

  // 高风险操作串行锁，防止并发或自动重试
  const busyRef = useRef(false);

  const queries = useSettingsQueries({
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
  });

  const authActions = useSettingsAuthActions({
    isLive,
    session,
    onSession,
    onFailure,
    onRefreshSession,
    simulateActionFailure,
    queryClient,
    busyRef,
    latestCsrfRef,
    headersWithCsrf,
    mockAdmin,
    setMockAdmin,
    mockTotp,
    setMockTotp,
    mockWebAuthn,
    setMockWebAuthn,
    setLiveTotpRemaining,
    prependMockAudit,
  });

  const opsActions = useSettingsOpsActions({
    isLive,
    onFailure,
    onRefreshSession,
    onSignedOut,
    simulateActionFailure,
    queryClient,
    busyRef,
    headersWithCsrf,
    ensureReverifiedIfNeeded: authActions.ensureReverifiedIfNeeded,
    sessionsItems: queries.sessionsItems,
    serverIdleMinutes: queries.serverIdleMinutes,
    mockSessions,
    setMockSessions,
    setMockBackup,
    setMockRetention,
    setMockRuntime,
    backupRunning,
    setBackupRunning,
    prependMockAudit,
  });

  return {
    adminSecurity: queries.adminSecurity,
    totpSecurity: queries.totpSecurity,
    webauthnCredentials: queries.webauthnCredentials,
    webauthnState: queries.webauthnState,
    webauthnError: queries.webauthnError,
    sessions: queries.sessions,
    sessionsState: queries.sessionsState,
    sessionsError: queries.sessionsError,
    backup: queries.backup,
    backupState: queries.backupState,
    backupError: queries.backupError,
    backupRunning,
    audits: queries.audits,
    auditsState: queries.auditsState,
    auditsError: queries.auditsError,
    auditIntegrity: queries.auditIntegrity,
    auditIntegrityState: queries.auditIntegrityState,
    retention: queries.retention,
    retentionState: queries.retentionState,
    retentionError: queries.retentionError,
    runtime: queries.runtime,
    runtimeState: queries.runtimeState,
    isRecentlyVerified: queries.isRecentlyVerified,
    handlers: {
      reverify: authActions.reverify,
      passkeyReverify: authActions.passkeyReverify,
      registerWebAuthnCredential: authActions.registerWebAuthnCredential,
      renameWebAuthnCredential: authActions.renameWebAuthnCredential,
      deleteWebAuthnCredential: authActions.deleteWebAuthnCredential,
      startTotpSetup: authActions.startTotpSetup,
      confirmTotpSetup: authActions.confirmTotpSetup,
      disableTotp: authActions.disableTotp,
      changePassword: authActions.changePassword,
      regenerateRecoveryCodes: authActions.regenerateRecoveryCodes,
      terminateSession: opsActions.terminateSession,
      logoutOtherSessions: opsActions.logoutOtherSessions,
      runImmediateBackup: opsActions.runImmediateBackup,
      runRestoreVerification: opsActions.runRestoreVerification,
      updateRetentionPolicy: opsActions.updateRetentionPolicy,
      retryAll: queries.retryAll,
    },
  };
}
