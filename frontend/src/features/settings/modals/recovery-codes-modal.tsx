import { useEffect, useId, useState } from 'react';
import {
  AlertTriangle,
  Copy,
  Download,
  KeySquare,
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
              <span>我已将上述 {generatedCodes.length} 个恢复码离线保存</span>
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
