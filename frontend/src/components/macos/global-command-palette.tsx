import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AppWindow,
  ArrowUpDown,
  BarChart3,
  Database,
  FileText,
  Filter,
  Lock,
  Mail,
  MailCheck,
  Plus,
  Search,
  Settings,
  SlidersHorizontal,
  Tag,
  Trash2,
} from 'lucide-react';
import { accountsList, type AccountSummary } from '@/api/generated';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { BUILTIN_ACCOUNT_VIEWS } from '@/features/accounts/saved-views';
import { cn } from '@/lib/utils';
import { StatusPill } from './status-pill';

export type CommandPaletteAction = {
  id: string;
  group: '快捷操作' | '智能筛选视图' | '页面导航' | '外观偏好';
  label: string;
  hint?: string;
  keywords?: string;
  icon: typeof Mail;
  onSelect: () => void;
};

export function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function GlobalCommandPalette({
  open,
  onOpenChange,
  onOpenAccount,
  onCreateAccount,
  onOpenTagManager,
  onApplyViewQuery,
  onNavigateHref,
  onToggleCompactMode,
  onToggleFlowingBg,
  onLockSession,
}: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onOpenAccount: (account: AccountSummary) => void;
  onCreateAccount: () => void;
  onOpenTagManager: () => void;
  onApplyViewQuery: (query: Record<string, string>) => void;
  onNavigateHref: (href: string) => void;
  onToggleCompactMode: () => void;
  onToggleFlowingBg: () => void;
  onLockSession: () => void;
}) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setDebouncedQuery('');
      setActiveIndex(0);
      return;
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setDebouncedQuery('');
      return;
    }
    const timer = window.setTimeout(() => setDebouncedQuery(trimmed), 200);
    return () => window.clearTimeout(timer);
  }, [query]);

  const accountsSearch = useQuery({
    queryKey: ['cmdk-accounts', debouncedQuery],
    enabled: open && debouncedQuery.length >= 1,
    queryFn: async ({ signal }) =>
      (
        await accountsList({
          query: { search: debouncedQuery, page: 1, page_size: 8 },
          signal,
          throwOnError: true,
        })
      ).data,
  });

  const staticCommands: CommandPaletteAction[] = useMemo(
    () => [
      {
        id: 'act:new-account',
        group: '快捷操作',
        label: '新建 Gmail 账号',
        hint: '打开创建表单',
        keywords: 'create add new account 新建 添加',
        icon: Plus,
        onSelect: onCreateAccount,
      },
      {
        id: 'act:tags',
        group: '快捷操作',
        label: '管理 / 新增标签',
        hint: '打开标签管理弹窗',
        keywords: 'tag label 标签',
        icon: Tag,
        onSelect: onOpenTagManager,
      },
      {
        id: 'act:lock',
        group: '快捷操作',
        label: '立即锁定会话',
        hint: '清除内存缓存并返回登录',
        keywords: 'lock logout 安全 锁定 退出',
        icon: Lock,
        onSelect: onLockSession,
      },
      ...BUILTIN_ACCOUNT_VIEWS.map((view) => ({
        id: `view:${view.id}`,
        group: '智能筛选视图' as const,
        label: `筛选：${view.name}`,
        hint: view.description,
        keywords: `${view.name} ${view.description ?? ''} filter view 筛选`,
        icon: Filter,
        onSelect: () => onApplyViewQuery(view.query),
      })),
      {
        id: 'nav:dashboard',
        group: '页面导航',
        label: '前往：数据概览与风险待办',
        keywords: 'dashboard chart overview 概览 统计 图表',
        icon: BarChart3,
        onSelect: () => onNavigateHref('/accounts?view=chart'),
      },
      {
        id: 'nav:accounts',
        group: '页面导航',
        label: '前往：全部账号列表',
        keywords: 'accounts list 账号 列表',
        icon: Mail,
        onSelect: () => onNavigateHref('/accounts'),
      },
      {
        id: 'nav:apps',
        group: '页面导航',
        label: '前往：第三方已注册应用',
        keywords: 'apps claude chatgpt 应用 领号',
        icon: AppWindow,
        onSelect: () => onNavigateHref('/apps'),
      },
      {
        id: 'nav:recovery',
        group: '页面导航',
        label: '前往：辅助邮箱统计与治理',
        keywords: 'recovery email 辅助邮箱 关联',
        icon: MailCheck,
        onSelect: () => onNavigateHref('/recovery-emails'),
      },
      {
        id: 'nav:trash',
        group: '页面导航',
        label: '前往：回收站',
        keywords: 'trash deleted 回收站 已删除',
        icon: Trash2,
        onSelect: () => onNavigateHref('/accounts?deleted=true'),
      },
      {
        id: 'nav:transfer',
        group: '页面导航',
        label: '前往：CSV 导入与加密导出',
        keywords: 'csv import export gmenc 导入 导出',
        icon: ArrowUpDown,
        onSelect: () => onNavigateHref('/transfers/csv'),
      },
      {
        id: 'nav:audit',
        group: '页面导航',
        label: '前往：防篡改审计日志',
        keywords: 'audit log 审计 日志',
        icon: FileText,
        onSelect: () => onNavigateHref('/settings/audit'),
      },
      {
        id: 'nav:backup',
        group: '页面导航',
        label: '前往：备份与恢复状态',
        keywords: 'backup restore 备份 恢复',
        icon: Database,
        onSelect: () => onNavigateHref('/settings/backup'),
      },
      {
        id: 'nav:settings',
        group: '页面导航',
        label: '前往：系统安全设置',
        keywords: 'settings security totp passkey 设置 安全',
        icon: Settings,
        onSelect: () => onNavigateHref('/settings/security'),
      },
      {
        id: 'pref:compact',
        group: '外观偏好',
        label: '切换：紧凑界面密度',
        keywords: 'compact density 紧凑 密度',
        icon: SlidersHorizontal,
        onSelect: onToggleCompactMode,
      },
      {
        id: 'pref:bg',
        group: '外观偏好',
        label: '切换：桌面流动光斑背景',
        keywords: 'background flowing 背景 动画',
        icon: SlidersHorizontal,
        onSelect: onToggleFlowingBg,
      },
    ],
    [
      onApplyViewQuery,
      onCreateAccount,
      onLockSession,
      onNavigateHref,
      onOpenTagManager,
      onToggleCompactMode,
      onToggleFlowingBg,
    ],
  );

  const matchedCommands = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return staticCommands;
    return staticCommands.filter((cmd) => {
      const hay =
        `${cmd.label} ${cmd.hint ?? ''} ${cmd.keywords ?? ''}`.toLowerCase();
      return hay.includes(term);
    });
  }, [query, staticCommands]);

  const matchedAccounts = debouncedQuery
    ? (accountsSearch.data?.items ?? [])
    : [];

  type FlatEntry =
    | { kind: 'account'; account: AccountSummary }
    | { kind: 'command'; command: CommandPaletteAction };

  const flatEntries: FlatEntry[] = useMemo(
    () => [
      ...matchedAccounts.map((account): FlatEntry => ({
        kind: 'account',
        account,
      })),
      ...matchedCommands.map((command): FlatEntry => ({
        kind: 'command',
        command,
      })),
    ],
    [matchedAccounts, matchedCommands],
  );

  useEffect(() => {
    setActiveIndex(0);
  }, [flatEntries.length, query]);

  const executeEntry = (entry: FlatEntry | undefined) => {
    if (!entry) return;
    onOpenChange(false);
    if (entry.kind === 'account') {
      onOpenAccount(entry.account);
    } else {
      entry.command.onSelect();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-slot="global-command-palette"
        className="macos-glass-modal max-w-xl gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-xl"
      >
        <DialogHeader className="sr-only">
          <DialogTitle>全局搜索与快捷命令面板</DialogTitle>
          <DialogDescription>
            输入编号或邮箱秒搜账号，或直接检索并执行系统快捷命令
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2.5 border-b border-[var(--table-divider)] px-4 py-3">
          <Search
            className="size-4 shrink-0 text-[var(--text-secondary)]"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            aria-label="搜索账号或快捷命令"
            placeholder="输入邮箱/编号直达账号，或输入命令（如：新建、无 2FA、领号、锁定）…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setActiveIndex((prev) =>
                  flatEntries.length > 0 ? (prev + 1) % flatEntries.length : 0,
                );
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActiveIndex((prev) =>
                  flatEntries.length > 0
                    ? (prev - 1 + flatEntries.length) % flatEntries.length
                    : 0,
                );
              } else if (e.key === 'Enter' && flatEntries.length > 0) {
                e.preventDefault();
                executeEntry(flatEntries[activeIndex]);
              }
            }}
            maxLength={200}
            className="h-8 min-w-0 flex-1 bg-transparent text-[13.5px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none"
          />
          <kbd className="rounded border border-[var(--border)] bg-[var(--surface-control)] px-1.5 py-0.5 text-[10.5px] font-medium text-[var(--text-secondary)]">
            ESC
          </kbd>
        </div>

        <div
          role="listbox"
          aria-label="命令与账号匹配结果"
          className="macos-thin-scrollbar max-h-[380px] overflow-y-auto p-2"
        >
          {flatEntries.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-[var(--text-secondary)]">
              {accountsSearch.isFetching
                ? '正在检索匹配账号…'
                : '未找到匹配的账号或快捷命令'}
            </p>
          ) : (
            <div className="space-y-2">
              {matchedAccounts.length > 0 && (
                <div>
                  <p className="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
                    匹配账号（回车查看详情）
                  </p>
                  <div className="space-y-0.5">
                    {matchedAccounts.map((acc, idx) => {
                      const active = activeIndex === idx;
                      return (
                        <button
                          key={acc.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() =>
                            executeEntry({ kind: 'account', account: acc })
                          }
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors',
                            active
                              ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                              : 'text-[var(--text-primary)] hover:bg-[var(--surface-control-hover)]',
                          )}
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium">
                              {acc.gmail_email}
                            </p>
                            <p className="truncate text-[11px] text-[var(--text-secondary)]">
                              {acc.account_no}
                              {acc.purpose ? ` · ${acc.purpose}` : ''}
                            </p>
                          </div>
                          <StatusPill status={acc.status} />
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {matchedCommands.length > 0 && (
                <div>
                  <p className="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
                    快捷命令与导航
                  </p>
                  <div className="space-y-0.5">
                    {matchedCommands.map((cmd, cmdOffset) => {
                      const flatIdx = matchedAccounts.length + cmdOffset;
                      const active = activeIndex === flatIdx;
                      const Icon = cmd.icon;
                      return (
                        <button
                          key={cmd.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          onMouseEnter={() => setActiveIndex(flatIdx)}
                          onClick={() =>
                            executeEntry({ kind: 'command', command: cmd })
                          }
                          className={cn(
                            'flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs transition-colors',
                            active
                              ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                              : 'text-[var(--text-primary)] hover:bg-[var(--surface-control-hover)]',
                          )}
                        >
                          <span className="flex min-w-0 items-center gap-2.5">
                            <Icon
                              className="size-4 shrink-0 text-[var(--text-secondary)]"
                              aria-hidden="true"
                            />
                            <span className="truncate font-medium">
                              {cmd.label}
                            </span>
                          </span>
                          {cmd.hint && (
                            <span className="max-w-[46%] truncate text-[11px] text-[var(--text-secondary)]">
                              {cmd.hint}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
