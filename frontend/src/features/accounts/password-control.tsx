import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import type { SessionResponse } from '@/api/generated';
import {
  accountsCopyPasswordEvent,
  accountsRevealPassword,
  authReverify,
} from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { CredentialForm } from '@/features/auth/credential-form';
import {
  formatWebAuthnError,
  isWebAuthnSupported,
  performPasskeyStepUp,
} from '@/lib/webauthn';

async function clipboardFingerprint(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export function PasswordControl({
  accountId,
  session,
  onSession,
  onFailure,
}: {
  accountId: string;
  session: SessionResponse;
  onSession: (value: SessionResponse) => void;
  onFailure: (error: unknown) => void;
}) {
  const [password, setPassword] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const mounted = useRef(true);
  const expiry = useRef<number | undefined>(undefined);
  const copied = useRef<Promise<string> | null>(null);
  const clear = useCallback(() => {
    generation.current++;
    window.clearTimeout(expiry.current);
    setPassword(null);
    const previous = copied.current;
    copied.current = null;
    // 只保留指纹用于剪贴板比对，权限等待不能延长原密码的内存保留。
    if (previous)
      void navigator.clipboard
        ?.readText()
        .then(async (text) => {
          if ((await clipboardFingerprint(text)) === (await previous))
            return navigator.clipboard.writeText('');
        })
        .catch(() => {
          /* 浏览器权限可能拒绝；剪贴板清理仅尽力执行。 */
        });
  }, []);
  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      if (document.hidden) {
        clear();
        setReauth(false);
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => {
      mounted.current = false;
      document.removeEventListener('visibilitychange', hide);
      clear();
    };
  }, [accountId, clear]);
  const reveal = useMutation({
    // 返回 void：Query 和 Mutation 缓存均不保存密码或敏感响应。
    mutationFn: async (intent: 'show' | 'copy') => {
      const ticket = ++generation.current;
      const headers = { 'X-CSRF-Token': session.csrf_token };
      try {
        let value = await accountsRevealPassword({
          path: { account_id: accountId },
          body: {},
          headers,
          throwOnError: true,
        }).then(({ data }) => data.password);
        if (
          ticket !== generation.current ||
          !mounted.current ||
          document.hidden
        )
          return;
        setPassword(value);
        window.clearTimeout(expiry.current);
        expiry.current = window.setTimeout(clear, 20000);
        if (intent === 'copy') {
          copied.current = clipboardFingerprint(value);
          const writing = navigator.clipboard.writeText(value);
          value = '';
          try {
            await writing;
          } catch {
            if (
              ticket === generation.current &&
              mounted.current &&
              !document.hidden
            ) {
              copied.current = null;
              clear();
              setMessage('浏览器未允许复制，请保持页面聚焦并检查剪贴板权限。');
            }
            return;
          }
          if (
            ticket !== generation.current ||
            !mounted.current ||
            document.hidden
          ) {
            // 写入在关闭之后才完成：此时不保留明文，尽力清空刚完成的写入。
            void navigator.clipboard.writeText('').catch(() => {});
            return;
          }
          // 审计请求不持有密码，也不延后清除期限。
          await accountsCopyPasswordEvent({
            path: { account_id: accountId },
            body: {},
            headers,
            throwOnError: true,
          });
          if (
            ticket !== generation.current ||
            !mounted.current ||
            document.hidden
          )
            return;
          setMessage(
            '密码已复制。20 秒后会尝试清理剪贴板，请勿依赖其绝对成功。',
          );
        } else {
          value = '';
          setMessage('20 秒后自动清除；离开详情或隐藏页面也会立即清除。');
        }
      } catch (error) {
        if (
          ticket !== generation.current ||
          !mounted.current ||
          document.hidden
        )
          return;
        clear();
        if (
          (error as { error?: { code?: string } })?.error?.code ===
          'REAUTH_REQUIRED'
        ) {
          setReauth(true);
          setMessage('请重新验证后，再点击显示或复制。');
        } else {
          setMessage('密码操作失败，未自动重试。');
          onFailure(error);
        }
      }
    },
    retry: false,
  });
  const [verifying, setVerifying] = useState(false);
  return (
    <section
      aria-label="密码操作"
      className="flex flex-col gap-4 rounded-lg border p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium">Gmail 登录密码</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={reveal.isPending}
            onClick={() => reveal.mutate('show')}
          >
            显示密码
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={reveal.isPending}
            onClick={() => reveal.mutate('copy')}
          >
            复制密码
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        <output aria-label="Gmail 密码" className="break-all font-mono">
          {password ?? '••••••••'}
        </output>
        {password !== null && (
          <Button size="sm" variant="ghost" onClick={clear}>
            立即隐藏
          </Button>
        )}
      </div>
      {message && (
        <p role="status" className="text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {reauth && (
        <>
          <Alert>
            <AlertDescription>
              {session.step_up_totp_required
                ? '需要最近 5 分钟内的管理员二次验证（通行密钥或密码 + TOTP）。'
                : '需要最近 5 分钟内的管理员重新验证。'}
            </AlertDescription>
          </Alert>
          {session.webauthn_enabled && isWebAuthnSupported() && (
            <Button
              type="button"
              variant="outline"
              disabled={verifying}
              onClick={async () => {
                const ticket = generation.current;
                setVerifying(true);
                try {
                  const data = await performPasskeyStepUp(session.csrf_token);
                  if (
                    !mounted.current ||
                    ticket !== generation.current ||
                    document.hidden
                  )
                    return;
                  onSession(data);
                  setReauth(false);
                  setMessage('通行密钥重新验证成功，请再次选择显示或复制。');
                } catch (error) {
                  if (
                    mounted.current &&
                    ticket === generation.current &&
                    !document.hidden
                  ) {
                    setMessage(formatWebAuthnError(error));
                    onFailure(error);
                  }
                } finally {
                  setVerifying(false);
                }
              }}
            >
              <KeyRound className="size-4" aria-hidden="true" />
              使用通行密钥（Passkey）验证
            </Button>
          )}
          <CredentialForm
            kind="reverify"
            busy={verifying}
            requireStepUpTotp={Boolean(session.step_up_totp_required)}
            onSubmit={async (body) => {
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
                )
                  return;
                onSession(data);
                setReauth(false);
                setMessage('重新验证成功，请再次选择显示或复制。');
              } catch (error) {
                if (
                  mounted.current &&
                  ticket === generation.current &&
                  !document.hidden
                )
                  onFailure(error);
              } finally {
                setVerifying(false);
              }
            }}
          />
        </>
      )}
    </section>
  );
}
