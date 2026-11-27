import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  FileText,
  RotateCcw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsCardShell } from './settings-card-shell';
import type {
  AuditLogEntry,
  AuditObjectType,
  AuditTimeRange,
  CardStateMode,
} from './types';

function escapeAuditCsvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function exportFilteredAuditCsv(entries: AuditLogEntry[]): void {
  const header = [
    '序号',
    '时间',
    '事件名称',
    '事件代码',
    '对象类型',
    '对象摘要',
    '结果',
    'IP 地址',
    '链哈希摘要',
  ];
  const lines = [
    header.join(','),
    ...entries.map((item) =>
      [
        `#${item.seq}`,
        item.createdAt,
        item.eventLabel,
        item.eventType,
        item.objectType,
        item.objectLabel,
        item.result === 'success' ? '成功' : '失败',
        item.ipAddress,
        item.hashShort ?? '',
      ]
        .map(escapeAuditCsvCell)
        .join(','),
    ),
  ];
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8',
  });
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `gmailfile-audit-filtered-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const OBJECT_TYPE_OPTIONS: readonly {
  value: AuditObjectType;
  label: string;
}[] = [
  { value: 'all', label: '全部对象' },
  { value: 'session', label: '管理员会话' },
  { value: 'account', label: 'Gmail 账号' },
  { value: 'backup', label: '加密备份' },
  { value: 'export', label: 'CSV 导出' },
  { value: 'settings', label: '系统配置' },
];

const TIME_RANGE_OPTIONS: readonly { value: AuditTimeRange; label: string }[] =
  [
    { value: 'all', label: '全部时间' },
    { value: '24h', label: '最近 24 小时' },
    { value: '7d', label: '最近 7 天' },
    { value: '30d', label: '最近 30 天' },
  ];

export function AuditLogCard({
  entries,
  state = 'ready',
  errorText,
  maxRows = 6,
  expanded = false,
  onViewFullLog,
  onRetry,
}: {
  entries: AuditLogEntry[];
  state?: CardStateMode;
  errorText?: string | null;
  maxRows?: number;
  expanded?: boolean;
  onViewFullLog?: () => void;
  onRetry?: () => void;
}) {
  const [timeRange, setTimeRange] = useState<AuditTimeRange>('all');
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [objectFilter, setObjectFilter] = useState<AuditObjectType>('all');
  const [keyword, setKeyword] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(
    null,
  );

  const eventOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const entry of entries) {
      if (!seen.has(entry.eventLabel)) {
        seen.set(entry.eventLabel, entry.eventLabel);
      }
    }
    return Array.from(seen.values());
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const now = Date.now();
    const maxAgeMs =
      timeRange === '24h'
        ? 24 * 3600_000
        : timeRange === '7d'
          ? 7 * 24 * 3600_000
          : timeRange === '30d'
            ? 30 * 24 * 3600_000
            : null;
    const q = keyword.trim().toLowerCase();

    return entries.filter((entry) => {
      if (maxAgeMs !== null) {
        const ts = Date.parse(entry.createdAtIso);
        if (Number.isFinite(ts) && now - ts > maxAgeMs) return false;
      }
      if (eventFilter !== 'all' && entry.eventLabel !== eventFilter) {
        return false;
      }
      if (objectFilter !== 'all' && entry.objectType !== objectFilter) {
        return false;
      }
      if (q) {
        const haystack =
          `${entry.eventLabel} ${entry.objectLabel} ${entry.ipAddress} ${entry.createdAt}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [entries, eventFilter, keyword, objectFilter, timeRange]);

  const hasActiveFilters =
    timeRange !== 'all' ||
    eventFilter !== 'all' ||
    objectFilter !== 'all' ||
    keyword.trim().length > 0;

  const visibleEntries = filteredEntries.slice(0, maxRows);

  const resetFilters = () => {
    setTimeRange('all');
    setEventFilter('all');
    setObjectFilter('all');
    setKeyword('');
  };

  return (
    <SettingsCardShell
      id="settings-card-audit-log"
      title="审计日志"
      subtitle="关键登录、凭据操作、备份与导出记录（防篡改哈希链）"
      icon={<FileText className="size-4" />}
      state={state}
      loadingText="正在读取审计日志…"
      errorText={errorText ?? '无法读取审计日志，请手动重试。'}
      emptyTitle="暂无审计日志"
      emptyDescription="系统尚未产生可检索的审计记录。"
      onRetry={onRetry}
      headerRight={
        <div className="flex flex-wrap items-center gap-1.5">
          {expanded && (
            <button
              type="button"
              disabled={filteredEntries.length === 0}
              onClick={() => exportFilteredAuditCsv(filteredEntries)}
              className="inline-flex h-8 items-center gap-1 rounded-xl border border-white/85 bg-white/75 px-2.5 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Download
                className="size-3.5 text-[var(--accent)]"
                aria-hidden="true"
              />
              <span>导出筛选 CSV</span>
            </button>
          )}
          {onViewFullLog && (
            <button
              type="button"
              onClick={onViewFullLog}
              className="inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-[12.5px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-soft)]"
            >
              <span>查看完整日志</span>
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      }
    >
      {/* 筛选栏：时间范围 / 事件类型 / 对象类型 / 搜索框 */}
      <div
        className={
          expanded
            ? 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4'
            : 'grid grid-cols-1 gap-2 sm:grid-cols-2'
        }
      >
        <select
          aria-label="筛选时间范围"
          value={timeRange}
          onChange={(e) => setTimeRange(e.target.value as AuditTimeRange)}
          className="h-8.5 rounded-xl border border-white/80 bg-white/62 px-2.5 text-[12.5px] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {TIME_RANGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          aria-label="筛选事件类型"
          value={eventFilter}
          onChange={(e) => setEventFilter(e.target.value)}
          className="h-8.5 rounded-xl border border-white/80 bg-white/62 px-2.5 text-[12.5px] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          <option value="all">全部事件</option>
          {eventOptions.map((ev) => (
            <option key={ev} value={ev}>
              {ev}
            </option>
          ))}
        </select>

        <select
          aria-label="筛选对象类型"
          value={objectFilter}
          onChange={(e) => setObjectFilter(e.target.value as AuditObjectType)}
          className="h-8.5 rounded-xl border border-white/80 bg-white/62 px-2.5 text-[12.5px] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          {OBJECT_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <div className="relative flex items-center">
          <Search
            className="pointer-events-none absolute left-2.5 size-3.5 text-[var(--text-secondary)]"
            aria-hidden="true"
          />
          <input
            type="search"
            aria-label="搜索审计日志"
            placeholder="搜索事件、对象或 IP…"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            className="h-8.5 w-full rounded-xl border border-white/80 bg-white/62 pr-2.5 pl-8 text-[12.5px] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] placeholder:text-[var(--text-secondary)] focus:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
          />
        </div>
      </div>

      {visibleEntries.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-white/70 bg-white/40 px-4 py-6 text-center">
          <p className="text-[13px] font-medium text-[var(--text-primary)]">
            没有符合筛选条件的审计记录
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="inline-flex h-7.5 items-center gap-1 rounded-lg border border-white/85 bg-white/75 px-3 text-[12px] font-medium text-[var(--accent)] hover:bg-white"
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              <span>重置筛选</span>
            </button>
          )}
        </div>
      ) : (
        <div className="macos-thin-scrollbar w-full max-w-full overflow-x-auto rounded-2xl border border-white/75 bg-white/44">
          <table
            aria-label="审计日志摘要"
            className="w-full min-w-[480px] border-collapse text-left text-[13px]"
          >
            <thead>
              <tr className="border-b border-[var(--table-divider)] bg-[var(--surface-table-head)] text-[11.5px] font-semibold text-[var(--text-secondary)]">
                <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                  时间
                </th>
                <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                  事件
                </th>
                <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                  对象
                </th>
                <th className="px-3 py-2.5 font-semibold whitespace-nowrap">
                  结果
                </th>
                <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                  IP 地址
                </th>
                <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                  详情
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--table-divider)]">
              {visibleEntries.map((item) => (
                <tr
                  key={item.id}
                  className="transition-colors hover:bg-[var(--table-row-hover)]"
                >
                  <td
                    data-dynamic="timestamp"
                    className="px-3 py-2.5 text-[12px] whitespace-nowrap tabular-nums text-[var(--text-secondary)]"
                  >
                    {item.createdAt}
                  </td>
                  <td className="px-3 py-2.5 font-medium whitespace-nowrap text-[var(--text-primary)]">
                    {item.eventLabel}
                  </td>
                  <td className="max-w-[180px] truncate px-3 py-2.5 text-[12.5px] text-[var(--text-secondary)]">
                    {item.objectLabel}
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    {item.result === 'success' ? (
                      <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--success-text)]">
                        <CheckCircle2
                          className="size-3.5 shrink-0 text-[var(--success)]"
                          aria-hidden="true"
                        />
                        <span>成功</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[12.5px] font-medium text-[var(--danger-text)]">
                        <XCircle
                          className="size-3.5 shrink-0 text-[var(--danger)]"
                          aria-hidden="true"
                        />
                        <span>失败</span>
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono text-[12px] whitespace-nowrap tabular-nums text-[var(--text-secondary)]">
                    {item.ipAddress}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setSelectedEntry(item)}
                      className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-white/80 bg-white/70 px-2 py-0.5 text-[11.5px] font-medium text-[var(--accent-text)] transition-colors hover:bg-white"
                    >
                      <Eye className="size-3" aria-hidden="true" />
                      <span>
                        详情<span className="sr-only"> #{item.seq}</span>
                      </span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={selectedEntry !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedEntry(null);
        }}
      >
        <DialogContent className="macos-glass-modal rounded-[20px] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>审计事件详情</DialogTitle>
            <DialogDescription>
              只读防篡改审计事件元数据（严禁包含密码、手机号或备注明文）。
            </DialogDescription>
          </DialogHeader>
          {selectedEntry && (
            <dl className="grid grid-cols-1 gap-3 rounded-2xl border border-white/75 bg-white/50 p-4 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-[11.5px] text-[var(--text-secondary)]">
                  序列编号
                </dt>
                <dd className="mt-0.5 font-mono font-semibold text-[var(--text-primary)]">
                  #{selectedEntry.seq}
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-[var(--text-secondary)]">
                  发生时间
                </dt>
                <dd className="mt-0.5 tabular-nums text-[var(--text-primary)]">
                  {selectedEntry.createdAt}
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-[var(--text-secondary)]">
                  事件名称
                </dt>
                <dd className="mt-0.5 font-medium text-[var(--text-primary)]">
                  {selectedEntry.eventLabel}
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-[var(--text-secondary)]">
                  事件代码
                </dt>
                <dd className="mt-0.5 font-mono text-[12px] text-[var(--text-secondary)]">
                  {selectedEntry.eventType}
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-[var(--text-secondary)]">
                  结果状态
                </dt>
                <dd className="mt-0.5 font-medium text-[var(--text-primary)]">
                  {selectedEntry.result === 'success' ? '成功' : '失败'}
                </dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-[var(--text-secondary)]">
                  来源 IP 地址
                </dt>
                <dd className="mt-0.5 font-mono text-[12.5px] text-[var(--text-primary)]">
                  {selectedEntry.ipAddress}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[11.5px] text-[var(--text-secondary)]">
                  操作对象摘要
                </dt>
                <dd className="mt-0.5 break-all text-[var(--text-primary)]">
                  {selectedEntry.objectLabel}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-[11.5px] text-[var(--text-secondary)]">
                  SHA-256 哈希链摘要
                </dt>
                <dd className="mt-0.5 flex items-center gap-1.5 font-mono text-[12px] text-[var(--text-primary)]">
                  <ShieldCheck
                    className="size-3.5 shrink-0 text-[var(--success)]"
                    aria-hidden="true"
                  />
                  <span>{selectedEntry.hashShort}</span>
                </dd>
              </div>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </SettingsCardShell>
  );
}
