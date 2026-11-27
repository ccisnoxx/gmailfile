import { useEffect, useId, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Copy,
  Download,
  KeyRound,
  Loader2,
  Smartphone,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { SettingsActionResult, TotpSetupChallenge } from './types';

export function TotpSetupModal({
  open,
  onOpenChange,
  isRebind,
  isRecentlyVerified,
  canUsePasskey = false,
  onPasskeyVerify,
  onStartSetup,
  onConfirmSetup,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isRebind: boolean;
  isRecentlyVerified: boolean;
  canUsePasskey?: boolean;
  onPasskeyVerify?: () => Promise<SettingsActionResult>;
  onStartSetup: (payload: {
    currentPassword: string;
    totpCode?: string;
    recoveryCode?: string;
  }) => Promise<
    | { ok: true; setup: TotpSetupChallenge }
    | { ok: false; error: string; requireReauth?: boolean }
  >;
  onConfirmSetup: (
    code: string,
  ) => Promise<
    | { ok: true; codes: string[]; message?: string }
    | { ok: false; error: string; requireReauth?: boolean }
  >;
  onSuccess?: (message?: string) => void;
}) {
  const passId = useId();
  const currentCodeId = useId();
  const confirmCodeId = useId();
  const secretId = useId();
  const savedId = useId();

  const [password, setPassword] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [currentFactor, setCurrentFactor] = useState('');
  const [setup, setSetup] = useState<TotpSetupChallenge | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [generatedCodes, setGeneratedCodes] = useState<string[] | null>(null);
  const [savedChecked, setSavedChecked] = useState(false);
  const [copiedNotice, setCopiedNotice] = useState('');
  const [passkeyVerified, setPasskeyVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // 关闭弹窗或切到后台标签页时立即清空所有 TOTP 密钥、验证码与恢复码
  useEffect(() => {
    if (!open) {
      setPassword('');
      setUseRecovery(false);
      setCurrentFactor('');
      setSetup(null);
      setConfirmCode('');
      setGeneratedCodes(null);
      setSavedChecked(false);
      setCopiedNotice('');
      setPasskeyVerified(false);
      setError('');
      setBusy(false);
      return;
    }
    const clearOnHide = () => {
      if (document.hidden) {
        setPassword('');
        setCurrentFactor('');
        setSetup(null);
        setConfirmCode('');
        setGeneratedCodes(null);
      }
    };
    document.addEventListener('visibilitychange', clearOnHide);
    return () => document.removeEventListener('visibilitychange', clearOnHide);
  }, [open]);

  const recentReady = isRecentlyVerified || passkeyVerified;
  const mustHoldOpen = generatedCodes !== null && !savedChecked;

  const handleStart = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setError('');

    if (!password.trim()) {
      setError('请输入当前管理员密码。');
      return;
    }
    if (isRebind) {
      const trimmed = currentFactor.trim();
      if (!useRecovery && !/^\d{6}$/.test(trimmed)) {
        setError('请输入当前验证器的 6 位动态验证码。');
        return;
      }
      if (useRecovery && !trimmed) {
        setError('请输入一条未使用的备用恢复码。');
        return;
      }
    }

    setBusy(true);
    try {
      const result = await onStartSetup({
        currentPassword: password,
        totpCode: isRebind && !useRecovery ? currentFactor.trim() : undefined,
        recoveryCode:
          isRebind && useRecovery ? currentFactor.trim() : undefined,
      });
      if (!result.ok) {
        if (result.requireReauth) {
          setPasskeyVerified(false);
        }
        setError(result.error);
        return;
      }
      setPassword('');
      setCurrentFactor('');
      setSetup(result.setup);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!/^\d{6}$/.test(confirmCode.trim())) {
      setError('请输入新验证器生成的 6 位数字验证码。');
      return;
    }

    setBusy(true);
    try {
      const result = await onConfirmSetup(confirmCode.trim());
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSetup(null);
      setConfirmCode('');
      setGeneratedCodes(result.codes);
      setSavedChecked(false);
      onSuccess?.(result.message);
    } finally {
      setBusy(false);
    }
  };

  const handleCopySecret = async () => {
    if (!setup) return;
    try {
      await navigator.clipboard.writeText(setup.secret);
      setCopiedNotice('已复制手工密钥，请粘贴至验证器后及时清理剪贴板。');
    } catch {
      setCopiedNotice('浏览器未授权剪贴板，请直接手工录入密钥。');
    }
  };

  const handleCopyCodes = async () => {
    if (!generatedCodes) return;
    try {
      await navigator.clipboard.writeText(generatedCodes.join('\n'));
      setCopiedNotice('已复制全部恢复码，请立即粘贴至离线密码库。');
    } catch {
      setCopiedNotice('浏览器未授权剪贴板，请手工记录或点击下载。');
    }
  };

  const handleDownloadCodes = () => {
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
        if (!next && mustHoldOpen) {
          setError('请先保存新恢复码并勾选确认框后再关闭弹窗。');
          return;
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        data-slot="totp-setup-modal"
        className="macos-glass-modal rounded-[20px] sm:max-w-[490px]"
      >
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-9 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
              <Smartphone className="size-4.5" aria-hidden="true" />
            </span>
            <div className="text-left">
              <DialogTitle className="text-[17px] font-semibold text-[var(--text-primary)]">
                {generatedCodes
                  ? '请离线保存新恢复码'
                  : setup
                    ? '扫描二维码并确认新验证器'
                    : isRebind
                      ? '重新绑定 TOTP 验证器'
                      : '绑定 TOTP 双因素验证器'}
              </DialogTitle>
              <DialogDescription className="mt-0.5 text-[12.5px] text-[var(--text-secondary)]">
                {generatedCodes
                  ? '新验证器已生效，旧会话与其他设备已自动撤销'
                  : setup
                    ? '二维码与手工密钥仅保存在当前内存，切到后台自动清空'
                    : isRebind
                      ? '验证当前凭据后生成新密钥，确认前原验证器保持有效'
                      : '启用基于时间的一次性动态口令（TOTP）并生成离线恢复码'}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {!setup && !generatedCodes && (
          <form onSubmit={(e) => void handleStart(e)} className="space-y-3.5">
            <div className="flex items-start gap-2 rounded-2xl border border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)] px-3.5 py-2.5 text-[12px] leading-5 text-[var(--badge-orange-text)]">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0"
                aria-hidden="true"
              />
              <span>
                {isRebind
                  ? '完成新验证器确认后，旧验证器与原有备用恢复码将立即失效，并退出其他设备会话。'
                  : '启用后每次登录和高风险操作均受双因素认证保护，系统会同步生成一组离线备用恢复码。'}
              </span>
            </div>

            {!recentReady && canUsePasskey && onPasskeyVerify && (
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
                <span>使用通行密钥（Passkey）刷新二次验证窗口</span>
              </button>
            )}

            {recentReady && (
              <div className="flex items-center gap-2 rounded-xl border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-3 py-2 text-[12px] text-[var(--badge-green-text)]">
                <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                <span>最近重新验证窗口有效，请校验当前凭据以生成新密钥。</span>
              </div>
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
                placeholder="输入当前管理员密码"
                className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
              />
            </div>

            {isRebind && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label
                    htmlFor={currentCodeId}
                    className="block text-[12.5px] font-medium text-[var(--text-primary)]"
                  >
                    {useRecovery ? '备用恢复码' : '当前 TOTP 验证码（6 位）'}
                  </label>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setUseRecovery((prev) => !prev);
                      setCurrentFactor('');
                    }}
                    className="text-[11.5px] font-medium text-[var(--accent-text)] hover:underline"
                  >
                    {useRecovery ? '改用 6 位验证码' : '改用备用恢复码'}
                  </button>
                </div>
                <input
                  id={currentCodeId}
                  type="text"
                  inputMode={useRecovery ? 'text' : 'numeric'}
                  autoComplete={useRecovery ? 'off' : 'one-time-code'}
                  maxLength={useRecovery ? 32 : 6}
                  required
                  disabled={busy}
                  value={currentFactor}
                  onChange={(e) =>
                    setCurrentFactor(
                      useRecovery
                        ? e.target.value
                        : e.target.value.replace(/\D/g, '').slice(0, 6),
                    )
                  }
                  placeholder={
                    useRecovery
                      ? '输入一条未使用的备用恢复码'
                      : '输入当前验证器的 6 位动态验证码'
                  }
                  className="h-9 w-full rounded-xl border border-[var(--border)] bg-white/85 px-3 font-mono text-[13px] tracking-widest text-[var(--text-primary)] placeholder:font-sans placeholder:tracking-normal focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                />
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
                  <Loader2
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                )}
                <span>{busy ? '正在生成密钥…' : '下一步：获取二维码'}</span>
              </button>
            </DialogFooter>
          </form>
        )}

        {setup && !generatedCodes && (
          <form onSubmit={(e) => void handleConfirm(e)} className="space-y-3.5">
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/80 bg-white/60 p-4">
              <div className="rounded-xl bg-white p-2.5 shadow-sm">
                <img
                  src={setup.qrDataUrl}
                  width={184}
                  height={184}
                  alt="TOTP 验证器绑定二维码"
                  className="size-46"
                />
              </div>
              <p className="text-center text-[12px] text-[var(--text-secondary)]">
                使用 Google Authenticator、1Password
                等验证器扫描二维码，或手工录入下方密钥：
              </p>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor={secretId}
                className="block text-[12.5px] font-medium text-[var(--text-primary)]"
              >
                手工密钥（Base32）
              </label>
              <div className="flex gap-2">
                <input
                  id={secretId}
                  readOnly
                  value={setup.secret}
                  autoComplete="off"
                  className="h-9 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-white/85 px-3 font-mono text-[12.5px] tracking-wider text-[var(--text-primary)]"
                />
                <button
                  type="button"
                  onClick={() => void handleCopySecret()}
                  className="inline-flex h-9 shrink-0 items-center gap-1 rounded-xl border border-white/85 bg-white/75 px-3 text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-white"
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  <span>复制</span>
                </button>
              </div>
            </div>

            {copiedNotice && (
              <p
                role="status"
                className="text-[12px] text-[var(--text-secondary)]"
              >
                {copiedNotice}
              </p>
            )}

            <div className="space-y-1.5">
              <label
                htmlFor={confirmCodeId}
                className="block text-[12.5px] font-medium text-[var(--text-primary)]"
              >
                新验证器 6 位验证码
              </label>
              <input
                id={confirmCodeId}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                disabled={busy}
                value={confirmCode}
                onChange={(e) =>
                  setConfirmCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                placeholder="输入新验证器显示的 6 位验证码"
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
                onClick={() => {
                  setSetup(null);
                  setConfirmCode('');
                  setError('');
                  onOpenChange(false);
                }}
                className="inline-flex h-9 items-center justify-center rounded-xl border border-white/85 bg-white/72 px-4 text-[13px] font-medium text-[var(--text-primary)] hover:bg-white"
              >
                取消绑定
              </button>
              <button
                type="submit"
                disabled={busy}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--primary-foreground)] shadow-[0_6px_16px_rgba(22,119,255,0.24)] hover:bg-[var(--accent-hover)] disabled:opacity-60"
              >
                {busy && (
                  <Loader2
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                )}
                <span>{busy ? '正在确认…' : '确认并启用 TOTP'}</span>
              </button>
            </DialogFooter>
          </form>
        )}

        {generatedCodes && (
          <div className="space-y-4">
            <div className="rounded-2xl border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-3.5 py-2.5 text-[12px] text-[var(--badge-green-text)]">
              以下备用恢复码仅在本次会话内存中展示一次，请立即离线保存后再关闭窗口。
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
                onClick={() => void handleCopyCodes()}
                className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-white/85 bg-white/75 px-3 text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-white"
              >
                <Copy className="size-3.5" aria-hidden="true" />
                <span>复制全部</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadCodes}
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
