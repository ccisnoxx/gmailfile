import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  accountsList,
  auditsIntegrity,
  auditsList,
  authChangePassword,
  authRegenerateRecoveryCodes,
  authReverify,
  authTotpConfirm,
  authTotpDisable,
  authTotpSetup,
  authWebauthnCredentialDelete,
  authWebauthnCredentialRename,
  authWebauthnCredentialsList,
  authWebauthnRegisterOptions,
  authWebauthnRegisterVerify,
  backupStatus,
  sessionsList,
  sessionsRevoke,
  sessionsRevokeOthers,
  settingsGet,
  settingsIdle,
  systemVersion,
} from '@/api/generated';
import type { ErrorResponse, SessionResponse } from '@/api/generated';
import {
  createPasskeyCredential,
  formatWebAuthnError,
  performPasskeyStepUp,
} from '@/lib/webauthn';
import {
  createMockActiveSessions,
  createMockAuditLogs,
  createMockBackupRestore,
  createMockRetentionPolicy,
  createMockSystemRuntime,
  createMockWebAuthnCredentials,
  formatSettingsDateTime,
  generateDemoRecoveryCodes,
  mapApiAuditToEntry,
  mapApiBackupStatus,
  mapApiSessionToRow,
  mapApiWebAuthnCredential,
  MOCK_ADMIN_SECURITY,
  MOCK_AUDIT_INTEGRITY,
  MOCK_TOTP_SECURITY,
  RESTORE_VERIFICATION_CHECKLIST,
} from './mock-fixtures';
import type {
  ActiveSessionRow,
  AdminSecurityInfo,
  AuditIntegrityInfo,
  AuditLogEntry,
  BackupArchiveItem,
  BackupRestoreInfo,
  CardStateMode,
  RestoreCheckItem,
  RestoreVerifyReport,
  RetentionPolicyInfo,
  SensitiveVerifyPayload,
  SettingsActionResult,
  SettingsMutationHandlers,
  SystemRuntimeInfo,
  TotpSecurityInfo,
  TotpSetupChallenge,
  WebAuthnCredentialRow,
} from './types';

function extractErrorInfo(error: unknown): {
  code?: string;
  message: string;
} {
  const err = error as Partial<ErrorResponse> | null;
  const code = err?.error?.code;
  if (code === 'REAUTH_REQUIRED') {
    return {
      code,
      message: '此高风险操作需要最近重新验证，请输入当前管理员密码后继续。',
    };
  }
  if (code === 'CSRF_INVALID') {
    return {
      code,
      message: '安全令牌已过期，操作未执行且未自动重试，请刷新页面后重试。',
    };
  }
  if (err?.error?.message) {
    return { code, message: err.error.message };
  }
  if (error instanceof Error && error.message) {
    return { message: error.message };
  }
  return { message: '操作失败，请检查服务连接后手动重试（未自动重试）。' };
}

export function isReauthActive(
  until?: string | null,
  now = Date.now(),
): boolean {
  if (!until) return false;
  const parsed = Date.parse(until);
  return Number.isFinite(parsed) && parsed > now;
}

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
    if (
      ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
        info.code ?? '',
      )
    ) {
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

  const reverify = useCallback(
    async (
      password: string,
      totpCode?: string,
    ): Promise<SettingsActionResult & { csrfToken?: string }> => {
      if (!password.trim()) {
        return { ok: false, error: '请输入当前管理员密码。' };
      }
      if (
        totpCode !== undefined &&
        totpCode !== '' &&
        !/^\d{6}$/.test(totpCode)
      ) {
        return { ok: false, error: 'TOTP 验证码必须为 6 位数字。' };
      }
      if (simulateActionFailure) {
        return { ok: false, error: '身份验证服务暂时不可用，操作未执行。' };
      }

      const activeHeaders = headersWithCsrf();
      if (isLive && session && activeHeaders) {
        try {
          const result = await authReverify({
            body: totpCode ? { password, totp_code: totpCode } : { password },
            headers: activeHeaders,
            throwOnError: true,
          });
          latestCsrfRef.current = result.data.csrf_token;
          onSession?.(result.data);
          return {
            ok: true,
            message: '身份重新验证成功，5 分钟内有效。',
            csrfToken: result.data.csrf_token,
          };
        } catch (error) {
          const info = extractErrorInfo(error);
          if (
            ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
              info.code ?? '',
            )
          ) {
            onFailure?.(error);
          }
          return { ok: false, error: info.message };
        }
      }

      // Mock 验证：拒绝明显测试错误码 000000
      if (totpCode === '000000') {
        return { ok: false, error: 'TOTP 验证码错误或已过期，请核对后重试。' };
      }
      const until = new Date(Date.now() + 5 * 60_000).toISOString();
      setMockAdmin((prev) => ({
        ...prev,
        reverifiedUntil: until,
        mfaReverifiedUntil: totpCode ? until : prev.mfaReverifiedUntil,
      }));
      return { ok: true, message: '身份重新验证成功，5 分钟内有效。' };
    },
    [
      headersWithCsrf,
      isLive,
      onFailure,
      onSession,
      session,
      simulateActionFailure,
    ],
  );

  const ensureReverifiedIfNeeded = useCallback(
    async (
      verify?: SensitiveVerifyPayload,
    ): Promise<SettingsActionResult & { csrfToken?: string }> => {
      const currentUntil = isLive
        ? session?.step_up_totp_required
          ? session.mfa_reauthenticated_until
          : session?.reauthenticated_until
        : mockAdmin.stepUpTotpRequired && mockTotp.enabled
          ? mockAdmin.mfaReverifiedUntil
          : mockAdmin.reverifiedUntil;

      if (isReauthActive(currentUntil)) {
        return {
          ok: true,
          csrfToken: latestCsrfRef.current ?? session?.csrf_token,
        };
      }
      if (!verify?.password) {
        return {
          ok: false,
          requireReauth: true,
          error: '高风险操作前请先完成管理员身份重新验证。',
        };
      }
      return reverify(verify.password, verify.totpCode);
    },
    [
      isLive,
      mockAdmin.mfaReverifiedUntil,
      mockAdmin.reverifiedUntil,
      mockAdmin.stepUpTotpRequired,
      mockTotp.enabled,
      reverify,
      session,
    ],
  );

  const passkeyReverify = useCallback(async (): Promise<
    SettingsActionResult & { csrfToken?: string }
  > => {
    if (simulateActionFailure) {
      return { ok: false, error: '通行密钥验证失败，请重试。' };
    }
    const token = latestCsrfRef.current ?? session?.csrf_token;
    if (isLive && session && token) {
      try {
        const updated = await performPasskeyStepUp(token);
        latestCsrfRef.current = updated.csrf_token;
        onSession?.(updated);
        return {
          ok: true,
          message: '通行密钥二次验证成功，5 分钟内有效。',
          csrfToken: updated.csrf_token,
        };
      } catch (error) {
        const info = extractErrorInfo(error);
        if (
          ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
            info.code ?? '',
          )
        ) {
          onFailure?.(error);
        }
        return { ok: false, error: formatWebAuthnError(error) };
      }
    }
    const until = new Date(Date.now() + 5 * 60_000).toISOString();
    setMockAdmin((prev) => ({
      ...prev,
      reverifiedUntil: until,
      mfaReverifiedUntil: until,
    }));
    return { ok: true, message: '通行密钥二次验证成功，5 分钟内有效。' };
  }, [isLive, onFailure, onSession, session, simulateActionFailure]);

  const registerWebAuthnCredential = useCallback(
    async (
      label: string,
      verify?: SensitiveVerifyPayload,
    ): Promise<SettingsActionResult> => {
      if (busyRef.current) {
        return { ok: false, error: '正在处理其他安全操作，请稍候。' };
      }
      if (simulateActionFailure) {
        return { ok: false, error: '绑定通行密钥失败，请重试。' };
      }
      busyRef.current = true;
      try {
        const reauth = await ensureReverifiedIfNeeded(verify);
        if (!reauth.ok) return reauth;
        const nextHeaders = headersWithCsrf(reauth.csrfToken);
        const cleanLabel = label.trim() || '本机通行密钥';

        if (isLive && nextHeaders) {
          const opt = await authWebauthnRegisterOptions({
            headers: nextHeaders,
            throwOnError: true,
          });
          const credential = await createPasskeyCredential(opt.data.options);
          const verified = await authWebauthnRegisterVerify({
            body: {
              challenge_id: opt.data.challenge_id,
              label: cleanLabel,
              credential,
            },
            headers: nextHeaders,
            throwOnError: true,
          });
          latestCsrfRef.current = verified.data.session.csrf_token;
          onSession?.(verified.data.session);
          await queryClient.invalidateQueries({
            queryKey: ['settings-webauthn-credentials'],
          });
          return {
            ok: true,
            message: `已成功绑定通行密钥「${verified.data.credential.label}」。`,
          };
        }

        const nowLabel = formatSettingsDateTime(new Date().toISOString());
        setMockWebAuthn((prev) => [
          ...prev,
          {
            id: `cred-mock-${Date.now()}`,
            label: cleanLabel,
            transports: ['internal'],
            discoverable: true,
            backupEligible: true,
            backupState: true,
            createdAt: nowLabel,
            lastUsedAt: null,
          },
        ]);
        prependMockAudit(
          'webauthn_registered',
          '绑定通行密钥',
          'settings',
          cleanLabel,
        );
        return { ok: true, message: `已绑定通行密钥「${cleanLabel}」。` };
      } catch (error) {
        const info = extractErrorInfo(error);
        if (
          ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
            info.code ?? '',
          )
        ) {
          onFailure?.(error);
        }
        return {
          ok: false,
          error:
            info.code === 'REAUTH_REQUIRED'
              ? info.message
              : formatWebAuthnError(error),
          requireReauth: info.code === 'REAUTH_REQUIRED',
        };
      } finally {
        busyRef.current = false;
      }
    },
    [
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      onFailure,
      onSession,
      prependMockAudit,
      queryClient,
      simulateActionFailure,
    ],
  );

  const renameWebAuthnCredential = useCallback(
    async (
      credentialId: string,
      label: string,
    ): Promise<SettingsActionResult> => {
      const cleanLabel = label.trim();
      if (!cleanLabel) return { ok: false, error: '请输入有效的设备名称。' };
      const activeHeaders = headersWithCsrf();
      if (isLive && activeHeaders) {
        try {
          await authWebauthnCredentialRename({
            path: { credential_id: credentialId },
            body: { label: cleanLabel },
            headers: activeHeaders,
            throwOnError: true,
          });
          await queryClient.invalidateQueries({
            queryKey: ['settings-webauthn-credentials'],
          });
          return { ok: true, message: '通行密钥名称已更新。' };
        } catch (error) {
          const info = extractErrorInfo(error);
          if (
            ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
              info.code ?? '',
            )
          ) {
            onFailure?.(error);
          }
          return { ok: false, error: info.message };
        }
      }
      setMockWebAuthn((prev) =>
        prev.map((item) =>
          item.id === credentialId ? { ...item, label: cleanLabel } : item,
        ),
      );
      prependMockAudit(
        'webauthn_renamed',
        '重命名通行密钥',
        'settings',
        cleanLabel,
      );
      return { ok: true, message: '通行密钥名称已更新。' };
    },
    [headersWithCsrf, isLive, onFailure, prependMockAudit, queryClient],
  );

  const deleteWebAuthnCredential = useCallback(
    async (
      credentialId: string,
      verify?: SensitiveVerifyPayload,
    ): Promise<SettingsActionResult> => {
      if (busyRef.current) {
        return { ok: false, error: '正在处理其他安全操作，请稍候。' };
      }
      busyRef.current = true;
      try {
        const reauth = await ensureReverifiedIfNeeded(verify);
        if (!reauth.ok) return reauth;
        const nextHeaders = headersWithCsrf(reauth.csrfToken);
        if (isLive && nextHeaders) {
          await authWebauthnCredentialDelete({
            path: { credential_id: credentialId },
            headers: nextHeaders,
            throwOnError: true,
          });
          await queryClient.invalidateQueries({
            queryKey: ['settings-webauthn-credentials'],
          });
          onRefreshSession?.();
          return { ok: true, message: '通行密钥已移除。' };
        }
        if (!mockTotp.enabled && mockWebAuthn.length <= 1) {
          return {
            ok: false,
            error: '至少需保留一种二步验证方式，禁止删除最后一个通行密钥。',
          };
        }
        setMockWebAuthn((prev) =>
          prev.filter((item) => item.id !== credentialId),
        );
        prependMockAudit(
          'webauthn_revoked',
          '移除通行密钥',
          'settings',
          credentialId,
        );
        return { ok: true, message: '通行密钥已移除。' };
      } catch (error) {
        const info = extractErrorInfo(error);
        if (
          ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
            info.code ?? '',
          )
        ) {
          onFailure?.(error);
        }
        return {
          ok: false,
          error: info.message,
          requireReauth: info.code === 'REAUTH_REQUIRED',
        };
      } finally {
        busyRef.current = false;
      }
    },
    [
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      mockTotp.enabled,
      mockWebAuthn.length,
      onFailure,
      onRefreshSession,
      prependMockAudit,
      queryClient,
    ],
  );

  const disableTotp = useCallback(
    async (verify?: SensitiveVerifyPayload): Promise<SettingsActionResult> => {
      if (busyRef.current) {
        return { ok: false, error: '正在处理其他安全操作，请稍候。' };
      }
      busyRef.current = true;
      try {
        const reauth = await ensureReverifiedIfNeeded(verify);
        if (!reauth.ok) return reauth;
        const nextHeaders = headersWithCsrf(reauth.csrfToken);
        if (isLive && nextHeaders) {
          const result = await authTotpDisable({
            headers: nextHeaders,
            throwOnError: true,
          });
          latestCsrfRef.current = result.data.session.csrf_token;
          onSession?.(result.data.session);
          return {
            ok: true,
            message:
              'TOTP 已停用，后续请使用通行密钥（Passkey）或离线恢复码验证。',
          };
        }
        if (mockWebAuthn.length < 1) {
          return {
            ok: false,
            error: '停用 TOTP 前必须至少绑定一个通行密钥。',
          };
        }
        setMockTotp((prev) => ({ ...prev, enabled: false, bound: false }));
        prependMockAudit(
          'totp_disabled',
          '停用 TOTP 验证器',
          'settings',
          '切换为纯通行密钥模式',
        );
        return { ok: true, message: 'TOTP 已停用。' };
      } catch (error) {
        const info = extractErrorInfo(error);
        if (
          ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
            info.code ?? '',
          )
        ) {
          onFailure?.(error);
        }
        return {
          ok: false,
          error: info.message,
          requireReauth: info.code === 'REAUTH_REQUIRED',
        };
      } finally {
        busyRef.current = false;
      }
    },
    [
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      mockWebAuthn.length,
      onFailure,
      onSession,
      prependMockAudit,
    ],
  );

  const startTotpSetup = useCallback(
    async ({
      currentPassword,
      totpCode,
      recoveryCode,
    }: {
      currentPassword: string;
      totpCode?: string;
      recoveryCode?: string;
    }): Promise<
      | { ok: true; setup: TotpSetupChallenge }
      | { ok: false; error: string; requireReauth?: boolean }
    > => {
      if (busyRef.current) {
        return { ok: false, error: '正在处理其他安全操作，请稍候。' };
      }
      if (!currentPassword.trim()) {
        return { ok: false, error: '请输入当前管理员密码。' };
      }
      if (simulateActionFailure) {
        return {
          ok: false,
          error: '生成 TOTP 绑定密钥失败：认证服务拒绝请求（未自动重试）。',
        };
      }

      busyRef.current = true;
      try {
        if (isLive && session) {
          let freshCsrf = latestCsrfRef.current ?? session.csrf_token;
          const recentUntil = session.step_up_totp_required
            ? session.mfa_reauthenticated_until
            : session.reauthenticated_until;
          if (!isReauthActive(recentUntil)) {
            if (session.step_up_totp_required) {
              return {
                ok: false,
                requireReauth: true,
                error: session.totp_enabled
                  ? '高风险操作要求 5 分钟内完成二次验证，请先点击通行密钥验证或通过「重新验证」完成校验，待动态验证码刷新后再重绑。'
                  : '请先使用通行密钥（Passkey）完成二次验证，再启用 TOTP 验证器。',
              };
            }
            const reauth = await reverify(currentPassword);
            if (!reauth.ok) return reauth;
            freshCsrf = reauth.csrfToken ?? freshCsrf;
          }
          const nextHeaders = headersWithCsrf(freshCsrf);
          if (!nextHeaders) {
            return { ok: false, error: '缺少有效的安全令牌，请刷新后重试。' };
          }
          const result = await authTotpSetup({
            body: {
              password: currentPassword,
              ...(totpCode ? { totp_code: totpCode.trim() } : {}),
              ...(recoveryCode ? { recovery_code: recoveryCode.trim() } : {}),
            },
            headers: nextHeaders,
            throwOnError: true,
          });
          latestCsrfRef.current = result.data.session.csrf_token;
          onSession?.(result.data.session);
          return {
            ok: true,
            setup: {
              secret: result.data.secret,
              qrDataUrl: result.data.qr_data_url,
              expiresAt: result.data.expires_at,
            },
          };
        }

        if (mockTotp.enabled && totpCode === '000000') {
          return { ok: false, error: '当前 TOTP 验证码错误或已过期。' };
        }
        const svg = encodeURIComponent(
          '<svg xmlns="http://www.w3.org/2000/svg" width="184" height="184" viewBox="0 0 184 184"><rect width="184" height="184" fill="#ffffff"/><rect x="16" y="16" width="44" height="44" fill="#0f172a"/><rect x="24" y="24" width="28" height="28" fill="#ffffff"/><rect x="30" y="30" width="16" height="16" fill="#0f172a"/><rect x="124" y="16" width="44" height="44" fill="#0f172a"/><rect x="132" y="24" width="28" height="28" fill="#ffffff"/><rect x="138" y="30" width="16" height="16" fill="#0f172a"/><rect x="16" y="124" width="44" height="44" fill="#0f172a"/><rect x="24" y="132" width="28" height="28" fill="#ffffff"/><rect x="30" y="138" width="16" height="16" fill="#0f172a"/><rect x="76" y="76" width="32" height="32" fill="#0f172a"/><rect x="120" y="120" width="40" height="40" fill="#0f172a"/></svg>',
        );
        return {
          ok: true,
          setup: {
            secret: 'MOCKDEMO234567AB',
            qrDataUrl: `data:image/svg+xml;utf8,${svg}`,
            expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
          },
        };
      } catch (error) {
        const info = extractErrorInfo(error);
        if (
          ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
            info.code ?? '',
          )
        ) {
          onFailure?.(error);
        }
        return {
          ok: false,
          error: info.message,
          requireReauth: info.code === 'REAUTH_REQUIRED',
        };
      } finally {
        busyRef.current = false;
      }
    },
    [
      headersWithCsrf,
      isLive,
      mockTotp.enabled,
      onFailure,
      onSession,
      reverify,
      session,
      simulateActionFailure,
    ],
  );

  const confirmTotpSetup = useCallback(
    async (
      code: string,
    ): Promise<
      | { ok: true; codes: string[]; message?: string }
      | { ok: false; error: string; requireReauth?: boolean }
    > => {
      if (busyRef.current) {
        return { ok: false, error: '正在处理其他安全操作，请稍候。' };
      }
      if (!/^\d{6}$/.test(code.trim())) {
        return { ok: false, error: '请输入 6 位数字 TOTP 验证码。' };
      }
      if (simulateActionFailure) {
        return {
          ok: false,
          error: '确认 TOTP 绑定失败：服务端拒绝请求（未自动重试）。',
        };
      }

      busyRef.current = true;
      try {
        const nextHeaders = headersWithCsrf();
        if (isLive && nextHeaders) {
          const result = await authTotpConfirm({
            body: { code: code.trim() },
            headers: nextHeaders,
            throwOnError: true,
          });
          latestCsrfRef.current = result.data.session.csrf_token;
          onSession?.(result.data.session);
          setLiveTotpRemaining(result.data.recovery_codes.length);
          void queryClient.invalidateQueries({
            queryKey: ['settings-sessions'],
          });
          void queryClient.invalidateQueries({
            queryKey: ['settings-audits'],
          });
          return {
            ok: true,
            codes: result.data.recovery_codes,
            message: 'TOTP 验证器已绑定，请立即离线保存新的备用恢复码。',
          };
        }

        if (code.trim() === '000000') {
          return { ok: false, error: '新验证器验证码无效，请重新核对。' };
        }
        const codes = generateDemoRecoveryCodes();
        setMockTotp((prev) => ({
          ...prev,
          enabled: true,
          bound: true,
          recoveryCodesTotal: codes.length,
          recoveryCodesRemaining: codes.length,
        }));
        prependMockAudit(
          'totp_bound',
          '绑定 TOTP 验证器',
          'settings',
          'TOTP 验证器与恢复码',
        );
        return {
          ok: true,
          codes,
          message: 'TOTP 验证器已绑定，请立即离线保存新的备用恢复码。',
        };
      } catch (error) {
        const info = extractErrorInfo(error);
        if (
          ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
            info.code ?? '',
          )
        ) {
          onFailure?.(error);
        }
        return {
          ok: false,
          error: info.message,
          requireReauth: info.code === 'REAUTH_REQUIRED',
        };
      } finally {
        busyRef.current = false;
      }
    },
    [
      headersWithCsrf,
      isLive,
      onFailure,
      onSession,
      prependMockAudit,
      queryClient,
      simulateActionFailure,
    ],
  );

  const changePassword = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
      totpCode?: string,
    ): Promise<SettingsActionResult> => {
      if (busyRef.current) {
        return { ok: false, error: '正在处理其他安全操作，请稍候。' };
      }
      if (!currentPassword) {
        return { ok: false, error: '请输入当前管理员密码。' };
      }
      if (newPassword.length < 16) {
        return { ok: false, error: '新密码长度不能少于 16 位。' };
      }
      if (newPassword === currentPassword) {
        return { ok: false, error: '新密码不能与当前密码相同。' };
      }
      if (simulateActionFailure) {
        return {
          ok: false,
          error: '修改密码失败：后端返回拒绝响应（未自动重试）。',
        };
      }

      busyRef.current = true;
      try {
        const reauth = await ensureReverifiedIfNeeded({
          password: currentPassword,
          totpCode,
        });
        if (!reauth.ok) return reauth;

        const nextHeaders = headersWithCsrf(reauth.csrfToken);
        if (isLive && nextHeaders) {
          await authChangePassword({
            body: { password: currentPassword, new_password: newPassword },
            headers: nextHeaders,
            throwOnError: true,
          });
          onRefreshSession?.();
          return {
            ok: true,
            message: '管理员密码已更新，所有活动会话已退出，请使用新密码登录。',
          };
        }

        const nowStr = formatSettingsDateTime(new Date().toISOString());
        setMockAdmin((prev) => ({
          ...prev,
          passwordChangedAt: nowStr,
          passwordStrengthLabel:
            newPassword.length >= 20 ? '极强（20+ 位）' : '强（16+ 位）',
        }));
        prependMockAudit(
          'password_changed',
          '修改管理员密码',
          'settings',
          'admin 账户口令策略',
        );
        return {
          ok: true,
          message: '管理员密码已更新，建议立即在所有设备上确认会话安全。',
        };
      } catch (error) {
        const info = extractErrorInfo(error);
        if (
          ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
            info.code ?? '',
          )
        ) {
          onFailure?.(error);
        }
        return {
          ok: false,
          error: info.message,
          requireReauth: info.code === 'REAUTH_REQUIRED',
        };
      } finally {
        busyRef.current = false;
      }
    },
    [
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      onFailure,
      onRefreshSession,
      prependMockAudit,
      simulateActionFailure,
    ],
  );

  const regenerateRecoveryCodes = useCallback(
    async (
      currentPassword: string,
      totpCode: string,
    ): Promise<
      | { ok: true; codes: string[]; message?: string }
      | { ok: false; error: string; requireReauth?: boolean }
    > => {
      if (busyRef.current) {
        return { ok: false, error: '正在处理其他安全操作，请稍候。' };
      }
      if (!currentPassword.trim()) {
        return { ok: false, error: '请输入当前管理员密码。' };
      }
      if (!/^\d{6}$/.test(totpCode.trim())) {
        return { ok: false, error: '请输入 6 位数字 TOTP 验证码。' };
      }
      if (simulateActionFailure) {
        return {
          ok: false,
          error: '重新生成恢复码失败，旧恢复码保持不变（未自动重试）。',
        };
      }

      busyRef.current = true;
      try {
        let freshCsrf = latestCsrfRef.current ?? session?.csrf_token;
        if (isLive && session) {
          if (!isReauthActive(session.reauthenticated_until)) {
            if (session.step_up_totp_required) {
              return {
                ok: false,
                requireReauth: true,
                error:
                  '当前环境已启用高风险操作 TOTP 二次验证，请先完成重新验证并待验证码刷新后再重新生成恢复码。',
              };
            }
            const reauth = await reverify(currentPassword);
            if (!reauth.ok) return reauth;
            freshCsrf = reauth.csrfToken ?? freshCsrf;
          }
          const nextHeaders = headersWithCsrf(freshCsrf);
          if (nextHeaders) {
            const result = await authRegenerateRecoveryCodes({
              body: { password: currentPassword, totp_code: totpCode.trim() },
              headers: nextHeaders,
              throwOnError: true,
            });
            latestCsrfRef.current = result.data.session.csrf_token;
            onSession?.(result.data.session);
            setLiveTotpRemaining(result.data.recovery_codes.length);
            return {
              ok: true,
              codes: result.data.recovery_codes,
              message: '已生成新的备用恢复码，旧恢复码已立即失效。',
            };
          }
        } else {
          const reauth = await ensureReverifiedIfNeeded({
            password: currentPassword,
            totpCode: totpCode.trim(),
          });
          if (!reauth.ok) return reauth;
        }

        if (totpCode.trim() === '000000') {
          return {
            ok: false,
            error: 'TOTP 验证码无效，请重新输入当前验证码。',
          };
        }
        const codes = generateDemoRecoveryCodes();
        setMockTotp((prev) => ({
          ...prev,
          recoveryCodesTotal: codes.length,
          recoveryCodesRemaining: codes.length,
        }));
        prependMockAudit(
          'totp_recovery_regenerated',
          '重新生成恢复码',
          'settings',
          'TOTP 备用恢复码（10 个）',
        );
        return {
          ok: true,
          codes,
          message: '已生成 10 个新恢复码，旧恢复码已失效，请立即离线保存。',
        };
      } catch (error) {
        const info = extractErrorInfo(error);
        if (
          ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
            info.code ?? '',
          )
        ) {
          onFailure?.(error);
        }
        return {
          ok: false,
          error: info.message,
          requireReauth: info.code === 'REAUTH_REQUIRED',
        };
      } finally {
        busyRef.current = false;
      }
    },
    [
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      onFailure,
      onSession,
      prependMockAudit,
      reverify,
      session,
      simulateActionFailure,
    ],
  );

  const terminateSession = useCallback(
    async (
      sessionId: string,
      verify?: SensitiveVerifyPayload,
    ): Promise<SettingsActionResult> => {
      if (busyRef.current) {
        return { ok: false, error: '正在执行其他会话操作，请稍候。' };
      }
      if (simulateActionFailure) {
        return {
          ok: false,
          error: '终止会话失败：服务拒绝请求（未自动重试）。',
        };
      }
      busyRef.current = true;
      try {
        const reauth = await ensureReverifiedIfNeeded(verify);
        if (!reauth.ok) return reauth;

        const nextHeaders = headersWithCsrf(reauth.csrfToken);
        if (isLive && nextHeaders) {
          const isCurrent = sessionsQuery.data?.items.some(
            (s) => s.id === sessionId && s.current,
          );
          if (isCurrent && onSignedOut) {
            onSignedOut(
              sessionsRevoke({
                path: { session_id: sessionId },
                headers: nextHeaders,
                throwOnError: true,
              }),
            );
            return { ok: true, message: '当前会话已终止。' };
          }
          await sessionsRevoke({
            path: { session_id: sessionId },
            headers: nextHeaders,
            throwOnError: true,
          });
          await queryClient.invalidateQueries({
            queryKey: ['settings-sessions'],
          });
          return { ok: true, message: '目标会话已终止。' };
        }

        const target = mockSessions.find((s) => s.id === sessionId);
        setMockSessions((prev) => prev.filter((s) => s.id !== sessionId));
        prependMockAudit(
          'session_revoked',
          '终止会话',
          'session',
          target ? `${target.deviceBrowser} (${target.ipAddress})` : sessionId,
        );
        return {
          ok: true,
          message: target
            ? `已终止会话：${target.deviceBrowser}`
            : '目标会话已终止。',
        };
      } catch (error) {
        const info = extractErrorInfo(error);
        if (
          ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
            info.code ?? '',
          )
        ) {
          onFailure?.(error);
        }
        return {
          ok: false,
          error: info.message,
          requireReauth: info.code === 'REAUTH_REQUIRED',
        };
      } finally {
        busyRef.current = false;
      }
    },
    [
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      mockSessions,
      onFailure,
      onSignedOut,
      prependMockAudit,
      queryClient,
      sessionsQuery.data?.items,
      simulateActionFailure,
    ],
  );

  const logoutOtherSessions = useCallback(
    async (verify?: SensitiveVerifyPayload): Promise<SettingsActionResult> => {
      if (busyRef.current) {
        return { ok: false, error: '正在执行其他会话操作，请稍候。' };
      }
      if (simulateActionFailure) {
        return {
          ok: false,
          error: '退出其他会话失败：无法确认远端撤销状态（未自动重试）。',
        };
      }
      busyRef.current = true;
      try {
        const reauth = await ensureReverifiedIfNeeded(verify);
        if (!reauth.ok) return reauth;

        const nextHeaders = headersWithCsrf(reauth.csrfToken);
        if (isLive && nextHeaders) {
          await sessionsRevokeOthers({
            headers: nextHeaders,
            throwOnError: true,
          });
          await queryClient.invalidateQueries({
            queryKey: ['settings-sessions'],
          });
          return { ok: true, message: '已退出所有其他设备会话。' };
        }

        setMockSessions((prev) => prev.filter((s) => s.current));
        prependMockAudit(
          'sessions_revoked_others',
          '退出其他会话',
          'session',
          '全部非当前活动会话',
        );
        return { ok: true, message: '已退出所有其他活动会话。' };
      } catch (error) {
        const info = extractErrorInfo(error);
        if (
          ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
            info.code ?? '',
          )
        ) {
          onFailure?.(error);
        }
        return {
          ok: false,
          error: info.message,
          requireReauth: info.code === 'REAUTH_REQUIRED',
        };
      } finally {
        busyRef.current = false;
      }
    },
    [
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      onFailure,
      prependMockAudit,
      queryClient,
      simulateActionFailure,
    ],
  );

  const runImmediateBackup =
    useCallback(async (): Promise<SettingsActionResult> => {
      if (isLive) {
        return {
          ok: false,
          error:
            '在线 Web 控制台不支持直接触发服务器备份，请通过部署主机备份脚本或定时任务执行 pg_dump + age 加密备份。',
        };
      }
      if (backupRunning) {
        return { ok: false, error: '已有备份任务正在执行，请等待完成。' };
      }
      setBackupRunning(true);
      try {
        await new Promise((resolve) => window.setTimeout(resolve, 420));
        if (simulateActionFailure) {
          setMockBackup((prev) => ({
            ...prev,
            state: 'failed',
            statusLabel: '备份失败',
          }));
          prependMockAudit(
            'backup_failed',
            '手动备份',
            'backup',
            'pg_dump + age 归档',
            'failed',
          );
          return {
            ok: false,
            error:
              '备份执行失败：age 加密归档校验未通过，请排查磁盘与密钥配置后手动重试。',
          };
        }

        const now = new Date();
        const formatted = formatSettingsDateTime(now.toISOString(), true);
        const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const suffix = Math.random().toString(36).slice(2, 6);
        const newArchive: BackupArchiveItem = {
          id: `bkp-${stamp}-${suffix}`,
          filename: `gmailfile_${stamp}.pgdump.age`,
          createdAt: formatted,
          sizeLabel: '64.5 MB',
          method: 'pg_dump + age 加密',
          checksumShort: 'sha256:c18b…4e20',
        };

        setMockBackup((prev) => ({
          ...prev,
          state: 'success',
          statusLabel: '备份正常',
          lastBackupAt: formatted,
          archives: [newArchive, ...prev.archives],
        }));
        prependMockAudit(
          'backup_completed',
          '立即备份',
          'backup',
          newArchive.filename,
        );

        return {
          ok: true,
          message: `加密备份已完成（${newArchive.filename}）`,
        };
      } finally {
        setBackupRunning(false);
      }
    }, [backupRunning, isLive, prependMockAudit, simulateActionFailure]);

  const runRestoreVerification = useCallback(
    async (archive: BackupArchiveItem): Promise<RestoreVerifyReport> => {
      const verifiedAt = formatSettingsDateTime(new Date().toISOString());
      if (isLive) {
        return {
          archive,
          passed: false,
          verifiedAt,
          durationMs: 0,
          sampledRows: 0,
          checks: RESTORE_VERIFICATION_CHECKLIST.map((item) => ({
            ...item,
            status: 'pending',
            detail: '需通过部署主机离线恢复脚本执行',
          })),
          errorMessage:
            '在线 Web 控制台不支持直接执行沙箱恢复演练，请通过部署主机离线恢复脚本验证归档完整性。',
        };
      }

      const started = performance.now();
      await new Promise((resolve) => window.setTimeout(resolve, 360));

      if (simulateActionFailure) {
        const failedChecks: RestoreCheckItem[] =
          RESTORE_VERIFICATION_CHECKLIST.map((item, idx) => ({
            ...item,
            status: idx < 2 ? 'passed' : idx === 2 ? 'failed' : 'pending',
            detail:
              idx < 2
                ? '校验通过'
                : idx === 2
                  ? '外键约束检查检测到缺失标签引用，已中止验证'
                  : '因前置步骤失败未执行',
          }));
        return {
          archive,
          passed: false,
          verifiedAt,
          durationMs: Math.max(380, Math.round(performance.now() - started)),
          sampledRows: 0,
          checks: failedChecks,
          errorMessage:
            '恢复验证未通过：检测到约束校验失败，请勿将该归档作为最新恢复基线。',
        };
      }

      const passedChecks: RestoreCheckItem[] =
        RESTORE_VERIFICATION_CHECKLIST.map((item) => ({
          ...item,
          status: 'passed',
          detail:
            item.id === 'age-decrypt'
              ? `校验和 ${archive.checksumShort} 匹配`
              : item.id === 'schema-structure'
                ? '14 张核心表与迁移版本 0004 一致'
                : item.id === 'constraints'
                  ? '唯一索引与外键完整性 100% 通过'
                  : '抽样 24 条加密记录完成内存认证解密',
        }));

      setMockBackup((prev) => ({
        ...prev,
        lastRestoreVerifiedAt: verifiedAt,
        restoreVerifySummary: '结构、约束与抽样解密',
      }));
      prependMockAudit(
        'restore_verified',
        '恢复验证',
        'backup',
        archive.filename,
      );

      return {
        archive,
        passed: true,
        verifiedAt,
        durationMs: Math.max(410, Math.round(performance.now() - started)),
        sampledRows: 24,
        checks: passedChecks,
      };
    },
    [isLive, prependMockAudit, simulateActionFailure],
  );

  const updateRetentionPolicy = useCallback(
    async (
      next: {
        auditRetentionDays: number;
        backupRetentionDays: number;
        idleMinutes?: number;
      },
      verify?: SensitiveVerifyPayload,
    ): Promise<SettingsActionResult> => {
      if (
        !isLive &&
        (next.auditRetentionDays < 30 ||
          next.auditRetentionDays > 3650 ||
          next.backupRetentionDays < 7 ||
          next.backupRetentionDays > 1095)
      ) {
        return {
          ok: false,
          error:
            '保留天数超出允许范围（审计日志 30–3650 天，备份 7–1095 天）。',
        };
      }
      if (simulateActionFailure) {
        return {
          ok: false,
          error: '保存生命周期策略失败：服务端配置写入被拒绝（未自动重试）。',
        };
      }

      if (
        isLive &&
        (typeof next.idleMinutes !== 'number' ||
          next.idleMinutes === systemQuery.data?.settings.idle_minutes)
      ) {
        return {
          ok: false,
          error:
            '当前服务端仅支持在线修改会话空闲自动锁定时间；审计与备份保留天数请通过部署环境变量调整。',
        };
      }

      const reauth = await ensureReverifiedIfNeeded(verify);
      if (!reauth.ok) return reauth;

      const nextHeaders = headersWithCsrf(reauth.csrfToken);
      if (isLive && nextHeaders) {
        try {
          await settingsIdle({
            body: { idle_minutes: next.idleMinutes! },
            headers: nextHeaders,
            throwOnError: true,
          });
          await queryClient.invalidateQueries({
            queryKey: ['settings-system-meta'],
          });
          onRefreshSession?.();
          return { ok: true, message: '会话空闲自动锁定策略已更新。' };
        } catch (error) {
          const info = extractErrorInfo(error);
          if (
            ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
              info.code ?? '',
            )
          ) {
            onFailure?.(error);
          }
          return {
            ok: false,
            error: info.message,
            requireReauth: info.code === 'REAUTH_REQUIRED',
          };
        }
      }

      setMockRetention((prev) => ({
        ...prev,
        auditRetentionDays: next.auditRetentionDays,
        backupRetentionDays: next.backupRetentionDays,
      }));
      if (typeof next.idleMinutes === 'number') {
        setMockRuntime((prev) => ({
          ...prev,
          idleMinutes: next.idleMinutes!,
        }));
      }
      prependMockAudit(
        'settings_updated',
        '调整生命周期策略',
        'settings',
        `审计 ${next.auditRetentionDays} 天 / 备份 ${next.backupRetentionDays} 天`,
      );
      return { ok: true, message: '日志保留与数据生命周期策略已保存。' };
    },
    [
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      onFailure,
      onRefreshSession,
      prependMockAudit,
      queryClient,
      simulateActionFailure,
      systemQuery.data?.settings.idle_minutes,
    ],
  );

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

  // 聚合各区域展示模型与加载/错误/空状态
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
    backupRunning,
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
    handlers: {
      reverify,
      passkeyReverify,
      registerWebAuthnCredential,
      renameWebAuthnCredential,
      deleteWebAuthnCredential,
      startTotpSetup,
      confirmTotpSetup,
      disableTotp,
      changePassword,
      regenerateRecoveryCodes,
      terminateSession,
      logoutOtherSessions,
      runImmediateBackup,
      runRestoreVerification,
      updateRetentionPolicy,
      retryAll,
    },
  };
}
