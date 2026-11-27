import { useEffect, useState } from 'react';
import {
  DropdownMenu as DropdownMenuPrimitive,
  Popover as PopoverPrimitive,
} from 'radix-ui';
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Columns3,
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
import { AccountAppPill } from './account-app-pill';
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
  const visibleCount = (
    Object.keys(accountColumnLabels) as AccountColumnKey[]
  ).filter((key) => columns[key]).length;
  const totalCount = Object.keys(accountColumnLabels).length;

  return (
    <div className="flex items-center">
      <PopoverPrimitive.Root>
        <PopoverPrimitive.Trigger asChild>
          <button
            type="button"
            aria-haspopup="dialog"
            className="inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-white/80 bg-white/65 px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:outline-none"
          >
            <Columns3
              className="size-3.5 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <span>显示列</span>
            <span className="rounded-full bg-[var(--surface-control)] px-1.5 py-0.5 text-[10.5px] tabular-nums text-[var(--text-secondary)]">
              {visibleCount}/{totalCount}
            </span>
          </button>
        </PopoverPrimitive.Trigger>
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Content
            align="start"
            sideOffset={6}
            aria-label="表格列显示设置"
            className="macos-glass-modal z-50 w-64 rounded-2xl p-3 text-xs text-[var(--text-primary)] outline-none"
          >
            <p className="mb-2 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
              选择表格显示列（自动本地保存）
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                Object.entries(accountColumnLabels) as [
                  AccountColumnKey,
                  string,
                ][]
              ).map(([key, label]) => (
                <label
                  key={key}
                  className="flex min-h-7 cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-[var(--accent-soft)]"
                >
                  <input
                    type="checkbox"
                    className="size-3.5 rounded accent-[var(--accent)]"
                    checked={columns[key]}
                    onChange={(e) => onToggle(key, e.target.checked)}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </PopoverPrimitive.Content>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </div>
  );
}

function getAriaSort(
  field: AccountSortField,
  currentSort?: string,
): 'ascending' | 'descending' | 'none' {
  if (currentSort === field) return 'ascending';
  if (currentSort === `-${field}`) return 'descending';
  return 'none';
}

function SortableHeader({
  label,
  field,
  currentSort,
  onSort,
  title,
}: {
  label: string;
  field: AccountSortField;
  currentSort?: string;
  onSort?: (nextSort: string) => void;
  title?: string;
}) {
  const isDesc = currentSort === `-${field}`;
  const isAsc = currentSort === field;
  if (!onSort) {
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap">
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
      title={title}
      onClick={() => onSort(isDesc ? field : `-${field}`)}
      className="inline-flex min-h-6 items-center gap-1 rounded-md py-0.5 text-left font-medium whitespace-nowrap text-[var(--text-primary)] transition-colors hover:text-[var(--accent)]"
    >
      <span>{label}</span>
      <Icon
        className={cn(
          'size-3.5 shrink-0',
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
                onSelect={() => {
                  if (account.recovery_email) onCopy(account.recovery_email);
                }}
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
              <>
                <DropdownMenuPrimitive.Item
                  onSelect={() => onOpen(account, false, 'restore')}
                  className={cn(itemClass, 'text-[var(--accent)]')}
                >
                  <RotateCcw className="size-3.5" />
                  <span>恢复</span>
                </DropdownMenuPrimitive.Item>
                <DropdownMenuPrimitive.Item
                  onSelect={() => onOpen(account, false, 'permanent-delete')}
                  className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] text-[var(--danger-text)] outline-none transition-colors data-[highlighted]:bg-[var(--danger-soft)] focus:bg-[var(--danger-soft)]"
                >
                  <Trash2 className="size-3.5" />
                  <span>永久删除</span>
                </DropdownMenuPrimitive.Item>
              </>
            ) : (
              <>
                {account.status === 'archived' ? (
                  <DropdownMenuPrimitive.Item
                    onSelect={() => onOpen(account, false, 'unarchive')}
                    className={cn(itemClass, 'text-[var(--accent-text)]')}
                  >
                    <RotateCcw className="size-3.5" />
                    <span>取消归档</span>
                  </DropdownMenuPrimitive.Item>
                ) : (
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
                  className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] text-[var(--danger-text)] outline-none transition-colors data-[highlighted]:bg-[var(--danger-soft)] focus:bg-[var(--danger-soft)]"
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

const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

function useIsMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return false;
    }
    return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    ) {
      return;
    }
    const media = window.matchMedia(MOBILE_MEDIA_QUERY);
    setIsMobile(media.matches);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  return isMobile;
}

function AccountMobileCardList({
  items,
  deleted,
  busy,
  selected,
  onToggleAll,
  onToggleOne,
  onOpen,
  onCopy,
  onMarkVerified,
  footer,
}: {
  items: AccountSummary[];
  deleted: boolean;
  busy: boolean;
  selected: Record<string, boolean>;
  onToggleAll: (checked: boolean) => void;
  onToggleOne: (id: string, checked: boolean) => void;
  onOpen: (
    account: AccountSummary,
    edit?: boolean,
    action?: AccountAction,
  ) => void;
  onCopy: (value: string) => void;
  onMarkVerified: (account: AccountSummary) => void;
  footer?: React.ReactNode;
}) {
  const selectedCount = items.filter((item) => selected[item.id]).length;
  const [selectionMode, setSelectionMode] = useState(false);
  const showSelection = selectionMode || selectedCount > 0;
  const allChecked = items.length > 0 && selectedCount === items.length;

  return (
    <div
      data-slot="account-mobile-card-list"
      className="macos-glass-panel macos-glass-panel-strong overflow-hidden"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--table-divider)] bg-[var(--surface-table-head)] px-3.5 py-2.5">
        {showSelection ? (
          <label className="inline-flex min-h-8 items-center gap-2 text-xs font-medium text-[var(--text-primary)]">
            <input
              type="checkbox"
              aria-label="选择当前页全部账号"
              checked={allChecked}
              onChange={(e) => onToggleAll(e.target.checked)}
              className="size-4 rounded border-[#b8cce4] accent-[var(--accent)]"
            />
            <span>
              全选当前页{selectedCount > 0 ? `（已选 ${selectedCount}）` : ''}
            </span>
          </label>
        ) : (
          <span className="text-xs font-medium text-[var(--text-secondary)]">
            共 {items.length} 条当前页账号
          </span>
        )}
        <button
          type="button"
          onClick={() => {
            if (showSelection) {
              onToggleAll(false);
              setSelectionMode(false);
            } else {
              setSelectionMode(true);
            }
          }}
          className="inline-flex min-h-8 items-center rounded-lg border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-control-hover)]"
        >
          {showSelection ? '取消选择' : '选择'}
        </button>
      </div>

      <ul
        aria-label={deleted ? '已删除账号列表' : '账号列表'}
        className="divide-y divide-[var(--table-divider)]"
      >
        {items.map((account) => {
          const isSelected = Boolean(selected[account.id]);
          return (
            <li
              key={account.id}
              data-slot="account-mobile-card"
              data-state={isSelected ? 'selected' : undefined}
              className={cn(
                'flex flex-col gap-2.5 px-3.5 py-3 transition-colors',
                isSelected
                  ? 'bg-[var(--table-row-selected)]'
                  : 'bg-transparent',
              )}
            >
              {/* 第一行：多选（可选） + 邮箱 + 复制 + 状态 + 固定更多操作 */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  {showSelection && (
                    <input
                      type="checkbox"
                      aria-label={`选择 ${account.account_no}`}
                      checked={isSelected}
                      onChange={(e) =>
                        onToggleOne(account.id, e.target.checked)
                      }
                      className="size-4 shrink-0 rounded border-[#b8cce4] accent-[var(--accent)]"
                    />
                  )}
                  <GmailMark size="sm" />
                  <button
                    type="button"
                    onClick={() => onOpen(account)}
                    className="min-h-8 min-w-0 flex-1 truncate text-left text-[13.5px] font-semibold text-[var(--text-primary)] hover:text-[var(--accent)]"
                  >
                    {account.gmail_email}
                  </button>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    aria-label={`复制邮箱 ${account.gmail_email}`}
                    onClick={() => onCopy(account.gmail_email)}
                    className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--accent)]"
                  >
                    <Copy className="size-3.5" aria-hidden="true" />
                  </button>
                  <RowActionsMenu
                    account={account}
                    deleted={deleted}
                    busy={busy}
                    onOpen={onOpen}
                    onCopy={onCopy}
                    onMarkVerified={onMarkVerified}
                  />
                </div>
              </div>

              {/* 第二行：状态、2FA、用途与标签 */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                <StatusPill status={account.status} />
                <span className="inline-flex items-center gap-1 rounded-full border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                  {account.two_factor_status === 'enabled' ? (
                    <>
                      <CheckCircle2
                        className="size-3 text-[var(--success)]"
                        aria-hidden="true"
                      />
                      <span className="text-[var(--text-primary)]">
                        2FA 已启用
                      </span>
                    </>
                  ) : account.two_factor_status === 'disabled' ? (
                    <>
                      <MinusCircle className="size-3" aria-hidden="true" />
                      <span>2FA 未启用</span>
                    </>
                  ) : (
                    <>
                      <HelpCircle className="size-3" aria-hidden="true" />
                      <span>2FA 未知</span>
                    </>
                  )}
                </span>
                {account.purpose && (
                  <span className="max-w-[160px] truncate rounded-full border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)]">
                    {account.purpose}
                  </span>
                )}
                {account.tags.slice(0, 2).map((tag) => (
                  <TagPill key={tag.id} name={tag.name} />
                ))}
                {account.tags.length > 2 && (
                  <span className="text-[11px] text-[var(--text-secondary)]">
                    +{account.tags.length - 2}
                  </span>
                )}
              </div>

              {/* 第三行：辅助邮箱（常显复制） + 最后验证 */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                <div className="flex min-w-0 items-center gap-1">
                  <span className="shrink-0">辅助：</span>
                  {account.recovery_email ? (
                    <>
                      <span className="max-w-[170px] truncate text-[var(--text-primary)]/90">
                        {account.recovery_email}
                      </span>
                      <button
                        type="button"
                        aria-label={`复制辅助邮箱 ${account.recovery_email}`}
                        onClick={() =>
                          account.recovery_email &&
                          onCopy(account.recovery_email)
                        }
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--accent)]"
                      >
                        <Copy className="size-3.5" aria-hidden="true" />
                      </button>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                </div>
                <span
                  data-dynamic="timestamp"
                  className="shrink-0 tabular-nums"
                  title={localDate(account.last_verified_at)}
                >
                  验证：{formatActivityDate(account.last_verified_at)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      {footer && (
        <div className="border-t border-[var(--table-divider)] bg-[var(--surface-table-head)] px-3.5 py-3">
          {footer}
        </div>
      )}
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
  const isMobile = useIsMobileViewport();

  if (isPending) {
    return <LoadingState />;
  }

  if (isError) {
    return (
      <EmptyState
        role="alert"
        title="账号加载失败"
        description="检查网络连接与服务状态后重试。"
        onCreate={onRetry}
        createLabel="重试加载"
        actionIcon="refresh"
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
          total > 0
            ? '当前页码超出已有记录范围，请使用下方分页控件切换页面。'
            : deleted
              ? '软删除的 Gmail 账号会保留在这里，支持单条或批量恢复。'
              : '还没有创建任何 Gmail 账号，点击下方按钮开始添加。'
        }
        onCreate={!deleted && total === 0 ? onCreate : undefined}
        onImportCsv={!deleted && total === 0 ? onImportCsv : undefined}
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
          <div className="border-t border-[var(--table-divider)] bg-[var(--surface-table-head)] px-4 py-3">
            {footer}
          </div>
        </div>
      );
    }
    return emptyNode;
  }

  if (isMobile) {
    return (
      <AccountMobileCardList
        items={items}
        deleted={deleted}
        busy={busy}
        selected={selected}
        onToggleAll={onToggleAll}
        onToggleOne={onToggleOne}
        onOpen={onOpen}
        onCopy={onCopy}
        onMarkVerified={onMarkVerified}
        footer={footer}
      />
    );
  }

  const allChecked = items.length > 0 && items.every((a) => selected[a.id]);
  const someChecked = items.some((a) => selected[a.id]);

  return (
    <div
      data-slot="account-table-card"
      className="macos-glass-panel macos-glass-panel-strong overflow-hidden"
    >
      <div className="macos-thin-scrollbar max-h-[calc(100vh-228px)] min-h-[300px] w-full overflow-x-auto overflow-y-auto">
        <table
          aria-label={deleted ? '已删除账号列表' : '账号列表'}
          className="w-full border-collapse text-left text-[12.5px] xl:text-[13px]"
        >
          <thead className="sticky top-0 z-20 border-b border-[var(--table-divider)] bg-[var(--surface-table-head)] backdrop-blur-md">
            <tr className="h-11 text-xs font-semibold text-[var(--text-secondary)]">
              <th className="w-9 pr-1 pl-3 whitespace-nowrap">
                <input
                  type="checkbox"
                  aria-label="选择当前页全部账号"
                  checked={allChecked}
                  ref={(el) => {
                    if (el) el.indeterminate = someChecked && !allChecked;
                  }}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  className="size-4 rounded border-[#b8cce4] accent-[var(--accent)]"
                />
              </th>
              <th
                className="px-2 2xl:px-2.5 whitespace-nowrap"
                aria-sort={getAriaSort('account_no', sort)}
              >
                <SortableHeader
                  label="Gmail 地址"
                  field="account_no"
                  currentSort={sort}
                  onSort={onSort}
                  title="按账号编号排序"
                />
              </th>
              {columns.status && (
                <th className="px-2 2xl:px-2.5 whitespace-nowrap">状态</th>
              )}
              {columns.factor && (
                <th className="px-2 2xl:px-2.5 whitespace-nowrap">二步验证</th>
              )}
              {columns.recovery && (
                <th className="px-2 2xl:px-2.5 whitespace-nowrap">辅助邮箱</th>
              )}
              {columns.apps && (
                <th className="px-2 2xl:px-2.5 whitespace-nowrap">
                  已注册应用
                </th>
              )}
              {columns.purpose && (
                <th className="px-2 2xl:px-2.5 whitespace-nowrap">用途</th>
              )}
              {columns.tags && (
                <th className="px-2 2xl:px-2.5 whitespace-nowrap">标签</th>
              )}
              {columns.verified && (
                <th
                  className="px-2 2xl:px-2.5 whitespace-nowrap"
                  aria-sort={getAriaSort('last_verified_at', sort)}
                >
                  <SortableHeader
                    label="最后验证"
                    field="last_verified_at"
                    currentSort={sort}
                    onSort={onSort}
                  />
                </th>
              )}
              {columns.registered && (
                <th
                  className="px-2 2xl:px-2.5 whitespace-nowrap"
                  aria-sort={getAriaSort('registered_at', sort)}
                >
                  <SortableHeader
                    label="注册时间"
                    field="registered_at"
                    currentSort={sort}
                    onSort={onSort}
                  />
                </th>
              )}
              {columns.updated && (
                <th
                  className="px-2 2xl:px-2.5 whitespace-nowrap"
                  aria-sort={getAriaSort('updated_at', sort)}
                >
                  <SortableHeader
                    label="更新时间"
                    field="updated_at"
                    currentSort={sort}
                    onSort={onSort}
                  />
                </th>
              )}
              <th className="sticky right-0 z-30 w-13 border-l border-[var(--table-divider)] bg-[var(--surface-sticky-cell)] pr-3 pl-2 text-right whitespace-nowrap shadow-[-6px_0_12px_-4px_rgba(15,23,42,0.12)]">
                操作
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((account) => {
              const isSelected = Boolean(selected[account.id]);
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
                  <td className="w-9 pr-1 pl-3">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${account.account_no}`}
                      checked={isSelected}
                      onChange={(e) =>
                        onToggleOne(account.id, e.target.checked)
                      }
                      className="size-4 rounded border-[#b8cce4] accent-[var(--accent)]"
                    />
                  </td>
                  <td className="px-2 2xl:px-2.5 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <GmailMark size="sm" />
                      <button
                        type="button"
                        title={account.gmail_email}
                        onClick={() => onOpen(account)}
                        className="inline-flex min-h-6 max-w-[144px] items-center py-0.5 text-left font-medium text-[var(--text-primary)] underline-offset-4 transition-colors hover:text-[var(--accent)] hover:underline min-[1360px]:max-w-[200px] 2xl:max-w-[235px]"
                      >
                        <span className="block truncate">
                          {account.gmail_email}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`复制邮箱 ${account.gmail_email}`}
                        onClick={() => onCopy(account.gmail_email)}
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] opacity-100 transition-opacity focus-visible:opacity-100 hover:bg-white/80 hover:text-[var(--accent)] [@media(hover:hover)]:md:opacity-0 [@media(hover:hover)]:md:group-hover:opacity-100 [@media(hover:hover)]:md:focus-visible:opacity-100"
                      >
                        <Copy className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                  {columns.status && (
                    <td className="px-2 2xl:px-2.5 whitespace-nowrap">
                      <StatusPill status={account.status} />
                    </td>
                  )}
                  {columns.factor && (
                    <td className="px-2 2xl:px-2.5 whitespace-nowrap">
                      {account.two_factor_status === 'enabled' ? (
                        <span className="inline-flex items-center gap-1 font-medium text-[var(--text-primary)]">
                          <CheckCircle2
                            className="size-3.5 shrink-0 text-[var(--success)]"
                            aria-hidden="true"
                          />
                          <span>已启用</span>
                        </span>
                      ) : account.two_factor_status === 'disabled' ? (
                        <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                          <MinusCircle
                            className="size-3.5 shrink-0 text-[#98a2b3]"
                            aria-hidden="true"
                          />
                          <span>未启用</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                          <HelpCircle
                            className="size-3.5 shrink-0 text-[#98a2b3]"
                            aria-hidden="true"
                          />
                          <span>未知</span>
                        </span>
                      )}
                    </td>
                  )}
                  {columns.recovery && (
                    <td className="px-2 2xl:px-2.5 whitespace-nowrap text-[var(--text-primary)]/90">
                      {account.recovery_email ? (
                        <div className="flex items-center gap-1">
                          <span
                            className="max-w-[110px] truncate 2xl:max-w-[190px]"
                            title={account.recovery_email}
                          >
                            {account.recovery_email}
                          </span>
                          <button
                            type="button"
                            aria-label={`复制辅助邮箱 ${account.recovery_email}`}
                            onClick={() => {
                              if (account.recovery_email) {
                                onCopy(account.recovery_email);
                              }
                            }}
                            className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] opacity-100 transition-opacity focus-visible:opacity-100 hover:bg-white/80 hover:text-[var(--accent)] [@media(hover:hover)]:md:opacity-0 [@media(hover:hover)]:md:group-hover:opacity-100 [@media(hover:hover)]:md:focus-visible:opacity-100"
                          >
                            <Copy className="size-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      ) : (
                        <span className="text-[var(--text-secondary)]">—</span>
                      )}
                    </td>
                  )}
                  {columns.apps && (
                    <td className="px-2 2xl:px-2.5 whitespace-nowrap">
                      {account.apps && account.apps.length > 0 ? (
                        <div className="flex max-w-[180px] flex-wrap items-center gap-1 2xl:max-w-[230px]">
                          {[...account.apps]
                            .sort((a, b) => {
                              const rank = {
                                banned: 0,
                                restricted: 1,
                                active: 2,
                              };
                              return rank[a.status] - rank[b.status];
                            })
                            .slice(0, 3)
                            .map((app) => (
                              <AccountAppPill
                                key={app.app_id}
                                app={app}
                                compact
                              />
                            ))}
                          {account.apps.length > 3 && (
                            <span className="text-[11px] text-[var(--text-secondary)]">
                              +{account.apps.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[var(--text-secondary)]">—</span>
                      )}
                    </td>
                  )}
                  {columns.purpose && (
                    <td className="px-2 2xl:px-2.5 whitespace-nowrap text-[var(--text-secondary)]">
                      {account.purpose ? (
                        <span
                          className="inline-block max-w-[78px] truncate align-bottom 2xl:max-w-[140px]"
                          title={account.purpose}
                        >
                          {account.purpose}
                        </span>
                      ) : (
                        <span>—</span>
                      )}
                    </td>
                  )}
                  {columns.tags && (
                    <td className="px-2 2xl:px-2.5 whitespace-nowrap">
                      <div className="flex max-w-[104px] flex-wrap items-center gap-1 2xl:max-w-[142px]">
                        {account.tags.slice(0, 2).map((tag) => (
                          <TagPill key={tag.id} name={tag.name} />
                        ))}
                        {account.status === 'archived' &&
                          !account.tags.some((t) =>
                            t.name.includes('归档'),
                          ) && <TagPill name="已归档" tone="gray" />}
                        {account.tags.length > 2 && (
                          <span className="text-[11px] text-[var(--text-secondary)]">
                            +{account.tags.length - 2}
                          </span>
                        )}
                      </div>
                    </td>
                  )}
                  {columns.verified && (
                    <td
                      data-dynamic="timestamp"
                      className="px-2 2xl:px-2.5 whitespace-nowrap tabular-nums text-[var(--text-primary)]/90"
                      title={localDate(account.last_verified_at)}
                    >
                      {formatActivityDate(account.last_verified_at)}
                    </td>
                  )}
                  {columns.registered && (
                    <td
                      data-dynamic="timestamp"
                      className="px-2 2xl:px-2.5 whitespace-nowrap tabular-nums text-[var(--text-secondary)]"
                      title={localDate(account.registered_at)}
                    >
                      {formatShortDate(account.registered_at)}
                    </td>
                  )}
                  {columns.updated && (
                    <td
                      data-dynamic="timestamp"
                      className="px-2 2xl:px-2.5 whitespace-nowrap tabular-nums text-[var(--text-secondary)]"
                    >
                      {localDate(account.updated_at)}
                    </td>
                  )}
                  <td className="sticky right-0 z-10 border-l border-[var(--table-divider)] bg-[var(--surface-sticky-cell)] pr-3 pl-2 text-right whitespace-nowrap shadow-[-6px_0_12px_-4px_rgba(15,23,42,0.12)]">
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
        <div className="border-t border-[var(--table-divider)] bg-[var(--surface-table-head)] px-4 py-3">
          {footer}
        </div>
      )}
    </div>
  );
}
