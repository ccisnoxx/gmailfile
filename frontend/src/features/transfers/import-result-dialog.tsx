import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  FileText,
  RefreshCw,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { CommitOutcome } from './types';

export function ImportResultDialog({
  open,
  outcome,
  onOpenChange,
  onOpenAuditLog,
  onRepreview,
  onRefreshState,
  onResetWorkflow,
}: {
  open: boolean;
  outcome: CommitOutcome | null;
  onOpenChange: (open: boolean) => void;
  onOpenAuditLog: () => void;
  onRepreview?: () => void;
  onRefreshState?: () => void;
  onResetWorkflow?: () => void;
}) {
  if (!outcome) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="import-result-dialog"
        className="macos-glass-modal max-w-lg rounded-[22px] border-white/88 p-5 text-[var(--text-primary)]"
      >
        {outcome.kind === 'committed' && (
          <>
            <DialogHeader className="space-y-2">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex size-9 items-center justify-center rounded-2xl border border-[#2fbf71]/25 bg-[#e7f8ef] text-[#1b8a4e]">
                  <CheckCircle2 className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <DialogTitle className="text-[16px] font-semibold">
                    CSV 原子导入成功
                  </DialogTitle>
                  <DialogDescription className="text-[12.5px] text-[var(--text-secondary)]">
                    批次 {outcome.batchId} 已以单事务写入并记录防篡改审计事件。
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="grid grid-cols-3 gap-2.5 py-2">
              <div className="rounded-2xl border border-white/85 bg-white/70 p-3 text-center">
                <p className="text-[11.5px] text-[var(--text-secondary)]">
                  新增
                </p>
                <p className="mt-1 text-[20px] font-semibold tabular-nums text-[#1158c7]">
                  {outcome.created.toLocaleString('en-US')}
                </p>
              </div>
              <div className="rounded-2xl border border-white/85 bg-white/70 p-3 text-center">
                <p className="text-[11.5px] text-[var(--text-secondary)]">
                  更新
                </p>
                <p className="mt-1 text-[20px] font-semibold tabular-nums text-[#1b8a4e]">
                  {outcome.updated.toLocaleString('en-US')}
                </p>
              </div>
              <div className="rounded-2xl border border-white/85 bg-white/70 p-3 text-center">
                <p className="text-[11.5px] text-[var(--text-secondary)]">
                  跳过
                </p>
                <p className="mt-1 text-[20px] font-semibold tabular-nums text-[var(--text-secondary)]">
                  {outcome.skipped.toLocaleString('en-US')}
                </p>
              </div>
            </div>

            <DialogFooter className="flex flex-wrap items-center justify-between gap-2 pt-2 sm:justify-between">
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onOpenAuditLog();
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#1677ff]/25 bg-[#eaf3ff] px-3.5 text-[13px] font-semibold text-[#1158c7] transition-colors hover:bg-[#dcebff]"
              >
                <FileText className="size-4" aria-hidden="true" />
                查看审计日志
              </button>

              <div className="flex items-center gap-2">
                {onResetWorkflow && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      onResetWorkflow();
                    }}
                    className="inline-flex h-9 items-center rounded-xl border border-white/88 bg-white/78 px-3.5 text-[13px] font-medium text-[var(--text-primary)] hover:bg-white"
                  >
                    继续导入新文件
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="inline-flex h-9 items-center rounded-xl bg-[var(--accent)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--accent-hover)]"
                >
                  完成
                </button>
              </div>
            </DialogFooter>
          </>
        )}

        {outcome.kind === 'conflict' && (
          <>
            <DialogHeader className="space-y-2">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex size-9 items-center justify-center rounded-2xl border border-[#e45d5d]/28 bg-[#fdecec] text-[#b93838]">
                  <AlertCircle className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <DialogTitle className="text-[16px] font-semibold">
                    服务端返回冲突，需要重新预览
                  </DialogTitle>
                  <DialogDescription className="text-[12.5px] text-[var(--text-secondary)]">
                    {outcome.message}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {outcome.issues.length > 0 && (
              <div
                role="alert"
                className="macos-thin-scrollbar max-h-44 overflow-auto rounded-2xl border border-[#e45d5d]/22 bg-[#fff7f7]/90 p-3 text-[12.5px]"
              >
                <ul className="space-y-1.5 text-[#a83838]">
                  {outcome.issues.map((item, idx) => (
                    <li key={idx}>
                      {item.row ? `第 ${item.row} 行` : '文件'} · {item.field}：
                      {item.reason}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <DialogFooter className="flex flex-wrap items-center justify-between gap-2 pt-2 sm:justify-between">
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onOpenAuditLog();
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/88 bg-white/78 px-3 text-[13px] font-medium text-[var(--text-primary)] hover:bg-white"
              >
                <FileText
                  className="size-4 text-[var(--accent)]"
                  aria-hidden="true"
                />
                查看审计日志
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="inline-flex h-9 items-center rounded-xl border border-white/88 bg-white/75 px-3.5 text-[13px] font-medium text-[var(--text-primary)] hover:bg-white"
                >
                  关闭
                </button>
                {onRepreview && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      onRepreview();
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--accent-hover)]"
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    重新预览
                  </button>
                )}
              </div>
            </DialogFooter>
          </>
        )}

        {outcome.kind === 'unknown' && (
          <>
            <DialogHeader className="space-y-2">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex size-9 items-center justify-center rounded-2xl border border-[#f5a623]/35 bg-[#fef6df] text-[#a36207]">
                  <AlertTriangle className="size-5" aria-hidden="true" />
                </span>
                <div>
                  <DialogTitle className="text-[16px] font-semibold">
                    {outcome.message}
                  </DialogTitle>
                  <DialogDescription className="text-[12.5px] text-[var(--text-secondary)]">
                    网络在提交过程中发生中断或服务端未返回明确状态，请勿重复提交。
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="rounded-2xl border border-[#f5a623]/28 bg-[#fffaf0]/90 p-3.5 text-[12.5px] leading-6 text-[#8a5105]">
              为防止重复写入或并发覆盖，系统已锁定本次提交凭据且
              <strong>不会自动重试</strong>
              ，也无法确认事务是否已落库。请刷新账号列表并查阅审计日志确认最终状态。
            </div>

            <DialogFooter className="flex flex-wrap items-center justify-between gap-2 pt-2 sm:justify-between">
              <button
                type="button"
                onClick={() => {
                  onOpenChange(false);
                  onOpenAuditLog();
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#1677ff]/25 bg-[#eaf3ff] px-3.5 text-[13px] font-semibold text-[#1158c7] hover:bg-[#dcebff]"
              >
                <FileText className="size-4" aria-hidden="true" />
                查看审计日志
              </button>

              <div className="flex items-center gap-2">
                {onRefreshState && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      onRefreshState();
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--accent-hover)]"
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    刷新确认
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  className="inline-flex h-9 items-center rounded-xl border border-white/88 bg-white/78 px-3.5 text-[13px] font-medium text-[var(--text-primary)] hover:bg-white"
                >
                  我知道了
                </button>
              </div>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
