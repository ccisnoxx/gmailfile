import { useId } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileText,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { GlassPanel } from '@/components/macos';
import { cn } from '@/lib/utils';
import type { CommitOutcome, CommitSummaryCounts } from './types';

export function AtomicCommitPanel({
  hasFile,
  summary,
  confirmed,
  submitting,
  needsRepreview,
  outcome,
  onConfirmedChange,
  onPrevStep,
  onStartImport,
  onRepreview,
  onOpenAuditLog,
  onRefreshState,
  className,
}: {
  hasFile: boolean;
  summary: CommitSummaryCounts;
  confirmed: boolean;
  submitting: boolean;
  needsRepreview: boolean;
  outcome: CommitOutcome | null;
  onConfirmedChange: (checked: boolean) => void;
  onPrevStep: () => void;
  onStartImport: () => void;
  onRepreview?: () => void;
  onOpenAuditLog: () => void;
  onRefreshState?: () => void;
  className?: string;
}) {
  const checkboxId = useId();
  const hasErrors = summary.error > 0;
  const startDisabled =
    !hasFile ||
    hasErrors ||
    !confirmed ||
    submitting ||
    needsRepreview ||
    outcome?.kind === 'unknown';

  return (
    <GlassPanel
      variant="strong"
      data-slot="atomic-commit-panel"
      className={cn('p-4 sm:p-5', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--table-divider)] pb-3.5">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-flex size-7 items-center justify-center rounded-xl bg-[#eaf3ff] text-[var(--accent)]"
            >
              <ShieldCheck className="size-4" />
            </span>
            <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
              确认导入（原子提交）
            </h2>
          </div>
          <p className="text-[13px] text-[var(--text-secondary)]">
            {hasFile ? (
              <>
                将一次性、原子地导入{' '}
                <strong className="font-semibold tabular-nums text-[var(--text-primary)]">
                  {summary.total.toLocaleString('en-US')}
                </strong>{' '}
                条数据
              </>
            ) : (
              '请先上传并校验 CSV 文件，随后在此执行事务性原子提交。'
            )}
          </p>
        </div>

        {/* 统计摘要胶囊 */}
        {hasFile && (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-medium tabular-nums">
            <span className="rounded-full border border-[#1677ff]/20 bg-[#eaf3ff]/80 px-3 py-1 text-[#1158c7]">
              新增 {summary.create.toLocaleString('en-US')} 条
            </span>
            <span className="rounded-full border border-[#2fbf71]/25 bg-[#e7f8ef]/85 px-3 py-1 text-[#1b8a4e]">
              更新 {summary.update.toLocaleString('en-US')} 条
            </span>
            <span className="rounded-full border border-[#b9d0ec]/65 bg-white/75 px-3 py-1 text-[var(--text-secondary)]">
              跳过 {summary.skip.toLocaleString('en-US')} 条
            </span>
            <span
              className={cn(
                'rounded-full border px-3 py-1',
                hasErrors
                  ? 'border-[#e45d5d]/30 bg-[#fdecec]/90 font-semibold text-[#b93838]'
                  : 'border-white/80 bg-white/65 text-[var(--text-secondary)]',
              )}
            >
              错误 {summary.error.toLocaleString('en-US')} 条
            </span>
          </div>
        )}
      </div>

      {/* 阻塞提示 / 进度条 / 结果横幅 */}
      <div className="mt-3.5 space-y-3">
        {hasFile && hasErrors && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-[#e45d5d]/28 bg-[#fdecec]/78 px-3.5 py-2.5 text-[12.5px] leading-5 text-[#a83838]"
          >
            <AlertCircle
              className="mt-0.5 size-4 shrink-0 text-[var(--danger)]"
              aria-hidden="true"
            />
            <span>
              当前存在{' '}
              <strong className="tabular-nums">
                {summary.error.toLocaleString('en-US')}
              </strong>{' '}
              条错误记录，“开始导入”已禁用。请修正 CSV
              文件错误行并重新上传，确保错误数为 0 后再提交。
            </span>
          </div>
        )}

        {hasFile && !hasErrors && needsRepreview && (
          <div
            role="status"
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#f5a623]/32 bg-[#fef6df]/85 px-3.5 py-2.5 text-[12.5px] text-[#9a5c06]"
          >
            <span className="flex items-center gap-2">
              <AlertTriangle
                className="size-4 shrink-0 text-[var(--warning)]"
                aria-hidden="true"
              />
              <span>
                字段映射或策略已变更，原确认凭据已失效，请重新预览校验后再提交。
              </span>
            </span>
            {onRepreview && (
              <button
                type="button"
                onClick={onRepreview}
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-[#f5a623]/40 bg-white/85 px-2.5 text-[12px] font-semibold text-[#9a5c06] hover:bg-white"
              >
                <RefreshCw className="size-3" aria-hidden="true" />
                重新预览
              </button>
            )}
          </div>
        )}

        {submitting && (
          <div
            role="status"
            aria-live="polite"
            data-slot="commit-progress"
            className="space-y-2 rounded-xl border border-[#1677ff]/25 bg-[#eaf3ff]/80 px-3.5 py-3"
          >
            <div className="flex items-center justify-between gap-2 text-[12.5px] font-medium text-[#1158c7]">
              <span className="flex items-center gap-2">
                <Loader2
                  className="macos-spinner size-4 shrink-0 text-[var(--accent)]"
                  aria-hidden="true"
                />
                <span>正在执行原子事务提交，请勿关闭页面或重复点击…</span>
              </span>
              <span className="text-[11.5px] text-[var(--text-secondary)]">
                单事务写入中
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="原子导入进度"
              aria-valuetext="正在提交"
              className="h-1.5 w-full overflow-hidden rounded-full bg-white/80"
            >
              <div className="h-full w-2/3 animate-pulse rounded-full bg-[linear-gradient(90deg,#3b93ff,#1677ff)]" />
            </div>
          </div>
        )}

        {outcome?.kind === 'unknown' && (
          <div
            role="alert"
            aria-live="assertive"
            data-slot="commit-unknown-banner"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f5a623]/38 bg-[#fef6df]/90 px-3.5 py-3 text-[12.5px] text-[#8a5105]"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-[var(--warning)]"
                aria-hidden="true"
              />
              <div>
                <p className="font-semibold">{outcome.message}</p>
                <p className="mt-0.5 text-[12px] text-[#8a5105]/90">
                  网络连接中断或服务端响应异常，系统不会自动重试，也无法判定是否已回滚。请先核对账号列表与审计日志。
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {onRefreshState && (
                <button
                  type="button"
                  onClick={onRefreshState}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/85 bg-white/85 px-3 text-[12px] font-medium text-[var(--text-primary)] hover:bg-white"
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  刷新状态
                </button>
              )}
              <button
                type="button"
                onClick={onOpenAuditLog}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#1677ff]/25 bg-[#eaf3ff] px-3 text-[12px] font-semibold text-[#1158c7] hover:bg-[#dcebff]"
              >
                <FileText className="size-3.5" aria-hidden="true" />
                查看审计日志
              </button>
            </div>
          </div>
        )}

        {outcome?.kind === 'conflict' && (
          <div
            role="alert"
            aria-live="assertive"
            data-slot="commit-conflict-banner"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e45d5d]/30 bg-[#fdecec]/90 px-3.5 py-3 text-[12.5px] text-[#a83838]"
          >
            <div className="flex items-start gap-2">
              <AlertCircle
                className="mt-0.5 size-4 shrink-0 text-[var(--danger)]"
                aria-hidden="true"
              />
              <div>
                <p className="font-semibold">{outcome.message}</p>
                {outcome.issues.length > 0 && (
                  <p className="mt-0.5 text-[12px]">
                    冲突示例：第 {outcome.issues[0].row} 行 ·{' '}
                    {outcome.issues[0].field}：{outcome.issues[0].reason}
                  </p>
                )}
              </div>
            </div>
            {onRepreview && (
              <button
                type="button"
                onClick={onRepreview}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#e45d5d]/30 bg-white/88 px-3 text-[12px] font-semibold text-[#a83838] hover:bg-white"
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
                重新预览
              </button>
            )}
          </div>
        )}

        {outcome?.kind === 'committed' && (
          <div
            role="status"
            aria-live="polite"
            data-slot="commit-success-banner"
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#2fbf71]/28 bg-[#e7f8ef]/85 px-3.5 py-3 text-[12.5px] text-[#186e40]"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2
                className="size-4 shrink-0 text-[var(--success)]"
                aria-hidden="true"
              />
              <span className="font-medium tabular-nums">
                原子导入已完成：新增 {outcome.created.toLocaleString('en-US')}{' '}
                条、更新 {outcome.updated.toLocaleString('en-US')} 条、跳过{' '}
                {outcome.skipped.toLocaleString('en-US')} 条（批次{' '}
                {outcome.batchId}）。
              </span>
            </div>
            <button
              type="button"
              onClick={onOpenAuditLog}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#2fbf71]/30 bg-white/85 px-3 text-[12px] font-semibold text-[#186e40] hover:bg-white"
            >
              <FileText className="size-3.5" aria-hidden="true" />
              查看审计日志
            </button>
          </div>
        )}

        {/* 底部确认勾选与按钮栏 */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor={checkboxId}
              className={cn(
                'inline-flex items-center gap-2.5 text-[13px] font-medium text-[var(--text-primary)] select-none',
                !hasFile || submitting
                  ? 'cursor-not-allowed opacity-60'
                  : 'cursor-pointer',
              )}
            >
              <input
                id={checkboxId}
                type="checkbox"
                checked={confirmed}
                disabled={!hasFile || submitting}
                onChange={(e) => onConfirmedChange(e.target.checked)}
                className="size-4 rounded border-[#9bb8dc] accent-[var(--accent)]"
              />
              <span>我已确认数据无误，并知悉该操作将以事务方式原子提交</span>
            </label>

            <button
              type="button"
              onClick={onOpenAuditLog}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--accent)] hover:underline"
            >
              <FileText className="size-3.5" aria-hidden="true" />
              审计日志入口
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={submitting}
              onClick={onPrevStep}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/88 bg-white/74 px-4 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_2px_8px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              <span>上一步</span>
            </button>

            <button
              type="button"
              disabled={startDisabled}
              onClick={onStartImport}
              className={cn(
                'inline-flex h-9 items-center gap-2 rounded-xl px-5 text-[13px] font-semibold transition-all duration-[180ms] ease-out',
                startDisabled
                  ? 'cursor-not-allowed border border-[#b9cde6]/70 bg-[#d5e3f4]/80 text-[#667892]'
                  : 'border border-white/35 bg-[linear-gradient(180deg,#3b93ff_0%,#1677ff_100%)] text-white shadow-[0_8px_20px_rgba(22,119,255,0.28),inset_0_1px_0_rgba(255,255,255,0.38)] hover:brightness-105',
              )}
            >
              {submitting && (
                <Loader2 className="macos-spinner size-4" aria-hidden="true" />
              )}
              <span>{submitting ? '正在提交…' : '开始导入'}</span>
            </button>
          </div>
        </div>
      </div>
    </GlassPanel>
  );
}
