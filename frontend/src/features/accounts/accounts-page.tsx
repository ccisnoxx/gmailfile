import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BarChart3, Filter, List, Plus, RefreshCw, Search } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useInRouterContext, useNavigate, useParams } from 'react-router-dom';
import type {
  AccountSummary,
  ErrorResponse,
  SessionResponse,
} from '@/api/generated';
import { dashboardSummary } from '@/api/generated';
import {
  AppWindowShell,
  EmptyState,
  GlassToolbar,
  IconTooltip,
  LoadingState,
  MobilePrimaryNavMenu,
  persistDisplaySettings,
  persistNavAlpha,
  PrimarySidebar,
  readDisplaySettings,
  readStoredNavAlpha,
  subscribeDisplaySettings,
  subscribeNavAlpha,
  type DisplaySettingsState,
  type SidebarSectionKey,
  type SidebarTagItem,
  type TopNavKey,
} from '@/components/macos';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import { AccountActionDialog } from './account-action-dialog';
import { BatchBar } from './account-batch-bar';
import { Filters } from './account-filters';
import { Pagination } from './account-pagination';
import { Summary, type AccountStatsData } from './account-summary';
import { AccountTable, ColumnToggle } from './account-table';
import { AccountsChartView } from './accounts-chart-view';
import type { AccountAction } from './constants';
import { useAccountQueryState } from './query-state';
import { useAccountDetail } from './use-account-detail';
import { useAccountsList } from './use-accounts-list';
import { useTagManager } from './use-tag-manager';

const RecoveryPage = lazy(() =>
  import('./recovery-usage-view').then((m) => ({ default: m.RecoveryPage })),
);
const AccountDetailDrawer = lazy(() =>
  import('./account-detail-drawer').then((m) => ({
    default: m.AccountDetailDrawer,
  })),
);
const AccountFormDialog = lazy(() =>
  import('./account-form-dialog').then((m) => ({
    default: m.AccountFormDialog,
  })),
);
const TagManagerDialog = lazy(() =>
  import('./tag-manager-dialog').then((m) => ({
    default: m.TagManagerDialog,
  })),
);

interface AccountsPageProps {
  session: SessionResponse;
  initialRecoveryView?: boolean;
  onSession: (value: SessionResponse) => void;
  onFailure: (error: unknown) => void;
  onSecurity: () => void;
  onOperations?: (tab?: 'status' | 'import' | 'export' | 'audit') => void;
  onLogout: () => void;
}

interface RouterSyncProps {
  accountIdParam?: string;
  navigateToAccount?: (id: string) => void;
  navigateBackToList?: () => void;
  navigateToRecovery?: () => void;
  navigateToAccountsWithQuery?: (queryString: string) => void;
}

export function AccountsPage(props: AccountsPageProps) {
  const inRouter = useInRouterContext();
  if (inRouter) {
    return <RoutedAccountsPage {...props} />;
  }
  return <AccountsPageBody {...props} />;
}

function RoutedAccountsPage(props: AccountsPageProps) {
  const navigate = useNavigate();
  const params = useParams<{ accountId?: string }>();
  const navigateToAccount = useCallback(
    (id: string) => {
      void navigate({
        pathname: `/accounts/${id}`,
        search: window.location.search,
      });
    },
    [navigate],
  );
  const navigateBackToList = useCallback(() => {
    void navigate({
      pathname: '/accounts',
      search: window.location.search,
    });
  }, [navigate]);
  const navigateToRecovery = useCallback(() => {
    void navigate('/recovery-emails');
  }, [navigate]);
  const navigateToAccountsWithQuery = useCallback(
    (queryString: string) => {
      void navigate({
        pathname: '/accounts',
        search: queryString ? `?${queryString}` : '',
      });
    },
    [navigate],
  );
  return (
    <AccountsPageBody
      {...props}
      accountIdParam={params.accountId}
      navigateToAccount={navigateToAccount}
      navigateBackToList={navigateBackToList}
      navigateToRecovery={navigateToRecovery}
      navigateToAccountsWithQuery={navigateToAccountsWithQuery}
    />
  );
}

function AccountsPageBody({
  session,
  initialRecoveryView = false,
  onSession,
  onFailure,
  onSecurity,
  onOperations,
  onLogout,
  accountIdParam,
  navigateToAccount,
  navigateBackToList,
  navigateToRecovery,
  navigateToAccountsWithQuery,
}: AccountsPageProps & RouterSyncProps) {
  const queryState = useAccountQueryState();
  const isRecoveryView = initialRecoveryView || queryState.recoveryView;

  const [navAlpha, setNavAlpha] = useState<number>(() => readStoredNavAlpha());
  const [displaySettings, setDisplaySettings] = useState<DisplaySettingsState>(
    () => readDisplaySettings(),
  );
  const [viewMode, setViewMode] = useState<'list' | 'chart'>('list');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showcaseToggle, setShowcaseToggle] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleNavAlphaChange = useCallback((next: number) => {
    setNavAlpha(next);
    persistNavAlpha(next);
  }, []);

  const handleDisplaySettingsChange = useCallback(
    (next: DisplaySettingsState) => {
      setDisplaySettings(next);
      persistDisplaySettings(next);
    },
    [],
  );

  useEffect(() => subscribeNavAlpha(setNavAlpha), []);
  useEffect(() => subscribeDisplaySettings(setDisplaySettings), []);

  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const stableRefresh = useCallback(() => refreshRef.current(), []);

  const detailState = useAccountDetail({
    session,
    search: queryState.search,
    onFailure,
    onRefresh: stableRefresh,
  });

  const listState = useAccountsList({
    query: queryState.query,
    search: queryState.search,
    recoveryView: isRecoveryView,
    onFailure: detailState.fail,
  });
  refreshRef.current = listState.refresh;

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const summaryQuery = useQuery({
    queryKey: ['summary', timezone],
    queryFn: async ({ signal }) =>
      (
        await dashboardSummary({
          query: { timezone },
          signal,
          throwOnError: true,
        })
      ).data,
  });

  useEffect(() => {
    if (summaryQuery.error) detailState.fail(summaryQuery.error);
  }, [summaryQuery.error, detailState.fail]);

  const tagState = useTagManager({
    headers: detailState.headers,
    onFailure: detailState.fail,
    onRefresh: listState.refresh,
    onCaptureFocus: detailState.captureFocus,
  });

  // 支持通过 /accounts?modal=tags 从其他页面直达标签管理弹窗
  useEffect(() => {
    if (queryState.params.get('modal') === 'tags') {
      tagState.openDialog();
      queryState.change({ modal: '' }, false, true);
    }
  }, [queryState, tagState]);

  // ⌘K / Ctrl+K 聚焦搜索框（存在弹窗或位于辅助邮箱视图时让位）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (
          isRecoveryView ||
          document.querySelector('[role="dialog"], [role="alertdialog"]')
        ) {
          return;
        }
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isRecoveryView]);

  // URL /accounts/:accountId 自动同步打开对应详情抽屉
  const openedRouteIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!accountIdParam) {
      openedRouteIdRef.current = null;
      return;
    }
    if (openedRouteIdRef.current === accountIdParam) return;
    openedRouteIdRef.current = accountIdParam;
    const match = listState.items.find((item) => item.id === accountIdParam);
    const stub = match ?? ({ id: accountIdParam } as AccountSummary);
    void detailState.open(stub);
  }, [accountIdParam, detailState, listState.items]);

  const handleOpenAccount = useCallback(
    (account: AccountSummary, edit = false, action?: AccountAction) => {
      if (!edit && !action && navigateToAccount) {
        openedRouteIdRef.current = account.id;
        navigateToAccount(account.id);
        return;
      }
      void detailState.open(account, edit, action);
    },
    [detailState, navigateToAccount],
  );

  const handleCloseDetail = useCallback(() => {
    detailState.close();
    if (accountIdParam && navigateBackToList) {
      openedRouteIdRef.current = null;
      navigateBackToList();
    }
  }, [accountIdParam, detailState, navigateBackToList]);

  const handleBatchFailure = useCallback(
    (error: unknown) => {
      const code = (error as ErrorResponse)?.error?.code;
      if (['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(code))
        onFailure(error);
    },
    [onFailure],
  );

  const activeSection: SidebarSectionKey = useMemo(() => {
    if (queryState.deleted) return 'trash';
    if (
      queryState.params.get('archived') === 'true' ||
      queryState.params.get('status') === 'archived'
    ) {
      return 'archived';
    }
    const status = queryState.params.get('status');
    const statuses = (queryState.params.get('statuses') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (status === 'normal') return 'normal';
    if (status === 'pending_verification') return 'pending';
    if (
      status === 'restricted' ||
      status === 'login_failed' ||
      (statuses.length > 0 &&
        statuses.every((s) => s === 'restricted' || s === 'login_failed'))
    ) {
      return 'risk';
    }
    if (status === 'disabled') return 'disabled';
    return 'all';
  }, [queryState.deleted, queryState.params]);

  const handleOpenRecoveryUsage = useCallback(() => {
    handleCloseDetail();
    if (navigateToRecovery) {
      navigateToRecovery();
    } else {
      queryState.openRecoveryView();
    }
  }, [handleCloseDetail, navigateToRecovery, queryState]);

  const handleOpenRecoveryAccounts = useCallback(
    (email: string) => {
      if (initialRecoveryView && navigateToAccountsWithQuery) {
        const next = new URLSearchParams({ recovery_email: email });
        navigateToAccountsWithQuery(next.toString());
      } else {
        queryState.change({ recovery_email: email }, true);
      }
    },
    [initialRecoveryView, navigateToAccountsWithQuery, queryState],
  );

  const handleSelectSection = useCallback(
    (section: SidebarSectionKey) => {
      handleCloseDetail();
      if (initialRecoveryView && navigateToAccountsWithQuery) {
        const map: Record<SidebarSectionKey, string> = {
          all: '',
          normal: 'status=normal',
          pending: 'status=pending_verification',
          risk: 'statuses=restricted,login_failed',
          disabled: 'status=disabled',
          archived: 'archived=true',
          trash: 'deleted=true',
        };
        navigateToAccountsWithQuery(map[section]);
        return;
      }
      if (section === 'all') {
        queryState.change({}, true);
      } else if (section === 'normal') {
        queryState.change({ status: 'normal' }, true);
      } else if (section === 'pending') {
        queryState.change({ status: 'pending_verification' }, true);
      } else if (section === 'risk') {
        queryState.change({ statuses: 'restricted,login_failed' }, true);
      } else if (section === 'disabled') {
        queryState.change({ status: 'disabled' }, true);
      } else if (section === 'archived') {
        queryState.change({ archived: 'true' }, true);
      } else {
        queryState.change({ deleted: 'true' }, true);
      }
    },
    [
      handleCloseDetail,
      initialRecoveryView,
      navigateToAccountsWithQuery,
      queryState,
    ],
  );

  const handleSelectTag = useCallback(
    (tagId: string) => {
      handleCloseDetail();
      if (initialRecoveryView && navigateToAccountsWithQuery) {
        navigateToAccountsWithQuery(
          new URLSearchParams({ tag: tagId }).toString(),
        );
        return;
      }
      const current = queryState.params.get('tag');
      queryState.change({
        tag: current === tagId ? '' : tagId,
        deleted: '',
        view: '',
      });
    },
    [
      handleCloseDetail,
      initialRecoveryView,
      navigateToAccountsWithQuery,
      queryState,
    ],
  );

  const handleTopNav = useCallback(
    (key: TopNavKey) => {
      handleCloseDetail();
      if (key === 'dashboard') {
        setViewMode('chart');
        if (initialRecoveryView && navigateToAccountsWithQuery) {
          navigateToAccountsWithQuery('');
        } else {
          queryState.change({}, true);
        }
      } else if (key === 'accounts') {
        setViewMode('list');
        if (initialRecoveryView && navigateToAccountsWithQuery) {
          navigateToAccountsWithQuery('');
        } else {
          queryState.change({ view: '' });
        }
      } else if (key === 'tags') {
        tagState.openDialog();
      } else if (key === 'transfer') {
        if (onOperations) onOperations('import');
        else onSecurity();
      } else if (key === 'audit') {
        if (onOperations) onOperations('audit');
        else onSecurity();
      } else if (key === 'settings') {
        onSecurity();
      }
    },
    [
      handleCloseDetail,
      initialRecoveryView,
      navigateToAccountsWithQuery,
      onOperations,
      onSecurity,
      queryState,
      tagState,
    ],
  );

  const visibleCounts = useMemo(() => {
    const summary = summaryQuery.data;
    const all = summary?.total ?? listState.list.data?.total ?? 0;
    const normal = summary?.normal ?? 0;
    const pending = summary?.pending_verification ?? 0;
    const risk = summary?.risk ?? summary?.abnormal ?? 0;
    const disabled = summary?.disabled ?? 0;
    const archived = summary?.archived ?? 0;
    return {
      all,
      normal,
      pending,
      addedThisMonth: summary?.added_this_month ?? 0,
      risk,
      disabled,
      archived,
      trash:
        summary?.deleted_count ??
        (queryState.deleted ? (listState.list.data?.total ?? 0) : 0),
    };
  }, [listState.list.data?.total, queryState.deleted, summaryQuery.data]);

  const stats: AccountStatsData = {
    all: visibleCounts.all,
    normal: visibleCounts.normal,
    pending: visibleCounts.pending,
    addedThisMonth: visibleCounts.addedThisMonth,
    risk: visibleCounts.risk,
    disabled: visibleCounts.disabled,
    archived: visibleCounts.archived,
  };

  const sidebarTags: SidebarTagItem[] = useMemo(() => {
    const tagCounts = summaryQuery.data?.tag_counts;
    return (listState.tags.data ?? []).map((tag) => ({
      id: tag.id,
      name: tag.name,
      count: tagCounts ? (tagCounts[tag.id] ?? 0) : undefined,
    }));
  }, [listState.tags.data, summaryQuery.data?.tag_counts]);

  const allowDebugUiState = import.meta.env.DEV;
  const uiStateParam = allowDebugUiState
    ? queryState.params.get('ui_state')
    : null;
  const showStateShowcase =
    allowDebugUiState && (uiStateParam === 'showcase' || showcaseToggle);
  const effectivePending =
    uiStateParam === 'loading' ? true : listState.list.isPending;
  const effectiveItems = uiStateParam === 'empty' ? [] : listState.items;
  const activeFilterCount = [
    'status',
    'statuses',
    'two_factor_status',
    'tag',
    'archived',
    'purpose',
    'from',
    'to',
    'recovery_email',
  ].filter((key) => queryState.params.has(key)).length;

  const selectedCount = listState.selectedItems.length;

  return (
    <AppWindowShell
      navAlpha={navAlpha}
      flowingBackground={displaySettings.flowingBackground}
      animationsEnabled={displaySettings.animationsEnabled}
      compactMode={displaySettings.compactMode}
      mobileDrawerHeader={
        <MobilePrimaryNavMenu
          activeNav="accounts"
          onSelectNav={handleTopNav}
        />
      }
      toolbar={
        <GlassToolbar
          activeNav="accounts"
          navAlpha={navAlpha}
          onNavAlphaChange={handleNavAlphaChange}
          displaySettings={displaySettings}
          onDisplaySettingsChange={handleDisplaySettingsChange}
          onSelectNav={handleTopNav}
          onOpenSecurity={() => {
            handleCloseDetail();
            onSecurity();
          }}
          onOpenTransfer={() => handleTopNav('transfer')}
          onOpenRecoveryUsage={handleOpenRecoveryUsage}
          onToggleShowcase={
            allowDebugUiState
              ? () => setShowcaseToggle((prev) => !prev)
              : undefined
          }
          showcaseActive={showStateShowcase}
          onLogout={() => {
            handleCloseDetail();
            onLogout();
          }}
          notifications={detailState.notice ? [detailState.notice] : []}
          onClearNotifications={() => detailState.setNotice('')}
        />
      }
      sidebar={
        <PrimarySidebar
          activeSection={isRecoveryView ? null : activeSection}
          activeTagId={queryState.params.get('tag')}
          counts={visibleCounts}
          tags={sidebarTags}
          onSelectSection={handleSelectSection}
          onSelectTag={handleSelectTag}
          onAddTag={tagState.openDialog}
          onOpenRecoveryUsage={handleOpenRecoveryUsage}
          recoveryActive={isRecoveryView}
          onOpenAudit={() => handleTopNav('audit')}
          onOpenBackup={() => {
            handleCloseDetail();
            if (onOperations) onOperations('status');
            else onSecurity();
          }}
        />
      }
    >
      {/* 主内容标题与工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-[var(--text-primary)]">
            {isRecoveryView
              ? '辅助邮箱统计'
              : queryState.deleted
                ? '回收站'
                : '账号管理'}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            {isRecoveryView
              ? '统计每个辅助邮箱关联的账号规模与异常分布，快速排查集中风险'
              : queryState.deleted
                ? '邮箱唯一性和关联仍然保留，支持单条或批量恢复。'
                : '集中管理 Gmail 账号资料、凭据、辅助邮箱与使用状态'}
          </p>
        </div>

        {isRecoveryView ? (
          <button
            type="button"
            onClick={() => handleSelectSection('all')}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/80 bg-white/70 px-3.5 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-white"
          >
            返回账号列表
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2.5">
            {/* 搜索框 + ⌘K */}
            <div className="relative flex items-center">
              <Search
                className="pointer-events-none absolute left-3 size-4 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <input
                ref={searchInputRef}
                type="search"
                aria-label="搜索账号"
                placeholder="搜索邮箱、辅助邮箱或备注"
                value={queryState.params.get('search') || ''}
                onChange={(e) =>
                  queryState.change({ search: e.target.value }, false, true)
                }
                maxLength={254}
                className="h-9 w-56 rounded-xl border border-white/80 bg-white/65 pr-11 pl-9 text-[13px] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-md transition-all duration-[180ms] ease-out placeholder:text-[var(--text-secondary)] focus:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:w-64"
              />
              <kbd
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 rounded-md border border-[var(--border)] bg-white/80 px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
              >
                ⌘K
              </kbd>
            </div>

            {/* 筛选开关按钮 */}
            <IconTooltip label={filtersOpen ? '收起筛选条件' : '展开筛选条件'}>
              <button
                type="button"
                aria-expanded={filtersOpen}
                onClick={() => setFiltersOpen((open) => !open)}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-medium transition-all duration-[180ms] ease-out',
                  filtersOpen || activeFilterCount > 0
                    ? 'border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-text)]'
                    : 'border-white/80 bg-white/65 text-[var(--text-primary)] hover:-translate-y-[1px] hover:bg-white/85',
                )}
              >
                <Filter className="size-3.5" aria-hidden="true" />
                <span>筛选</span>
                {activeFilterCount > 0 && (
                  <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-semibold text-[var(--primary-foreground)]">
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </IconTooltip>

            {/* 列表 / 图表视图切换 */}
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

            <IconTooltip label="刷新列表">
              <button
                type="button"
                aria-label="刷新列表"
                onClick={() => void listState.refresh()}
                className="inline-flex size-9 items-center justify-center rounded-xl border border-white/80 bg-white/65 text-[var(--text-secondary)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/90 hover:text-[var(--text-primary)]"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
              </button>
            </IconTooltip>

            {!queryState.deleted && (
              <button
                type="button"
                onClick={detailState.openNew}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--primary-foreground)] shadow-[0_8px_20px_rgba(22,119,255,0.28)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-[var(--accent-hover)]"
              >
                <Plus className="size-4" aria-hidden="true" />
                <span>新建账号</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* 全局统计卡片（仅在账号管理视图展示，避免与辅助邮箱统计卡重复） */}
      {!isRecoveryView && (
        <Summary
          stats={stats}
          activeSection={activeSection}
          onSelectSection={handleSelectSection}
        />
      )}

      {detailState.notice && (
        <Alert
          variant={detailState.conflict ? 'destructive' : 'default'}
          role="status"
          className="macos-glass-panel border-white/80"
        >
          <AlertDescription>{detailState.notice}</AlertDescription>
        </Alert>
      )}

      {/* 可折叠的筛选面板 + 列显示 */}
      {filtersOpen && !isRecoveryView && (
        <div className="space-y-3">
          <Filters
            params={queryState.params}
            change={queryState.change}
            tags={listState.tags.data ?? []}
            onOpenRecoveryUsage={handleOpenRecoveryUsage}
          />
          <ColumnToggle
            columns={listState.columns}
            onToggle={listState.toggleColumn}
          />
        </div>
      )}

      {/* 选中行时显示批量操作条（普通列表支持批量状态/标签，回收站支持批量恢复） */}
      {!isRecoveryView && selectedCount > 0 && (
        <BatchBar
          key={queryState.search + ':' + listState.list.dataUpdatedAt}
          selected={listState.selectedItems}
          tags={listState.tags.data ?? []}
          session={session}
          deleted={queryState.deleted}
          complete={async (kind) => {
            await listState.refresh();
            detailState.setNotice(
              kind === 'restore' ? '整批账号已恢复。' : '整批操作已提交。',
            );
          }}
          onFailure={handleBatchFailure}
        />
      )}

      {/* 主视图区域：辅助邮箱统计 / 图表视图 / 账号表格 */}
      {isRecoveryView ? (
        <div className="macos-glass-panel macos-glass-panel-strong p-5">
          <Suspense fallback={<LoadingState title="正在加载辅助邮箱统计…" />}>
            <RecoveryPage
              params={queryState.params}
              change={queryState.change}
              onFailure={detailState.fail}
              onCopy={(value) => void detailState.copy(value)}
              onOpenAccountsFilter={handleOpenRecoveryAccounts}
            />
          </Suspense>
        </div>
      ) : viewMode === 'chart' ? (
        <AccountsChartView
          stats={stats}
          items={listState.items}
          liveAnalytics
          timezone={timezone}
          onOpenRecoveryUsage={handleOpenRecoveryUsage}
        />
      ) : (
        <AccountTable
          items={effectiveItems}
          total={listState.list.data?.total ?? 0}
          isPending={effectivePending}
          isError={listState.list.isError}
          deleted={queryState.deleted}
          busy={detailState.busy}
          columns={listState.columns}
          selected={listState.selected}
          sort={queryState.query.sort}
          onSort={(nextSort) => queryState.change({ sort: nextSort })}
          onToggleAll={listState.toggleAll}
          onToggleOne={listState.toggleOne}
          onOpen={handleOpenAccount}
          onCopy={(value) => void detailState.copy(value)}
          onMarkVerified={detailState.markVerifiedQuick}
          onCreate={detailState.openNew}
          onImportCsv={onOperations ? () => onOperations('import') : undefined}
          onRetry={() => void listState.refresh()}
          footer={
            listState.list.data && (
              <Pagination
                {...listState.list.data}
                selectedCount={selectedCount}
                change={queryState.change}
                busy={listState.list.isFetching}
              />
            )
          }
        />
      )}

      {/* 状态展示区（仅在 ?ui_state=showcase 或调试开关开启时显示，不影响正常表格页） */}
      {showStateShowcase && (
        <section
          aria-label="组件状态展示"
          className="grid gap-4 md:grid-cols-2"
        >
          <EmptyState
            onCreate={detailState.openNew}
            onImportCsv={
              onOperations ? () => onOperations('import') : onSecurity
            }
          />
          <LoadingState />
        </section>
      )}

      {detailState.drawerLoaded && (
        <Suspense fallback={null}>
          <AccountDetailDrawer
            open={detailState.drawer}
            detail={detailState.detail}
            session={session}
            secretEpoch={detailState.secretEpoch}
            busy={detailState.busy}
            conflict={detailState.conflict}
            notice={detailState.notice}
            onClose={handleCloseDetail}
            onRestoreFocus={detailState.restoreFocus}
            onSession={onSession}
            onFailure={detailState.fail}
            onCopy={(value) => void detailState.copy(value)}
            onReload={(account) => void detailState.open(account)}
            onAction={(action) => void detailState.act(action)}
            onEdit={detailState.openEditFromDrawer}
            onRequestConfirm={detailState.requestAction}
          />
        </Suspense>
      )}

      {detailState.formLoaded && (
        <Suspense fallback={null}>
          <AccountFormDialog
            form={detailState.form}
            detail={detailState.detail}
            tags={listState.tags.data ?? []}
            busy={detailState.busy}
            conflict={detailState.conflict}
            notice={detailState.notice}
            onClose={handleCloseDetail}
            onRestoreFocus={detailState.restoreFocus}
            onReload={(account) => void detailState.open(account, true)}
            onFailure={detailState.fail}
            onSubmit={detailState.save}
          />
        </Suspense>
      )}

      <AccountActionDialog
        confirm={detailState.confirm}
        detail={detailState.detail}
        busy={detailState.busy}
        conflict={detailState.conflict}
        notice={detailState.notice}
        onClose={() => detailState.setConfirm(null)}
        onConfirm={(action) => void detailState.act(action)}
      />

      {tagState.loaded && (
        <Suspense fallback={null}>
          <TagManagerDialog
            open={tagState.open}
            tags={listState.tags.data ?? []}
            target={tagState.target}
            name={tagState.name}
            deleteTarget={tagState.deleteTarget}
            busy={tagState.busy}
            notice={tagState.notice}
            onOpenChange={tagState.setOpen}
            onRestoreFocus={detailState.restoreFocus}
            onNameChange={tagState.setName}
            onSave={tagState.saveTag}
            onStartRename={tagState.startRename}
            onCancelRename={tagState.cancelRename}
            onRequestDelete={tagState.setDeleteTarget}
            onConfirmDelete={tagState.confirmDelete}
          />
        </Suspense>
      )}
    </AppWindowShell>
  );
}
