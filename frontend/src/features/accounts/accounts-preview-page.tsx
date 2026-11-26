import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BarChart3, Filter, List, Plus, Search } from 'lucide-react';
import { useInRouterContext, useNavigate, useParams } from 'react-router-dom';
import type {
  AccountCreateWritable,
  AccountDetail,
  AccountSummary,
  TagResponse,
} from '@/api/generated';
import {
  AppWindowShell,
  EmptyState,
  GlassToolbar,
  IconTooltip,
  LoadingState,
  persistDisplaySettings,
  persistNavAlpha,
  PrimarySidebar,
  readDisplaySettings,
  readStoredNavAlpha,
  StatusPill,
  subscribeDisplaySettings,
  subscribeNavAlpha,
  TagPill,
  type DisplaySettingsState,
  type SidebarSectionKey,
  type TopNavKey,
} from '@/components/macos';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { AccountForm } from './account-form';
import { Pagination } from './account-pagination';
import { Summary, type AccountStatsData } from './account-summary';
import { AccountTable } from './account-table';
import { AccountsChartView } from './accounts-chart-view';
import {
  actionLabels,
  defaultVisibleColumns,
  factorLabels,
  localDate,
  statusLabels,
  type AccountAction,
} from './constants';
import {
  createMockAccounts,
  MOCK_COUNTS,
  MOCK_SIDEBAR_TAGS,
  MOCK_TAGS,
} from './mock-fixtures';

interface PreviewRouterProps {
  accountIdParam?: string;
  goAccount?: (id: string) => void;
  goList?: () => void;
}

export function AccountsPreviewPage() {
  const inRouter = useInRouterContext();
  if (inRouter) {
    return <RoutedAccountsPreviewPage />;
  }
  return <AccountsPreviewBody />;
}

function RoutedAccountsPreviewPage() {
  const navigate = useNavigate();
  const params = useParams<{ accountId?: string }>();
  const goAccount = useCallback(
    (id: string) => {
      void navigate({
        pathname: `/preview/accounts/${id}`,
        search: window.location.search,
      });
    },
    [navigate],
  );
  const goList = useCallback(() => {
    void navigate({
      pathname: '/preview/accounts',
      search: window.location.search,
    });
  }, [navigate]);
  return (
    <AccountsPreviewBody
      accountIdParam={params.accountId}
      goAccount={goAccount}
      goList={goList}
    />
  );
}

function AccountsPreviewBody({
  accountIdParam,
  goAccount,
  goList,
}: PreviewRouterProps) {
  const [navAlpha, setNavAlpha] = useState<number>(() => readStoredNavAlpha());
  const [displaySettings, setDisplaySettings] = useState<DisplaySettingsState>(
    () => readDisplaySettings(),
  );
  useEffect(() => subscribeNavAlpha(setNavAlpha), []);
  useEffect(() => subscribeDisplaySettings(setDisplaySettings), []);
  const [accounts, setAccounts] = useState<AccountDetail[]>(() =>
    createMockAccounts(),
  );
  const [tags, setTags] = useState<TagResponse[]>(() => [...MOCK_TAGS]);
  const [section, setSection] = useState<SidebarSectionKey>('all');
  const [activeTagId, setActiveTagId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [twoFaFilter, setTwoFaFilter] = useState('');
  const [archivedFilter, setArchivedFilter] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState('-account_no');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [viewMode, setViewMode] = useState<'list' | 'chart'>('list');
  const [detailId, setDetailId] = useState<string | null>(
    accountIdParam ?? null,
  );
  const [formMode, setFormMode] = useState<'new' | 'edit' | null>(null);
  const [editingAccount, setEditingAccount] = useState<AccountDetail | null>(
    null,
  );
  const [confirmAction, setConfirmAction] = useState<{
    account: AccountDetail;
    action: AccountAction;
  } | null>(null);
  const [tagModalOpen, setTagModalOpen] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [notice, setNotice] = useState('');

  const urlState = new URLSearchParams(window.location.search).get('ui_state');
  const [showShowcase, setShowShowcase] = useState(() => urlState !== 'none');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDetailId(accountIdParam ?? null);
  }, [accountIdParam]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
          return;
        }
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleNavAlphaChange = useCallback((next: number) => {
    setNavAlpha(next);
    persistNavAlpha(next);
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = accounts.filter((account) => {
      const isDeleted = account.deleted_at !== null;
      if (section === 'trash') {
        if (!isDeleted) return false;
      } else {
        if (isDeleted) return false;
        if (section === 'normal' && account.status !== 'normal') return false;
        if (section === 'pending' && account.status !== 'pending_verification')
          return false;
        if (
          section === 'risk' &&
          !['restricted', 'login_failed'].includes(account.status)
        )
          return false;
        if (section === 'disabled' && account.status !== 'disabled')
          return false;
        if (section === 'archived' && account.status !== 'archived')
          return false;
      }
      if (activeTagId && !account.tags.some((t) => t.id === activeTagId))
        return false;
      if (statusFilter && account.status !== statusFilter) return false;
      if (twoFaFilter && account.two_factor_status !== twoFaFilter)
        return false;
      if (archivedFilter === 'true' && account.status !== 'archived')
        return false;
      if (archivedFilter === 'false' && account.status === 'archived')
        return false;
      if (term) {
        const haystack = [
          account.gmail_email,
          account.recovery_email,
          account.purpose ?? '',
          account.notes ?? '',
          account.account_no,
          ...account.tags.map((t) => t.name),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      return true;
    });

    const desc = sort.startsWith('-');
    const field = sort.replace(/^-/, '');
    return [...rows].sort((a, b) => {
      const getKey = (item: AccountDetail) => {
        if (field === 'created_at') return item.created_at;
        if (field === 'last_login_at')
          return item.last_login_at ?? item.updated_at;
        if (field === 'updated_at') return item.updated_at;
        return item.account_no;
      };
      const cmp = getKey(a).localeCompare(getKey(b));
      return desc ? -cmp : cmp;
    });
  }, [
    accounts,
    activeTagId,
    archivedFilter,
    search,
    section,
    sort,
    statusFilter,
    twoFaFilter,
  ]);

  const isUnfilteredAll =
    section === 'all' &&
    !activeTagId &&
    !search.trim() &&
    !statusFilter &&
    !twoFaFilter &&
    !archivedFilter;

  const displayTotal = isUnfilteredAll ? MOCK_COUNTS.all : filtered.length;
  const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize);

  const sidebarCounts = useMemo(() => {
    const addedDelta = Math.max(0, accounts.length - 8);
    const pending = accounts.filter(
      (a) => a.deleted_at === null && a.status === 'pending_verification',
    ).length;
    return {
      all: MOCK_COUNTS.all + addedDelta,
      normal: MOCK_COUNTS.normal + addedDelta,
      pending,
      risk: MOCK_COUNTS.risk,
      disabled: MOCK_COUNTS.disabled,
      archived: MOCK_COUNTS.archived,
      trash: accounts.filter((a) => a.deleted_at !== null).length,
    };
  }, [accounts]);

  const stats: AccountStatsData = {
    all: sidebarCounts.all,
    normal: sidebarCounts.normal,
    pending: sidebarCounts.pending,
    addedThisMonth: MOCK_COUNTS.addedThisMonth,
    risk: sidebarCounts.risk,
    disabled: sidebarCounts.disabled,
    archived: sidebarCounts.archived,
  };

  const sidebarTags = useMemo(
    () =>
      tags.map((tag) => {
        const preset = MOCK_SIDEBAR_TAGS.find((m) => m.id === tag.id);
        return {
          id: tag.id,
          name: tag.name,
          count:
            preset?.count ??
            accounts.filter(
              (a) => !a.deleted_at && a.tags.some((t) => t.id === tag.id),
            ).length,
        };
      }),
    [accounts, tags],
  );

  const activeDetail = detailId
    ? (accounts.find((a) => a.id === detailId) ?? null)
    : null;

  const handleOpenRow = useCallback(
    (account: AccountSummary, edit = false, action?: AccountAction) => {
      const full = accounts.find((a) => a.id === account.id);
      if (!full) return;
      if (action) {
        setConfirmAction({ account: full, action });
        return;
      }
      if (edit) {
        setEditingAccount(full);
        setFormMode('edit');
        return;
      }
      setDetailId(full.id);
      goAccount?.(full.id);
    },
    [accounts, goAccount],
  );

  const handleCloseDetail = useCallback(() => {
    setDetailId(null);
    goList?.();
  }, [goList]);

  const handleSaveForm = useCallback(
    async (body: AccountCreateWritable) => {
      const resolvedTags = tags.filter((t) =>
        (body.tag_ids ?? []).includes(t.id),
      );
      if (formMode === 'edit' && editingAccount) {
        setAccounts((prev) =>
          prev.map((item) =>
            item.id === editingAccount.id
              ? {
                  ...item,
                  gmail_email: body.gmail_email,
                  recovery_email: body.recovery_email_external ?? '',
                  recovery_email_external: body.recovery_email_external ?? null,
                  status: body.status ?? item.status,
                  two_factor_status:
                    body.two_factor_status ?? item.two_factor_status,
                  purpose: body.purpose ?? null,
                  phone: body.phone ?? null,
                  notes: body.notes ?? null,
                  tags: resolvedTags,
                  row_version: item.row_version + 1,
                  updated_at: new Date().toISOString(),
                }
              : item,
          ),
        );
        setNotice(`${editingAccount.gmail_email} 已更新。`);
      } else {
        const nextNum = 101 + accounts.length;
        const created: AccountDetail = {
          id: `acc-${crypto.randomUUID().slice(0, 8)}`,
          account_no: `GM-${String(nextNum).padStart(6, '0')}`,
          gmail_email: body.gmail_email,
          registered_at: body.registered_at ?? new Date().toISOString(),
          recovery_account_id: body.recovery_account_id ?? null,
          recovery_email_external: body.recovery_email_external ?? null,
          recovery_email: body.recovery_email_external ?? '',
          status: body.status ?? 'normal',
          two_factor_status: body.two_factor_status ?? 'enabled',
          purpose: body.purpose ?? null,
          tags: resolvedTags,
          last_login_at: new Date().toISOString(),
          last_verified_at: new Date().toISOString(),
          password_changed_at: null,
          archived_at:
            body.status === 'archived' ? new Date().toISOString() : null,
          deleted_at: null,
          row_version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          phone: body.phone ?? null,
          notes: body.notes ?? null,
        };
        setAccounts((prev) => [created, ...prev]);
        setNotice(`已新建账号 ${created.gmail_email}。`);
      }
      setFormMode(null);
      setEditingAccount(null);
    },
    [accounts.length, editingAccount, formMode, tags],
  );

  const handleConfirmAction = useCallback(() => {
    if (!confirmAction) return;
    const { account, action } = confirmAction;
    const now = new Date().toISOString();
    setAccounts((prev) =>
      prev.map((item) => {
        if (item.id !== account.id) return item;
        if (action === 'archive') {
          return {
            ...item,
            status: 'archived',
            archived_at: now,
            updated_at: now,
            row_version: item.row_version + 1,
          };
        }
        if (action === 'unarchive') {
          return {
            ...item,
            status: 'normal',
            archived_at: null,
            updated_at: now,
            row_version: item.row_version + 1,
          };
        }
        if (action === 'delete') {
          return {
            ...item,
            deleted_at: now,
            updated_at: now,
            row_version: item.row_version + 1,
          };
        }
        if (action === 'restore') {
          return {
            ...item,
            deleted_at: null,
            updated_at: now,
            row_version: item.row_version + 1,
          };
        }
        return item;
      }),
    );
    setNotice(`${account.gmail_email} 已${actionLabels[action]}。`);
    setConfirmAction(null);
  }, [confirmAction]);

  const handleTopNav = useCallback((key: TopNavKey) => {
    if (key === 'dashboard') setViewMode('chart');
    else if (key === 'accounts') setViewMode('list');
    else if (key === 'tags') setTagModalOpen(true);
    else if (key === 'transfer')
      setNotice('导入 / 导出请在登录后进入运维工作区。');
    else if (key === 'audit')
      setNotice('防篡改审计日志可在登录后于审计面板核验哈希链。');
    else if (key === 'settings')
      setNotice('系统与安全设置请在登录后进入安全设置页。');
  }, []);

  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <AppWindowShell
      navAlpha={navAlpha}
      flowingBackground={displaySettings.flowingBackground}
      animationsEnabled={displaySettings.animationsEnabled}
      compactMode={displaySettings.compactMode}
      toolbar={
        <GlassToolbar
          activeNav="accounts"
          navAlpha={navAlpha}
          onNavAlphaChange={handleNavAlphaChange}
          displaySettings={displaySettings}
          onDisplaySettingsChange={(next) => {
            setDisplaySettings(next);
            persistDisplaySettings(next);
          }}
          onSelectNav={handleTopNav}
          onOpenSecurity={() => setNotice('安全设置（预览模式）')}
          onToggleShowcase={() => setShowShowcase((prev) => !prev)}
          showcaseActive={showShowcase}
          onLogout={() => setNotice('当前为预览模式，未创建登录会话。')}
          notifications={notice ? [notice] : []}
          onClearNotifications={() => setNotice('')}
        />
      }
      sidebar={
        <PrimarySidebar
          activeSection={section}
          activeTagId={activeTagId || null}
          counts={sidebarCounts}
          tags={sidebarTags}
          onSelectSection={(next) => {
            setSection(next);
            setActiveTagId('');
            setPage(1);
            setSelected({});
          }}
          onSelectTag={(id) => {
            setActiveTagId((current) => (current === id ? '' : id));
            setPage(1);
            setSelected({});
          }}
          onAddTag={() => setTagModalOpen(true)}
          onOpenDashboard={() => setViewMode('chart')}
          onOpenApps={() => setNotice('已注册应用统计入口（预览模式）')}
          onOpenRecoveryUsage={() => setNotice('辅助邮箱统计入口（预览模式）')}
          onOpenTransfer={() => handleTopNav('transfer')}
          onOpenAudit={() => handleTopNav('audit')}
          onOpenBackup={() => setNotice('备份与恢复入口（预览模式）')}
          onOpenSettings={() => handleTopNav('settings')}
        />
      }
    >
      {/* 主标题与工具区 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-[var(--text-primary)]">
            账号管理
          </h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            集中管理 Gmail 账号资料、凭据、辅助邮箱与使用状态
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-3 size-4 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <input
              ref={searchRef}
              type="search"
              aria-label="搜索账号"
              placeholder="搜索邮箱、辅助邮箱或备注"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="h-9 w-56 rounded-xl border border-white/80 bg-white/65 pr-11 pl-9 text-[13px] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-md transition-all duration-[180ms] ease-out placeholder:text-[var(--text-secondary)] focus:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:w-64"
            />
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute right-2.5 rounded-md border border-[var(--border)] bg-white/80 px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
            >
              ⌘K
            </kbd>
          </div>

          <IconTooltip label={filtersOpen ? '收起筛选条件' : '展开筛选条件'}>
            <button
              type="button"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((o) => !o)}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-medium transition-all duration-[180ms] ease-out',
                filtersOpen || statusFilter || twoFaFilter || archivedFilter
                  ? 'border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-text)]'
                  : 'border-white/80 bg-white/65 text-[var(--text-primary)] hover:-translate-y-[1px] hover:bg-white/85',
              )}
            >
              <Filter className="size-3.5" aria-hidden="true" />
              <span>筛选</span>
            </button>
          </IconTooltip>

          <div
            role="group"
            aria-label="视图切换"
            className="inline-flex h-9 items-center rounded-xl border border-white/80 bg-white/60 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
          >
            <IconTooltip label="列表视图">
              <button
                type="button"
                aria-label="列表视图"
                aria-pressed={viewMode === 'list'}
                onClick={() => setViewMode('list')}
                className={cn(
                  'inline-flex size-8 items-center justify-center rounded-[10px] transition-all duration-[160ms] ease-out',
                  viewMode === 'list'
                    ? 'bg-[var(--accent)] text-[var(--primary-foreground)] shadow-[0_4px_12px_rgba(22,119,255,0.28)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                <List className="size-4" aria-hidden="true" />
              </button>
            </IconTooltip>
            <IconTooltip label="图表视图">
              <button
                type="button"
                aria-label="图表视图"
                aria-pressed={viewMode === 'chart'}
                onClick={() => setViewMode('chart')}
                className={cn(
                  'inline-flex size-8 items-center justify-center rounded-[10px] transition-all duration-[160ms] ease-out',
                  viewMode === 'chart'
                    ? 'bg-[var(--accent)] text-[var(--primary-foreground)] shadow-[0_4px_12px_rgba(22,119,255,0.28)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                <BarChart3 className="size-4" aria-hidden="true" />
              </button>
            </IconTooltip>
          </div>

          <button
            type="button"
            onClick={() => {
              setEditingAccount(null);
              setFormMode('new');
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--primary-foreground)] shadow-[0_8px_20px_rgba(22,119,255,0.28)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-[var(--accent-hover)]"
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>新建账号</span>
          </button>
        </div>
      </div>

      {/* 5 张统计卡片 */}
      <Summary
        stats={stats}
        activeSection={section}
        onSelectSection={(next) => {
          setSection(next);
          setActiveTagId('');
          setPage(1);
        }}
      />

      {/* 筛选栏 */}
      {filtersOpen && (
        <section
          aria-label="筛选条件"
          className="macos-glass-panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
            <span>状态</span>
            <NativeSelect
              aria-label="筛选状态"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-9 rounded-xl border-white/80 bg-white/75 text-[13px]"
            >
              <option value="">全部</option>
              {Object.entries(statusLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
            <span>双重验证 (2FA)</span>
            <NativeSelect
              aria-label="筛选二步验证"
              value={twoFaFilter}
              onChange={(e) => setTwoFaFilter(e.target.value)}
              className="h-9 rounded-xl border-white/80 bg-white/75 text-[13px]"
            >
              <option value="">全部</option>
              {Object.entries(factorLabels).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </NativeSelect>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
            <span>归档状态</span>
            <NativeSelect
              aria-label="归档条件"
              value={archivedFilter}
              onChange={(e) => setArchivedFilter(e.target.value)}
              className="h-9 rounded-xl border-white/80 bg-white/75 text-[13px]"
            >
              <option value="">全部</option>
              <option value="false">不含归档</option>
              <option value="true">仅归档</option>
            </NativeSelect>
          </label>
          <div className="flex items-end">
            <Button
              variant="outline"
              size="sm"
              className="h-9 w-full rounded-xl border-white/80 bg-white/75"
              onClick={() => {
                setStatusFilter('');
                setTwoFaFilter('');
                setArchivedFilter('');
                setActiveTagId('');
                setSearch('');
                setSection('all');
              }}
            >
              重置筛选
            </Button>
          </div>
        </section>
      )}

      {notice && (
        <p
          role="status"
          className="macos-glass-panel px-4 py-2.5 text-xs font-medium text-[var(--text-primary)]"
        >
          {notice}
        </p>
      )}

      {/* 列表或图表视图 */}
      {viewMode === 'chart' ? (
        <AccountsChartView stats={stats} items={filtered} />
      ) : (
        <AccountTable
          items={urlState === 'empty' ? [] : pageItems}
          total={displayTotal}
          isPending={urlState === 'loading'}
          isError={false}
          deleted={section === 'trash'}
          busy={false}
          columns={defaultVisibleColumns}
          selected={selected}
          sort={sort}
          onSort={setSort}
          onToggleAll={(checked) =>
            setSelected(
              checked
                ? Object.fromEntries(pageItems.map((i) => [i.id, true]))
                : {},
            )
          }
          onToggleOne={(id, checked) =>
            setSelected((cur) => ({ ...cur, [id]: checked }))
          }
          onOpen={handleOpenRow}
          onCopy={(value) => {
            void navigator.clipboard?.writeText(value).catch(() => {});
            setNotice(`已复制 ${value}`);
          }}
          onMarkVerified={(acc) =>
            setNotice(`${acc.gmail_email} 已标记今天验证。`)
          }
          onCreate={() => {
            setEditingAccount(null);
            setFormMode('new');
          }}
          onImportCsv={() => setNotice('导入 CSV（预览模式）')}
          footer={
            <Pagination
              page={page}
              page_size={pageSize}
              total={displayTotal}
              selectedCount={selectedCount}
              change={(values) => {
                if (values.page) setPage(Number(values.page));
                if (values.page_size) {
                  setPageSize(Number(values.page_size));
                  setPage(1);
                }
              }}
            />
          }
        />
      )}

      {/* 状态展示区：空状态与加载状态并列 */}
      {showShowcase && (
        <section
          aria-label="组件状态展示"
          className="grid gap-4 md:grid-cols-2"
        >
          <EmptyState
            onCreate={() => {
              setEditingAccount(null);
              setFormMode('new');
            }}
            onImportCsv={() => setNotice('导入 CSV（预览模式）')}
          />
          <LoadingState />
        </section>
      )}

      {/* 玻璃质感账号详情抽屉（对应 /preview/accounts/:id） */}
      <Sheet
        open={activeDetail !== null}
        onOpenChange={(open) => {
          if (!open) handleCloseDetail();
        }}
      >
        <SheetContent className="macos-glass-modal w-full overflow-y-auto border-l border-white/80 sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>账号详情</SheetTitle>
            <SheetDescription>{activeDetail?.account_no}</SheetDescription>
          </SheetHeader>
          {activeDetail && (
            <div className="space-y-5 px-6 pb-8 text-sm">
              <div>
                <h2 className="text-lg font-semibold break-all text-[var(--text-primary)]">
                  {activeDetail.gmail_email}
                </h2>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <StatusPill status={activeDetail.status} />
                  {activeDetail.tags.map((t) => (
                    <TagPill key={t.id} name={t.name} />
                  ))}
                </div>
              </div>
              <dl className="grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-3">
                <dt className="text-[var(--text-secondary)]">辅助邮箱</dt>
                <dd>{activeDetail.recovery_email || '—'}</dd>
                <dt className="text-[var(--text-secondary)]">双重验证</dt>
                <dd>{factorLabels[activeDetail.two_factor_status]}</dd>
                <dt className="text-[var(--text-secondary)]">用途</dt>
                <dd>{activeDetail.purpose || '—'}</dd>
                <dt className="text-[var(--text-secondary)]">备注</dt>
                <dd>{activeDetail.notes || '—'}</dd>
                <dt className="text-[var(--text-secondary)]">创建时间</dt>
                <dd>{localDate(activeDetail.created_at)}</dd>
                <dt className="text-[var(--text-secondary)]">最后活动</dt>
                <dd>{localDate(activeDetail.last_login_at)}</dd>
              </dl>
              <div className="flex flex-wrap gap-2 border-t border-[var(--table-divider)] pt-4">
                <Button
                  size="sm"
                  onClick={() => {
                    setEditingAccount(activeDetail);
                    handleCloseDetail();
                    setFormMode('edit');
                  }}
                >
                  编辑账号
                </Button>
                {activeDetail.deleted_at ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setConfirmAction({
                        account: activeDetail,
                        action: 'restore',
                      })
                    }
                  >
                    恢复
                  </Button>
                ) : (
                  <>
                    {activeDetail.status === 'archived' ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setConfirmAction({
                            account: activeDetail,
                            action: 'unarchive',
                          })
                        }
                      >
                        取消归档
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setConfirmAction({
                            account: activeDetail,
                            action: 'archive',
                          })
                        }
                      >
                        归档
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() =>
                        setConfirmAction({
                          account: activeDetail,
                          action: 'delete',
                        })
                      }
                    >
                      删除
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* 玻璃质感新建/编辑弹窗 */}
      <Dialog
        open={formMode !== null}
        onOpenChange={(open) => {
          if (!open) {
            setFormMode(null);
            setEditingAccount(null);
          }
        }}
      >
        <DialogContent className="macos-glass-modal flex max-h-[90vh] min-h-0 flex-col overflow-hidden rounded-[22px] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {formMode === 'edit' ? '编辑账号' : '新建账号'}
            </DialogTitle>
            <DialogDescription>
              填写 Gmail 地址、加密凭据、辅助邮箱与标签信息。
            </DialogDescription>
          </DialogHeader>
          {formMode && (
            <AccountForm
              key={`${formMode}-${editingAccount?.id ?? 'new'}`}
              account={
                formMode === 'edit' && editingAccount
                  ? editingAccount
                  : undefined
              }
              onFailure={() => {}}
              tags={tags}
              busy={false}
              conflict={false}
              onSubmit={handleSaveForm}
              onCancel={() => {
                setFormMode(null);
                setEditingAccount(null);
              }}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* 新增标签玻璃弹窗 */}
      <Dialog open={tagModalOpen} onOpenChange={setTagModalOpen}>
        <DialogContent className="macos-glass-modal rounded-[22px]">
          <DialogHeader>
            <DialogTitle>标签管理</DialogTitle>
            <DialogDescription>
              新增用于分类管理 Gmail 账号的标签。
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const trimmed = newTagName.trim();
              if (!trimmed) return;
              setTags((prev) => [
                ...prev,
                {
                  id: `tag-${crypto.randomUUID().slice(0, 6)}`,
                  name: trimmed,
                  created_at: new Date().toISOString(),
                },
              ]);
              setNewTagName('');
              setTagModalOpen(false);
              setNotice(`已添加标签“${trimmed}”。`);
            }}
          >
            <Input
              aria-label="标签名称"
              placeholder="输入新标签名称…"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
              maxLength={50}
              required
            />
            <Button type="submit">添加</Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* 危险操作二次确认 */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
      >
        <AlertDialogContent className="macos-glass-modal rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              确认
              {confirmAction ? actionLabels[confirmAction.action] : ''}
              账号？
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.account.gmail_email}。
              {confirmAction?.action === 'delete'
                ? '将移入回收站（软删除），之后可随时恢复。'
                : confirmAction?.action === 'restore'
                  ? '恢复后将重新回到正常账号列表。'
                  : '归档后资料保持只读留存。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={
                confirmAction?.action === 'delete' ? 'destructive' : 'default'
              }
              onClick={(e) => {
                e.preventDefault();
                handleConfirmAction();
              }}
            >
              确认
              {confirmAction ? actionLabels[confirmAction.action] : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppWindowShell>
  );
}
