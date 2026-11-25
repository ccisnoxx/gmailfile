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
  LoadingState,
  persistNavAlpha,
  PrimarySidebar,
  readStoredNavAlpha,
  subscribeNavAlpha,
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
  return (
    <AccountsPageBody
      {...props}
      accountIdParam={params.accountId}
      navigateToAccount={navigateToAccount}
      navigateBackToList={navigateBackToList}
    />
  );
}

function AccountsPageBody({
  session,
  onSession,
  onFailure,
  onSecurity,
  onOperations,
  onLogout,
  accountIdParam,
  navigateToAccount,
  navigateBackToList,
}: AccountsPageProps & RouterSyncProps) {
  const queryState = useAccountQueryState();

  const [navAlpha, setNavAlpha] = useState<number>(() => readStoredNavAlpha());
  const [viewMode, setViewMode] = useState<'list' | 'chart'>('list');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showcaseToggle, setShowcaseToggle] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleNavAlphaChange = useCallback((next: number) => {
    setNavAlpha(next);
    persistNavAlpha(next);
  }, []);

  useEffect(() => subscribeNavAlpha(setNavAlpha), []);

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
    recoveryView: queryState.recoveryView,
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
    run: detailState.run,
    onRefresh: listState.refresh,
    onCaptureFocus: detailState.captureFocus,
  });

  // ⌘K / Ctrl+K 聚焦搜索框
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
    if (status === 'normal') return 'normal';
    if (status === 'restricted' || status === 'login_failed') return 'risk';
    if (status === 'disabled') return 'disabled';
    return 'all';
  }, [queryState.deleted, queryState.params]);

  const handleSelectSection = useCallback(
    (section: SidebarSectionKey) => {
      handleCloseDetail();
      if (section === 'all') {
        queryState.change({}, true);
      } else if (section === 'normal') {
        queryState.change({ status: 'normal' }, true);
      } else if (section === 'risk') {
        queryState.change({ status: 'restricted' }, true);
      } else if (section === 'disabled') {
        queryState.change({ status: 'disabled' }, true);
      } else if (section === 'archived') {
        queryState.change({ archived: 'true' }, true);
      } else {
        queryState.change({ deleted: 'true' }, true);
      }
    },
    [handleCloseDetail, queryState],
  );

  const handleSelectTag = useCallback(
    (tagId: string) => {
      handleCloseDetail();
      const current = queryState.params.get('tag');
      queryState.change({
        tag: current === tagId ? '' : tagId,
        deleted: '',
        view: '',
      });
    },
    [handleCloseDetail, queryState],
  );

  const handleTopNav = useCallback(
    (key: TopNavKey) => {
      handleCloseDetail();
      if (key === 'dashboard') {
        setViewMode('chart');
        queryState.change({}, true);
      } else if (key === 'accounts') {
        setViewMode('list');
        queryState.change({ view: '' });
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
    [handleCloseDetail, onOperations, onSecurity, queryState, tagState],
  );

  const visibleCounts = useMemo(() => {
    const items = listState.items;
    const summary = summaryQuery.data;
    const disabledVisible = items.filter((i) => i.status === 'disabled').length;
    const archivedVisible = items.filter((i) => i.status === 'archived').length;
    const abnormal = summary?.abnormal ?? 0;
    const all = summary?.total ?? listState.list.data?.total ?? 0;
    const normal = summary?.normal ?? 0;
    const pending = summary?.pending_verification ?? 0;
    const inferredArchived = Math.max(
      archivedVisible,
      all - normal - abnormal - pending,
    );
    const disabled = disabledVisible;
    const risk = Math.max(0, abnormal - disabled);
    return {
      all,
      normal,
      addedThisMonth: summary?.added_this_month ?? 0,
      risk,
      disabled,
      archived: inferredArchived,
      trash: queryState.deleted ? (listState.list.data?.total ?? 0) : 0,
    };
  }, [
    listState.items,
    listState.list.data?.total,
    queryState.deleted,
    summaryQuery.data,
  ]);

  const stats: AccountStatsData = {
    all: visibleCounts.all,
    normal: visibleCounts.normal,
    addedThisMonth: visibleCounts.addedThisMonth,
    risk: visibleCounts.risk,
    disabled: visibleCounts.disabled,
    archived: visibleCounts.archived,
  };

  const sidebarTags: SidebarTagItem[] = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const item of listState.items) {
      for (const tag of item.tags) {
        countMap.set(tag.id, (countMap.get(tag.id) ?? 0) + 1);
      }
    }
    return (listState.tags.data ?? []).map((tag) => ({
      id: tag.id,
      name: tag.name,
      count: countMap.get(tag.id),
    }));
  }, [listState.items, listState.tags.data]);

  const uiStateParam = queryState.params.get('ui_state');
  const showStateShowcase = uiStateParam === 'showcase' || showcaseToggle;
  const effectivePending =
    uiStateParam === 'loading' ? true : listState.list.isPending;
  const effectiveItems = uiStateParam === 'empty' ? [] : listState.items;
  const activeFilterCount = [
    'status',
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
      toolbar={
        <GlassToolbar
          activeNav={viewMode === 'chart' ? 'dashboard' : 'accounts'}
          navAlpha={navAlpha}
          onNavAlphaChange={handleNavAlphaChange}
          onSelectNav={handleTopNav}
          onOpenSecurity={() => {
            handleCloseDetail();
            onSecurity();
          }}
          onOpenRecoveryUsage={queryState.openRecoveryView}
          onToggleShowcase={() => setShowcaseToggle((prev) => !prev)}
          showcaseActive={showStateShowcase}
          onLogout={() => {
            handleCloseDetail();
            onLogout();
          }}
          notifications={
            detailState.notice
              ? [detailState.notice]
              : ['已启用防篡改哈希链审计与高风险操作 TOTP 二次验证。']
          }
        />
      }
      sidebar={
        <PrimarySidebar
          activeSection={activeSection}
          activeTagId={queryState.params.get('tag')}
          counts={visibleCounts}
          tags={sidebarTags}
          onSelectSection={handleSelectSection}
          onSelectTag={handleSelectTag}
          onAddTag={tagState.openDialog}
          onOpenAudit={() => {
            handleCloseDetail();
            if (onOperations) onOperations('audit');
            else onSecurity();
          }}
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
            {queryState.deleted ? '回收站' : '账号管理'}
          </h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            {queryState.deleted
              ? '邮箱唯一性和关联仍然保留，可逐条恢复。'
              : '集中管理 Gmail 账号资料、凭据、辅助邮箱与使用状态'}
          </p>
        </div>

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
              placeholder="搜索邮箱、辅助邮箱、备注…"
              value={queryState.params.get('search') || ''}
              onChange={(e) => queryState.change({ search: e.target.value })}
              maxLength={254}
              className="h-9 w-56 rounded-xl border border-white/80 bg-white/65 pr-11 pl-9 text-[13px] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-md transition-all duration-[180ms] ease-out placeholder:text-[var(--text-secondary)] focus:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:w-64"
            />
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute right-2.5 rounded-md border border-[#cdddf0] bg-white/80 px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]"
            >
              ⌘K
            </kbd>
          </div>

          {/* 筛选开关按钮 */}
          <button
            type="button"
            aria-expanded={filtersOpen}
            onClick={() => setFiltersOpen((open) => !open)}
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-medium transition-all duration-[180ms] ease-out',
              filtersOpen || activeFilterCount > 0
                ? 'border-[#1677ff]/30 bg-[var(--accent-soft)] text-[var(--accent)]'
                : 'border-white/80 bg-white/65 text-[var(--text-primary)] hover:-translate-y-[1px] hover:bg-white/85',
            )}
          >
            <Filter className="size-3.5" aria-hidden="true" />
            <span>筛选</span>
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-semibold text-white">
                {activeFilterCount}
              </span>
            )}
          </button>

          {/* 列表 / 图表视图切换 */}
          <div
            role="group"
            aria-label="视图切换"
            className="inline-flex h-9 items-center rounded-xl border border-white/80 bg-white/60 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
          >
            <button
              type="button"
              aria-label="列表视图"
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-[10px] transition-all duration-[160ms] ease-out',
                viewMode === 'list'
                  ? 'bg-[var(--accent)] text-white shadow-[0_4px_12px_rgba(22,119,255,0.28)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )}
            >
              <List className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="图表视图"
              aria-pressed={viewMode === 'chart'}
              onClick={() => setViewMode('chart')}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-[10px] transition-all duration-[160ms] ease-out',
                viewMode === 'chart'
                  ? 'bg-[var(--accent)] text-white shadow-[0_4px_12px_rgba(22,119,255,0.28)]'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
              )}
            >
              <BarChart3 className="size-4" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            aria-label="刷新列表"
            title="刷新列表"
            onClick={() => void listState.refresh()}
            className="inline-flex size-9 items-center justify-center rounded-xl border border-white/80 bg-white/65 text-[var(--text-secondary)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/90 hover:text-[var(--text-primary)]"
          >
            <RefreshCw className="size-4" aria-hidden="true" />
          </button>

          {!queryState.deleted && (
            <button
              type="button"
              onClick={detailState.openNew}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-white shadow-[0_8px_20px_rgba(22,119,255,0.28)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-[var(--accent-hover)]"
            >
              <Plus className="size-4" aria-hidden="true" />
              <span>新建账号</span>
            </button>
          )}
        </div>
      </div>

      {/* 5 张全局统计卡片 */}
      <Summary
        stats={stats}
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
      />

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
      {filtersOpen && !queryState.recoveryView && (
        <div className="space-y-3">
          <Filters
            params={queryState.params}
            change={queryState.change}
            tags={listState.tags.data ?? []}
            onOpenRecoveryUsage={queryState.openRecoveryView}
          />
          <ColumnToggle
            columns={listState.columns}
            onToggle={listState.toggleColumn}
          />
        </div>
      )}

      {/* 选中行时显示批量操作条 */}
      {!queryState.deleted && !queryState.recoveryView && selectedCount > 0 && (
        <BatchBar
          key={queryState.search + ':' + listState.list.dataUpdatedAt}
          selected={listState.selectedItems}
          tags={listState.tags.data ?? []}
          session={session}
          complete={async () => {
            await listState.refresh();
            detailState.setNotice('整批操作已提交。');
          }}
          onFailure={handleBatchFailure}
        />
      )}

      {/* 主视图区域：辅助邮箱统计 / 图表视图 / 账号表格 */}
      {queryState.recoveryView ? (
        <div className="macos-glass-panel macos-glass-panel-strong p-5">
          <Suspense fallback={<LoadingState title="正在加载辅助邮箱统计…" />}>
            <RecoveryPage
              params={queryState.params}
              change={queryState.change}
              onFailure={detailState.fail}
            />
          </Suspense>
        </div>
      ) : viewMode === 'chart' ? (
        <AccountsChartView
          stats={stats}
          items={listState.items}
          onOpenRecoveryUsage={queryState.openRecoveryView}
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
            busy={detailState.busy}
            notice={detailState.notice}
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
