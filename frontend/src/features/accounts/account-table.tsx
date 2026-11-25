import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Copy,
  Eye,
  HelpCircle,
  MinusCircle,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { AccountSummary } from '@/api/generated';
import {
  EmptyState,
  GmailMark,
  LoadingState,
  StatusPill,
  TagPill,
} from '@/components/macos';
import { cn } from '@/lib/utils';
import {
  accountColumnLabels,
  localDate,
  type AccountAction,
  type AccountColumnKey,
} from './constants';

export type AccountSortField =
  | 'account_no'
  | 'registered_at'
  | 'last_verified_at'
  | 'last_login_at'
  | 'created_at'
  | 'updated_at';

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatActivityDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const targetStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
  const diffDays = Math.round((todayStart - targetStart) / 86400000);
  const timePart = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (diffDays === 0) return `今天 ${timePart}`;
  if (diffDays === 1) return `昨天 ${timePart}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function formatShortDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function ColumnToggle({
  columns,
  onToggle,
}: {
  columns: Record<AccountColumnKey, boolean>;
  onToggle: (key: AccountColumnKey, checked: boolean) => void;
}) {
  return (
    <details className="rounded-xl border border-white/75 bg-white/55 px-3 py-2 text-xs text-[var(--text-primary)]">
      <summary className="cursor-pointer font-medium select-none">
        显示列
      </summary>
      <div className="mt-2.5 flex flex-wrap gap-3">
        {(
          Object.entries(accountColumnLabels) as [AccountColumnKey, string][]
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              className="accent-[var(--accent)]"
              checked={columns[key]}
              onChange={(e) => onToggle(key, e.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
    </details>
  );
}

function SortableHeader({
  label,
  field,
  currentSort,
  onSort,
}: {
  label: string;
  field: AccountSortField;
  currentSort?: string;
  onSort?: (nextSort: string) => void;
}) {
  const isDesc = currentSort === `-${field}`;
  const isAsc = currentSort === field;
  if (!onSort) {
    return (
      <span className="inline-flex items-center gap-1">
        {label}
        <ArrowUpDown
          className="size-3 text-[var(--text-secondary)]/70"
          aria-hidden="true"
        />
      </span>
    );
  }
  const Icon = isAsc ? ArrowUp : isDesc ? ArrowDown : ArrowUpDown;
  return (
    <button
      type="button"
      onClick={() => onSort(isDesc ? field : `-${field}`)}
      className="inline-flex items-center gap-1 rounded-md text-left font-medium text-[var(--text-primary)] transition-colors hover:text-[var(--accent)]"
    >
      <span>{label}</span>
      <Icon
        className={cn(
          'size-3.5',
          isAsc || isDesc
            ? 'text-[var(--accent)]'
            : 'text-[var(--text-secondary)]/70',
        )}
        aria-hidden="true"
      />
    </button>
  );
}

function RowActionsMenu({
  account,
  deleted,
  busy,
  onOpen,
  onCopy,
  onMarkVerified,
}: {
  account: AccountSummary;
  deleted: boolean;
  busy: boolean;
  onOpen: (
    account: AccountSummary,
    edit?: boolean,
    action?: AccountAction,
  ) => void;
  onCopy: (value: string) => void;
  onMarkVerified: (account: AccountSummary) => void;
}) {
  const itemClass =
    'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors data-[highlighted]:bg-[var(--accent-soft)] focus:bg-[var(--accent-soft)]';

  return (
    <div
      className="inline-flex justify-end"
      onClick={(e) => e.stopPropagation()}
    >
      <DropdownMenuPrimitive.Root>
        <DropdownMenuPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label={`更多操作 ${account.gmail_email}`}
            disabled={busy}
            className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-white/75 hover:text-[var(--text-primary)]"
          >
            <MoreHorizontal className="size-4" aria-hidden="true" />
          </button>
        </DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            align="end"
            sideOffset={6}
            aria-label={`${account.gmail_email} 操作菜单`}
            className="macos-glass-modal z-50 w-44 rounded-2xl p-1.5 text-[var(--text-primary)]"
          >
            <DropdownMenuPrimitive.Item
              onSelect={() => onOpen(account)}
              className={itemClass}
            >
              <Eye className="size-3.5 text-[var(--text-secondary)]" />
              <span>查看详情</span>
            </DropdownMenuPrimitive.Item>
            {!deleted && (
              <DropdownMenuPrimitive.Item
                onSelect={() => onOpen(account, true)}
                className={itemClass}
              >
                <Pencil className="size-3.5 text-[var(--text-secondary)]" />
                <span>编辑</span>
              </DropdownMenuPrimitive.Item>
            )}
            <DropdownMenuPrimitive.Item
              onSelect={() => onCopy(account.gmail_email)}
              className={itemClass}
            >
              <Copy className="size-3.5 text-[var(--text-secondary)]" />
              <span>复制邮箱</span>
            </DropdownMenuPrimitive.Item>
            {account.recovery_email && (
              <DropdownMenuPrimitive.Item
                onSelect={() => onCopy(account.recovery_email)}
                className={itemClass}
              >
                <Copy className="size-3.5 text-[var(--text-secondary)]" />
                <span>复制辅助邮箱</span>
              </DropdownMenuPrimitive.Item>
            )}
            {!deleted && (
              <DropdownMenuPrimitive.Item
                onSelect={() => onMarkVerified(account)}
                className={itemClass}
              >
                <CheckCircle2 className="size-3.5 text-[var(--success)]" />
                <span>今天已验证</span>
              </DropdownMenuPrimitive.Item>
            )}
            <DropdownMenuPrimitive.Separator className="my-1 h-px bg-[var(--table-divider)]" />
            {deleted ? (
              <DropdownMenuPrimitive.Item
                onSelect={() => onOpen(account, false, 'restore')}
                className={cn(itemClass, 'text-[var(--accent)]')}
              >
                <RotateCcw className="size-3.5" />
                <span>恢复</span>
              </DropdownMenuPrimitive.Item>
            ) : (
              <>
                {account.status !== 'archived' && (
                  <DropdownMenuPrimitive.Item
                    onSelect={() => onOpen(account, false, 'archive')}
                    className={itemClass}
                  >
                    <Archive className="size-3.5 text-[var(--text-secondary)]" />
                    <span>归档</span>
                  </DropdownMenuPrimitive.Item>
                )}
                <DropdownMenuPrimitive.Item
                  onSelect={() => onOpen(account, false, 'delete')}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] text-[var(--danger)] outline-none transition-colors data-[highlighted]:bg-[var(--danger-soft)] focus:bg-[var(--danger-soft)]"
                >
                  <Trash2 className="size-3.5" />
                  <span>删除</span>
                </DropdownMenuPrimitive.Item>
              </>
            )}
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Root>
    </div>
  );
}

export function AccountTable({
  items,
  total,
  isPending,
  isError,
  deleted,
  busy,
  columns,
  selected,
  sort,
  onSort,
  onToggleAll,
  onToggleOne,
  onOpen,
  onCopy,
  onMarkVerified,
  onCreate,
  onImportCsv,
  onRetry,
  footer,
}: {
  items: AccountSummary[];
  total: number;
  isPending: boolean;
  isError: boolean;
  deleted: boolean;
  busy: boolean;
  columns: Record<AccountColumnKey, boolean>;
  selected: Record<string, boolean>;
  sort?: string;
  onSort?: (nextSort: string) => void;
  onToggleAll: (checked: boolean) => void;
  onToggleOne: (id: string, checked: boolean) => void;
  onOpen: (
    account: AccountSummary,
    edit?: boolean,
    action?: AccountAction,
  ) => void;
  onCopy: (value: string) => void;
  onMarkVerified: (account: AccountSummary) => void;
  onCreate?: () => void;
  onImportCsv?: () => void;
  onRetry?: () => void;
  footer?: React.ReactNode;
}) {
  if (isPending) {
    return <LoadingState />;
  }

  if (isError) {
    return (
      <EmptyState
        title="账号加载失败"
        description="检查网络连接与服务状态后重试。"
        onCreate={onRetry}
        createLabel="重试加载"
      />
    );
  }

  if (!items.length) {
    const emptyNode = (
      <EmptyState
        title={
          total > 0
            ? '这一页没有记录，请返回第一页'
            : deleted
              ? '回收站为空'
              : '暂无账号'
        }
        description={
          deleted
            ? '软删除的 Gmail 账号会保留在这里，可随时逐条恢复。'
            : '还没有创建任何 Gmail 账号，点击下方按钮开始添加。'
        }
        onCreate={!deleted ? onCreate : undefined}
        onImportCsv={!deleted ? onImportCsv : undefined}
        className={
          footer && total > 0
            ? 'rounded-none border-0 bg-transparent shadow-none'
            : undefined
        }
      />
    );
    if (footer && total > 0) {
      return (
        <div
          data-slot="account-table-card"
          className="macos-glass-panel macos-glass-panel-strong overflow-hidden"
        >
          {emptyNode}
          <div className="border-t border-[var(--table-divider)] bg-white/45 px-4 py-3">
            {footer}
          </div>
        </div>
      );
    }
    return emptyNode;
  }

  const allChecked = items.length > 0 && items.every((a) => selected[a.id]);

  return (
    <div
      data-slot="account-table-card"
      className="macos-glass-panel macos-glass-panel-strong overflow-hidden"
    >
      <div className="macos-thin-scrollbar max-h-[540px] w-full overflow-x-auto overflow-y-auto">
        <table
          aria-label={deleted ? '已删除账号列表' : '账号列表'}
          className="w-full min-w-[920px] border-collapse text-left text-[13px]"
        >
          <thead className="sticky top-0 z-20 border-b border-[var(--table-divider)] bg-[#f7fbff]/88 backdrop-blur-md">
            <tr className="h-11 text-xs font-semibold text-[var(--text-secondary)]">
              <th className="w-11 pr-2 pl-4">
                <input
                  type="checkbox"
                  aria-label="选择当前页全部账号"
                  checked={allChecked}
                  disabled={deleted}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  className="size-4 rounded border-[#b8cce4] accent-[var(--accent)]"
                />
              </th>
              <th className="px-3">
                <SortableHeader
                  label="Gmail 地址"
                  field="account_no"
                  currentSort={sort}
                  onSort={onSort}
                />
              </th>
              {columns.status && <th className="px-3">状态</th>}
              {columns.factor && <th className="px-3">双重验证 (2FA)</th>}
              {columns.recovery && <th className="px-3">辅助邮箱</th>}
              {columns.tags && <th className="px-3">标签</th>}
              {columns.verified && (
                <th className="px-3">
                  <SortableHeader
                    label="最后活动"
                    field="last_login_at"
                    currentSort={sort}
                    onSort={onSort}
                  />
                </th>
              )}
              {columns.registered && (
                <th className="px-3">
                  <SortableHeader
                    label="创建时间"
                    field="created_at"
                    currentSort={sort}
                    onSort={onSort}
                  />
                </th>
              )}
              {columns.updated && (
                <th className="px-3">
                  <SortableHeader
                    label="更新时间"
                    field="updated_at"
                    currentSort={sort}
                    onSort={onSort}
                  />
                </th>
              )}
              <th className="w-16 pr-4 pl-2 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((account) => {
              const isSelected = Boolean(selected[account.id]);
              const activityTimestamp =
                account.last_login_at ??
                account.last_verified_at ??
                account.updated_at;
              return (
                <tr
                  key={account.id}
                  data-state={isSelected ? 'selected' : undefined}
                  onClick={(e) => {
                    if (
                      !(e.target as HTMLElement).closest(
                        'button,input,a,summary,details,[role="menu"]',
                      )
                    ) {
                      onOpen(account);
                    }
                  }}
                  className={cn(
                    'group h-12 cursor-pointer border-b border-[var(--table-divider)] transition-colors duration-[160ms] ease-out last:border-b-0',
                    isSelected
                      ? 'bg-[var(--table-row-selected)]'
                      : 'hover:bg-[var(--table-row-hover)]',
                  )}
                >
                  <td className="w-11 pr-2 pl-4">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${account.account_no}`}
                      checked={isSelected}
                      disabled={deleted}
                      onChange={(e) =>
                        onToggleOne(account.id, e.target.checked)
                      }
                      className="size-4 rounded border-[#b8cce4] accent-[var(--accent)]"
                    />
                  </td>
                  <td className="px-3 whitespace-nowrap">
                    <div className="flex items-center gap-2.5">
                      <GmailMark size="sm" />
                      <button
                        type="button"
                        onClick={() => onOpen(account)}
                        className="text-left font-medium text-[var(--text-primary)] underline-offset-4 transition-colors hover:text-[var(--accent)] hover:underline"
                      >
                        {account.gmail_email}
                      </button>
                      <button
                        type="button"
                        aria-label={`复制邮箱 ${account.gmail_email}`}
                        onClick={() => onCopy(account.gmail_email)}
                        className="inline-flex size-6 items-center justify-center rounded-md text-[var(--text-secondary)] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-white/80 hover:text-[var(--accent)]"
                      >
                        <Copy className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                  {columns.status && (
                    <td className="px-3 whitespace-nowrap">
                      <StatusPill status={account.status} />
                    </td>
                  )}
                  {columns.factor && (
                    <td className="px-3 whitespace-nowrap">
                      {account.two_factor_status === 'enabled' ? (
                        <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--text-primary)]">
                          <CheckCircle2
                            className="size-4 text-[var(--success)]"
                            aria-hidden="true"
                          />
                          <span>已启用</span>
                        </span>
                      ) : account.two_factor_status === 'disabled' ? (
                        <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)]">
                          <MinusCircle
                            className="size-4 text-[#98a2b3]"
                            aria-hidden="true"
                          />
                          <span>未启用</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[13px] text-[var(--text-secondary)]">
                          <HelpCircle
                            className="size-4 text-[#98a2b3]"
                            aria-hidden="true"
                          />
                          <span>未知</span>
                        </span>
                      )}
                    </td>
                  )}
                  {columns.recovery && (
                    <td className="px-3 whitespace-nowrap text-[var(--text-primary)]/90">
                      {account.recovery_email ? (
                        <div className="flex items-center gap-1.5">
                          <span
                            className="max-w-48 truncate"
                            title={account.recovery_email}
                          >
                            {account.recovery_email}
                          </span>
                          <button
                            type="button"
                            aria-label={`复制辅助邮箱 ${account.recovery_email}`}
                            onClick={() => onCopy(account.recovery_email)}
                            className="inline-flex size-6 items-center justify-center rounded-md text-[var(--text-secondary)] opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-white/80 hover:text-[var(--accent)]"
                          >
                            <Copy className="size-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[var(--text-secondary)]">—</span>
                      )}
                    </td>
                  )}
                  {columns.tags && (
                    <td className="px-3 whitespace-nowrap">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {account.tags.slice(0, 3).map((tag) => (
                          <TagPill key={tag.id} name={tag.name} />
                        ))}
                        {account.status === 'archived' &&
                          !account.tags.some((t) =>
                            t.name.includes('归档'),
                          ) && <TagPill name="已归档" tone="gray" />}
                        {account.tags.length > 3 && (
                          <span className="text-[11px] text-[var(--text-secondary)]">
                            +{account.tags.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                  )}
                  {columns.verified && (
                    <td
                      className="px-3 whitespace-nowrap tabular-nums text-[var(--text-primary)]/90"
                      title={localDate(activityTimestamp)}
                    >
                      {formatActivityDate(activityTimestamp)}
                    </td>
                  )}
                  {columns.registered && (
                    <td
                      className="px-3 whitespace-nowrap tabular-nums text-[var(--text-secondary)]"
                      title={localDate(account.created_at)}
                    >
                      {formatShortDate(account.created_at)}
                    </td>
                  )}
                  {columns.updated && (
                    <td className="px-3 whitespace-nowrap tabular-nums text-[var(--text-secondary)]">
                      {localDate(account.updated_at)}
                    </td>
                  )}
                  <td className="pr-4 pl-2 text-right whitespace-nowrap">
                    <RowActionsMenu
                      account={account}
                      deleted={deleted}
                      busy={busy}
                      onOpen={onOpen}
                      onCopy={onCopy}
                      onMarkVerified={onMarkVerified}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {footer && (
        <div className="border-t border-[var(--table-divider)] bg-white/45 px-4 py-3">
          {footer}
        </div>
      )}
    </div>
  );
}
