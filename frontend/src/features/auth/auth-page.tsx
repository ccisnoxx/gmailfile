import { useQueryClient } from '@tanstack/react-query';
import { useIdleSession } from './use-idle-session';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyRound, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import {
  authChangePassword,
  authLogin,
  authLogout,
  authRegenerateRecoveryCodes,
  authReverify,
  authSession,
  authTotpConfirm,
  authTotpSetup,
} from '@/api/generated/sdk.gen';
import type {
  Credentials,
  ErrorResponse,
  RecoveryResponse,
  SessionResponse,
  SetupResponse,
} from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { CredentialForm } from './credential-form';
import { OperationsPage } from '@/features/operations/operations-page';
import { AccountsPage } from '@/features/accounts/accounts-page';

export function AuthPage({
  initialView = 'accounts',
}: {
  initialView?: 'accounts' | 'security';
}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<'accounts' | 'security' | 'operations'>(
    initialView,
  );
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [panel, setPanel] = useState<
    'reverify' | 'password' | 'rebind' | 'recovery'
  >('reverify');
  const [notice, setNotice] = useState({ message: '', kind: 'error' });
  const message = notice.message;
  const setMessage = useCallback((text: string, kind = 'error') => {
    setNotice({ message: text, kind });
  }, []);
  const [busy, setBusy] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const running = useRef(false);
  const generation = useRef(0);
  const initial = useRef<ReturnType<typeof authSession> | null>(null);
  const clearSecrets = useCallback(() => {
    generation.current += 1;
    running.current = false;
    setBusy(false);
    queryClient.clear();
    setSetup(null);
    setCodes(null);
    setSaved(false);
    setEpoch((n) => n + 1);
  }, [queryClient]);

  async function refresh() {
    clearSecrets();
    setSession(null);
    const ticket = generation.current;
    const result = await authSession({ throwOnError: true });
    if (ticket === generation.current) setSession(result.data);
  }

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
  }, []);

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

  async function run(action: (ticket: number) => Promise<void>) {
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
        setPanel('reverify');
        setView('security');
        setMessage('请先重新验证管理员密码，再继续安全操作。');
      } else {
        setMessage(failure?.error?.message ?? '无法连接服务，请稍后重试。');
      }
    } finally {
      if (ticket === generation.current) {
        running.current = false;
        setBusy(false);
      }
    }
  }

  function acceptRecovery(result: RecoveryResponse, ticket: number) {
    if (ticket !== generation.current || document.hidden) return;
    setSession(result.session);
    setSetup(null);
    setSaved(false);
    setCodes(result.recovery_codes);
  }

  const headers = { 'X-CSRF-Token': session?.csrf_token ?? '' };
  const authenticated = session?.state === 'authenticated';
  const pending = session?.state === 'mfa_pending';
  const title = codes
    ? '保存你的恢复码'
    : setup || pending
      ? '绑定二步验证'
      : authenticated
        ? '安全设置'
        : '管理员登录';
  const selectPanel = (value: typeof panel) => {
    clearSecrets();
    setMessage('');
    setPanel(value);
  };

  if (authenticated && view === 'operations' && !setup && !codes) {
    return (
      <OperationsPage
        key={epoch}
        session={session}
        onBack={() => {
          clearSecrets();
          setView('accounts');
        }}
        onSecurity={() => {
          clearSecrets();
          setView('security');
        }}
        onFailure={(error) => {
          const code = (error as ErrorResponse)?.error?.code;
          if (
            [
              'AUTH_REQUIRED',
              'MFA_REQUIRED',
              'CSRF_INVALID',
              'REAUTH_REQUIRED',
            ].includes(code)
          )
            void run(async () => {
              throw error;
            });
        }}
        onRefreshSession={() => {
          void run(async () => {
            await refresh();
          });
        }}
        onSignedOut={(revocation) => {
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
        }}
      />
    );
  }

  if (authenticated && view === 'accounts' && !setup && !codes) {
    return (
      <AccountsPage
        key={epoch}
        session={session}
        onSession={setSession}
        onFailure={(error) => {
          void run(async () => {
            throw error;
          });
        }}
        onSecurity={() => {
          clearSecrets();
          setView('security');
        }}
        onLogout={() => {
          clearSecrets();
          setSession(null);
          void run(async () => {
            await authLogout({ headers, throwOnError: true });
            await refresh();
          });
        }}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-5 sm:px-10">
          <div className="flex items-center gap-3 font-semibold">
            <Mail className="size-5 text-primary" aria-hidden="true" />
            Gmail 账号管理
          </div>
          <span className="text-sm text-muted-foreground">安全工作区</span>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl gap-12 px-6 py-10 sm:px-10 sm:py-16 lg:grid-cols-[1fr_1.15fr] lg:gap-20">
        <aside className="flex flex-col gap-6">
          <ShieldCheck className="size-9 text-primary" aria-hidden="true" />
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            账号资料，
            <br className="hidden lg:block" />
            从安全开始。
          </h1>
          <p className="max-w-sm leading-8 text-muted-foreground">
            仅供管理员使用。使用密码和验证器登录，让敏感资料留在受保护的工作区。
          </p>
          <div className="mt-2 flex items-center gap-3 text-sm text-muted-foreground">
            <LockKeyhole className="size-4" aria-hidden="true" />
            默认闲置 15 分钟自动锁定
          </div>
          <p className="max-w-sm text-sm leading-7 text-muted-foreground">
            账号资料支持加密保存、版本保护和单条恢复。敏感密码仅按需显示。
          </p>
        </aside>
        <section
          aria-labelledby="auth-title"
          className="min-w-0 rounded-xl border bg-card p-6 sm:p-8"
        >
          <div className="mb-7 flex items-center justify-between gap-4">
            <h2 id="auth-title" className="text-2xl font-semibold">
              {title}
            </h2>
            {session && session.state !== 'anonymous' && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  clearSecrets();
                  void run(async () => {
                    await authLogout({ headers, throwOnError: true });
                    await refresh();
                  });
                }}
              >
                退出
              </Button>
            )}
          </div>
          {message && (
            <Alert
              variant={notice.kind === 'success' ? 'default' : 'destructive'}
              role={notice.kind === 'success' ? 'status' : 'alert'}
              className="mb-6"
            >
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          )}
          {!session ? (
            <p role="status" className="text-muted-foreground">
              {message ? '刷新页面以重新连接。' : '正在建立安全连接…'}
            </p>
          ) : codes ? (
            <div className="flex flex-col gap-6">
              <p className="text-sm leading-7 text-muted-foreground">
                这些恢复码只展示这一次。请离线保管，每个只能使用一次。重新生成后，旧码全部失效。
              </p>
              <ul
                aria-label="一次性恢复码"
                className="grid gap-2 rounded-lg bg-muted p-4 font-mono text-sm"
              >
                {codes.map((code) => (
                  <li key={code} className="break-all select-all">
                    {code}
                  </li>
                ))}
              </ul>
              <Button
                variant="outline"
                onClick={() => {
                  const file = new Blob([codes.join('\n') + '\n'], {
                    type: 'text/plain;charset=utf-8',
                  });
                  const url = URL.createObjectURL(file);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'gmail-manager-recovery-codes.txt';
                  document.body.append(link);
                  link.click();
                  link.remove();
                  window.setTimeout(() => URL.revokeObjectURL(url), 0);
                }}
              >
                下载恢复码
              </Button>
              <label className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={saved}
                  onChange={(event) => setSaved(event.target.checked)}
                />
                我已离线保存恢复码
              </label>
              <Button
                disabled={!saved}
                onClick={() => {
                  clearSecrets();
                  setPanel('reverify');
                }}
              >
                完成并清除展示
              </Button>
            </div>
          ) : setup ? (
            <div className="flex flex-col gap-6">
              <p className="text-sm leading-7 text-muted-foreground">
                在验证器中扫描二维码，或手工输入
                Secret。输入验证码确认后才会启用。离开或隐藏页面会清除展示。
              </p>
              <img
                src={setup.qr_data_url}
                width={224}
                height={224}
                alt="验证器绑定二维码"
                className="mx-auto size-56"
              />
              <Field>
                <FieldLabel htmlFor="totp-secret">手工 Secret</FieldLabel>
                <Input
                  id="totp-secret"
                  readOnly
                  value={setup.secret}
                  autoComplete="off"
                  className="font-mono"
                />
              </Field>
              <form
                key={epoch}
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = event.currentTarget;
                  const code = String(new FormData(form).get('code'));
                  form.reset();
                  void run(async (ticket) => {
                    const result = await authTotpConfirm({
                      body: { code },
                      headers,
                      throwOnError: true,
                    });
                    acceptRecovery(result.data, ticket);
                  });
                }}
              >
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="confirmation">验证器验证码</FieldLabel>
                    <Input
                      id="confirmation"
                      name="code"
                      inputMode="numeric"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      autoComplete="one-time-code"
                      required
                      disabled={busy}
                    />
                  </Field>
                  <Button disabled={busy}>
                    {busy ? '正在确认…' : '确认绑定'}
                  </Button>
                </FieldGroup>
              </form>
              <Button variant="ghost" disabled={busy} onClick={clearSecrets}>
                取消展示
              </Button>
            </div>
          ) : pending ? (
            <div className="flex flex-col gap-6">
              <p className="leading-7 text-muted-foreground">
                密码已验证。请绑定验证器，完成前不能访问账号资料。使用恢复码登录后也必须重新绑定。
              </p>
              <Button
                disabled={busy}
                onClick={() =>
                  void run(async (ticket) => {
                    const result = await authTotpSetup({
                      body: {},
                      headers,
                      throwOnError: true,
                    });
                    if (ticket !== generation.current || document.hidden)
                      return;
                    setSession(result.data.session);
                    setSetup(result.data);
                  })
                }
              >
                开始绑定验证器
              </Button>
            </div>
          ) : !authenticated ? (
            <CredentialForm
              key={epoch}
              kind="login"
              busy={busy}
              onSubmit={(body) =>
                run(async (ticket) => {
                  const result = await authLogin({
                    body,
                    headers,
                    throwOnError: true,
                  });
                  if (ticket !== generation.current || document.hidden) return;
                  setSession(result.data);
                })
              }
            />
          ) : (
            <div className="flex flex-col gap-7">
              <Empty className="p-0 md:p-0">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ShieldCheck />
                  </EmptyMedia>
                  <EmptyTitle>已通过二步验证</EmptyTitle>
                  <EmptyDescription>
                    认证已完成，可返回账号工作区管理资料。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
              <Button
                variant="outline"
                onClick={() => {
                  clearSecrets();
                  setView('accounts');
                }}
              >
                返回账号列表
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  clearSecrets();
                  setView('operations');
                }}
              >
                迁移与运维
              </Button>
              <Separator />
              <nav aria-label="安全操作" className="flex flex-wrap gap-2">
                <Button
                  variant={panel === 'reverify' ? 'secondary' : 'ghost'}
                  disabled={busy}
                  onClick={() => selectPanel('reverify')}
                >
                  重新验证
                </Button>
                <Button
                  variant={panel === 'password' ? 'secondary' : 'ghost'}
                  disabled={busy}
                  onClick={() => selectPanel('password')}
                >
                  修改密码
                </Button>
                <Button
                  variant={panel === 'rebind' ? 'secondary' : 'ghost'}
                  disabled={busy}
                  onClick={() => selectPanel('rebind')}
                >
                  重绑验证器
                </Button>
                <Button
                  variant={panel === 'recovery' ? 'secondary' : 'ghost'}
                  disabled={busy}
                  onClick={() => selectPanel('recovery')}
                >
                  重新生成恢复码
                </Button>
              </nav>
              <p className="text-sm leading-7 text-muted-foreground">
                {panel === 'reverify'
                  ? '敏感操作前重新输入密码，验证在 5 分钟内有效。'
                  : panel === 'password'
                    ? '改密后所有会话立即退出。请先完成重新验证。'
                    : '请先重新验证，再输入当前密码和现有 TOTP 或恢复码。此操作会撤销其他会话；验证码不能重复使用。'}
              </p>
              <CredentialForm
                key={`${panel}-${epoch}`}
                kind={
                  panel === 'reverify'
                    ? 'reverify'
                    : panel === 'password'
                      ? 'password'
                      : 'factor'
                }
                busy={busy}
                onSubmit={(body) =>
                  run(async (ticket) => {
                    if (panel === 'reverify') {
                      const result = await authReverify({
                        body: { password: body.password },
                        headers,
                        throwOnError: true,
                      });
                      if (ticket !== generation.current || document.hidden)
                        return;
                      setSession(result.data);
                      setMessage(
                        '重新验证成功，5 分钟内可进行敏感操作。',
                        'success',
                      );
                    } else if (panel === 'password') {
                      await authChangePassword({
                        body: {
                          password: body.password,
                          new_password: body.new_password!,
                        },
                        headers,
                        throwOnError: true,
                      });
                      await refresh();
                      setMessage(
                        '密码已修改，所有会话已退出。请使用新密码登录。',
                        'success',
                      );
                    } else if (panel === 'rebind') {
                      const result = await authTotpSetup({
                        body: body as Credentials,
                        headers,
                        throwOnError: true,
                      });
                      if (ticket !== generation.current || document.hidden)
                        return;
                      setSession(result.data.session);
                      setSetup(result.data);
                    } else {
                      const result = await authRegenerateRecoveryCodes({
                        body,
                        headers,
                        throwOnError: true,
                      });
                      acceptRecovery(result.data, ticket);
                    }
                  })
                }
              />
            </div>
          )}
        </section>
      </main>
      <footer className="mx-auto flex max-w-6xl items-center gap-2 px-6 pb-8 text-sm text-muted-foreground sm:px-10">
        <KeyRound className="size-4" aria-hidden="true" />
        请勿在公共设备上保存凭据。
      </footer>
    </div>
  );
}
