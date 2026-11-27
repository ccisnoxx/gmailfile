import { lazy, Suspense, useCallback, useEffect } from 'react';
import {
  useInRouterContext,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import { resolveAppHref } from '@/app/navigation';
import {
  AppWindowShell,
  EmptyState,
  GlassToolbar,
  LoadingState,
  PrimarySidebar,
  useAppShellContext,
} from '@/components/macos';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AccountActionDialog } from './account-action-dialog';
import { AccountActiveFilters } from './account-active-filters';
import { BatchBar } from './account-batch-bar';
import { Filters } from './account-filters';
import { Pagination } from './account-pagination';
import { AccountStatusStrip } from './account-summary';
import { AccountTable } from './account-table';
import { AccountsToolbar } from './accounts-toolbar';
import {
  useAccountsPageController,
  type AccountsPageProps,
  type RouterSyncProps,
} from './use-accounts-page-controller';

const loadAccountsChartView = () =>
  import('./accounts-chart-view').then((m) => ({
    default: m.AccountsChartView,
  }));
const AccountsChartView = lazy(loadAccountsChartView);
const RecoveryPage = lazy(() =>
  import('./recovery-usage-view').then((m) => ({ default: m.RecoveryPage })),
);
const AppsUsageView = lazy(() =>
  import('./apps-usage-view').then((m) => ({ default: m.AppsUsageView })),
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

export function AccountsPage(props: AccountsPageProps) {
  const inRouter = useInRouterContext();
  if (inRouter) {
    return <RoutedAccountsPage {...props} />;
  }
  return <AccountsPageBody {...props} />;
}

function RoutedAccountsPage(props: AccountsPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams<{ accountId?: string }>();
  const navigateToAccount = useCallback(
    (id: string) => {
      void navigate(
        resolveAppHref({
          kind: 'account-detail',
          accountId: id,
          search: location.search,
        }),
      );
    },
    [location.search, navigate],
  );
  const navigateBackToList = useCallback(() => {
    void navigate({
      pathname: resolveAppHref({ kind: 'accounts' }),
      search: location.search,
    });
  }, [location.search, navigate]);
  const navigateToRecovery = useCallback(() => {
    void navigate(resolveAppHref({ kind: 'recovery-emails' }));
  }, [navigate]);
  const navigateToApps = useCallback(() => {
    void navigate(resolveAppHref({ kind: 'apps' }));
  }, [navigate]);
  const navigateToAccountsWithQuery = useCallback(
    (queryString: string) => {
      void navigate({
        pathname: resolveAppHref({ kind: 'accounts' }),
        search: queryString ? `?${queryString}` : '',
      });
    },
    [navigate],
  );
  const handleRouterSearchChange = useCallback(
    (nextSearch: string, replace: boolean) => {
      void navigate(
        {
          pathname: location.pathname,
          search: nextSearch,
        },
        { replace },
      );
    },
    [location.pathname, navigate],
  );
  return (
    <AccountsPageBody
      {...props}
      accountIdParam={params.accountId}
      routerSearch={location.search}
      onRouterSearchChange={handleRouterSearchChange}
      navigateToAccount={navigateToAccount}
      navigateBackToList={navigateBackToList}
      navigateToRecovery={navigateToRecovery}
      navigateToApps={navigateToApps}
      navigateToAccountsWithQuery={navigateToAccountsWithQuery}
    />
  );
}

function AccountsPageBody(props: AccountsPageProps & RouterSyncProps) {
  const { session, onSession, onSecurity, onOperations, onLogout } = props;
  const shell = useAppShellContext();
  const inPersistentShell = Boolean(shell?.persistentShell);
  const ctrl = useAccountsPageController(props);
  const { queryState, detailState, listState, tagState } = ctrl;

  useEffect(() => {
    if (inPersistentShell && detailState.notice) {
      shell?.pushNotification?.(detailState.notice);
    }
  }, [detailState.notice, inPersistentShell, shell]);

  const workspaceContent = (
    <>
      {!ctrl.isStandaloneSubView && (
        <AccountsToolbar
          isRecoveryView={ctrl.isRecoveryView}
          isAppsView={ctrl.isAppsView}
          isStandaloneSubView={ctrl.isStandaloneSubView}
          isChartView={ctrl.isChartView}
          deleted={queryState.deleted}
          viewMode={ctrl.viewMode}
          searchInputRef={ctrl.searchInputRef}
          searchDraft={ctrl.searchDraft}
          filtersOpen={ctrl.filtersOpen}
          activeFilterCount={ctrl.activeFilterCount}
          params={queryState.params}
          columns={listState.columns}
          onToggleColumn={listState.toggleColumn}
          onSearchChange={ctrl.handleSearchInputChange}
          onCommitSearch={ctrl.commitSearch}
          onToggleFilters={() => ctrl.setFiltersOpen((open) => !open)}
          onApplySavedView={ctrl.handleApplySavedView}
          onSetViewMode={ctrl.handleSetViewMode}
          onPreloadChartView={() => void loadAccountsChartView()}
          onRefresh={() => void listState.refresh()}
          onCreateNew={detailState.openNew}
          onReturnToList={() => ctrl.handleSelectSection('all')}
        />
      )}

      {!ctrl.isStandaloneSubView &&
        !ctrl.isChartView &&
        !ctrl.hideStatusStrip && (
          <AccountStatusStrip
            stats={ctrl.stats}
            activeSection={ctrl.activeSection}
            onSelectSection={ctrl.handleSelectSection}
          />
        )}

      {!ctrl.isStandaloneSubView && !ctrl.isChartView && (
        <AccountActiveFilters
          params={queryState.params}
          tags={listState.tags.data ?? []}
          apps={listState.apps.data ?? []}
          change={queryState.change}
          onClearAll={ctrl.handleClearAllFilters}
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

      {ctrl.filtersOpen && !ctrl.isStandaloneSubView && (
        <Filters
          params={queryState.params}
          change={queryState.change}
          tags={listState.tags.data ?? []}
          apps={listState.apps.data ?? []}
          purposeSuggestions={ctrl.purposeSuggestions}
          onOpenRecoveryUsage={ctrl.handleOpenRecoveryUsage}
          onOpenAppsUsage={ctrl.handleOpenAppsUsage}
        />
      )}

      {ctrl.isRecoveryView ? (
        <div className="macos-glass-panel macos-glass-panel-strong p-5">
          <Suspense fallback={<LoadingState title="正在加载辅助邮箱统计…" />}>
            <RecoveryPage
              params={queryState.params}
              change={queryState.change}
              csrfToken={session.csrf_token}
              onFailure={detailState.fail}
              onCopy={(value) => void detailState.copy(value)}
              onOpenAccountsFilter={ctrl.handleOpenRecoveryAccounts}
            />
          </Suspense>
        </div>
      ) : ctrl.isAppsView ? (
        <div className="macos-glass-panel macos-glass-panel-strong p-5">
          <Suspense fallback={<LoadingState title="正在加载已注册应用统计…" />}>
            <AppsUsageView
              csrfToken={session.csrf_token}
              session={session}
              onSession={onSession}
              onFailure={detailState.fail}
              onOpenRegisteredAccounts={(appId) =>
                ctrl.navigateWithAccountQuery({ app_id: appId })
              }
              onOpenBannedAccounts={(appId) =>
                ctrl.navigateWithAccountQuery({
                  app_id: appId,
                  app_status: 'banned',
                })
              }
              onOpenAvailableAccounts={(appId) =>
                ctrl.navigateWithAccountQuery({
                  status: 'normal',
                  exclude_app_id: appId,
                })
              }
            />
          </Suspense>
        </div>
      ) : ctrl.viewMode === 'chart' ? (
        <Suspense fallback={<LoadingState title="正在加载数据图表…" />}>
          <AccountsChartView
            stats={ctrl.stats}
            items={listState.items}
            csrfToken={session.csrf_token}
            liveAnalytics
            timezone={ctrl.timezone}
            activeSection={ctrl.activeSection}
            onSelectSection={ctrl.handleSelectSection}
            onDrillDown={ctrl.navigateWithAccountQuery}
            onOpenRecoveryUsage={ctrl.handleOpenRecoveryUsage}
            onOpenBackup={
              onOperations ? () => onOperations('status') : undefined
            }
            onOpenAudit={onOperations ? () => onOperations('audit') : undefined}
          />
        </Suspense>
      ) : (
        <AccountTable
          items={ctrl.effectiveItems}
          total={listState.list.data?.total ?? 0}
          isPending={ctrl.effectivePending}
          isError={listState.list.isError}
          deleted={queryState.deleted}
          busy={detailState.busy}
          columns={listState.columns}
          selected={listState.selected}
          sort={queryState.query.sort}
          onSort={(nextSort) => queryState.change({ sort: nextSort })}
          onToggleAll={listState.toggleAll}
          onToggleOne={listState.toggleOne}
          onOpen={ctrl.handleOpenAccount}
          onCopy={(value) => void detailState.copy(value)}
          onMarkVerified={detailState.markVerifiedQuick}
          onCreate={detailState.openNew}
          onImportCsv={onOperations ? () => onOperations('import') : undefined}
          onRetry={() => void listState.refresh()}
          footer={
            listState.list.data && (
              <Pagination
                {...listState.list.data}
                selectedCount={ctrl.selectedCount}
                change={queryState.change}
                busy={listState.list.isFetching}
              />
            )
          }
        />
      )}

      {!ctrl.isStandaloneSubView && ctrl.selectedCount > 0 && (
        <div
          data-slot="batch-floating-dock"
          className="sticky bottom-4 z-30 mx-auto w-fit max-w-full"
        >
          <BatchBar
            key={queryState.search + ':' + listState.list.dataUpdatedAt}
            selected={listState.selectedItems}
            tags={listState.tags.data ?? []}
            session={session}
            deleted={queryState.deleted}
            onSession={onSession}
            onClearSelection={() => listState.toggleAll(false)}
            complete={async (kind) => {
              await listState.refresh();
              detailState.setNotice(
                kind === 'permanent-delete'
                  ? '整批账号已永久删除。'
                  : kind === 'restore'
                    ? '整批账号已恢复。'
                    : kind === 'delete'
                      ? '整批账号已移入回收站。'
                      : kind === 'verify'
                        ? '整批账号已标记为今天已验证。'
                        : '整批操作已提交。',
              );
            }}
            onFailure={ctrl.handleBatchFailure}
          />
        </div>
      )}

      {ctrl.showStateShowcase && (
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
            positionLabel={ctrl.drawerPositionLabel}
            onSelectPrev={ctrl.handleSelectPrevDrawerAccount}
            onSelectNext={ctrl.handleSelectNextDrawerAccount}
            onOpenFullPage={ctrl.handleOpenFullDetail}
            onSelectAccountById={(targetId) => {
              const found = ctrl.effectiveItems.find((i) => i.id === targetId);
              void detailState.open(
                found ?? ({ id: targetId } as (typeof ctrl.effectiveItems)[0]),
              );
            }}
            onClose={ctrl.handleCloseDetail}
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
            session={session}
            reauthRequired={detailState.reauthRequired}
            tags={listState.tags.data ?? []}
            appsCatalog={listState.apps.data ?? []}
            purposeSuggestions={ctrl.purposeSuggestions}
            onCreateApp={ctrl.handleCreateApp}
            onFetchAppIcon={ctrl.handleFetchAppIcon}
            busy={detailState.busy}
            conflict={detailState.conflict}
            notice={detailState.notice}
            onClose={ctrl.handleCloseDetail}
            onRestoreFocus={detailState.restoreFocus}
            onReload={(account) => void detailState.open(account, true)}
            onSession={(next) => {
              detailState.setReauthRequired(false);
              detailState.setNotice('');
              onSession(next);
            }}
            onFailure={detailState.fail}
            onSubmit={detailState.save}
          />
        </Suspense>
      )}

      <AccountActionDialog
        confirm={detailState.confirm}
        detail={detailState.detail}
        session={session}
        reauthRequired={detailState.reauthRequired}
        busy={detailState.busy}
        conflict={detailState.conflict}
        notice={detailState.notice}
        onClose={() => {
          detailState.setReauthRequired(false);
          detailState.setConfirm(null);
        }}
        onSession={(next) => {
          detailState.setReauthRequired(false);
          detailState.setNotice('');
          onSession(next);
        }}
        onFailure={detailState.fail}
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
    </>
  );

  if (inPersistentShell) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        {workspaceContent}
      </div>
    );
  }

  return (
    <AppWindowShell
      navAlpha={ctrl.navAlpha}
      flowingBackground={ctrl.displaySettings.flowingBackground}
      animationsEnabled={ctrl.displaySettings.animationsEnabled}
      compactMode={ctrl.displaySettings.compactMode}
      toolbar={
        <GlassToolbar
          activeNav={ctrl.isChartView ? 'dashboard' : 'accounts'}
          navAlpha={ctrl.navAlpha}
          onNavAlphaChange={ctrl.handleNavAlphaChange}
          displaySettings={ctrl.displaySettings}
          onDisplaySettingsChange={ctrl.handleDisplaySettingsChange}
          onSelectNav={ctrl.handleTopNav}
          onOpenSecurity={() => {
            ctrl.handleCloseDetail();
            onSecurity();
          }}
          onOpenTransfer={() => ctrl.handleTopNav('transfer')}
          onOpenRecoveryUsage={ctrl.handleOpenRecoveryUsage}
          onToggleShowcase={
            ctrl.allowDebugUiState
              ? () => ctrl.setShowcaseToggle((prev) => !prev)
              : undefined
          }
          showcaseActive={ctrl.showStateShowcase}
          onLogout={() => {
            ctrl.handleCloseDetail();
            onLogout();
          }}
          session={session}
          onSession={onSession}
          notifications={detailState.notice ? [detailState.notice] : []}
          onClearNotifications={() => detailState.setNotice('')}
        />
      }
      sidebar={
        <PrimarySidebar
          activeSection={ctrl.isStandaloneSubView ? null : ctrl.activeSection}
          activeTagId={queryState.params.get('tag')}
          dashboardActive={ctrl.isChartView}
          appsActive={ctrl.isAppsView}
          recoveryActive={ctrl.isRecoveryView}
          counts={ctrl.visibleCounts}
          tags={ctrl.sidebarTags}
          onSelectSection={ctrl.handleSelectSection}
          onSelectTag={ctrl.handleSelectTag}
          onAddTag={tagState.openDialog}
          onOpenDashboard={() => ctrl.handleTopNav('dashboard')}
          onOpenApps={ctrl.handleOpenAppsUsage}
          onOpenRecoveryUsage={ctrl.handleOpenRecoveryUsage}
          onOpenTransfer={() => ctrl.handleTopNav('transfer')}
          onOpenAudit={() => ctrl.handleTopNav('audit')}
          onOpenBackup={() => {
            ctrl.handleCloseDetail();
            if (onOperations) onOperations('status');
            else onSecurity();
          }}
          onOpenSettings={() => {
            ctrl.handleCloseDetail();
            onSecurity();
          }}
        />
      }
    >
      {workspaceContent}
    </AppWindowShell>
  );
}
