import { useEffect, useId, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  ShieldAlert,
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
import type { SensitiveVerifyPayload, SettingsActionResult } from './types';

export type SensitiveActionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  riskSummary: string;
  riskPoints?: readonly string[];
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  isRecentlyVerified: boolean;
  requireTotp?: boolean;
  alwaysRequireCredentials?: boolean;
  canUsePasskey?: boolean;
  onPasskeyVerify?: () => Promise<SettingsActionResult>;
  onConfirm: (verify?: SensitiveVerifyPayload) => Promise<SettingsActionResult>;
  onSuccess?: (message?: string) => void;
};

export function SensitiveActionDialog({
  open,
  onOpenChange,
  title,
  description,
  riskSummary,
  riskPoints = [],
  confirmLabel,
  tone = 'danger',
  isRecentlyVerified,
  requireTotp = false,
  alwaysRequireCredentials = false,
  canUsePasskey = false,
  onPasskeyVerify,
  onConfirm,
  onSuccess,
}: SensitiveActionDialogProps) {
  const passwordId = useId();
  const totpId = useId();
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [forceCredentials, setForceCredentials] = useState(false);
  const [passkeyVerified, setPasskeyVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const needsCredentials =
    !passkeyVerified &&
    (alwaysRequireCredentials || !isRecentlyVerified || forceCredentials);

  // 关闭弹窗或切到后台标签页时立即清空所有敏感输入
  useEffect(() => {
    if (!open) {
      setPassword('');
      setTotpCode('');
      setErrorMessage('');
      setForceCredentials(false);
      setPasskeyVerified(false);
      setBusy(false);
      return;
    }
    const handleVisibility = () => {
      if (document.hidden) {
        setPassword('');
        setTotpCode('');
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [open]);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setErrorMessage('');

    if (needsCredentials && !password.trim()) {
      setErrorMessage('请输入当前管理员密码完成身份验证。');
      return;
    }
    if (needsCredentials && requireTotp && !/^\d{6}$/.test(totpCode.trim())) {
      setErrorMessage('请输入 6 位数字 TOTP 验证码。');
      return;
    }

    setBusy(true);
    try {
      const result = await onConfirm(
        needsCredentials
          ? {
              password,
              totpCode: requireTotp ? totpCode.trim() : undefined,
            }
          : undefined,
      );
      if (!result.ok) {
        if (result.requireReauth) {
          setPasskeyVerified(false);
          setForceCredentials(true);
        }
        setErrorMessage(result.error);
        return;
      }
      setPassword('');
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
        data-slot="sensitive-action-dialog"
        className="macos-glass-modal rounded-[20px] sm:max-w-[460px]"
      >
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={cn(
                'inline-flex size-9 shrink-0 items-center justify-center rounded-xl',
                tone === 'danger'
                  ? 'bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]'
                  : 'bg-[var(--accent-soft)] text-[var(--accent)]',
              )}
            >
              <ShieldAlert className="size-4.5" />
            </span>
            <div className="min-w-0 text-left">
              <DialogTitle className="text-[17px] font-semibold text-[var(--text-primary)]">
                {title}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {/* 明确风险说明 */}
          <div
            className={cn(
              'rounded-2xl border px-3.5 py-3 text-[12.5px] leading-5',
              tone === 'danger'
                ? 'border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]'
                : 'border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)]',
            )}
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <p className="font-semibold">{riskSummary}</p>
                {riskPoints.length > 0 && (
                  <ul className="list-disc space-y-0.5 pl-4 text-[12px] opacity-90">
                    {riskPoints.map((point) => (
                      <li key={point}>{point}</li>
                    ))}
                  </ul>
                )}
                <p className="text-[11.5px] opacity-85">
                  安全策略：若请求失败不会自动重试，请核对结果后决定是否手动重试。
                </p>
              </div>
            </div>
          </div>

          {/* 最近重新验证状态或凭据输入 */}
          {needsCredentials ? (
            <div className="space-y-3 rounded-2xl border border-white/80 bg-white/55 p-3.5">
              <p className="text-[12px] font-medium text-[var(--text-secondary)]">
                {alwaysRequireCredentials
                  ? '此操作每次均需校验当前管理员凭据（不写入缓存或本地存储）'
                  : '高风险操作要求 5 分钟内重新验证，请先验证管理员身份：'}
              </p>
              {canUsePasskey && onPasskeyVerify && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={async () => {
                    setErrorMessage('');
                    setBusy(true);
                    try {
                      const res = await onPasskeyVerify();
                      if (!res.ok) {
                        setErrorMessage(res.error);
                        return;
                      }
                      if (alwaysRequireCredentials) {
                        onOpenChange(false);
                        onSuccess?.(res.message);
                      } else {
                        setPasskeyVerified(true);
                        setForceCredentials(false);
                      }
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
              <div className="space-y-1.5">
                <label
                  htmlFor={passwordId}
                  className="block text-[12.5px] font-medium text-[var(--text-primary)]"
                >
                  当前管理员密码
                </label>
                <input
                  id={passwordId}
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={busy}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="请输入当前管理员密码"
                  className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)]/80 focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                />
              </div>

              {requireTotp && (
                <div className="space-y-1.5">
                  <label
                    htmlFor={totpId}
                    className="block text-[12.5px] font-medium text-[var(--text-primary)]"
                  >
                    TOTP 验证码（6 位）
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
                    className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 font-mono text-[13px] tracking-widest text-[var(--text-primary)] placeholder:font-sans placeholder:tracking-normal placeholder:text-[var(--text-secondary)]/80 focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-3 py-2 text-[12.5px] text-[var(--badge-green-text)]">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              <span>
                最近已完成管理员重新验证（5 分钟有效期内），可直接确认。
              </span>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="rounded-xl border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-3 py-2 text-[12.5px] leading-5 text-[var(--badge-red-text)]"
            >
              {errorMessage}
            </div>
          )}

          <DialogFooter className="pt-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => onOpenChange(false)}
              className="inline-flex h-9 items-center justify-center rounded-xl border border-white/85 bg-white/70 px-4 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-white/95 disabled:opacity-50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={busy}
              className={cn(
                'inline-flex h-9 items-center justify-center gap-1.5 rounded-xl px-4 text-[13px] font-medium transition-all duration-[180ms] ease-out disabled:opacity-60',
                tone === 'danger'
                  ? 'border border-[#c53030]/35 bg-[#c53030] text-white shadow-[0_6px_16px_rgba(197,48,48,0.22)] hover:bg-[#a62626]'
                  : 'bg-[var(--accent)] text-[var(--primary-foreground)] shadow-[0_6px_16px_rgba(22,119,255,0.25)] hover:bg-[var(--accent-hover)]',
              )}
            >
              {busy && (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              )}
              <span>{busy ? '正在执行…' : confirmLabel}</span>
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
