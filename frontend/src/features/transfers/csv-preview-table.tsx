import { Fragment, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  ShieldCheck,
  ShieldOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PreviewRow, RowValidationStatus } from './types';

const STATUS_BADGE: Record<
  RowValidationStatus,
  { label: string; className: string; dotClass: string }
> = {
  valid: {
    label: '有效',
    className:
      'border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]',
    dotClass: 'bg-[var(--success)]',
  },
  warning: {
    label: '警告',
    className:
      'border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)]',
    dotClass: 'bg-[var(--warning)]',
  },
  error: {
    label: '错误',
    className:
      'border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]',
    dotClass: 'bg-[var(--danger)]',
  },
};

export function CsvPreviewTable({
  rows,
  totalFiltered,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  selectedRows,
  onToggleRow,
  onTogglePageAll,
  className,
}: {
  rows: readonly PreviewRow[];
  totalFiltered: number;
  page: number;
  pageSize: number;
  onPageChange: (nextPage: number) => void;
  onPageSizeChange: (nextSize: number) => void;
  selectedRows: ReadonlySet<number>;
  onToggleRow: (rowNumber: number) => void;
  onTogglePageAll: (rowNumbers: number[], selectAll: boolean) => void;
  className?: string;
}) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(
    () => new Set<number>(),
  );

  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIndex = totalFiltered === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const endIndex = Math.min(totalFiltered, safePage * pageSize);

  const pageRowNumbers = useMemo(() => rows.map((r) => r.rowNumber), [rows]);
  const allPageSelected =
    rows.length > 0 && rows.every((r) => selectedRows.has(r.rowNumber));
  const somePageSelected =
    rows.some((r) => selectedRows.has(r.rowNumber)) && !allPageSelected;

  const toggleExpand = (rowNumber: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  };

  return (
    <div data-slot="csv-preview-table" className={cn('space-y-3', className)}>
      <div className="macos-thin-scrollbar max-h-[430px] overflow-auto rounded-2xl border border-white/84 bg-white/56 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]">
        <table className="w-full min-w-[880px] border-collapse text-left text-[13px]">
          <thead className="sticky top-0 z-10 border-b border-[var(--table-divider)] bg-[var(--surface-table-head)] text-[11.5px] font-semibold text-[var(--text-secondary)] backdrop-blur-md">
            <tr>
              <th scope="col" className="w-10 px-3 py-2.5 text-center">
                <input
                  type="checkbox"
                  aria-label="全选当前页记录"
                  checked={allPageSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = somePageSelected;
                  }}
                  disabled={rows.length === 0}
                  onChange={(e) =>
                    onTogglePageAll(pageRowNumbers, e.target.checked)
                  }
                  className="size-4 rounded border-[#9bb8dc] accent-[var(--accent)]"
                />
              </th>
              <th scope="col" className="w-16 px-2.5 py-2.5">
                行号
              </th>
              <th scope="col" className="w-24 px-2.5 py-2.5">
                导入状态
              </th>
              <th scope="col" className="px-3 py-2.5">
                Gmail 地址
              </th>
              <th scope="col" className="px-3 py-2.5">
                辅助邮箱
              </th>
              <th scope="col" className="px-3 py-2.5">
                手机号
              </th>
              <th scope="col" className="w-24 px-2.5 py-2.5">
                账号状态
              </th>
              <th scope="col" className="w-24 px-2.5 py-2.5">
                二步验证
              </th>
              <th scope="col" className="min-w-[210px] px-3 py-2.5">
                校验信息
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[var(--table-divider)]">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-10 text-center text-[13px] text-[var(--text-secondary)]"
                >
                  当前筛选条件下暂无匹配的数据行。
                </td>
              </tr>
            ) : (
              rows.map((row) => {
                const badge = STATUS_BADGE[row.status];
                const isSelected = selectedRows.has(row.rowNumber);
                const hasDetails = row.issues.length > 0;
                const isExpanded =
                  hasDetails && expandedRows.has(row.rowNumber);

                return (
                  <Fragment key={row.rowNumber}>
                    <tr
                      data-row-status={row.status}
                      className={cn(
                        'transition-colors duration-150',
                        isSelected
                          ? 'bg-[var(--table-row-selected)]'
                          : row.status === 'error'
                            ? 'bg-[var(--badge-red-bg)]/45 hover:bg-[var(--badge-red-bg)]/70'
                            : row.status === 'warning'
                              ? 'bg-[var(--badge-orange-bg)]/35 hover:bg-[var(--badge-orange-bg)]/60'
                              : 'hover:bg-white/62',
                      )}
                    >
                      <td className="px-3 py-2.5 text-center align-middle">
                        <input
                          type="checkbox"
                          aria-label={`选择第 ${row.rowNumber} 行`}
                          checked={isSelected}
                          onChange={() => onToggleRow(row.rowNumber)}
                          className="size-4 rounded border-[#9bb8dc] accent-[var(--accent)]"
                        />
                      </td>

                      <td className="px-2.5 py-2.5 align-middle font-mono text-[12px] tabular-nums text-[var(--text-secondary)]">
                        {row.rowNumber}
                      </td>

                      <td className="px-2.5 py-2.5 align-middle">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium whitespace-nowrap',
                            badge.className,
                          )}
                        >
                          <span
                            aria-hidden="true"
                            className={cn(
                              'size-1.5 rounded-full',
                              badge.dotClass,
                            )}
                          />
                          {badge.label}
                        </span>
                      </td>

                      <td className="max-w-[220px] truncate px-3 py-2.5 align-middle font-medium text-[var(--text-primary)]">
                        <span
                          className={cn(
                            row.status === 'error' &&
                              row.issues.some(
                                (i) => i.field === 'gmail_email',
                              ) &&
                              'text-[var(--danger-text)]',
                          )}
                        >
                          {row.gmailEmail}
                        </span>
                      </td>

                      <td className="max-w-[200px] truncate px-3 py-2.5 align-middle text-[var(--text-secondary)]">
                        {row.recoveryEmail}
                      </td>

                      <td
                        data-slot="preview-phone-masked"
                        className="px-3 py-2.5 align-middle font-mono text-[12px] tabular-nums text-[var(--text-secondary)] whitespace-nowrap"
                      >
                        {row.phoneMasked}
                      </td>

                      <td className="px-2.5 py-2.5 align-middle whitespace-nowrap text-[12.5px] text-[var(--text-primary)]/90">
                        {row.accountStatusLabel}
                      </td>

                      <td className="px-2.5 py-2.5 align-middle whitespace-nowrap">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 text-[12px] font-medium',
                            row.twoFactorStatus === 'enabled'
                              ? 'text-[var(--success-text)]'
                              : row.twoFactorStatus === 'disabled'
                                ? 'text-[var(--warning-text)]'
                                : 'text-[var(--text-secondary)]',
                          )}
                        >
                          {row.twoFactorStatus === 'enabled' ? (
                            <ShieldCheck
                              className="size-3.5 text-[var(--success)]"
                              aria-hidden="true"
                            />
                          ) : row.twoFactorStatus === 'disabled' ? (
                            <ShieldOff
                              className="size-3.5 text-[var(--warning)]"
                              aria-hidden="true"
                            />
                          ) : null}
                          <span>{row.twoFactorLabel}</span>
                        </span>
                      </td>

                      <td className="px-3 py-2.5 align-middle">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              'truncate text-[12.5px]',
                              row.status === 'error'
                                ? 'font-medium text-[var(--danger-text)]'
                                : row.status === 'warning'
                                  ? 'text-[var(--warning-text)]'
                                  : 'text-[var(--text-secondary)]',
                            )}
                          >
                            {row.validationMessage}
                          </span>
                          {hasDetails && (
                            <button
                              type="button"
                              aria-expanded={isExpanded}
                              aria-label={`${isExpanded ? '收起' : '展开'}第 ${row.rowNumber} 行详细问题`}
                              onClick={() => toggleExpand(row.rowNumber)}
                              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-lg border border-white/85 bg-white/75 px-2 text-[11.5px] font-medium text-[var(--accent)] transition-colors hover:bg-white"
                            >
                              <span>{isExpanded ? '收起' : '展开'}</span>
                              {isExpanded ? (
                                <ChevronUp
                                  className="size-3"
                                  aria-hidden="true"
                                />
                              ) : (
                                <ChevronDown
                                  className="size-3"
                                  aria-hidden="true"
                                />
                              )}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr
                        data-slot="preview-row-detail"
                        className="bg-white/75"
                      >
                        <td colSpan={9} className="px-6 py-3">
                          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-table-head)] p-3">
                            <p className="mb-2 text-[12px] font-semibold text-[var(--text-primary)]">
                              第 {row.rowNumber} 行字段校验明细（共{' '}
                              {row.issues.length} 项）
                            </p>
                            <ul className="space-y-2">
                              {row.issues.map((issue, idx) => (
                                <li
                                  key={`${row.rowNumber}-${issue.field}-${idx}`}
                                  className="flex items-start gap-2 text-[12px] leading-5"
                                >
                                  {issue.severity === 'error' ? (
                                    <AlertCircle
                                      className="mt-0.5 size-3.5 shrink-0 text-[var(--danger)]"
                                      aria-hidden="true"
                                    />
                                  ) : (
                                    <AlertTriangle
                                      className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]"
                                      aria-hidden="true"
                                    />
                                  )}
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      <span className="font-semibold text-[var(--text-primary)]">
                                        {issue.fieldLabel}
                                      </span>
                                      {issue.columnLetter && (
                                        <span className="rounded bg-white/90 px-1.5 py-0.5 font-mono text-[10.5px] text-[var(--text-secondary)] ring-1 ring-[var(--border)]">
                                          {issue.columnLetter} 列
                                        </span>
                                      )}
                                      <span
                                        className={cn(
                                          'font-medium',
                                          issue.severity === 'error'
                                            ? 'text-[var(--danger-text)]'
                                            : 'text-[var(--warning-text)]',
                                        )}
                                      >
                                        {issue.reason}
                                      </span>
                                    </div>
                                    {issue.suggestion && (
                                      <p className="mt-0.5 text-[11.5px] text-[var(--text-secondary)]">
                                        修复建议：{issue.suggestion}
                                      </p>
                                    )}
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* 分页与每页数量控制 */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[12.5px] text-[var(--text-secondary)]">
        <div className="flex flex-wrap items-center gap-3 tabular-nums">
          <span>
            显示第{' '}
            <strong className="font-semibold text-[var(--text-primary)]">
              {startIndex.toLocaleString('en-US')}–
              {endIndex.toLocaleString('en-US')}
            </strong>{' '}
            条，共{' '}
            <strong className="font-semibold text-[var(--text-primary)]">
              {totalFiltered.toLocaleString('en-US')}
            </strong>{' '}
            条
          </span>
          {selectedRows.size > 0 && (
            <span className="rounded-full bg-[var(--badge-blue-bg)] px-2.5 py-0.5 text-[11.5px] font-medium text-[var(--badge-blue-text)]">
              已勾选 {selectedRows.size} 行（导出预览时将仅导出所选行）
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label className="inline-flex items-center gap-1.5">
            <span>每页</span>
            <select
              aria-label="每页显示数量"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-8 rounded-lg border border-[#b9d0ec]/80 bg-white/82 px-2 text-[12px] font-medium text-[var(--text-primary)] focus:border-[var(--accent)] focus:outline-none"
            >
              <option value={10}>10 条</option>
              <option value={20}>20 条</option>
              <option value={50}>50 条</option>
              <option value={100}>100 条</option>
            </select>
          </label>

          <div
            role="navigation"
            aria-label="预览表格分页"
            className="flex items-center gap-1"
          >
            <button
              type="button"
              aria-label="第一页"
              disabled={safePage <= 1}
              onClick={() => onPageChange(1)}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-white/85 bg-white/70 text-[var(--text-primary)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronsLeft className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="上一页"
              disabled={safePage <= 1}
              onClick={() => onPageChange(safePage - 1)}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-white/85 bg-white/70 text-[var(--text-primary)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft className="size-3.5" aria-hidden="true" />
            </button>
            <span className="px-2 font-medium tabular-nums text-[var(--text-primary)]">
              第 {safePage} / {totalPages} 页
            </span>
            <button
              type="button"
              aria-label="下一页"
              disabled={safePage >= totalPages}
              onClick={() => onPageChange(safePage + 1)}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-white/85 bg-white/70 text-[var(--text-primary)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronRight className="size-3.5" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="最后一页"
              disabled={safePage >= totalPages}
              onClick={() => onPageChange(totalPages)}
              className="inline-flex size-8 items-center justify-center rounded-lg border border-white/85 bg-white/70 text-[var(--text-primary)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronsRight className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
