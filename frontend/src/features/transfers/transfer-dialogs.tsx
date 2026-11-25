import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileText,
  History,
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
import type { ImportHistoryRecord } from './types';

export function ImportHistoryDialog({
  open,
  records,
  onOpenChange,
  onOpenAuditLog,
}: {
  open: boolean;
  records: readonly ImportHistoryRecord[];
  onOpenChange: (open: boolean) => void;
  onOpenAuditLog: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="import-history-dialog"
        className="macos-glass-modal max-w-2xl rounded-[22px] border-white/88 p-5 text-[var(--text-primary)]"
      >
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[#eaf3ff] text-[var(--accent)]">
              <History className="size-4" aria-hidden="true" />
            </span>
            <div>
              <DialogTitle className="text-[16px] font-semibold">
                CSV 导入历史
              </DialogTitle>
              <DialogDescription className="text-[12.5px] text-[var(--text-secondary)]">
                最近通过原子事务执行的 CSV 批量导入记录（所有敏感字段均已脱敏）
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="macos-thin-scrollbar max-h-72 overflow-auto rounded-2xl border border-white/84 bg-white/60">
          {records.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-[var(--text-secondary)]">
              暂无 CSV 导入历史记录。
            </p>
          ) : (
            <table className="w-full border-collapse text-left text-[12.5px]">
              <thead className="border-b border-[var(--table-divider)] bg-white/70 text-[11.5px] font-semibold text-[var(--text-secondary)]">
                <tr>
                  <th scope="col" className="px-3.5 py-2.5">
                    文件 / 批次
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    策略
                  </th>
                  <th scope="col" className="px-3 py-2.5">
                    统计
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-right">
                    结果
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--table-divider)]">
                {records.map((rec) => (
                  <tr key={rec.id} className="hover:bg-white/60">
                    <td className="px-3.5 py-2.5">
                      <p className="font-medium text-[var(--text-primary)]">
                        {rec.fileName}
                      </p>
                      <p className="font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
                        {rec.executedAt} · {rec.operator}
                      </p>
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)]">
                      {rec.strategyLabel}
                    </td>
                    <td className="px-3 py-2.5 tabular-nums text-[var(--text-primary)]">
                      +{rec.created.toLocaleString('en-US')} / ~
                      {rec.updated.toLocaleString('en-US')} / 跳过{' '}
                      {rec.skipped.toLocaleString('en-US')}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {rec.status === 'committed' ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#2fbf71]/25 bg-[#e7f8ef] px-2.5 py-0.5 text-[11px] font-medium text-[#116b3b]">
                          <CheckCircle2 className="size-3" aria-hidden="true" />
                          已提交
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-[#e45d5d]/28 bg-[#fdecec] px-2.5 py-0.5 text-[11px] font-medium text-[#b93838]">
                          <XCircle className="size-3" aria-hidden="true" />
                          已回滚
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
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
            前往完整审计日志
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-9 items-center rounded-xl border border-white/88 bg-white/80 px-4 text-[13px] font-medium text-[var(--text-primary)] hover:bg-white"
          >
            关闭
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExportDataDialog({
  open,
  busy,
  onOpenChange,
  onConfirmExport,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmExport: (scope: 'all' | 'filtered') => void;
}) {
  const [scope, setScope] = useState<'all' | 'filtered'>('all');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="export-data-dialog"
        className="macos-glass-modal max-w-md rounded-[22px] border-white/88 p-5 text-[var(--text-primary)]"
      >
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[#eaf3ff] text-[var(--accent)]">
              <Download className="size-4" aria-hidden="true" />
            </span>
            <div>
              <DialogTitle className="text-[16px] font-semibold">
                导出非敏感 CSV 数据
              </DialogTitle>
              <DialogDescription className="text-[12.5px] text-[var(--text-secondary)]">
                导出 UTF-8 BOM CSV
                并自动防护电子表格公式注入；不含密码、手机号与备注。
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <label className="block space-y-1.5 text-[13px]">
            <span className="font-medium text-[var(--text-primary)]">
              导出范围
            </span>
            <select
              aria-label="选择导出范围"
              value={scope}
              disabled={busy}
              onChange={(e) => setScope(e.target.value as 'all' | 'filtered')}
              className="h-9.5 w-full rounded-xl border border-[#b9d0ec]/80 bg-white/88 px-3 text-[13px] font-medium text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            >
              <option value="all">全部未删除账号（含归档）</option>
              <option value="filtered">当前筛选条件下的全部账号</option>
            </select>
          </label>
          <p className="rounded-xl border border-white/80 bg-white/55 px-3 py-2 text-[12px] leading-5 text-[var(--text-secondary)]">
            每次导出均自动写入防篡改审计日志，不暴露密码、手机号、备注、TOTP
            密钥或会话凭据。
          </p>
        </div>

        <DialogFooter className="gap-2 pt-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onOpenChange(false)}
            className="inline-flex h-9 items-center rounded-xl border border-white/88 bg-white/78 px-4 text-[13px] font-medium text-[var(--text-primary)] hover:bg-white"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirmExport(scope)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-semibold text-white hover:bg-[var(--accent-hover)] disabled:opacity-55"
          >
            <Download className="size-3.5" aria-hidden="true" />
            <span>{busy ? '正在生成…' : '下载 CSV'}</span>
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
