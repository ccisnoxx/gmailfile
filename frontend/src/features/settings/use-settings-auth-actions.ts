import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react';
import type { QueryClient } from '@tanstack/react-query';
import {
  authChangePassword,
  authRegenerateRecoveryCodes,
  authReverify,
  authTotpConfirm,
  authTotpDisable,
  authTotpSetup,
  authWebauthnCredentialDelete,
  authWebauthnCredentialRename,
  authWebauthnRegisterOptions,
  authWebauthnRegisterVerify,
  type SessionResponse,
} from '@/api/generated';
import {
  createPasskeyCredential,
  formatWebAuthnError,
  performPasskeyStepUp,
} from '@/lib/webauthn';
import {
  formatSettingsDateTime,
  generateDemoRecoveryCodes,
} from './mock-fixtures';
import {
  forwardFatalSessionError,
  isReauthActive,
  type PrependMockAuditFn,
} from './settings-data-helpers';
import type {
  AdminSecurityInfo,
  SensitiveVerifyPayload,
  SettingsActionResult,
  TotpSecurityInfo,
  TotpSetupChallenge,
  WebAuthnCredentialRow,
} from './types';

export type UseSettingsAuthActionsOptions = {
  isLive: boolean;
  session?: SessionResponse;
  onSession?: (next: SessionResponse) => void;
  onFailure?: (error: unknown) => void;
  onRefreshSession?: () => void;
  simulateActionFailure: boolean;
  queryClient: QueryClient;
  busyRef: MutableRefObject<boolean>;
  latestCsrfRef: MutableRefObject<string | undefined>;
  headersWithCsrf: (
    csrfOverride?: string,
  ) => { 'X-CSRF-Token': string } | undefined;
  mockAdmin: AdminSecurityInfo;
  setMockAdmin: Dispatch<SetStateAction<AdminSecurityInfo>>;
  mockTotp: TotpSecurityInfo;
  setMockTotp: Dispatch<SetStateAction<TotpSecurityInfo>>;
  mockWebAuthn: WebAuthnCredentialRow[];
  setMockWebAuthn: Dispatch<SetStateAction<WebAuthnCredentialRow[]>>;
  setLiveTotpRemaining: Dispatch<SetStateAction<number | null>>;
  prependMockAudit: PrependMockAuditFn;
};

export function useSettingsAuthActions({
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
}: UseSettingsAuthActionsOptions) {
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
          const info = forwardFatalSessionError(error, onFailure);
          return { ok: false, error: info.message };
        }
      }

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
      latestCsrfRef,
      onFailure,
      onSession,
      session,
      setMockAdmin,
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
      latestCsrfRef,
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
        forwardFatalSessionError(error, onFailure);
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
  }, [
    isLive,
    latestCsrfRef,
    onFailure,
    onSession,
    session,
    setMockAdmin,
    simulateActionFailure,
  ]);

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
        const info = forwardFatalSessionError(error, onFailure);
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
      busyRef,
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      latestCsrfRef,
      onFailure,
      onSession,
      prependMockAudit,
      queryClient,
      setMockWebAuthn,
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
          const info = forwardFatalSessionError(error, onFailure);
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
    [
      headersWithCsrf,
      isLive,
      onFailure,
      prependMockAudit,
      queryClient,
      setMockWebAuthn,
    ],
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
        const info = forwardFatalSessionError(error, onFailure);
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
      busyRef,
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      mockTotp.enabled,
      mockWebAuthn.length,
      onFailure,
      onRefreshSession,
      prependMockAudit,
      queryClient,
      setMockWebAuthn,
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
        const info = forwardFatalSessionError(error, onFailure);
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
      busyRef,
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      latestCsrfRef,
      mockWebAuthn.length,
      onFailure,
      onSession,
      prependMockAudit,
      setMockTotp,
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
          const requiresExistingMfa =
            session.step_up_totp_required ||
            (!session.totp_enabled && session.webauthn_enabled);
          const recentUntil = requiresExistingMfa
            ? session.mfa_reauthenticated_until
            : session.reauthenticated_until;
          if (!isReauthActive(recentUntil)) {
            if (requiresExistingMfa) {
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
        const info = forwardFatalSessionError(error, onFailure);
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
      busyRef,
      headersWithCsrf,
      isLive,
      latestCsrfRef,
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
        const info = forwardFatalSessionError(error, onFailure);
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
      busyRef,
      headersWithCsrf,
      isLive,
      latestCsrfRef,
      onFailure,
      onSession,
      prependMockAudit,
      queryClient,
      setLiveTotpRemaining,
      setMockTotp,
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
        const info = forwardFatalSessionError(error, onFailure);
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
      busyRef,
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      onFailure,
      onRefreshSession,
      prependMockAudit,
      setMockAdmin,
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
        const info = forwardFatalSessionError(error, onFailure);
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
      busyRef,
      ensureReverifiedIfNeeded,
      headersWithCsrf,
      isLive,
      latestCsrfRef,
      onFailure,
      onSession,
      prependMockAudit,
      reverify,
      session,
      setLiveTotpRemaining,
      setMockTotp,
      simulateActionFailure,
    ],
  );

  return {
    reverify,
    ensureReverifiedIfNeeded,
    passkeyReverify,
    registerWebAuthnCredential,
    renameWebAuthnCredential,
    deleteWebAuthnCredential,
    disableTotp,
    startTotpSetup,
    confirmTotpSetup,
    changePassword,
    regenerateRecoveryCodes,
  };
}
