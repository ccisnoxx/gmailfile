import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  authChangePassword,
  authLogin,
  authLogout,
  authReverify,
  authSession,
  authWebauthnLoginOptions,
  authWebauthnLoginVerify,
  authWebauthnRegisterOptions,
  authWebauthnRegisterVerify,
  authWebauthnStepUpOptions,
  authWebauthnStepUpVerify,
} from '@/api/generated/sdk.gen';
import type {
  Credentials,
  ErrorResponse,
  SessionResponse,
  WebAuthnRegisterVerifyResponse,
} from '@/api/generated';
import { clearServiceWorkerCaches } from '@/lib/pwa';
import {
  createPasskeyCredential,
  formatWebAuthnError,
  getPasskeyAssertion,
} from '@/lib/webauthn';
import { useIdleSession } from './use-idle-session';

export type AuthNotice = {
  message: string;
  kind: 'error' | 'success';
};

export function useAuthMachine({
  onClearSecrets,
  onReauthRequired,
}: {
  onClearSecrets: () => void;
  onReauthRequired: () => void;
}) {
  const queryClient = useQueryClient();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [notice, setNotice] = useState<AuthNotice>({
    message: '',
    kind: 'error',
  });
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const running = useRef(false);
  const generation = useRef(0);
  const initial = useRef<ReturnType<typeof authSession> | null>(null);
  const callbacks = useRef({ onClearSecrets, onReauthRequired });
  callbacks.current = { onClearSecrets, onReauthRequired };

  const setMessage = useCallback(
    (text: string, kind: AuthNotice['kind'] = 'error') => {
      setNotice({ message: text, kind });
    },
    [],
  );

  const clearSecrets = useCallback(() => {
    generation.current += 1;
    running.current = false;
    setBusy(false);
    queryClient.clear();
    clearServiceWorkerCaches();
    callbacks.current.onClearSecrets();
    setEpoch((n) => n + 1);
  }, [queryClient]);

  const refresh = useCallback(async () => {
    clearSecrets();
    setSession(null);
    const ticket = generation.current;
    const result = await authSession({ throwOnError: true });
    if (ticket === generation.current) setSession(result.data);
  }, [clearSecrets]);

  const run = useCallback(
    async (action: (ticket: number) => Promise<void>) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setMessage('');
      const ticket = generation.current;
      try {
        await action(ticket);
      } catch (error) {
        if (ticket !== generation.current) return;
        const failure = error as Partial<ErrorResponse> | null;
        const code = failure?.error?.code;
        if (code === 'AUTH_REQUIRED' || code === 'MFA_REQUIRED') {
          setMessage('会话已失效，请重新登录。');
          try {
            await refresh();
          } catch {
            setMessage('无法连接服务，请刷新页面。');
          }
        } else if (code === 'CSRF_INVALID') {
          clearSecrets();
          setSession(null);
          setMessage('页面校验已失效。请刷新页面后重试，操作未自动重放。');
        } else if (code === 'REAUTH_REQUIRED') {
          clearSecrets();
          callbacks.current.onReauthRequired();
          setMessage('请先重新验证管理员密码，再继续安全操作。');
        } else if (failure?.error?.message) {
          setMessage(failure.error.message);
        } else if (error instanceof DOMException) {
          setMessage(formatWebAuthnError(error));
        } else {
          setMessage('无法连接服务，请稍后重试。');
        }
      } finally {
        if (ticket === generation.current) {
          running.current = false;
          setBusy(false);
        }
      }
    },
    [clearSecrets, refresh, setMessage],
  );

  useEffect(() => {
    let active = true;
    // StrictMode 的两次 effect 共用同一请求，避免首次 CSRF 轮换互相覆盖。
    initial.current ??= authSession({ throwOnError: true });
    void initial.current
      .then((result) => {
        if (active) setSession(result.data!);
      })
      .catch(() => {
        if (active) setMessage('无法连接服务，请检查 API 后刷新页面。');
      });
    return () => {
      active = false;
    };
  }, [setMessage]);

  useEffect(() => {
    const hidden = () => {
      if (document.hidden) clearSecrets();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, [clearSecrets]);

  useIdleSession(
    session,
    setSession,
    () => {
      const headers = { 'X-CSRF-Token': session?.csrf_token ?? '' };
      clearSecrets();
      setSession(null);
      setMessage('会话已超时，请重新登录。');
      const ticket = generation.current;
      // 本地锁定也尝试撤销会话，防止刷新解锁仍有效的服务端会话。
      void authLogout({ headers, throwOnError: true })
        .catch(() => undefined)
        .then(() => authSession({ throwOnError: true }))
        .then(({ data }) => {
          if (ticket !== generation.current) return;
          if (data.state === 'anonymous') setSession(data);
          else setMessage('界面已锁定，请刷新页面后重新验证。');
        })
        .catch(() => setMessage('会话已锁定，无法连接服务，请刷新页面。'));
    },
    (error) => {
      const code = (error as ErrorResponse)?.error?.code;
      if (['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(code))
        void run(async () => {
          throw error;
        });
    },
  );

  const headers = { 'X-CSRF-Token': session?.csrf_token ?? '' };
  const isCurrentTicket = useCallback(
    (ticket: number) => ticket === generation.current && !document.hidden,
    [],
  );

  const login = useCallback(
    (body: Credentials) =>
      run(async (ticket) => {
        const result = await authLogin({
          body,
          headers,
          throwOnError: true,
        });
        if (!isCurrentTicket(ticket)) return;
        setSession(result.data);
      }),
    [headers, isCurrentTicket, run],
  );

  const loginWithPasskey = useCallback(
    () =>
      run(async (ticket) => {
        const optionsRes = await authWebauthnLoginOptions({
          headers,
          throwOnError: true,
        });
        const credential = await getPasskeyAssertion(optionsRes.data.options);
        const verified = await authWebauthnLoginVerify({
          body: {
            challenge_id: optionsRes.data.challenge_id,
            credential,
          },
          headers,
          throwOnError: true,
        });
        if (!isCurrentTicket(ticket)) return;
        setSession(verified.data);
      }),
    [headers, isCurrentTicket, run],
  );

  const registerPasskey = useCallback(
    (
      label: string,
      onRegistered?: (data: WebAuthnRegisterVerifyResponse) => void,
    ) =>
      run(async (ticket) => {
        const cleanLabel = label.trim() || '本机通行密钥';
        const optionsRes = await authWebauthnRegisterOptions({
          headers,
          throwOnError: true,
        });
        const credential = await createPasskeyCredential(
          optionsRes.data.options,
        );
        const verified = await authWebauthnRegisterVerify({
          body: {
            challenge_id: optionsRes.data.challenge_id,
            label: cleanLabel,
            credential,
          },
          headers,
          throwOnError: true,
        });
        if (!isCurrentTicket(ticket)) return;
        setSession(verified.data.session);
        onRegistered?.(verified.data);
        setMessage('通行密钥绑定成功。', 'success');
      }),
    [headers, isCurrentTicket, run, setMessage],
  );

  const reverifyWithPasskey = useCallback(
    () =>
      run(async (ticket) => {
        const optionsRes = await authWebauthnStepUpOptions({
          headers,
          throwOnError: true,
        });
        const credential = await getPasskeyAssertion(optionsRes.data.options);
        const verified = await authWebauthnStepUpVerify({
          body: {
            challenge_id: optionsRes.data.challenge_id,
            credential,
          },
          headers,
          throwOnError: true,
        });
        if (!isCurrentTicket(ticket)) return;
        setSession(verified.data);
        setMessage('通行密钥二次验证成功，5 分钟内可进行敏感操作。', 'success');
      }),
    [headers, isCurrentTicket, run, setMessage],
  );

  const logout = useCallback(
    (clearSessionImmediately = false) => {
      clearSecrets();
      if (clearSessionImmediately) setSession(null);
      void run(async () => {
        await authLogout({ headers, throwOnError: true });
        await refresh();
      });
    },
    [clearSecrets, headers, refresh, run],
  );

  const reverify = useCallback(
    (password: string, totpCode?: string) =>
      run(async (ticket) => {
        const result = await authReverify({
          body: totpCode ? { password, totp_code: totpCode } : { password },
          headers,
          throwOnError: true,
        });
        if (!isCurrentTicket(ticket)) return;
        setSession(result.data);
        setMessage('重新验证成功，5 分钟内可进行敏感操作。', 'success');
      }),
    [headers, isCurrentTicket, run, setMessage],
  );

  const changePassword = useCallback(
    (password: string, newPassword: string) =>
      run(async () => {
        await authChangePassword({
          body: {
            password,
            new_password: newPassword,
          },
          headers,
          throwOnError: true,
        });
        await refresh();
        setMessage('密码已修改，所有会话已退出。请使用新密码登录。', 'success');
      }),
    [headers, refresh, run, setMessage],
  );

  const handleOperationsFailure = useCallback(
    (error: unknown) => {
      const code = (error as ErrorResponse)?.error?.code;
      if (
        [
          'AUTH_REQUIRED',
          'MFA_REQUIRED',
          'CSRF_INVALID',
          'REAUTH_REQUIRED',
        ].includes(code)
      ) {
        void run(async () => {
          throw error;
        });
      }
    },
    [run],
  );

  const handleAccountFailure = useCallback(
    (error: unknown) => {
      void run(async () => {
        throw error;
      });
    },
    [run],
  );

  const handleRefreshSession = useCallback(() => {
    void run(async () => {
      await refresh();
    });
  }, [refresh, run]);

  const handleSignedOut = useCallback(
    (revocation: Promise<unknown>) => {
      clearSecrets();
      setSession(null);
      void run(async () => {
        try {
          await revocation;
        } catch (error) {
          const detail = (error as ErrorResponse)?.error;
          const known =
            detail &&
            !['INTERNAL_ERROR', 'DECRYPTION_FAILED'].includes(detail.code);
          setMessage(
            known
              ? `${detail.message}。界面已清空，请刷新确认会话状态。`
              : '撤销结果未知，界面已清空。请刷新确认会话状态，不要自动重试。',
          );
          return;
        }
        await refresh();
      });
    },
    [clearSecrets, refresh, run, setMessage],
  );

  return {
    session,
    setSession,
    notice,
    setMessage,
    busy,
    epoch,
    headers,
    clearSecrets,
    refresh,
    run,
    isCurrentTicket,
    login,
    loginWithPasskey,
    registerPasskey,
    logout,
    reverify,
    reverifyWithPasskey,
    changePassword,
    handleOperationsFailure,
    handleAccountFailure,
    handleRefreshSession,
    handleSignedOut,
  };
}

export type AuthMachine = ReturnType<typeof useAuthMachine>;
