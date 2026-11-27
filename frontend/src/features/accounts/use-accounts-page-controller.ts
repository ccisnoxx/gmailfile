import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AccountSummary,
  ErrorResponse,
  RegisteredAppResponse,
  SessionResponse,
} from '@/api/generated';
import { appsCreate, appsFetchIcon, dashboardSummary } from '@/api/generated';
import { sectionToAccountQuery } from '@/app/navigation';
import {
  isEditableElement,
  persistDisplaySettings,
  persistNavAlpha,
  readDisplaySettings,
  readSidebarLayoutState,
  readStoredNavAlpha,
  SIDEBAR_LAYOUT_SYNC_EVENT,
  subscribeDisplaySettings,
  subscribeNavAlpha,
  useAppShellContext,
  type DisplaySettingsState,
  type SidebarSectionKey,
  type SidebarTagItem,
  type TopNavKey,
} from '@/components/macos';
import type { AccountStatsData } from './account-summary';
import type { AccountAction } from './constants';
import { useAccountQueryState } from './query-state';
import {
  BUILTIN_ACCOUNT_VIEWS,
  readSavedViewsStore,
  type SavedAccountView,
} from './saved-views';
import { useAccountDetail } from './use-account-detail';
import { useAccountsList } from './use-accounts-list';
import { useTagManager } from './use-tag-manager';

const SEARCH_DEBOUNCE_MS = 300;

export interface AccountsPageProps {
  session: SessionResponse;
  initialRecoveryView?: boolean;
  initialAppsView?: boolean;
  onSession: (value: SessionResponse) => void;
  onFailure: (error: unknown) => void;
  onSecurity: () => void;
  onOperations?: (tab?: 'status' | 'import' | 'export' | 'audit') => void;
  onLogout: () => void;
}

export interface RouterSyncProps {
  accountIdParam?: string;
  navigateToAccount?: (id: string) => void;
  navigateBackToList?: () => void;
  navigateToRecovery?: () => void;
  navigateToApps?: () => void;
  navigateToAccountsWithQuery?: (queryString: string) => void;
}

export function useAccountsPageController({
  session,
  initialRecoveryView = false,
  initialAppsView = false,
  onFailure,
  onSecurity,
  onOperations,
  accountIdParam,
  navigateToAccount,
  navigateBackToList,
  navigateToRecovery,
  navigateToApps,
  navigateToAccountsWithQuery,
}: AccountsPageProps & RouterSyncProps) {
  const queryClient = useQueryClient();
  const queryState = useAccountQueryState();
  const isRecoveryView = initialRecoveryView || queryState.recoveryView;
  const isAppsView =
    !isRecoveryView && (initialAppsView || queryState.appsView);
  const isStandaloneSubView = isRecoveryView || isAppsView;

  const [navAlpha, setNavAlpha] = useState<number>(() => readStoredNavAlpha());
  const [displaySettings, setDisplaySettings] = useState<DisplaySettingsState>(
    () => readDisplaySettings(),
  );
  const viewMode: 'list' | 'chart' = queryState.chartView ? 'chart' : 'list';
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [showcaseToggle, setShowcaseToggle] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const urlSearch = queryState.params.get('search') || '';
  const [searchDraft, setSearchDraft] = useState(urlSearch);
  const searchDebounceRef = useRef<number | null>(null);
  const pendingSearchRef = useRef<string | null>(null);

  const cancelPendingSearch = useCallback(() => {
    if (searchDebounceRef.current !== null) {
      window.clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
    pendingSearchRef.current = null;
  }, []);

  useEffect(() => {
    if (pendingSearchRef.current === urlSearch) {
      pendingSearchRef.current = null;
      return;
    }
    cancelPendingSearch();
    setSearchDraft(urlSearch);
  }, [cancelPendingSearch, urlSearch]);

  useEffect(() => cancelPendingSearch, [cancelPendingSearch]);

  const commitSearch = useCallback(
    (nextValue: string) => {
      cancelPendingSearch();
      if (nextValue === urlSearch) return;
      pendingSearchRef.current = nextValue;
      queryState.change({ search: nextValue }, false, true);
    },
    [cancelPendingSearch, queryState, urlSearch],
  );

  const handleSearchInputChange = useCallback(
    (nextValue: string) => {
      setSearchDraft(nextValue);
      cancelPendingSearch();
      if (nextValue === '') {
        if (urlSearch !== '') {
          pendingSearchRef.current = '';
          queryState.change({ search: '' }, false, true);
        }
        return;
      }
      searchDebounceRef.current = window.setTimeout(() => {
        searchDebounceRef.current = null;
        if (nextValue === urlSearch) return;
        pendingSearchRef.current = nextValue;
        queryState.change({ search: nextValue }, false, true);
      }, SEARCH_DEBOUNCE_MS);
    },
    [cancelPendingSearch, queryState, urlSearch],
  );

  const handleSetViewMode = useCallback(
    (nextMode: 'list' | 'chart') => {
      if (nextMode === viewMode) return;
      const currentPage = queryState.params.get('page') || '';
      queryState.change(
        {
          view: nextMode === 'chart' ? 'chart' : '',
          page: currentPage,
        },
        false,
        false,
      );
    },
    [queryState, viewMode],
  );

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
    appsView: isAppsView,
    onFailure: detailState.fail,
  });
  refreshRef.current = listState.refresh;

  const handleCreateApp = useCallback(
    async (
      name: string,
      options?: { domain?: string | null; icon_data?: string | null },
    ): Promise<RegisteredAppResponse | null> => {
      const { data } = await appsCreate({
        body: {
          name,
          ...(options?.domain !== undefined ? { domain: options.domain } : {}),
          ...(options?.icon_data !== undefined
            ? { icon_data: options.icon_data }
            : {}),
        },
        headers: detailState.headers,
        throwOnError: true,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['apps'] }),
        queryClient.invalidateQueries({ queryKey: ['apps-usage'] }),
      ]);
      return data;
    },
    [detailState.headers, queryClient],
  );

  const handleFetchAppIcon = useCallback(
    async (domain: string) => {
      const { data } = await appsFetchIcon({
        body: { domain },
        headers: detailState.headers,
        throwOnError: true,
      });
      return data;
    },
    [detailState.headers],
  );

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

  const shell = useAppShellContext();
  const inPersistentShell = Boolean(shell?.persistentShell);
  const [sidebarLayout, setSidebarLayout] = useState(() =>
    readSidebarLayoutState(),
  );

  useEffect(() => {
    const sync = () => setSidebarLayout(readSidebarLayoutState());
    window.addEventListener(SIDEBAR_LAYOUT_SYNC_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(SIDEBAR_LAYOUT_SYNC_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  // 支持通过 /accounts?modal=tags|create 或 ?inspect=<id> 从全局命令面板/其他页面直达
  useEffect(() => {
    const modal = queryState.params.get('modal');
    const inspectId = queryState.params.get('inspect');
    if (modal === 'tags') {
      tagState.openDialog();
      queryState.change({ modal: '' }, false, true);
    } else if (modal === 'create') {
      detailState.openNew();
      queryState.change({ modal: '' }, false, true);
    } else if (inspectId) {
      const match = listState.items.find((item) => item.id === inspectId);
      void detailState.open(match ?? ({ id: inspectId } as AccountSummary));
      queryState.change({ inspect: '' }, false, true);
    }
  }, [detailState, listState.items, queryState, tagState]);

  // 独立模式下监听 ⌘K 与 / 聚焦搜索框；持久壳层模式下由外层统一接管 ⌘K 命令面板与 / 搜索快捷键
  useEffect(() => {
    if (inPersistentShell) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        if (
          isStandaloneSubView ||
          document.querySelector('[role="dialog"], [role="alertdialog"]')
        ) {
          return;
        }
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isStandaloneSubView &&
        !isEditableElement(event.target) &&
        !document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inPersistentShell, isStandaloneSubView]);

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
      void detailState.open(account, edit, action);
    },
    [detailState],
  );

  const handleOpenFullDetail = useCallback(
    (accountId: string) => {
      if (!navigateToAccount) return;
      detailState.close();
      navigateToAccount(accountId);
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

  const defaultViewAppliedRef = useRef(false);
  useEffect(() => {
    if (defaultViewAppliedRef.current) return;
    defaultViewAppliedRef.current = true;
    if (isStandaloneSubView || accountIdParam || window.location.search) return;
    const savedStore = readSavedViewsStore();
    if (!savedStore.defaultViewId) return;
    const target = [...BUILTIN_ACCOUNT_VIEWS, ...savedStore.views].find(
      (v) => v.id === savedStore.defaultViewId,
    );
    if (!target) return;
    if (target.columns) {
      listState.applyColumns(target.columns);
    }
    if (Object.keys(target.query).length > 0) {
      setSearchDraft(target.query.search ?? '');
      queryState.change({ ...target.query, view: '' }, true, true);
    }
  }, [accountIdParam, isStandaloneSubView, listState, queryState]);

  const handleApplySavedView = useCallback(
    (view: SavedAccountView) => {
      handleCloseDetail();
      cancelPendingSearch();
      if (view.columns) {
        listState.applyColumns(view.columns);
      }
      setSearchDraft(view.query.search ?? '');
      queryState.change({ ...view.query, view: '' }, true);
    },
    [cancelPendingSearch, handleCloseDetail, listState, queryState],
  );

  const purposeSuggestions = useMemo(() => {
    const seen = new Set<string>();
    for (const item of listState.items) {
      const value = item.purpose?.trim();
      if (value) seen.add(value);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [listState.items]);

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

  const handleOpenAppsUsage = useCallback(() => {
    handleCloseDetail();
    if (navigateToApps) {
      navigateToApps();
    } else {
      queryState.openAppsView();
    }
  }, [handleCloseDetail, navigateToApps, queryState]);

  const navigateWithAccountQuery = useCallback(
    (values: Record<string, string>) => {
      cancelPendingSearch();
      setSearchDraft(values.search ?? '');
      if (
        (initialRecoveryView || initialAppsView) &&
        navigateToAccountsWithQuery
      ) {
        const next = new URLSearchParams();
        for (const [k, v] of Object.entries(values)) {
          if (v) next.set(k, v);
        }
        navigateToAccountsWithQuery(next.toString());
      } else {
        queryState.change(values, true);
      }
    },
    [
      cancelPendingSearch,
      initialAppsView,
      initialRecoveryView,
      navigateToAccountsWithQuery,
      queryState,
    ],
  );

  const handleOpenRecoveryAccounts = useCallback(
    (email: string) => navigateWithAccountQuery({ recovery_email: email }),
    [navigateWithAccountQuery],
  );

  const handleSelectSection = useCallback(
    (section: SidebarSectionKey) => {
      handleCloseDetail();
      navigateWithAccountQuery(sectionToAccountQuery(section));
    },
    [handleCloseDetail, navigateWithAccountQuery],
  );

  const handleSelectTag = useCallback(
    (tagId: string) => {
      handleCloseDetail();
      if (
        (initialRecoveryView || initialAppsView) &&
        navigateToAccountsWithQuery
      ) {
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
      initialAppsView,
      initialRecoveryView,
      navigateToAccountsWithQuery,
      queryState,
    ],
  );

  const handleTopNav = useCallback(
    (key: TopNavKey) => {
      handleCloseDetail();
      if (key === 'dashboard') {
        if (
          (initialRecoveryView || initialAppsView) &&
          navigateToAccountsWithQuery
        ) {
          navigateToAccountsWithQuery('view=chart');
        } else {
          queryState.openChartView();
        }
      } else if (key === 'accounts') {
        if (
          (initialRecoveryView || initialAppsView) &&
          navigateToAccountsWithQuery
        ) {
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
      initialAppsView,
      initialRecoveryView,
      navigateToAccountsWithQuery,
      onOperations,
      onSecurity,
      queryState,
      tagState,
    ],
  );

  const handleClearAllFilters = useCallback(() => {
    cancelPendingSearch();
    setSearchDraft('');
    queryState.change(
      { deleted: queryState.params.get('deleted') || '' },
      true,
    );
  }, [cancelPendingSearch, queryState]);

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
    'app_id',
    'app_status',
    'exclude_app_id',
    'archived',
    'purpose',
    'from',
    'to',
    'recovery_email',
    'upstream_recovery_risk',
  ].filter((key) => queryState.params.has(key)).length;

  const selectedCount = listState.selectedItems.length;
  const isChartView = !isStandaloneSubView && viewMode === 'chart';
  const hideStatusStrip =
    !sidebarLayout.collapsed && sidebarLayout.accountsExpanded;

  const currentDrawerIdx = useMemo(() => {
    if (!detailState.drawer || !detailState.detail) return -1;
    return effectiveItems.findIndex(
      (item) => item.id === detailState.detail?.id,
    );
  }, [detailState.detail, detailState.drawer, effectiveItems]);

  const drawerPositionLabel =
    currentDrawerIdx >= 0
      ? `${currentDrawerIdx + 1} / ${effectiveItems.length}`
      : undefined;

  const handleSelectPrevDrawerAccount = useMemo(() => {
    if (currentDrawerIdx <= 0) return undefined;
    return () => {
      const target = effectiveItems[currentDrawerIdx - 1];
      if (target) void detailState.open(target);
    };
  }, [currentDrawerIdx, detailState, effectiveItems]);

  const handleSelectNextDrawerAccount = useMemo(() => {
    if (currentDrawerIdx < 0 || currentDrawerIdx >= effectiveItems.length - 1) {
      return undefined;
    }
    return () => {
      const target = effectiveItems[currentDrawerIdx + 1];
      if (target) void detailState.open(target);
    };
  }, [currentDrawerIdx, detailState, effectiveItems]);

  return {
    queryState,
    detailState,
    listState,
    tagState,
    timezone,
    isRecoveryView,
    isAppsView,
    isStandaloneSubView,
    isChartView,
    hideStatusStrip,
    viewMode,
    navAlpha,
    displaySettings,
    filtersOpen,
    setFiltersOpen,
    showcaseToggle,
    setShowcaseToggle,
    allowDebugUiState,
    showStateShowcase,
    effectivePending,
    effectiveItems,
    activeFilterCount,
    selectedCount,
    activeSection,
    visibleCounts,
    stats,
    sidebarTags,
    purposeSuggestions,
    searchInputRef,
    searchDraft,
    commitSearch,
    handleSearchInputChange,
    handleSetViewMode,
    handleNavAlphaChange,
    handleDisplaySettingsChange,
    handleCreateApp,
    handleFetchAppIcon,
    handleOpenAccount,
    handleOpenFullDetail: navigateToAccount ? handleOpenFullDetail : undefined,
    drawerPositionLabel,
    handleSelectPrevDrawerAccount,
    handleSelectNextDrawerAccount,
    handleCloseDetail,
    handleApplySavedView,
    handleBatchFailure,
    handleOpenRecoveryUsage,
    handleOpenAppsUsage,
    navigateWithAccountQuery,
    handleOpenRecoveryAccounts,
    handleSelectSection,
    handleSelectTag,
    handleTopNav,
    handleClearAllFilters,
  };
}
