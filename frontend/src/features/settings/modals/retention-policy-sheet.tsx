import { useEffect, useId, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  SlidersHorizontal,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type {
  RetentionPolicyInfo,
  SensitiveVerifyPayload,
  SettingsActionResult,
} from '../types';

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
