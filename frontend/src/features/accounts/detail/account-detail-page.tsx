import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useInRouterContext, useNavigate, useParams } from 'react-router-dom';
import type { ErrorResponse, SessionResponse } from '@/api/generated';
import {
  accountsDetail,
  accountsList,
  appsList,
  auditsList,
  backupStatus,
  dashboardSummary,
  systemVersion,
  tagsList,
} from '@/api/generated';
import {
  EmptyState,
  LoadingState,
  type SidebarCounts,
  type SidebarSectionKey,
  type SidebarSystemStatus,
  type SidebarTagItem,
  type WorkspaceNavKey,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AccountActionDialog } from '../account-action-dialog';
import { AccountForm } from '../account-form';
import {
  AccountBasicInfoForm,
  createDraftFromAccount,
  isDraftDirty,
  type AccountBasicInfoDraft,
} from './account-basic-info-form';
import { AccountHeaderCard } from './account-header-card';
import {
  AccountListPane,
  type AccountListFilterTab,
} from './account-list-pane';
import { AccountMasterDetailLayout } from './account-master-detail-layout';
import { AccountOverviewCard } from './account-overview-card';
import {
  AuditTabPanel,
  BackupsTabPanel,
  ContactsTabPanel,
  SecurityCredentialsTabPanel,
} from './account-secondary-tabs';
import { AccountTabs, type AccountDetailTabKey } from './account-tabs';
import {
  ActivityTimeline,
  type ActivityTimelineItem,
} from './activity-timeline';
import {
  mapAuditToTimeline,
  useSharedDisplayState,
  useToast,
  type PendingGuardAction,
} from './detail-helpers';
import { formatDetailDateTime } from './detail-mock-fixtures';
import { useAccountDetailMutations } from './use-account-detail-mutations';

export {
  AccountDetailPreviewPage,
  type AccountDetailPreviewProps,
} from './account-detail-preview-page';

export type AccountDetailPageProps = {
  session: SessionResponse;
  onSession: (value: SessionResponse) => void;
  onFailure: (error: unknown) => void;
  onSecurity: () => void;
  onOperations?: (tab?: 'status' | 'import' | 'export' | 'audit') => void;
  onLogout: () => void;
  accountIdOverride?: string;
  defaultDisplaySettingsOpen?: boolean;
};

export function AccountDetailPage(props: AccountDetailPageProps) {
  const inRouter = useInRouterContext();
  if (inRouter) {
    return <RoutedAccountDetailPage {...props} />;
  }
  return <AccountDetailLiveBody {...props} />;
}

function RoutedAccountDetailPage(props: AccountDetailPageProps) {
  const navigate = useNavigate();
  const params = useParams<{ accountId?: string }>();
  const goAccount = useCallback(
    (id: string) => {
      void navigate({
        pathname: `/accounts/${id}`,
        search: window.location.search,
      });
    },
    [navigate],
  );
  const goList = useCallback(() => {
    void navigate({
      pathname: '/accounts',
      search: window.location.search,
    });
  }, [navigate]);
  const goListWithQuery = useCallback(
    (queryString: string) => {
      void navigate({
        pathname: '/accounts',
        search: queryString ? `?${queryString}` : '',
      });
    },
    [navigate],
  );
  const goRecovery = useCallback(() => {
    void navigate('/recovery-emails');
  }, [navigate]);
  const goApps = useCallback(() => {
    void navigate('/apps');
  }, [navigate]);

  return (
    <AccountDetailLiveBody
      {...props}
      accountIdParam={params.accountId}
      onNavigateAccount={goAccount}
      onNavigateList={goList}
      onNavigateListWithQuery={goListWithQuery}
      onNavigateRecovery={goRecovery}
      onNavigateApps={goApps}
    />
  );
}

function AccountDetailLiveBody({
  session,
  onSession,
  onFailure,
  onSecurity,
  onOperations,
  onLogout,
  accountIdOverride,
  accountIdParam,
  onNavigateAccount,
  onNavigateList,
  onNavigateListWithQuery,
  onNavigateRecovery,
  onNavigateApps,
  defaultDisplaySettingsOpen,
}: AccountDetailPageProps & {
  accountIdParam?: string;
  onNavigateAccount?: (id: string) => void;
  onNavigateList?: () => void;
  onNavigateListWithQuery?: (queryString: string) => void;
  onNavigateRecovery?: () => void;
  onNavigateApps?: () => void;
}) {
  const queryClient = useQueryClient();
  const headers = useMemo(
    () => ({ 'X-CSRF-Token': session.csrf_token }),
    [session.csrf_token],
  );

  const initialPopoverOpen =
    defaultDisplaySettingsOpen ??
    new URLSearchParams(window.location.search).get('display_settings') ===
      'open';

  const {
    navAlpha,
    handleNavAlphaChange,
    displaySettings,
    handleDisplaySettingsChange,
    displaySettingsOpen,
    setDisplaySettingsOpen,
  } = useSharedDisplayState(initialPopoverOpen);

  const { toastMessage, showToast } = useToast();

  const [selectedId, setSelectedId] = useState<string>(
    accountIdOverride ?? accountIdParam ?? '',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<AccountListFilterTab>('all');
  const [activeTab, setActiveTab] = useState<AccountDetailTabKey>('basic');
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<AccountBasicInfoDraft | null>(null);
  const [secretEpoch, setSecretEpoch] = useState(0);
  const [unsavedGuard, setUnsavedGuard] = useState<PendingGuardAction | null>(
    null,
  );
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [localTimelineAdditions, setLocalTimelineAdditions] = useState<
    Record<string, ActivityTimelineItem[]>
  >({});

  useEffect(() => {
    const incoming = accountIdOverride ?? accountIdParam;
    if (incoming) setSelectedId(incoming);
  }, [accountIdOverride, accountIdParam]);

  const listQueryParams = useMemo(() => {
    return {
      search: searchQuery.trim() || undefined,
      status:
        filterTab === 'normal'
          ? ('normal' as const)
          : filterTab === 'disabled'
            ? ('disabled' as const)
            : filterTab === 'archived'
              ? ('archived' as const)
              : undefined,
      archived: filterTab === 'archived' ? true : undefined,
      deleted: false,
      page: 1,
      page_size: 50,
    };
  }, [filterTab, searchQuery]);

  const accountsQuery = useQuery({
    queryKey: ['detail-accounts-list', listQueryParams],
    queryFn: async ({ signal }) =>
      (
        await accountsList({
          query: listQueryParams,
          signal,
          throwOnError: true,
        })
      ).data,
  });

  const tagsQuery = useQuery({
    queryKey: ['tags'],
    queryFn: async ({ signal }) =>
      (await tagsList({ signal, throwOnError: true })).data,
  });

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

  const backupQuery = useQuery({
    queryKey: ['detail-backup-status'],
    queryFn: async ({ signal }) =>
      (await backupStatus({ signal, throwOnError: true })).data,
  });

  const appsQuery = useQuery({
    queryKey: ['apps'],
    queryFn: async ({ signal }) => {
      const { data } = await appsList({ signal, throwOnError: true });
      return Array.isArray(data) ? data : [];
    },
  });

  const versionQuery = useQuery({
    queryKey: ['detail-system-version'],
    queryFn: async ({ signal }) =>
      (await systemVersion({ signal, throwOnError: true })).data,
  });

  const listItems = accountsQuery.data?.items ?? [];
  const effectiveAccountId = selectedId || listItems[0]?.id || '';

  const detailQuery = useQuery({
    queryKey: ['account-detail', effectiveAccountId],
    queryFn: async ({ signal }) =>
      (
        await accountsDetail({
          path: { account_id: effectiveAccountId },
          signal,
          throwOnError: true,
        })
      ).data,
    enabled: Boolean(effectiveAccountId),
  });

  const auditsQuery = useQuery({
    queryKey: ['account-audits', effectiveAccountId],
    queryFn: async ({ signal }) =>
      (
        await auditsList({
          query: { account_id: effectiveAccountId, page: 1, page_size: 20 },
          signal,
          throwOnError: true,
        })
      ).data,
    enabled: Boolean(effectiveAccountId),
  });

  useEffect(() => {
    const err = accountsQuery.error || detailQuery.error || tagsQuery.error;
    if (err) {
      const code = (err as Partial<ErrorResponse>)?.error?.code;
      if (
        ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(code ?? '')
      ) {
        onFailure(err);
      }
    }
  }, [accountsQuery.error, detailQuery.error, onFailure, tagsQuery.error]);

  useEffect(() => {
    if (!effectiveAccountId || !auditsQuery.data) return;
    setLocalTimelineAdditions((prev) =>
      prev[effectiveAccountId]?.length
        ? { ...prev, [effectiveAccountId]: [] }
        : prev,
    );
  }, [auditsQuery.data, auditsQuery.dataUpdatedAt, effectiveAccountId]);

  useEffect(
    () => () => {
      queryClient.removeQueries({ queryKey: ['detail-accounts-list'] });
      queryClient.removeQueries({ queryKey: ['account-detail'] });
      queryClient.removeQueries({ queryKey: ['account-audits'] });
    },
    [queryClient],
  );

  const account = detailQuery.data ?? null;

  useEffect(() => {
    if (account && !isEditing) {
      setDraft(createDraftFromAccount(account));
    }
  }, [account, isEditing]);

  const effectiveDraft = useMemo(
    () => draft ?? (account ? createDraftFromAccount(account) : null),
    [account, draft],
  );

  const dirty = useMemo(
    () =>
      Boolean(
        isEditing &&
        account &&
        effectiveDraft &&
        isDraftDirty(account, effectiveDraft),
      ),
    [account, effectiveDraft, isEditing],
  );

  const bumpSecretEpoch = useCallback(() => {
    setSecretEpoch((n) => n + 1);
  }, []);

  const prependLocalTimeline = useCallback(
    (accountId: string, title: string) => {
      const entry: ActivityTimelineItem = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        title,
        timestamp: formatDetailDateTime(new Date().toISOString(), true),
        source: '管理员（本地控制台）',
      };
      setLocalTimelineAdditions((prev) => ({
        ...prev,
        [accountId]: [entry, ...(prev[accountId] ?? [])],
      }));
    },
    [],
  );

  const commitSwitchAccount = useCallback(
    (nextId: string) => {
      setIsEditing(false);
      setDraft(null);
      bumpSecretEpoch();
      setSelectedId(nextId);
      onNavigateAccount?.(nextId);
    },
    [bumpSecretEpoch, onNavigateAccount],
  );

  const mutations = useAccountDetailMutations({
    account,
    headers,
    queryClient,
    onFailure,
    onNavigateList,
    setSelectedId,
    setDraft,
    setIsEditing,
    setCreateDialogOpen,
    bumpSecretEpoch,
    commitSwitchAccount,
    prependLocalTimeline,
    showToast,
  });

  const {
    busy,
    conflict,
    conflictMessage,
    setConflictMessage,
    reauthRequired,
    setReauthRequired,
    editReauthRequired,
    setEditReauthRequired,
    confirmAction,
    setConfirmAction,
    resetConflictState,
    handleSaveBasicInfo,
    handleReloadLatest,
    handleLifecycleAction,
    attachTag,
    createAndAttachTag,
    handleCreateAccount,
    handleCreateApp,
    handleFetchAppIcon,
    handleQuickToggleAppStatus,
  } = mutations;

  const switchAccountAndReset = useCallback(
    (nextId: string) => {
      resetConflictState();
      commitSwitchAccount(nextId);
    },
    [commitSwitchAccount, resetConflictState],
  );

  const requestSwitchAccount = useCallback(
    (nextId: string) => {
      if (nextId === effectiveAccountId) return;
      if (dirty) {
        setUnsavedGuard({ type: 'switch', accountId: nextId });
        return;
      }
      switchAccountAndReset(nextId);
    },
    [dirty, effectiveAccountId, switchAccountAndReset],
  );

  const requestCancelEdit = useCallback(() => {
    if (dirty) {
      setUnsavedGuard({ type: 'cancel-edit' });
      return;
    }
    setIsEditing(false);
    resetConflictState();
    if (account) setDraft(createDraftFromAccount(account));
  }, [account, dirty, resetConflictState]);

  // Escape 退出编辑模式（浮层优先自行拦截 Escape）
  useEffect(() => {
    if (!isEditing) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (
        displaySettingsOpen ||
        confirmAction !== null ||
        unsavedGuard !== null ||
        createDialogOpen
      ) {
        return;
      }
      event.preventDefault();
      requestCancelEdit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    confirmAction,
    createDialogOpen,
    displaySettingsOpen,
    isEditing,
    requestCancelEdit,
    unsavedGuard,
  ]);

  const copyField = useCallback(
    async (label: string, value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        showToast(`已复制${label}`);
      } catch {
        showToast(`浏览器未允许复制${label}，请手动选择复制`);
      }
    },
    [showToast],
  );

  const handleWorkspaceNav = useCallback(
    (key: WorkspaceNavKey) => {
      if (key === 'dashboard') {
        if (onNavigateListWithQuery) onNavigateListWithQuery('view=chart');
        else onNavigateList?.();
      } else if (key === 'accounts') {
        onNavigateList?.();
      } else if (key === 'apps') {
        if (onNavigateApps) onNavigateApps();
        else if (onNavigateListWithQuery) onNavigateListWithQuery('view=apps');
        else onNavigateList?.();
      } else if (key === 'recovery') {
        if (onNavigateRecovery) onNavigateRecovery();
        else if (onNavigateListWithQuery)
          onNavigateListWithQuery('view=recovery');
        else onNavigateList?.();
      } else if (key === 'archived') {
        setFilterTab('archived');
      } else if (key === 'trash') {
        if (onNavigateListWithQuery) onNavigateListWithQuery('deleted=true');
        else onNavigateList?.();
      } else if (key === 'tags') {
        if (onNavigateListWithQuery) onNavigateListWithQuery('modal=tags');
        else onNavigateList?.();
      } else if (key === 'audit') {
        onOperations?.('audit');
      } else if (key === 'transfer') {
        onOperations?.('import');
      } else if (key === 'backup') {
        onOperations?.('status');
      } else if (key === 'settings') {
        onSecurity();
      }
    },
    [
      onNavigateApps,
      onNavigateList,
      onNavigateListWithQuery,
      onNavigateRecovery,
      onOperations,
      onSecurity,
    ],
  );

  const handleSidebarSection = useCallback(
    (section: SidebarSectionKey) => {
      const map: Record<SidebarSectionKey, string> = {
        all: '',
        normal: 'status=normal',
        pending: 'status=pending_verification',
        risk: 'statuses=restricted,login_failed',
        disabled: 'status=disabled',
        archived: 'archived=true',
        trash: 'deleted=true',
      };
      if (onNavigateListWithQuery) {
        onNavigateListWithQuery(map[section]);
      } else if (section === 'archived') {
        setFilterTab('archived');
      } else {
        onNavigateList?.();
      }
    },
    [onNavigateList, onNavigateListWithQuery],
  );

  const sidebarCounts: SidebarCounts | undefined = useMemo(() => {
    const s = summaryQuery.data;
    if (!s) return undefined;
    return {
      all: s.total,
      normal: s.normal,
      pending: s.pending_verification,
      risk: s.risk ?? s.abnormal,
      disabled: s.disabled ?? 0,
      archived: s.archived ?? 0,
      trash: s.deleted_count ?? 0,
    };
  }, [summaryQuery.data]);

  const sidebarTags: SidebarTagItem[] = useMemo(() => {
    const tagCounts = summaryQuery.data?.tag_counts;
    return (tagsQuery.data ?? []).map((tag) => ({
      id: tag.id,
      name: tag.name,
      count: tagCounts ? (tagCounts[tag.id] ?? 0) : undefined,
    }));
  }, [summaryQuery.data?.tag_counts, tagsQuery.data]);

  const timelineItems = useMemo(() => {
    const fromApi = mapAuditToTimeline(auditsQuery.data?.items ?? []);
    const local = account ? (localTimelineAdditions[account.id] ?? []) : [];
    const fallback: ActivityTimelineItem[] = account
      ? [
          {
            id: `upd-${account.id}`,
            title: '更新账号信息',
            timestamp: formatDetailDateTime(account.updated_at, true),
          },
          {
            id: `cre-${account.id}`,
            title: '创建账号',
            timestamp: formatDetailDateTime(account.created_at, true),
          },
        ]
      : [];
    const merged = [...local, ...(fromApi.length > 0 ? fromApi : fallback)];
    return merged.slice(0, 12);
  }, [account, auditsQuery.data?.items, localTimelineAdditions]);

  const lastBackupLabel = backupQuery.data?.last_success_at
    ? formatDetailDateTime(backupQuery.data.last_success_at, false)
    : '未配置';

  const backupState = backupQuery.data?.state;
  const backupHealthy =
    backupState === 'success' || backupState === 'running'
      ? true
      : backupState === 'failed' || backupState === 'stale'
        ? false
        : undefined;

  const systemStatus: SidebarSystemStatus = {
    healthy: backupHealthy ?? true,
    headline:
      backupState === 'failed'
        ? '备份状态异常'
        : backupState === 'stale'
          ? '备份已过期'
          : backupState === 'unconfigured'
            ? '未配置自动备份'
            : backupState === 'never_run'
              ? '尚未执行备份'
              : backupState === 'running'
                ? '正在执行备份'
                : backupState === 'success'
                  ? '系统运行正常'
                  : '状态同步中',
    httpsEnabled:
      typeof window !== 'undefined' && window.location.protocol === 'https:',
    csrfEnabled: Boolean(session.csrf_token),
    encryptionLabel: '字段加密 AES-256-GCM',
    totpEnabled: Boolean(session.totp_enabled),
    lastBackupLabel,
    version: versionQuery.data?.version
      ? `v${versionQuery.data.version}`
      : undefined,
  };

  const isListFiltered = Boolean(searchQuery.trim() || filterTab !== 'all');
  const totalCount = isListFiltered
    ? (accountsQuery.data?.total ?? listItems.length)
    : (summaryQuery.data?.total ??
      accountsQuery.data?.total ??
      listItems.length);

  return (
    <>
      <AccountMasterDetailLayout
        navAlpha={navAlpha}
        onNavAlphaChange={handleNavAlphaChange}
        displaySettings={displaySettings}
        onDisplaySettingsChange={handleDisplaySettingsChange}
        displaySettingsOpen={displaySettingsOpen}
        onDisplaySettingsOpenChange={setDisplaySettingsOpen}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        activeNav={filterTab === 'archived' ? 'archived' : 'accounts'}
        onSelectNav={handleWorkspaceNav}
        onSelectSection={handleSidebarSection}
        onSelectTag={(tagId) =>
          onNavigateListWithQuery?.(
            new URLSearchParams({ tag: tagId }).toString(),
          )
        }
        onAddTag={() => onNavigateListWithQuery?.('modal=tags')}
        sidebarCounts={sidebarCounts}
        sidebarTags={sidebarTags}
        trashCount={summaryQuery.data?.deleted_count ?? 0}
        systemStatus={systemStatus}
        notifications={[]}
        onOpenSecurity={onSecurity}
        onOpenRecoveryUsage={onNavigateRecovery}
        onOpenOperations={
          onOperations ? () => onOperations('status') : undefined
        }
        onLogout={onLogout}
        onNavigateAccountsList={() => onNavigateList?.()}
        listPane={
          <AccountListPane
            accounts={listItems}
            totalCount={totalCount}
            selectedAccountId={effectiveAccountId || null}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            filterTab={filterTab}
            onFilterTabChange={setFilterTab}
            favorites={favorites}
            onToggleFavorite={(id) => {
              setFavorites((cur) => ({ ...cur, [id]: !cur[id] }));
            }}
            onSelectAccount={requestSwitchAccount}
            onCreateAccount={() => setCreateDialogOpen(true)}
            isLoading={accountsQuery.isPending}
            isError={accountsQuery.isError}
            onRetry={() => void accountsQuery.refetch()}
          />
        }
        detailContent={
          detailQuery.isLoading ? (
            <LoadingState
              title="正在加载账号详情…"
              description="正在获取加密资料与活动时间线…"
            />
          ) : detailQuery.isError &&
            (detailQuery.error as Partial<ErrorResponse> | null)?.error
              ?.code !== 'ACCOUNT_NOT_FOUND' ? (
            <EmptyState
              role="alert"
              title="账号详情加载失败"
              description="无法从服务器获取账号资料，请检查网络连接与服务状态后重试。"
              createLabel="重试加载"
              actionIcon="refresh"
              onCreate={() => void detailQuery.refetch()}
            />
          ) : !account || !effectiveDraft ? (
            <EmptyState
              title="未找到该账号"
              description="请从中间列表选择一个 Gmail 账号，或创建新账号。"
              onCreate={() => setCreateDialogOpen(true)}
            />
          ) : (
            <>
              <AccountHeaderCard
                account={account}
                availableTags={tagsQuery.data ?? []}
                isEditing={isEditing}
                busy={busy}
                onCopyEmail={(email) => void copyField('邮箱', email)}
                onEdit={() => {
                  setActiveTab('basic');
                  bumpSecretEpoch();
                  setDraft(createDraftFromAccount(account));
                  setIsEditing(true);
                }}
                onArchive={() => setConfirmAction('archive')}
                onUnarchive={() => setConfirmAction('unarchive')}
                onDelete={() => setConfirmAction('delete')}
                onRestore={() => setConfirmAction('restore')}
                onPermanentDelete={() => {
                  setReauthRequired(false);
                  setConflictMessage('');
                  setConfirmAction('permanent-delete');
                }}
                onViewAudit={() => setActiveTab('audit')}
                onMarkLoggedIn={() => void handleLifecycleAction('logged-in')}
                onMarkVerified={() => void handleLifecycleAction('verified')}
                onAddTag={(tag) => void attachTag(tag)}
                onCreateAndAttachTag={(name) => void createAndAttachTag(name)}
              />

              <AccountTabs activeTab={activeTab} onChange={setActiveTab} />

              <div
                role="tabpanel"
                id={`account-tabpanel-${activeTab}`}
                aria-labelledby={`account-tab-${activeTab}`}
              >
                {activeTab === 'basic' && (
                  <div className="macos-detail-body-grid">
                    <AccountBasicInfoForm
                      account={account}
                      draft={effectiveDraft}
                      isEditing={isEditing}
                      isDirty={dirty}
                      busy={busy}
                      conflict={conflict}
                      conflictMessage={conflictMessage}
                      reauthRequired={editReauthRequired}
                      secretEpoch={secretEpoch}
                      session={session}
                      appsCatalog={appsQuery.data ?? []}
                      onCreateApp={handleCreateApp}
                      onFetchAppIcon={handleFetchAppIcon}
                      onQuickToggleAppStatus={handleQuickToggleAppStatus}
                      onSession={(next) => {
                        setEditReauthRequired(false);
                        onSession(next);
                      }}
                      onFailure={onFailure}
                      onDraftChange={setDraft}
                      onSubmit={handleSaveBasicInfo}
                      onCancel={requestCancelEdit}
                      onReloadLatest={() => void handleReloadLatest()}
                      onCopyField={(label, val) => void copyField(label, val)}
                      onPasswordAuditEvent={(intent) => {
                        prependLocalTimeline(
                          account.id,
                          intent === 'copy'
                            ? '复制凭据（密码）'
                            : '查看凭据（密码）',
                        );
                      }}
                      onToast={showToast}
                    />
                    <div className="macos-detail-side-cards">
                      <AccountOverviewCard
                        account={account}
                        updateSource={timelineItems[0]?.source}
                        onCopyId={(id) => void copyField('记录 ID', id)}
                      />
                      <ActivityTimeline
                        items={timelineItems.slice(0, 6)}
                        onViewFullLog={() => setActiveTab('audit')}
                      />
                    </div>
                  </div>
                )}

                {activeTab === 'credentials' && (
                  <SecurityCredentialsTabPanel
                    account={account}
                    secretEpoch={secretEpoch}
                    session={session}
                    onSession={onSession}
                    onFailure={onFailure}
                    onPasswordAuditEvent={(intent) =>
                      prependLocalTimeline(
                        account.id,
                        intent === 'copy'
                          ? '复制凭据（密码）'
                          : '查看凭据（密码）',
                      )
                    }
                    onToast={showToast}
                  />
                )}

                {activeTab === 'contacts' && (
                  <ContactsTabPanel
                    account={account}
                    secretEpoch={secretEpoch}
                    session={session}
                    onSession={onSession}
                    onFailure={onFailure}
                    onCopyField={(label, val) => void copyField(label, val)}
                  />
                )}

                {activeTab === 'audit' && (
                  <AuditTabPanel
                    items={timelineItems}
                    onOpenGlobalAudit={
                      onOperations ? () => onOperations('audit') : undefined
                    }
                  />
                )}

                {activeTab === 'backups' && (
                  <BackupsTabPanel
                    account={account}
                    lastBackupLabel={lastBackupLabel}
                    backupHealthy={backupHealthy ?? null}
                    backupHeadline={systemStatus.headline}
                    onOpenBackupPage={
                      onOperations ? () => onOperations('status') : undefined
                    }
                  />
                )}
              </div>
            </>
          )
        }
        toastMessage={toastMessage}
      />

      {/* 归档 / 删除 / 恢复 / 永久删除 确认弹窗 */}
      <AccountActionDialog
        confirm={confirmAction}
        detail={account}
        session={session}
        reauthRequired={reauthRequired}
        busy={busy}
        conflict={conflict}
        notice={conflictMessage}
        onClose={() => {
          setReauthRequired(false);
          setConflictMessage('');
          setConfirmAction(null);
        }}
        onSession={(next) => {
          setReauthRequired(false);
          setConflictMessage('');
          onSession(next);
        }}
        onFailure={onFailure}
        onConfirm={(action) => void handleLifecycleAction(action)}
      />

      {/* 未保存修改确认弹窗 */}
      <AlertDialog
        open={unsavedGuard !== null}
        onOpenChange={(open) => {
          if (!open) setUnsavedGuard(null);
        }}
      >
        <AlertDialogContent className="macos-glass-modal rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的修改？</AlertDialogTitle>
            <AlertDialogDescription>
              当前表单包含尚未保存的改动。继续操作将放弃这些修改且不会写入服务器。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const pending = unsavedGuard;
                setUnsavedGuard(null);
                if (!pending) return;
                if (pending.type === 'switch') {
                  switchAccountAndReset(pending.accountId);
                } else {
                  setIsEditing(false);
                  resetConflictState();
                  if (account) setDraft(createDraftFromAccount(account));
                }
              }}
            >
              放弃修改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* 新建账号弹窗 */}
      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          if (!open && !busy) setCreateDialogOpen(false);
        }}
      >
        <DialogContent className="macos-glass-modal flex max-h-[90vh] min-h-0 flex-col overflow-hidden rounded-[22px] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>新建账号</DialogTitle>
            <DialogDescription>
              保存后密码、手机号与备注将以 AES-256-GCM 加密存储。
            </DialogDescription>
          </DialogHeader>
          <AccountForm
            tags={tagsQuery.data ?? []}
            appsCatalog={appsQuery.data ?? []}
            onCreateApp={handleCreateApp}
            onFetchAppIcon={handleFetchAppIcon}
            busy={busy}
            conflict={false}
            onFailure={onFailure}
            onSubmit={handleCreateAccount}
            onCancel={() => setCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
