import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  KeySquare,
  Loader2,
  ShieldCheck,
  SlidersHorizontal,
  XCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { RESTORE_VERIFICATION_CHECKLIST } from './mock-fixtures';
import type {
  BackupArchiveItem,
  RestoreVerifyReport,
  RetentionPolicyInfo,
  SensitiveVerifyPayload,
  SettingsActionResult,
} from './types';

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

/* ============================================================================
 * 2. 查看 / 重新生成恢复码 Modal（需当前密码 + TOTP，不存缓存或 localStorage）
 * ============================================================================ */

export function RecoveryCodesModal({
  open,
  onOpenChange,
  remainingCount,
  totalCount,
  onRegenerate,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  remainingCount: number | null;
  totalCount: number;
  onRegenerate: (
    currentPassword: string,
    totpCode: string,
  ) => Promise<
    | { ok: true; codes: string[]; message?: string }
    | { ok: false; error: string }
  >;
  onSuccess?: (message?: string) => void;
}) {
  const passId = useId();
  const totpId = useId();
  const savedId = useId();

  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null);
  const [savedChecked, setSavedChecked] = useState(false);
  const [copiedNotice, setCopiedNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 关闭弹窗或隐藏页面时立即清除所有明文恢复码和凭据输入
  useEffect(() => {
    if (!open) {
      setPassword('');
      setTotpCode('');
      setGeneratedCodes(null);
      setSavedChecked(false);
      setCopiedNotice('');
      setError('');
      setBusy(false);
      return;
    }
    const clearOnHide = () => {
      if (document.hidden) {
        setPassword('');
        setTotpCode('');
        setGeneratedCodes(null);
      }
    };
    document.addEventListener('visibilitychange', clearOnHide);
    return () => document.removeEventListener('visibilitychange', clearOnHide);
  }, [open]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!password.trim()) {
      setError('请输入当前管理员密码。');
      return;
    }
    if (!/^\d{6}$/.test(totpCode.trim())) {
      setError('请输入 6 位数字 TOTP 验证码。');
      return;
    }

    setBusy(true);
    try {
      const result = await onRegenerate(password, totpCode.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPassword('');
      setTotpCode('');
      setGeneratedCodes(result.codes);
      setSavedChecked(false);
      onSuccess?.(result.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCopyAll = async () => {
    if (!generatedCodes) return;
    try {
      await navigator.clipboard.writeText(generatedCodes.join('\n'));
      setCopiedNotice('已复制全部恢复码，请立即粘贴至离线密码库。');
    } catch {
      setCopiedNotice('浏览器未授权剪贴板，请手工记录或点击下载。');
    }
  };

  const handleDownload = () => {
    if (!generatedCodes) return;
    const blob = new Blob([generatedCodes.join('\n') + '\n'], {
      type: 'text/plain;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'gmail-manager-recovery-codes.txt';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next && generatedCodes !== null && !savedChecked) {
          setError('请先复制或下载新恢复码并勾选确认框后再关闭窗口。');
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        data-slot="recovery-codes-modal"
        className="macos-glass-modal rounded-[20px] sm:max-w-[480px]"
      >
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <KeySquare className="size-4.5" aria-hidden="true" />
            </span>
            <div className="text-left">
              <DialogTitle className="text-[17px] font-semibold">
                {generatedCodes
                  ? '请离线保存新恢复码'
                  : '查看 / 重新生成恢复码'}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-[12.5px]">
                当前共有 {totalCount} 个备用恢复码，
                {remainingCount === null
                  ? '服务端以单向摘要保存'
                  : `剩余 ${remainingCount} 个可用`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!generatedCodes ? (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3.5">
            <div className="flex items-start gap-2 rounded-2xl border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-3.5 py-2.5 text-[12px] leading-5 text-[var(--badge-red-text)]">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>
                历史恢复码在服务端以单向摘要保存，无法直接明文查看。重新生成将使原有{' '}
                {totalCount} 个备用恢复码立即失效，并撤销其他设备会话。
              </span>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={passId}
                className="block text-[12.5px] font-medium text-[var(--text-primary)]"
              >
                当前管理员密码
              </label>
              <input
                id={passId}
                type="password"
                autoComplete="current-password"
                required
                disabled={busy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="输入当前管理员密码"
                className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              />
            </div>

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
                placeholder="输入认证应用中的 6 位验证码"
                className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 font-mono text-[13px] tracking-widest text-[var(--text-primary)] placeholder:font-sans placeholder:tracking-normal focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              />
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
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-[#c53030] px-4 text-[13px] font-medium text-white shadow-[0_6px_16px_rgba(197,48,48,0.22)] hover:bg-[#a62626] disabled:opacity-60"
              >
                {busy && (
                  <Loader2
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                )}
                <span>{busy ? '正在验证…' : '验证并重新生成'}</span>
              </button>
            </DialogFooter>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-3.5 py-2.5 text-[12px] text-[var(--badge-green-text)]">
              以下恢复码仅在本次会话内存中展示一次，关闭窗口或切换标签页后自动清空。
            </div>

            <ol
              aria-label="新生成的备用恢复码"
              className="grid grid-cols-2 gap-2 rounded-2xl border border-white/80 bg-white/60 p-3 font-mono text-[12.5px] tabular-nums text-[var(--text-primary)]"
            >
              {generatedCodes.map((code) => (
                <li
                  key={code}
                  className="rounded-lg border border-white/80 bg-white/75 px-2.5 py-1.5 text-center tracking-wider"
                >
                  {code}
                </li>
              ))}
            </ol>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleCopyAll()}
                className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-white/85 bg-white/75 px-3 text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-white"
              >
                <Copy className="size-3.5" aria-hidden="true" />
                <span>复制全部</span>
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-white/85 bg-white/75 px-3 text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-white"
              >
                <Download className="size-3.5" aria-hidden="true" />
                <span>下载为 TXT</span>
              </button>
            </div>

            {copiedNotice && (
              <p
                role="status"
                className="text-[12px] text-[var(--text-secondary)]"
              >
                {copiedNotice}
              </p>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-3 py-2 text-[12.5px] text-[var(--badge-red-text)]"
              >
                {error}
              </div>
            )}

            <label
              htmlFor={savedId}
              className="flex cursor-pointer items-center gap-2 text-[12.5px] text-[var(--text-primary)]"
            >
              <input
                id={savedId}
                type="checkbox"
                checked={savedChecked}
                onChange={(e) => {
                  setSavedChecked(e.target.checked);
                  if (e.target.checked) setError('');
                }}
                className="size-4 rounded accent-[var(--accent)]"
              />
              <span>
                我已将上述 {generatedCodes.length} 个恢复码离线保存
              </span>
            </label>

            <DialogFooter>
              <button
                type="button"
                disabled={!savedChecked}
                onClick={() => {
                  setGeneratedCodes(null);
                  onOpenChange(false);
                }}
                className="inline-flex h-9 items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--primary-foreground)] shadow-[0_6px_16px_rgba(22,119,255,0.24)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                完成并清除展示
              </button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================================
 * 3. 步骤式恢复验证 Modal（选择备份 -> 校验清单 -> 开始验证 -> 显示结果）
 * ============================================================================ */

const RESTORE_STEPS = [
  { step: 1, label: '选择备份' },
  { step: 2, label: '校验清单' },
  { step: 3, label: '开始验证' },
  { step: 4, label: '显示结果' },
] as const;

export function RestoreVerifyModal({
  open,
  onOpenChange,
  archives,
  initialArchiveId,
  onRunVerification,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  archives: BackupArchiveItem[];
  initialArchiveId?: string | null;
  onRunVerification: (
    archive: BackupArchiveItem,
  ) => Promise<RestoreVerifyReport>;
  onComplete?: (report: RestoreVerifyReport) => void;
}) {
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string>(
    initialArchiveId ?? archives[0]?.id ?? '',
  );
  const [report, setReport] = useState<RestoreVerifyReport | null>(null);
  const [running, setRunning] = useState(false);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setStep(1);
      setSelectedArchiveId(initialArchiveId ?? archives[0]?.id ?? '');
      setReport(null);
      setRunning(false);
    }
    wasOpenRef.current = open;
  }, [archives, initialArchiveId, open]);

  const selectedArchive =
    archives.find((item) => item.id === selectedArchiveId) ?? archives[0];

  const handleStartVerify = async () => {
    if (!selectedArchive || running) return;
    setStep(3);
    setRunning(true);
    try {
      const result = await onRunVerification(selectedArchive);
      setReport(result);
      setStep(4);
      onComplete?.(result);
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!running) onOpenChange(next);
      }}
    >
      <DialogContent
        data-slot="restore-verify-modal"
        className="macos-glass-modal rounded-[20px] sm:max-w-[540px]"
      >
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <ShieldCheck className="size-4.5" aria-hidden="true" />
            </span>
            <div className="text-left">
              <DialogTitle className="text-[17px] font-semibold">
                备份恢复验证演练
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-[12.5px]">
                在隔离沙箱校验密文归档的结构、约束与抽样解密，不影响线上数据
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* 步骤条 */}
        <ol
          aria-label="恢复验证步骤"
          className="grid grid-cols-4 gap-1.5 rounded-2xl border border-white/75 bg-white/45 p-2 text-[11.5px]"
        >
          {RESTORE_STEPS.map((item) => {
            const active = step === item.step;
            const done = step > item.step;
            return (
              <li
                key={item.step}
                aria-current={active ? 'step' : undefined}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-xl px-2 py-1.5 font-medium transition-colors',
                  active
                    ? 'bg-[var(--accent)] text-[var(--primary-foreground)] shadow-[0_4px_10px_rgba(22,119,255,0.22)]'
                    : done
                      ? 'bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]'
                      : 'text-[var(--text-secondary)]',
                )}
              >
                <span className="tabular-nums">{item.step}.</span>
                <span className="truncate">{item.label}</span>
              </li>
            );
          })}
        </ol>

        {/* 步骤 1：选择备份 */}
        {step === 1 && (
          <div className="space-y-2.5">
            <p className="text-[12.5px] font-medium text-[var(--text-secondary)]">
              选择要执行隔离恢复校验的加密归档：
            </p>
            {archives.length === 0 ? (
              <div className="rounded-2xl border border-white/75 bg-white/45 p-5 text-center text-[13px] text-[var(--text-secondary)]">
                暂无可用的加密备份归档，请先执行一次立即备份。
              </div>
            ) : (
              <div
                role="radiogroup"
                aria-label="选择备份归档"
                className="space-y-2"
              >
                {archives.map((archive) => {
                  const checked = archive.id === selectedArchive?.id;
                  return (
                    <label
                      key={archive.id}
                      className={cn(
                        'flex cursor-pointer items-center justify-between gap-3 rounded-2xl border px-3.5 py-2.5 transition-all',
                        checked
                          ? 'border-[#1677ff]/35 bg-[#1677ff]/[0.08]'
                          : 'border-white/75 bg-white/45 hover:bg-white/68',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <input
                          type="radio"
                          name="restore-archive"
                          checked={checked}
                          onChange={() => setSelectedArchiveId(archive.id)}
                          className="accent-[var(--accent)]"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-[12.5px] font-semibold text-[var(--text-primary)]">
                            {archive.filename}
                          </span>
                          <span className="block text-[11.5px] tabular-nums text-[var(--text-secondary)]">
                            {archive.createdAt} · {archive.method} ·{' '}
                            {archive.checksumShort}
                          </span>
                        </span>
                      </span>
                      <span className="shrink-0 rounded-full bg-white/75 px-2 py-0.5 text-[11.5px] font-medium tabular-nums text-[var(--text-secondary)]">
                        {archive.sizeLabel}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* 步骤 2：校验清单 */}
        {step === 2 && selectedArchive && (
          <div className="space-y-3">
            <div className="rounded-xl border border-white/75 bg-white/55 px-3 py-2 text-[12px] text-[var(--text-secondary)]">
              目标归档：
              <span className="font-mono font-semibold text-[var(--text-primary)]">
                {selectedArchive.filename}
              </span>
            </div>
            <ul className="space-y-2">
              {RESTORE_VERIFICATION_CHECKLIST.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2.5 rounded-2xl border border-white/75 bg-white/48 px-3.5 py-2.5"
                >
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-[var(--accent)]"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-[13px] font-semibold text-[var(--text-primary)]">
                      {item.label}
                    </p>
                    <p className="text-[12px] text-[var(--text-secondary)]">
                      {item.description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 步骤 3：开始验证（执行中） */}
        {step === 3 && (
          <div
            role="status"
            aria-busy="true"
            className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-white/75 bg-white/48 px-6 py-8 text-center"
          >
            <Loader2
              className="size-8 animate-spin text-[var(--accent)]"
              aria-hidden="true"
            />
            <div>
              <p className="text-[14px] font-semibold text-[var(--text-primary)]">
                正在执行沙箱恢复与抽样解密验证…
              </p>
              <p className="mt-1 text-[12.5px] text-[var(--text-secondary)]">
                正在校验 {selectedArchive?.filename}{' '}
                的结构、外键约束与加密完整性
              </p>
            </div>
          </div>
        )}

        {/* 步骤 4：显示结果 */}
        {step === 4 && report && (
          <div className="space-y-3">
            <div
              role={report.passed ? 'status' : 'alert'}
              className={cn(
                'flex items-start gap-2.5 rounded-2xl border px-3.5 py-3 text-[13px]',
                report.passed
                  ? 'border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]'
                  : 'border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]',
              )}
            >
              {report.passed ? (
                <CheckCircle2
                  className="mt-0.5 size-4.5 shrink-0 text-[var(--success)]"
                  aria-hidden="true"
                />
              ) : (
                <XCircle
                  className="mt-0.5 size-4.5 shrink-0 text-[var(--danger)]"
                  aria-hidden="true"
                />
              )}
              <div>
                <p className="font-semibold">
                  {report.passed
                    ? '恢复验证全部通过（结构、约束与抽样解密）'
                    : '恢复验证未通过'}
                </p>
                <p className="mt-0.5 text-[12px] opacity-90">
                  {report.passed
                    ? `验证时间 ${report.verifiedAt} · 耗时 ${report.durationMs} ms · 抽样解密 ${report.sampledRows} 条`
                    : report.errorMessage}
                </p>
              </div>
            </div>

            <ul className="space-y-1.5">
              {report.checks.map((check) => (
                <li
                  key={check.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-white/75 bg-white/50 px-3 py-2 text-[12.5px]"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {check.status === 'passed' ? (
                      <CheckCircle2
                        className="size-3.5 shrink-0 text-[var(--success)]"
                        aria-hidden="true"
                      />
                    ) : check.status === 'failed' ? (
                      <XCircle
                        className="size-3.5 shrink-0 text-[var(--danger)]"
                        aria-hidden="true"
                      />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="size-3 rounded-full border border-[var(--text-secondary)]/40"
                      />
                    )}
                    <span className="truncate font-medium text-[var(--text-primary)]">
                      {check.label}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11.5px] text-[var(--text-secondary)]">
                    {check.detail}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <DialogFooter>
          {step === 1 && (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-white/85 bg-white/72 px-4 text-[13px] font-medium hover:bg-white"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!selectedArchive}
                onClick={() => setStep(2)}
                className="inline-flex h-9 items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--primary-foreground)] shadow-[0_6px_16px_rgba(22,119,255,0.24)] hover:bg-[var(--accent-hover)] disabled:opacity-45"
              >
                下一步：查看校验清单
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-white/85 bg-white/72 px-4 text-[13px] font-medium hover:bg-white"
              >
                上一步
              </button>
              <button
                type="button"
                onClick={() => void handleStartVerify()}
                className="inline-flex h-9 items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--primary-foreground)] shadow-[0_6px_16px_rgba(22,119,255,0.24)] hover:bg-[var(--accent-hover)]"
              >
                开始验证
              </button>
            </>
          )}

          {step === 4 && (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="inline-flex h-9 items-center justify-center rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--primary-foreground)] shadow-[0_6px_16px_rgba(22,119,255,0.24)] hover:bg-[var(--accent-hover)]"
            >
              完成关闭
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ============================================================================
 * 4. 调整日志保留与数据生命周期策略 Sheet
 * ============================================================================ */

export function RetentionPolicySheet({
  open,
  onOpenChange,
  policy,
  idleMinutes,
  maxIdleMinutes,
  isRecentlyVerified,
  requireStepUpTotp,
  readOnlyRetentionDays = false,
  canUsePasskey = false,
  onPasskeyVerify,
  onSave,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policy: RetentionPolicyInfo;
  idleMinutes: number;
  maxIdleMinutes: number;
  isRecentlyVerified: boolean;
  requireStepUpTotp: boolean;
  readOnlyRetentionDays?: boolean;
  canUsePasskey?: boolean;
  onPasskeyVerify?: () => Promise<SettingsActionResult>;
  onSave: (
    next: {
      auditRetentionDays: number;
      backupRetentionDays: number;
      idleMinutes: number;
    },
    verify?: SensitiveVerifyPayload,
  ) => Promise<SettingsActionResult>;
  onSuccess?: (message?: string) => void;
}) {
  const auditDaysId = useId();
  const backupDaysId = useId();
  const idleId = useId();
  const passId = useId();
  const totpId = useId();

  const [auditDaysInput, setAuditDaysInput] = useState(
    String(policy.auditRetentionDays),
  );
  const [backupDaysInput, setBackupDaysInput] = useState(
    policy.backupRetentionDays !== null
      ? String(policy.backupRetentionDays)
      : '',
  );
  const [idleInput, setIdleInput] = useState(String(idleMinutes));
  const [password, setPassword] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [passkeyVerified, setPasskeyVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      setAuditDaysInput(String(policy.auditRetentionDays));
      setBackupDaysInput(
        policy.backupRetentionDays !== null
          ? String(policy.backupRetentionDays)
          : '',
      );
      setIdleInput(String(idleMinutes));
      setPassword('');
      setTotpCode('');
      setPasskeyVerified(false);
      setError('');
      setBusy(false);
    }
    wasOpenRef.current = open;
  }, [
    idleMinutes,
    open,
    policy.auditRetentionDays,
    policy.backupRetentionDays,
  ]);

  useEffect(() => {
    if (!open) return;
    const onHide = () => {
      if (document.hidden) {
        setPassword('');
        setTotpCode('');
      }
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [open]);

  const parsedAuditDays = Number(auditDaysInput);
  const parsedBackupDays = Number(backupDaysInput);
  const parsedIdle = Number(idleInput);

  const shorteningRetention =
    !readOnlyRetentionDays &&
    ((Number.isFinite(parsedAuditDays) &&
      auditDaysInput.trim() !== '' &&
      parsedAuditDays < policy.auditRetentionDays) ||
      (policy.backupRetentionDays !== null &&
        Number.isFinite(parsedBackupDays) &&
        backupDaysInput.trim() !== '' &&
        parsedBackupDays < policy.backupRetentionDays));
  const needsCredentials = !isRecentlyVerified && !passkeyVerified;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setError('');

    if (
      !readOnlyRetentionDays &&
      (!auditDaysInput.trim() ||
        !Number.isInteger(parsedAuditDays) ||
        parsedAuditDays < 30 ||
        parsedAuditDays > 3650)
    ) {
      setError('审计日志保留天数必须为 30–3650 之间的整数。');
      return;
    }
    if (
      !readOnlyRetentionDays &&
      (!backupDaysInput.trim() ||
        !Number.isInteger(parsedBackupDays) ||
        parsedBackupDays < 7 ||
        parsedBackupDays > 1095)
    ) {
      setError('备份文件保留天数必须为 7–1095 之间的整数。');
      return;
    }
    if (
      !idleInput.trim() ||
      !Number.isInteger(parsedIdle) ||
      parsedIdle < 1 ||
      parsedIdle > maxIdleMinutes
    ) {
      setError(`会话空闲自动锁定时间必须为 1–${maxIdleMinutes} 之间的整数。`);
      return;
    }

    if (needsCredentials && !password.trim()) {
      setError('修改保留与锁定策略需最近重新验证，请输入当前管理员密码。');
      return;
    }
    if (
      needsCredentials &&
      requireStepUpTotp &&
      !/^\d{6}$/.test(totpCode.trim())
    ) {
      setError('请输入 6 位 TOTP 验证码。');
      return;
    }

    setBusy(true);
    try {
      const result = await onSave(
        {
          auditRetentionDays: readOnlyRetentionDays
            ? policy.auditRetentionDays
            : parsedAuditDays,
          backupRetentionDays: readOnlyRetentionDays
            ? (policy.backupRetentionDays ?? 0)
            : parsedBackupDays,
          idleMinutes: parsedIdle,
        },
        needsCredentials
          ? {
              password,
              totpCode: requireStepUpTotp ? totpCode.trim() : undefined,
            }
          : undefined,
      );
      if (!result.ok) {
        if (result.requireReauth) {
          setPasskeyVerified(false);
        }
        setError(result.error);
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
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next);
      }}
    >
      <SheetContent
        side="right"
        data-slot="retention-policy-sheet"
        className="macos-glass-modal flex w-full flex-col border-l border-white/80 p-0 sm:max-w-[440px]"
      >
        <SheetHeader className="border-b border-[var(--table-divider)] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <SlidersHorizontal className="size-4" aria-hidden="true" />
            </span>
            <div>
              <SheetTitle className="text-[17px] font-semibold text-[var(--text-primary)]">
                调整保留与生命周期策略
              </SheetTitle>
              <SheetDescription className="text-[12.5px] text-[var(--text-secondary)]">
                配置审计留存天数、加密备份轮替周期与空闲锁定时间
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="macos-thin-scrollbar flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <label
                htmlFor={auditDaysId}
                className="block text-[13px] font-medium text-[var(--text-primary)]"
              >
                审计日志保留天数（30–3650 天）
              </label>
              <input
                id={auditDaysId}
                type="number"
                min={30}
                max={3650}
                required={!readOnlyRetentionDays}
                disabled={busy || readOnlyRetentionDays}
                value={auditDaysInput}
                onChange={(e) => setAuditDaysInput(e.target.value)}
                className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 text-[13px] tabular-nums text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-65"
              />
              <p className="text-[11.5px] text-[var(--text-secondary)]">
                {readOnlyRetentionDays
                  ? '由部署环境变量（AUDIT_RETENTION_DAYS）只读控制，此处仅在线修改空闲自动锁定时间。'
                  : '推荐至少 365–730 天以满足合规追溯要求。'}
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={backupDaysId}
                className="block text-[13px] font-medium text-[var(--text-primary)]"
              >
                备份文件保留天数（7–1095 天）
              </label>
              {readOnlyRetentionDays && policy.backupRetentionDays === null ? (
                <input
                  id={backupDaysId}
                  type="text"
                  readOnly
                  disabled
                  value="由部署主机备份脚本管理"
                  className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/60 px-3 text-[13px] text-[var(--text-secondary)] disabled:cursor-not-allowed disabled:opacity-75"
                />
              ) : (
                <input
                  id={backupDaysId}
                  type="number"
                  min={7}
                  max={1095}
                  required={!readOnlyRetentionDays}
                  disabled={busy || readOnlyRetentionDays}
                  value={backupDaysInput}
                  onChange={(e) => setBackupDaysInput(e.target.value)}
                  className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 text-[13px] tabular-nums text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-65"
                />
              )}
              {readOnlyRetentionDays && (
                <p className="text-[11.5px] text-[var(--text-secondary)]">
                  由部署主机备份轮替脚本控制，不支持在 Web 端直接更改。
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={idleId}
                className="block text-[13px] font-medium text-[var(--text-primary)]"
              >
                会话空闲自动锁定（分钟，1–{maxIdleMinutes}）
              </label>
              <input
                id={idleId}
                type="number"
                min={1}
                max={maxIdleMinutes}
                required
                disabled={busy}
                value={idleInput}
                onChange={(e) => setIdleInput(e.target.value)}
                className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 text-[13px] tabular-nums text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              />
            </div>

            {shorteningRetention && (
              <div className="flex items-start gap-2 rounded-2xl border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-3.5 py-2.5 text-[12px] leading-5 text-[var(--badge-red-text)]">
                <AlertTriangle
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  缩短保留周期将导致超过新窗口的历史归档在下次清理任务中被永久移除，请确认已完成必要冷归档。
                </span>
              </div>
            )}

            {needsCredentials ? (
              <div className="space-y-3 rounded-2xl border border-white/80 bg-white/55 p-3.5">
                <p className="text-[12px] font-medium text-[var(--text-secondary)]">
                  策略调整属于高风险操作，请验证当前管理员身份：
                </p>
                {canUsePasskey && onPasskeyVerify && (
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
                <div className="space-y-1.5">
                  <label
                    htmlFor={passId}
                    className="block text-[12.5px] font-medium text-[var(--text-primary)]"
                  >
                    当前管理员密码
                  </label>
                  <input
                    id={passId}
                    type="password"
                    autoComplete="current-password"
                    required
                    disabled={busy}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                  />
                </div>
                {requireStepUpTotp && (
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
                        setTotpCode(
                          e.target.value.replace(/\D/g, '').slice(0, 6),
                        )
                      }
                      className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 font-mono text-[13px] tracking-widest text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                    />
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-3 py-2 text-[12px] text-[var(--badge-green-text)]">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                <span>最近已完成重新验证，可直接保存策略。</span>
              </div>
            )}

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-3 py-2 text-[12.5px] text-[var(--badge-red-text)]"
              >
                {error}
              </div>
            )}
          </div>

          <SheetFooter className="flex-row justify-end gap-2 border-t border-[var(--table-divider)] px-5 py-3.5">
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
              <span>{busy ? '正在保存…' : '保存策略'}</span>
            </button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
