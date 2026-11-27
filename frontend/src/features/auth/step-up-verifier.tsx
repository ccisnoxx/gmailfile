import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, KeyRound, ShieldAlert } from 'lucide-react';
import {
  authReverify,
  type ErrorResponse,
  type SessionResponse,
} from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  formatWebAuthnError,
  isWebAuthnSupported,
  performPasskeyStepUp,
} from '@/lib/webauthn';

export function isSessionStepUpActive(
  session: SessionResponse | undefined,
  requireMfa = true,
  referenceNowMs?: number,
): boolean {
  if (!session) return false;
  const nowMs =
    referenceNowMs ??
    (Number.isFinite(Date.parse(session.server_time))
      ? Date.parse(session.server_time)
      : Date.now());
  const reauthUntil = session.reauthenticated_until
    ? Date.parse(session.reauthenticated_until)
    : Number.NaN;
  if (!Number.isFinite(reauthUntil) || reauthUntil <= nowMs) {
    return false;
  }
  const hasAnyMfa = Boolean(session.totp_enabled || session.webauthn_enabled);
  if (requireMfa && hasAnyMfa) {
    const mfaUntil = session.mfa_reauthenticated_until
      ? Date.parse(session.mfa_reauthenticated_until)
      : Number.NaN;
    if (!Number.isFinite(mfaUntil) || mfaUntil <= nowMs) {
      return false;
    }
  }
  return true;
}

export function useStepUpActive(
  session: SessionResponse | undefined,
  requireMfa = true,
): boolean {
  const [anchor, setAnchor] = useState(() => ({
    serverMs:
      session && Number.isFinite(Date.parse(session.server_time))
        ? Date.parse(session.server_time)
        : Date.now(),
    localMs: Date.now(),
  }));
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const localMs = Date.now();
    const parsedServer =
      session && Number.isFinite(Date.parse(session.server_time))
        ? Date.parse(session.server_time)
        : localMs;
    setAnchor({ serverMs: parsedServer, localMs });
    setNowMs(localMs);
  }, [
    session?.server_time,
    session?.reauthenticated_until,
    session?.mfa_reauthenticated_until,
    session,
  ]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  const estimatedServerMs =
    anchor.serverMs + Math.max(0, nowMs - anchor.localMs);
  return isSessionStepUpActive(session, requireMfa, estimatedServerMs);
}

export function StepUpVerifier({
  session,
  requireMfa = true,
  forceVerify = false,
  disabled = false,
  actionLabel = '继续操作',
  onVerified,
  onFailure,
}: {
  session: SessionResponse;
  requireMfa?: boolean;
  forceVerify?: boolean;
  disabled?: boolean;
  actionLabel?: string;
  onVerified: (nextSession: SessionResponse) => void;
  onFailure?: (error: unknown) => void;
}) {
  const passwordId = useId();
  const totpId = useId();
  const mounted = useRef(true);
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState('');

  const active = useStepUpActive(session, requireMfa);
  const needsVerify = forceVerify || !active;
  const hasAnyMfa = Boolean(session.totp_enabled || session.webauthn_enabled);
  const needsMfa = requireMfa && hasAnyMfa;
  const canPasskey = Boolean(session.webauthn_enabled && isWebAuthnSupported());
  const canPasswordFlow = Boolean(
    session.totp_enabled || !session.webauthn_enabled,
  );

  useEffect(() => {
    mounted.current = true;
    const clearSecrets = () => {
      if (document.hidden) {
        setPassword('');
        setTotpCode('');
      }
    };
    document.addEventListener('visibilitychange', clearSecrets);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', clearSecrets);
    };
  }, []);

  async function handlePasskeyVerify() {
    if (verifying || disabled) return;
    setError('');
    setVerifying(true);
    try {
      const updated = await performPasskeyStepUp(session.csrf_token);
      if (!mounted.current || document.hidden) return;
      setPassword('');
      setTotpCode('');
      onVerified(updated);
    } catch (err) {
      if (!mounted.current || document.hidden) return;
      setError(formatWebAuthnError(err));
      onFailure?.(err);
    } finally {
      if (mounted.current) setVerifying(false);
    }
  }

  async function handleCredentialVerify() {
    if (verifying || disabled) return;
    setError('');
    if (!password) {
      setError('请输入当前管理员密码完成身份验证。');
      return;
    }
    if (needsMfa && session.totp_enabled && !/^\d{6}$/.test(totpCode.trim())) {
      setError('请输入 6 位数字 TOTP 验证码。');
      return;
    }
    setVerifying(true);
    try {
      const body =
        needsMfa && session.totp_enabled
          ? { password, totp_code: totpCode.trim() }
          : { password };
      const { data } = await authReverify({
        body,
        headers: { 'X-CSRF-Token': session.csrf_token },
        throwOnError: true,
      });
      if (!mounted.current || document.hidden) return;
      setPassword('');
      setTotpCode('');
      onVerified(data);
    } catch (err) {
      if (!mounted.current || document.hidden) return;
      const msg = (err as Partial<ErrorResponse>)?.error?.message;
      setError(msg ?? '重新验证失败，请检查管理员凭据后重试。');
      onFailure?.(err);
    } finally {
      if (mounted.current) setVerifying(false);
    }
  }

  if (!needsVerify) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-xl border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-3 py-2 text-xs text-[var(--badge-green-text)]"
      >
        <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
        <span>已完成最近 5 分钟管理员二次验证，现在可{actionLabel}。</span>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label="管理员二次验证"
      className="space-y-3 rounded-xl border border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)]/50 p-3.5"
    >
      <div className="flex items-start gap-2 text-xs leading-5 text-[var(--badge-orange-text)]">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <p>
          {needsMfa
            ? `此操作不可逆，请先完成最近 5 分钟内的管理员二次验证（通行密钥或密码 + TOTP），验证通过后方可${actionLabel}。`
            : `此操作不可逆，请先完成最近 5 分钟内的管理员重新验证，验证通过后方可${actionLabel}。`}
        </p>
      </div>

      {canPasskey && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full"
          disabled={verifying || disabled}
          onClick={() => void handlePasskeyVerify()}
        >
          <KeyRound className="size-4" aria-hidden="true" />
          {verifying
            ? '正在验证通行密钥…'
            : '使用通行密钥（Passkey）完成二次验证'}
        </Button>
      )}

      {canPasswordFlow ? (
        <div className="space-y-2.5">
          <div className="space-y-1">
            <label htmlFor={passwordId} className="block text-xs font-medium">
              当前管理员密码
            </label>
            <Input
              id={passwordId}
              type="password"
              autoComplete="current-password"
              disabled={verifying || disabled}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleCredentialVerify();
                }
              }}
              placeholder="请输入当前管理员密码"
            />
          </div>
          {needsMfa && session.totp_enabled && (
            <div className="space-y-1">
              <label htmlFor={totpId} className="block text-xs font-medium">
                TOTP 验证码（6 位）
              </label>
              <Input
                id={totpId}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                disabled={verifying || disabled}
                value={totpCode}
                onChange={(e) =>
                  setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleCredentialVerify();
                  }
                }}
                placeholder="输入 6 位动态验证码"
              />
            </div>
          )}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="w-full"
            disabled={verifying || disabled}
            onClick={() => void handleCredentialVerify()}
          >
            {verifying ? '正在验证…' : '完成管理员二次验证'}
          </Button>
        </div>
      ) : !canPasskey ? (
        <p role="alert" className="text-xs text-destructive">
          当前账号已停用
          TOTP，且当前浏览器不支持通行密钥（Passkey），无法完成二次验证。
        </p>
      ) : null}

      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
