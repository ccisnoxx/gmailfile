import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { RESTORE_VERIFICATION_CHECKLIST } from '../mock-fixtures';
import type { BackupArchiveItem, RestoreVerifyReport } from '../types';

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
