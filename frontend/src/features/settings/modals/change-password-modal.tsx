import { useEffect, useId, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  KeyRound,
  Loader2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { SettingsActionResult } from '../types';

/* ============================================================================
 * 1. 修改密码 Modal
 * ============================================================================ */

export function ChangePasswordModal({
  open,
  onOpenChange,
  isRecentlyVerified,
  requireStepUpTotp,
  canUsePasskey = false,
  onPasskeyVerify,
  onSubmit,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isRecentlyVerified: boolean;
  requireStepUpTotp: boolean;
  canUsePasskey?: boolean;
  onPasskeyVerify?: () => Promise<SettingsActionResult>;
  onSubmit: (
    currentPassword: string,
    newPassword: string,
    totpCode?: string,
  ) => Promise<SettingsActionResult>;
  onSuccess?: (message?: string) => void;
}) {
  const curId = useId();
  const newId = useId();
  const confirmId = useId();
  const totpId = useId();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [passkeyVerified, setPasskeyVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTotpCode('');
      setPasskeyVerified(false);
      setError('');
      setBusy(false);
      return;
    }
    const clearOnHide = () => {
      if (document.hidden) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setTotpCode('');
      }
    };
    document.addEventListener('visibilitychange', clearOnHide);
    return () => document.removeEventListener('visibilitychange', clearOnHide);
  }, [open]);

  const lenOk = newPassword.length >= 16;
  const matchOk = newPassword.length > 0 && newPassword === confirmPassword;
  const verifiedRecently = isRecentlyVerified || passkeyVerified;
  const needsStepUpTotp = requireStepUpTotp && !verifiedRecently;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setError('');

    if (!currentPassword) {
      setError('请输入当前管理员密码。');
      return;
    }
    if (!lenOk) {
      setError('新密码长度至少 16 位，建议使用多词密码短语。');
      return;
    }
    if (!matchOk) {
      setError('两次输入的新密码不一致。');
      return;
    }
    if (needsStepUpTotp && !/^\d{6}$/.test(totpCode.trim())) {
      setError('请提供 6 位 TOTP 验证码完成最近重新验证。');
      return;
    }

    setBusy(true);
    try {
      const result = await onSubmit(
        currentPassword,
        newPassword,
        needsStepUpTotp ? totpCode.trim() : undefined,
      );
      if (!result.ok) {
        if (result.requireReauth) {
          setPasskeyVerified(false);
        }
        setError(result.error);
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTotpCode('');
      onOpenChange(false);
      onSuccess?.(result.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <DialogContent
        data-slot="change-password-modal"
        className="macos-glass-modal rounded-[20px] sm:max-w-[460px]"
      >
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <KeyRound className="size-4.5" aria-hidden="true" />
            </span>
            <div className="text-left">
              <DialogTitle className="text-[17px] font-semibold">
                修改管理员密码
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-[12.5px]">
                采用强密码短语保护管理控制台入口
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
          <div className="flex items-start gap-2 rounded-2xl border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-3.5 py-2.5 text-[12px] leading-5 text-[var(--badge-red-text)]">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            <span>
              高风险操作：修改密码后将立即撤销全部现有会话，需使用新密码重新登录。失败时不会自动重试。
            </span>
          </div>

          {!verifiedRecently && canUsePasskey && onPasskeyVerify && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setError('');
                setBusy(true);
                try {
                  const res = await onPasskeyVerify();
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  setPasskeyVerified(true);
                } finally {
                  setBusy(false);
                }
              }}
              className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--badge-blue-border)] bg-[var(--badge-blue-bg)] px-3 text-[12.5px] font-medium text-[var(--badge-blue-text)] transition-colors hover:brightness-95 disabled:opacity-50"
            >
              <KeyRound className="size-3.5" aria-hidden="true" />
              <span>使用通行密钥（Passkey）完成二次验证</span>
            </button>
          )}

          {passkeyVerified && (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-3 py-2 text-[12px] text-[var(--badge-green-text)]">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              <span>已完成通行密钥二次验证，请输入密码后提交。</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor={curId}
              className="block text-[12.5px] font-medium text-[var(--text-primary)]"
            >
              当前管理员密码
            </label>
            <input
              id={curId}
              type="password"
              autoComplete="current-password"
              required
              disabled={busy}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            />
          </div>

          {needsStepUpTotp && (
            <div className="space-y-1.5">
              <label
                htmlFor={totpId}
                className="block text-[12.5px] font-medium text-[var(--text-primary)]"
              >
                TOTP 验证码（最近重新验证）
              </label>
              <input
                id={totpId}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                disabled={busy}
                value={totpCode}
                onChange={(e) =>
                  setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder="输入 6 位动态验证码"
                className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 font-mono text-[13px] tracking-widest text-[var(--text-primary)] placeholder:font-sans placeholder:tracking-normal focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor={newId}
              className="block text-[12.5px] font-medium text-[var(--text-primary)]"
            >
              新密码（至少 16 位）
            </label>
            <input
              id={newId}
              type="password"
              autoComplete="new-password"
              required
              minLength={16}
              disabled={busy}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="建议使用 4 个以上独立词汇组成的密码短语"
              className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor={confirmId}
              className="block text-[12.5px] font-medium text-[var(--text-primary)]"
            >
              确认新密码
            </label>
            <input
              id={confirmId}
              type="password"
              autoComplete="new-password"
              required
              disabled={busy}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            />
          </div>

          <div className="flex flex-wrap gap-3 rounded-xl border border-white/75 bg-white/50 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
            <span
              className={cn(
                'inline-flex items-center gap-1',
                lenOk && 'font-medium text-[var(--success-text)]',
              )}
            >
              <Check className="size-3.5" aria-hidden="true" />
              <span>至少 16 位</span>
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1',
                matchOk && 'font-medium text-[var(--success-text)]',
              )}
            >
              <Check className="size-3.5" aria-hidden="true" />
              <span>两次输入一致</span>
            </span>
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-xl border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-3 py-2 text-[12.5px] text-[var(--badge-red-text)]"
            >
              {error}
            </div>
          )}

          <DialogFooter>
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpenChange(false)}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-white/85 bg-white/72 px-4 text-[13px] font-medium text-[var(--text-primary)] hover:bg-white"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--primary-foreground)] shadow-[0_6px_16px_rgba(22,119,255,0.24)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
            >
              {busy && (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              )}
              <span>{busy ? '正在提交…' : '确认修改密码'}</span>
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
