import { useCallback, useEffect, useRef, useState } from 'react';
import type { SessionResponse } from '@/api/generated';
import {
  accountsCopyPasswordEvent,
  accountsRevealPassword,
  authReverify,
} from '@/api/generated';
import {
  formatWebAuthnError,
  isWebAuthnSupported,
  performPasskeyStepUp,
} from '@/lib/webauthn';

export const PASSWORD_MASK_TEXT = '••••••••••••••••';
const SECRET_TTL_MS = 20000;

async function clipboardFingerprint(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    return String(value.length);
  }
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function isMaskedPasswordPlaceholder(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && /^[•●*]+$/.test(trimmed);
}

export function usePasswordSecret({
  accountId,
  resetEpoch = 0,
  session,
  onSession,
  onFailure,
  mockReveal,
  onAuditEvent,
  onToast,
}: {
  accountId: string;
  resetEpoch?: number;
  session?: SessionResponse;
  onSession?: (value: SessionResponse) => void;
  onFailure?: (error: unknown) => void;
  mockReveal?: (accountId: string) => Promise<string>;
  onAuditEvent?: (intent: 'show' | 'copy') => void;
  onToast?: (message: string) => void;
}) {
  // 仅保存在局部组件状态，绝不写入 Query/Mutation 缓存或全局存储。
  const [password, setPassword] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const [pending, setPending] = useState(false);
  const [reauth, setReauth] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const generation = useRef(0);
  const mounted = useRef(true);
  const expiry = useRef<number | undefined>(undefined);
  const tickRef = useRef<number | undefined>(undefined);
  const copied = useRef<Promise<string> | null>(null);

  const clear = useCallback(() => {
    generation.current++;
    window.clearTimeout(expiry.current);
    window.clearInterval(tickRef.current);
    setPassword(null);
    setRemainingSeconds(0);
    setPending(false);
    const previous = copied.current;
    copied.current = null;
    if (previous) {
      void navigator.clipboard
        ?.readText?.()
        .then(async (text) => {
          if ((await clipboardFingerprint(text)) === (await previous)) {
            return navigator.clipboard.writeText('');
          }
        })
        .catch(() => {
          /* 浏览器剪贴板清理仅尽力执行，避免延长敏感信息保留。 */
        });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    clear();
    setReauth(false);
    setStatusMessage('');

    const handleVisibility = () => {
      if (document.hidden) {
        clear();
        setReauth(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', handleVisibility);
      clear();
    };
  }, [accountId, resetEpoch, clear]);

  const reveal = useCallback(
    async (intent: 'show' | 'copy') => {
      if (pending) return;
      if (intent === 'show' && password !== null) {
        clear();
        setStatusMessage('');
        return;
      }

      const ticket = ++generation.current;
      setPending(true);
      setStatusMessage('');

      try {
        let value: string;
        if (mockReveal) {
          value = await mockReveal(accountId);
        } else if (session) {
          const headers = { 'X-CSRF-Token': session.csrf_token };
          value = await accountsRevealPassword({
            path: { account_id: accountId },
            body: {},
            headers,
            throwOnError: true,
          }).then(({ data }) => data.password);
        } else {
          throw new Error('缺少会话凭据');
        }

        if (
          ticket !== generation.current ||
          !mounted.current ||
          document.hidden
        ) {
          value = '';
          return;
        }

        setPassword(value);
        setRemainingSeconds(20);
        window.clearTimeout(expiry.current);
        window.clearInterval(tickRef.current);
        const expiresAtMs = Date.now() + SECRET_TTL_MS;
        expiry.current = window.setTimeout(clear, SECRET_TTL_MS);
        tickRef.current = window.setInterval(() => {
          setRemainingSeconds(
            Math.max(0, Math.ceil((expiresAtMs - Date.now()) / 1000)),
          );
        }, 1000);

        if (intent === 'copy') {
          copied.current = clipboardFingerprint(value);
          const writing = navigator.clipboard?.writeText?.(value);
          value = '';
          try {
            if (!writing) throw new Error('clipboard unavailable');
            await writing;
          } catch {
            if (
              ticket === generation.current &&
              mounted.current &&
              !document.hidden
            ) {
              copied.current = null;
              clear();
              setStatusMessage(
                '浏览器未允许复制，请保持页面聚焦并检查剪贴板权限。',
              );
            }
            return;
          }

          if (
            ticket !== generation.current ||
            !mounted.current ||
            document.hidden
          ) {
            void navigator.clipboard?.writeText?.('').catch(() => {});
            return;
          }

          if (!mockReveal && session) {
            await accountsCopyPasswordEvent({
              path: { account_id: accountId },
              body: {},
              headers: { 'X-CSRF-Token': session.csrf_token },
              throwOnError: true,
            });
          }

          if (
            ticket !== generation.current ||
            !mounted.current ||
            document.hidden
          ) {
            return;
          }

          onAuditEvent?.('copy');
          setStatusMessage('密码已复制，20 秒后自动隐藏并尝试清理剪贴板。');
          onToast?.('登录密码已复制（20 秒后自动清理）');
        } else {
          value = '';
          onAuditEvent?.('show');
          setStatusMessage('20 秒后自动隐藏；切换账号或隐藏页面将立即清除。');
        }
      } catch (error) {
        if (
          ticket !== generation.current ||
          !mounted.current ||
          document.hidden
        ) {
          return;
        }
        clear();
        if (
          (error as { error?: { code?: string } })?.error?.code ===
          'REAUTH_REQUIRED'
        ) {
          setReauth(true);
          setStatusMessage('请完成管理员重新验证后，再点击显示或复制。');
        } else {
          setStatusMessage('密码操作失败，未自动重试。');
          onFailure?.(error);
        }
      } finally {
        if (ticket === generation.current && mounted.current) {
          setPending(false);
        }
      }
    },
    [
      accountId,
      clear,
      mockReveal,
      onAuditEvent,
      onFailure,
      onToast,
      password,
      pending,
      session,
    ],
  );

  const submitReverify = useCallback(
    async (body: { password: string; totp_code?: string }) => {
      if (!session || !onSession) return;
      const ticket = generation.current;
      setVerifying(true);
      try {
        const { data } = await authReverify({
          body: body.totp_code
            ? { password: body.password, totp_code: body.totp_code }
            : { password: body.password },
          headers: { 'X-CSRF-Token': session.csrf_token },
          throwOnError: true,
        });
        if (
          !mounted.current ||
          ticket !== generation.current ||
          document.hidden
        ) {
          return;
        }
        onSession(data);
        setReauth(false);
        setStatusMessage('重新验证成功，请再次选择显示或复制。');
      } catch (error) {
        if (
          mounted.current &&
          ticket === generation.current &&
          !document.hidden
        ) {
          setStatusMessage(
            (error as { error?: { message?: string } })?.error?.message ??
              '重新验证失败，请检查管理员凭据后重试。',
          );
          onFailure?.(error);
        }
      } finally {
        if (mounted.current) setVerifying(false);
      }
    },
    [onFailure, onSession, session],
  );

  const reverifyWithPasskey = useCallback(async () => {
    if (!session || !onSession || verifying) return;
    const ticket = generation.current;
    setVerifying(true);
    setStatusMessage('');
    try {
      const data = await performPasskeyStepUp(session.csrf_token);
      if (
        !mounted.current ||
        ticket !== generation.current ||
        document.hidden
      ) {
        return;
      }
      onSession(data);
      setReauth(false);
      setStatusMessage('通行密钥重新验证成功，请再次选择显示或复制。');
    } catch (error) {
      if (
        mounted.current &&
        ticket === generation.current &&
        !document.hidden
      ) {
        setStatusMessage(formatWebAuthnError(error));
        onFailure?.(error);
      }
    } finally {
      if (mounted.current) setVerifying(false);
    }
  }, [onFailure, onSession, session, verifying]);

  const canUsePasskey = Boolean(
    session?.webauthn_enabled && isWebAuthnSupported(),
  );

  return {
    password,
    remainingSeconds,
    pending,
    reauth,
    verifying,
    statusMessage,
    canUsePasskey,
    reveal,
    clear,
    submitReverify,
    reverifyWithPasskey,
  };
}
