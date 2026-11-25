import type { ReactNode } from 'react';
import { KeyRound, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { AuthNotice } from './use-auth-machine';

export function AuthShell({
  title,
  showLogout,
  busy,
  notice,
  onLogout,
  children,
}: {
  title: string;
  showLogout: boolean;
  busy: boolean;
  notice: AuthNotice;
  onLogout: () => void;
  children: ReactNode;
}) {
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
            {showLogout && (
              <Button variant="ghost" disabled={busy} onClick={onLogout}>
                退出
              </Button>
            )}
          </div>
          {notice.message && (
            <Alert
              variant={notice.kind === 'success' ? 'default' : 'destructive'}
              role={notice.kind === 'success' ? 'status' : 'alert'}
              className="mb-6"
            >
              <AlertDescription>{notice.message}</AlertDescription>
            </Alert>
          )}
          {children}
        </section>
      </main>
      <footer className="mx-auto flex max-w-6xl items-center gap-2 px-6 pb-8 text-sm text-muted-foreground sm:px-10">
        <KeyRound className="size-4" aria-hidden="true" />
        请勿在公共设备上保存凭据。
      </footer>
    </div>
  );
}
