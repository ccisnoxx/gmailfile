import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useInRouterContext, useNavigate, useParams } from 'react-router-dom';
import type {
  AccountCreateWritable,
  AccountDetail,
  AccountPatchWritable,
  AuditItem,
  ErrorResponse,
  SessionResponse,
  TagResponse,
} from '@/api/generated';
import {
  accountsArchive,
  accountsCreate,
  accountsDelete,
  accountsDetail,
  accountsList,
  accountsMarkVerified,
  accountsPatch,
  accountsRestore,
  auditsList,
  backupStatus,
  dashboardSummary,
  systemVersion,
  tagsCreate,
  tagsList,
} from '@/api/generated';
import {
  DETAIL_DEFAULT_NAV_ALPHA,
  EmptyState,
  LoadingState,
  persistDisplaySettings,
  persistNavAlpha,
  readDisplaySettings,
  readStoredNavAlpha,
  subscribeDisplaySettings,
  subscribeNavAlpha,
  type DisplaySettingsState,
  type SidebarSystemStatus,
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
import type { AccountAction } from '../constants';
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
  createDetailMockAccounts,
  createDetailMockTimelines,
  DETAIL_DEFAULT_ACCOUNT_ID,
  DETAIL_MOCK_LAST_BACKUP,
  DETAIL_MOCK_PASSWORDS,
  DETAIL_MOCK_TAGS,
  DETAIL_MOCK_TOTAL_COUNT,
  DETAIL_MOCK_TRASH_COUNT,
  formatDetailDateTime,
} from './detail-mock-fixtures';

const auditEventLabels: Record<string, string> = {
  account_created: '创建账号',
  account_updated: '更新账号信息',
  account_archived: '归档账号',
  account_deleted: '删除账号',
  account_restored: '恢复账号',
  account_verified: '标记已验证',
  account_logged_in: '标记已登录',
  password_revealed: '查看凭据（密码）',
  password_copied: '复制凭据（密码）',
  totp_enabled: '启用二步验证（TOTP）',
};

function mapAuditToTimeline(items: AuditItem[]): ActivityTimelineItem[] {
  return items.map((item) => ({
    id: item.id,
    title:
      auditEventLabels[item.event_type] ?? item.operation ?? item.event_type,
    timestamp: formatDetailDateTime(item.created_at, true),
    source: item.ip_address
      ? `管理员（${item.ip_address}）`
      : '管理员（本地控制台）',
  }));
}

function summarizeChangedFields(
  prev: AccountDetail,
  next: AccountBasicInfoDraft,
): string {
  const fields: string[] = [];
  if (prev.gmail_email !== next.gmail_email) fields.push('Gmail 地址');
  if (next.password) fields.push('密码');
  if ((prev.phone ?? '') !== next.phone) fields.push('手机号');
  if (
    (prev.recovery_email_external ?? prev.recovery_email ?? '') !==
    next.recovery_email_external
  ) {
    fields.push('辅助邮箱');
  }
  if (prev.status !== next.status) fields.push('状态');
  if (prev.two_factor_status !== next.two_factor_status) fields.push('2FA');
  if ((prev.purpose ?? '') !== next.purpose) fields.push('用途');
  if ((prev.notes ?? '') !== next.notes) fields.push('备注');
  return fields.length > 0
    ? `更新账号信息（${fields.slice(0, 3).join('、')}）`
    : '更新账号信息';
}

function useSharedDisplayState(defaultOpen: boolean) {
  const [navAlpha, setNavAlpha] = useState<number>(() =>
    readStoredNavAlpha(DETAIL_DEFAULT_NAV_ALPHA),
  );
  const [displaySettings, setDisplaySettings] = useState<DisplaySettingsState>(
    () => readDisplaySettings(),
  );
  const [displaySettingsOpen, setDisplaySettingsOpen] =
    useState<boolean>(defaultOpen);

  useEffect(() => {
    const unsubAlpha = subscribeNavAlpha(setNavAlpha, DETAIL_DEFAULT_NAV_ALPHA);
    const unsubDisplay = subscribeDisplaySettings(setDisplaySettings);
    return () => {
      unsubAlpha();
      unsubDisplay();
    };
  }, []);

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

  return {
    navAlpha,
    handleNavAlphaChange,
    displaySettings,
    handleDisplaySettingsChange,
    displaySettingsOpen,
    setDisplaySettingsOpen,
  };
}

function useToast() {
  const [message, setMessage] = useState('');
  const timerRef = useRef<number | undefined>(undefined);

  const showToast = useCallback((text: string) => {
    setMessage(text);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setMessage('');
    }, 2800);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
    },
    [],
  );

  return { toastMessage: message, showToast };
}

type PendingGuardAction =
  { type: 'switch'; accountId: string } | { type: 'cancel-edit' };

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

  return (
    <AccountDetailLiveBody
      {...props}
      accountIdParam={params.accountId}
      onNavigateAccount={goAccount}
      onNavigateList={goList}
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
  defaultDisplaySettingsOpen,
}: AccountDetailPageProps & {
  accountIdParam?: string;
  onNavigateAccount?: (id: string) => void;
  onNavigateList?: () => void;
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
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [conflictMessage, setConflictMessage] = useState('');
  const [secretEpoch, setSecretEpoch] = useState(0);
  const [confirmAction, setConfirmAction] = useState<AccountAction | null>(
    null,
  );
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

  const commitSwitchAccount = useCallback(
    (nextId: string) => {
      setIsEditing(false);
      setConflict(false);
      setConflictMessage('');
      setDraft(null);
      setSecretEpoch((n) => n + 1);
      setSelectedId(nextId);
      onNavigateAccount?.(nextId);
    },
    [onNavigateAccount],
  );

  const requestSwitchAccount = useCallback(
    (nextId: string) => {
      if (nextId === effectiveAccountId) return;
      if (dirty) {
        setUnsavedGuard({ type: 'switch', accountId: nextId });
        return;
      }
      commitSwitchAccount(nextId);
    },
    [commitSwitchAccount, dirty, effectiveAccountId],
  );

  const requestCancelEdit = useCallback(() => {
    if (dirty) {
      setUnsavedGuard({ type: 'cancel-edit' });
      return;
    }
    setIsEditing(false);
    setConflict(false);
    setConflictMessage('');
    if (account) setDraft(createDraftFromAccount(account));
  }, [account, dirty]);

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

  const handleSaveBasicInfo = useCallback(
    async (nextDraft: AccountBasicInfoDraft) => {
      if (!account || busy) return;
      setBusy(true);
      setConflict(false);
      setConflictMessage('');

      try {
        const patch: AccountPatchWritable = {
          row_version: account.row_version,
          gmail_email: nextDraft.gmail_email,
          phone: nextDraft.phone || null,
          recovery_account_id: account.recovery_account_id,
          recovery_email_external: nextDraft.recovery_email_external || null,
          status: nextDraft.status,
          two_factor_status: nextDraft.two_factor_status,
          purpose: nextDraft.purpose || null,
          notes: nextDraft.notes || null,
          tag_ids: account.tags.map((t) => t.id),
        };
        if (nextDraft.password) {
          patch.password = nextDraft.password;
        }

        const { data } = await accountsPatch({
          path: { account_id: account.id },
          body: patch,
          headers,
          throwOnError: true,
        });

        queryClient.setQueryData(['account-detail', data.id], data);
        setDraft(createDraftFromAccount(data));
        setIsEditing(false);
        prependLocalTimeline(
          data.id,
          summarizeChangedFields(account, nextDraft),
        );
        showToast(`已保存修改，当前版本更新为 v${data.row_version}`);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['detail-accounts-list'] }),
          queryClient.invalidateQueries({
            queryKey: ['account-audits', data.id],
          }),
          queryClient.invalidateQueries({ queryKey: ['summary'] }),
        ]);
      } catch (error) {
        const err = error as Partial<ErrorResponse>;
        const code = err?.error?.code;
        if (code === 'ROW_VERSION_CONFLICT') {
          setConflict(true);
          setConflictMessage(
            `版本冲突：账号已被其他页面修改（本地基于 v${account.row_version}），请重新加载最新版本后再编辑。`,
          );
        } else {
          showToast(err?.error?.message ?? '保存失败，请稍后重试');
          if (
            ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
              code ?? '',
            )
          ) {
            onFailure(error);
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [
      account,
      busy,
      headers,
      onFailure,
      prependLocalTimeline,
      queryClient,
      showToast,
    ],
  );

  const handleReloadLatest = useCallback(async () => {
    if (!account) return;
    setBusy(true);
    try {
      const { data } = await accountsDetail({
        path: { account_id: account.id },
        throwOnError: true,
      });
      queryClient.setQueryData(['account-detail', data.id], data);
      setDraft(createDraftFromAccount(data));
      setConflict(false);
      setConflictMessage('');
      showToast(`已重新加载最新版本 v${data.row_version}`);
    } catch (error) {
      onFailure(error);
    } finally {
      setBusy(false);
    }
  }, [account, onFailure, queryClient, showToast]);

  const handleLifecycleAction = useCallback(
    async (action: AccountAction) => {
      if (!account || busy) return;
      setBusy(true);
      setConflict(false);
      try {
        const fn = {
          archive: accountsArchive,
          delete: accountsDelete,
          restore: accountsRestore,
          verified: accountsMarkVerified,
          'logged-in': accountsMarkVerified,
        }[action];
        const { data } = await fn({
          path: { account_id: account.id },
          body: { row_version: account.row_version },
          headers,
          throwOnError: true,
        });
        queryClient.setQueryData(['account-detail', data.id], data);
        setDraft(createDraftFromAccount(data));
        setConfirmAction(null);
        setIsEditing(false);
        setSecretEpoch((n) => n + 1);
        const label =
          action === 'archive'
            ? '归档账号'
            : action === 'delete'
              ? '删除账号'
              : action === 'restore'
                ? '恢复账号'
                : '标记今天已验证';
        prependLocalTimeline(data.id, label);
        showToast(`${label}成功（v${data.row_version}）`);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['detail-accounts-list'] }),
          queryClient.invalidateQueries({
            queryKey: ['account-audits', data.id],
          }),
          queryClient.invalidateQueries({ queryKey: ['summary'] }),
        ]);
      } catch (error) {
        const err = error as Partial<ErrorResponse>;
        const code = err?.error?.code;
        if (code === 'ROW_VERSION_CONFLICT') {
          setConflict(true);
          setConflictMessage('操作触发版本冲突，请重新加载最新版本后重试。');
        } else {
          showToast(err?.error?.message ?? '操作失败，请稍后重试');
          if (
            ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
              code ?? '',
            )
          ) {
            onFailure(error);
          }
        }
      } finally {
        setBusy(false);
      }
    },
    [
      account,
      busy,
      headers,
      onFailure,
      prependLocalTimeline,
      queryClient,
      showToast,
    ],
  );

  const attachTag = useCallback(
    async (tag: TagResponse) => {
      if (!account || busy) return;
      const nextTagIds = Array.from(
        new Set([...account.tags.map((t) => t.id), tag.id]),
      );
      setBusy(true);
      try {
        const { data } = await accountsPatch({
          path: { account_id: account.id },
          body: { row_version: account.row_version, tag_ids: nextTagIds },
          headers,
          throwOnError: true,
        });
        queryClient.setQueryData(['account-detail', data.id], data);
        prependLocalTimeline(data.id, `添加标签（${tag.name}）`);
        showToast(`已添加标签“${tag.name}”`);
        await queryClient.invalidateQueries({
          queryKey: ['detail-accounts-list'],
        });
      } catch (error) {
        const err = error as Partial<ErrorResponse>;
        showToast(err?.error?.message ?? '添加标签失败');
      } finally {
        setBusy(false);
      }
    },
    [account, busy, headers, prependLocalTimeline, queryClient, showToast],
  );

  const createAndAttachTag = useCallback(
    async (name: string) => {
      if (!account || busy) return;
      setBusy(true);
      try {
        const { data: created } = await tagsCreate({
          body: { name },
          headers,
          throwOnError: true,
        });
        await queryClient.invalidateQueries({ queryKey: ['tags'] });
        const nextTagIds = Array.from(
          new Set([...account.tags.map((t) => t.id), created.id]),
        );
        const { data } = await accountsPatch({
          path: { account_id: account.id },
          body: { row_version: account.row_version, tag_ids: nextTagIds },
          headers,
          throwOnError: true,
        });
        queryClient.setQueryData(['account-detail', data.id], data);
        prependLocalTimeline(data.id, `新增并绑定标签（${created.name}）`);
        showToast(`已添加标签“${created.name}”`);
        await queryClient.invalidateQueries({
          queryKey: ['detail-accounts-list'],
        });
      } catch (error) {
        const err = error as Partial<ErrorResponse>;
        showToast(err?.error?.message ?? '新建标签失败');
      } finally {
        setBusy(false);
      }
    },
    [account, busy, headers, prependLocalTimeline, queryClient, showToast],
  );

  const handleCreateAccount = useCallback(
    async (body: AccountCreateWritable) => {
      setBusy(true);
      try {
        const { data } = await accountsCreate({
          body,
          headers,
          throwOnError: true,
        });
        setCreateDialogOpen(false);
        showToast(`已新建账号 ${data.gmail_email}`);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['detail-accounts-list'] }),
          queryClient.invalidateQueries({ queryKey: ['summary'] }),
        ]);
        commitSwitchAccount(data.id);
      } catch (error) {
        const err = error as Partial<ErrorResponse>;
        showToast(err?.error?.message ?? '创建账号失败');
        onFailure(error);
      } finally {
        setBusy(false);
      }
    },
    [commitSwitchAccount, headers, onFailure, queryClient, showToast],
  );

  const handleWorkspaceNav = useCallback(
    (key: WorkspaceNavKey) => {
      if (key === 'accounts') {
        onNavigateList?.();
      } else if (key === 'dashboard') {
        onNavigateList?.();
      } else if (key === 'archived') {
        setFilterTab('archived');
      } else if (key === 'trash') {
        onNavigateList?.();
      } else if (key === 'audit') {
        onOperations?.('audit');
      } else if (key === 'transfer') {
        onOperations?.('import');
      } else if (key === 'backup') {
        onOperations?.('status');
      } else if (key === 'settings') {
        onSecurity();
      } else if (key === 'tags') {
        onNavigateList?.();
      }
    },
    [onNavigateList, onOperations, onSecurity],
  );

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

  const systemStatus: SidebarSystemStatus = {
    healthy: backupQuery.data?.state !== 'failed',
    headline: '系统运行正常',
    httpsEnabled: true,
    csrfEnabled: true,
    encryptionLabel: '字段加密 AES-256-GCM',
    totpEnabled: true,
    lastBackupLabel,
    version: versionQuery.data?.version
      ? `v${versionQuery.data.version}`
      : 'v1.1.0',
  };

  const totalCount =
    summaryQuery.data?.total ?? accountsQuery.data?.total ?? listItems.length;

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
        activeNav="accounts"
        onSelectNav={handleWorkspaceNav}
        trashCount={0}
        systemStatus={systemStatus}
        notifications={['已启用防篡改哈希链审计与高风险操作 TOTP 二次验证。']}
        onOpenSecurity={onSecurity}
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
            filterTab={filterTab}
            onFilterTabChange={setFilterTab}
            favorites={favorites}
            onToggleFavorite={(id) => {
              setFavorites((cur) => ({ ...cur, [id]: !cur[id] }));
            }}
            onSelectAccount={requestSwitchAccount}
            onCreateAccount={() => setCreateDialogOpen(true)}
            isLoading={accountsQuery.isPending}
          />
        }
        detailContent={
          detailQuery.isPending ? (
            <LoadingState
              title="正在加载账号详情…"
              description="正在获取加密资料与活动时间线…"
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
                  setSecretEpoch((n) => n + 1);
                  setDraft(createDraftFromAccount(account));
                  setIsEditing(true);
                }}
                onArchive={() => setConfirmAction('archive')}
                onDelete={() => setConfirmAction('delete')}
                onRestore={() => setConfirmAction('restore')}
                onViewAudit={() => setActiveTab('audit')}
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
                      secretEpoch={secretEpoch}
                      session={session}
                      onSession={onSession}
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

      {/* 归档 / 删除 / 恢复 确认弹窗 */}
      <AccountActionDialog
        confirm={confirmAction}
        detail={account}
        busy={busy}
        conflict={conflict}
        notice={conflictMessage}
        onClose={() => setConfirmAction(null)}
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
                  commitSwitchAccount(pending.accountId);
                } else {
                  setIsEditing(false);
                  setConflict(false);
                  setConflictMessage('');
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
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="macos-glass-modal flex max-h-[90vh] flex-col rounded-[22px] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>新建账号</DialogTitle>
            <DialogDescription>
              保存后密码、手机号与备注将以 AES-256-GCM 加密存储。
            </DialogDescription>
          </DialogHeader>
          <AccountForm
            tags={tagsQuery.data ?? []}
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

/* ============================================================================
 * 高保真原型预览页（无需后端会话，默认展示 6 条示例账号与“界面与显示”浮层）
 * ============================================================================ */

export type AccountDetailPreviewProps = {
  initialAccountId?: string;
  defaultDisplaySettingsOpen?: boolean;
  simulateVersionConflict?: boolean;
};

export function AccountDetailPreviewPage(props: AccountDetailPreviewProps) {
  const inRouter = useInRouterContext();
  if (inRouter) {
    return <RoutedAccountDetailPreviewPage {...props} />;
  }
  return <AccountDetailPreviewBody {...props} />;
}

function RoutedAccountDetailPreviewPage(props: AccountDetailPreviewProps) {
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
    <AccountDetailPreviewBody
      {...props}
      initialAccountId={params.accountId ?? props.initialAccountId}
      onNavigateAccount={goAccount}
      onNavigateList={goList}
    />
  );
}

function AccountDetailPreviewBody({
  initialAccountId,
  defaultDisplaySettingsOpen = true,
  simulateVersionConflict = false,
  onNavigateAccount,
  onNavigateList,
}: AccountDetailPreviewProps & {
  onNavigateAccount?: (id: string) => void;
  onNavigateList?: () => void;
}) {
  const {
    navAlpha,
    handleNavAlphaChange,
    displaySettings,
    handleDisplaySettingsChange,
    displaySettingsOpen,
    setDisplaySettingsOpen,
  } = useSharedDisplayState(defaultDisplaySettingsOpen);

  const { toastMessage, showToast } = useToast();

  const [accounts, setAccounts] = useState<AccountDetail[]>(() =>
    createDetailMockAccounts(),
  );
  const [tags, setTags] = useState<TagResponse[]>(() => [...DETAIL_MOCK_TAGS]);
  const [timelines, setTimelines] = useState<
    Record<string, ActivityTimelineItem[]>
  >(() => createDetailMockTimelines());

  const [selectedId, setSelectedId] = useState<string>(() => {
    const initial = initialAccountId || DETAIL_DEFAULT_ACCOUNT_ID;
    const found = createDetailMockAccounts().some((a) => a.id === initial);
    return found ? initial : DETAIL_DEFAULT_ACCOUNT_ID;
  });

  useEffect(() => {
    if (initialAccountId && accounts.some((a) => a.id === initialAccountId)) {
      setSelectedId(initialAccountId);
    }
  }, [accounts, initialAccountId]);

  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<AccountListFilterTab>('all');
  const [activeTab, setActiveTab] = useState<AccountDetailTabKey>('basic');
  const [favorites, setFavorites] = useState<Record<string, boolean>>({});
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<AccountBasicInfoDraft>(() =>
    createDraftFromAccount(createDetailMockAccounts()[0]),
  );
  const [conflict, setConflict] = useState(false);
  const [conflictMessage, setConflictMessage] = useState('');
  const [conflictTriggeredOnce, setConflictTriggeredOnce] = useState(false);
  const [secretEpoch, setSecretEpoch] = useState(0);
  const [confirmAction, setConfirmAction] = useState<AccountAction | null>(
    null,
  );
  const [unsavedGuard, setUnsavedGuard] = useState<PendingGuardAction | null>(
    null,
  );
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [trashCount, setTrashCount] = useState(DETAIL_MOCK_TRASH_COUNT);

  const account = useMemo(
    () => accounts.find((a) => a.id === selectedId) ?? accounts[0] ?? null,
    [accounts, selectedId],
  );

  useEffect(() => {
    if (account && !isEditing) {
      setDraft(createDraftFromAccount(account));
    }
  }, [account, isEditing]);

  const dirty = useMemo(
    () => Boolean(isEditing && account && isDraftDirty(account, draft)),
    [account, draft, isEditing],
  );

  const filteredAccounts = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return accounts.filter((item) => {
      if (item.deleted_at) return false;
      if (filterTab === 'normal' && item.status !== 'normal') return false;
      if (filterTab === 'disabled' && item.status !== 'disabled') return false;
      if (filterTab === 'archived' && item.status !== 'archived') return false;
      if (term) {
        const hay = [
          item.gmail_email,
          item.recovery_email,
          item.purpose ?? '',
          item.notes ?? '',
          ...item.tags.map((t) => t.name),
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(term)) return false;
      }
      return true;
    });
  }, [accounts, filterTab, searchQuery]);

  const prependTimeline = useCallback((accountId: string, title: string) => {
    const entry: ActivityTimelineItem = {
      id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title,
      timestamp: formatDetailDateTime(new Date().toISOString(), true),
      source: '管理员（本地控制台）',
    };
    setTimelines((prev) => ({
      ...prev,
      [accountId]: [entry, ...(prev[accountId] ?? [])],
    }));
  }, []);

  const commitSwitchAccount = useCallback(
    (nextId: string) => {
      setIsEditing(false);
      setConflict(false);
      setConflictMessage('');
      setSecretEpoch((n) => n + 1);
      setSelectedId(nextId);
      const match = accounts.find((a) => a.id === nextId);
      if (match) setDraft(createDraftFromAccount(match));
      onNavigateAccount?.(nextId);
    },
    [accounts, onNavigateAccount],
  );

  const requestSwitchAccount = useCallback(
    (nextId: string) => {
      if (nextId === selectedId) return;
      if (dirty) {
        setUnsavedGuard({ type: 'switch', accountId: nextId });
        return;
      }
      commitSwitchAccount(nextId);
    },
    [commitSwitchAccount, dirty, selectedId],
  );

  const requestCancelEdit = useCallback(() => {
    if (dirty) {
      setUnsavedGuard({ type: 'cancel-edit' });
      return;
    }
    setIsEditing(false);
    setConflict(false);
    setConflictMessage('');
    if (account) setDraft(createDraftFromAccount(account));
  }, [account, dirty]);

  // 支持 Escape 退出编辑（浮层打开时由浮层优先处理 Escape）
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
        await navigator.clipboard?.writeText?.(value);
      } catch {
        /* 预览环境或剪贴板拒绝时仍给出友好反馈 */
      }
      showToast(`已复制${label}`);
    },
    [showToast],
  );

  const handleSave = useCallback(
    async (nextDraft: AccountBasicInfoDraft) => {
      if (!account) return;
      if (simulateVersionConflict && !conflictTriggeredOnce) {
        setConflictTriggeredOnce(true);
        setConflict(true);
        setConflictMessage(
          `版本冲突：账号已被其他会话更新至 v${account.row_version + 1}（当前基于 v${account.row_version}），当前修改未覆盖服务器。`,
        );
        return;
      }
      const now = new Date().toISOString();
      const nextVersion = account.row_version + 1;
      const summary = summarizeChangedFields(account, nextDraft);
      const updated: AccountDetail = {
        ...account,
        gmail_email: nextDraft.gmail_email,
        phone: nextDraft.phone || null,
        recovery_email_external: nextDraft.recovery_email_external || null,
        recovery_email: nextDraft.recovery_email_external || '',
        status: nextDraft.status,
        two_factor_status: nextDraft.two_factor_status,
        purpose: nextDraft.purpose || null,
        notes: nextDraft.notes || null,
        row_version: nextVersion,
        updated_at: now,
      };
      setAccounts((prev) =>
        prev.map((item) => (item.id === account.id ? updated : item)),
      );
      setDraft(createDraftFromAccount(updated));
      setIsEditing(false);
      setConflict(false);
      setConflictMessage('');
      prependTimeline(account.id, summary);
      showToast(`已保存修改，当前版本更新为 v${nextVersion}`);
    },
    [
      account,
      conflictTriggeredOnce,
      prependTimeline,
      showToast,
      simulateVersionConflict,
    ],
  );

  const handleReloadLatest = useCallback(() => {
    if (!account) return;
    const bumped: AccountDetail = {
      ...account,
      row_version: account.row_version + 1,
      updated_at: new Date().toISOString(),
    };
    setAccounts((prev) =>
      prev.map((item) => (item.id === account.id ? bumped : item)),
    );
    setDraft(createDraftFromAccount(bumped));
    setConflict(false);
    setConflictMessage('');
    showToast(`已重新加载最新版本 v${bumped.row_version}`);
  }, [account, showToast]);

  const handleConfirmAction = useCallback(
    (action: AccountAction) => {
      if (!account) return;
      const now = new Date().toISOString();
      const nextVersion = account.row_version + 1;

      if (action === 'archive') {
        const updated: AccountDetail = {
          ...account,
          status: 'archived',
          archived_at: now,
          updated_at: now,
          row_version: nextVersion,
        };
        setAccounts((prev) =>
          prev.map((item) => (item.id === account.id ? updated : item)),
        );
        prependTimeline(account.id, '归档账号');
        showToast(`${account.gmail_email} 已归档（v${nextVersion}）`);
      } else if (action === 'delete') {
        const updated: AccountDetail = {
          ...account,
          deleted_at: now,
          updated_at: now,
          row_version: nextVersion,
        };
        setAccounts((prev) =>
          prev.map((item) => (item.id === account.id ? updated : item)),
        );
        setTrashCount((c) => c + 1);
        prependTimeline(account.id, '移入回收站（软删除）');
        showToast(`${account.gmail_email} 已移入回收站`);
      } else if (action === 'restore') {
        const wasDeleted = Boolean(account.deleted_at);
        const updated: AccountDetail = {
          ...account,
          status: account.status === 'archived' ? 'normal' : account.status,
          archived_at: null,
          deleted_at: null,
          updated_at: now,
          row_version: nextVersion,
        };
        setAccounts((prev) =>
          prev.map((item) => (item.id === account.id ? updated : item)),
        );
        if (wasDeleted) setTrashCount((c) => Math.max(0, c - 1));
        prependTimeline(account.id, '恢复账号');
        showToast(`${account.gmail_email} 已恢复（v${nextVersion}）`);
      }

      setConfirmAction(null);
      setIsEditing(false);
      setSecretEpoch((n) => n + 1);
    },
    [account, prependTimeline, showToast],
  );

  const handleAttachTag = useCallback(
    (tag: TagResponse) => {
      if (!account) return;
      const now = new Date().toISOString();
      const nextVersion = account.row_version + 1;
      setAccounts((prev) =>
        prev.map((item) =>
          item.id === account.id
            ? {
                ...item,
                tags: item.tags.some((t) => t.id === tag.id)
                  ? item.tags
                  : [...item.tags, tag],
                row_version: nextVersion,
                updated_at: now,
              }
            : item,
        ),
      );
      prependTimeline(account.id, `添加标签（${tag.name}）`);
      showToast(`已添加标签“${tag.name}”`);
    },
    [account, prependTimeline, showToast],
  );

  const handleCreateAndAttachTag = useCallback(
    (name: string) => {
      const existing = tags.find((t) => t.name === name);
      if (existing) {
        handleAttachTag(existing);
        return;
      }
      const created: TagResponse = {
        id: `tag-${Date.now()}`,
        name,
        created_at: new Date().toISOString(),
      };
      setTags((prev) => [...prev, created]);
      handleAttachTag(created);
    },
    [handleAttachTag, tags],
  );

  const handleCreateAccount = useCallback(
    async (body: AccountCreateWritable) => {
      const now = new Date().toISOString();
      const resolvedTags = tags.filter((t) =>
        (body.tag_ids ?? []).includes(t.id),
      );
      const created: AccountDetail = {
        id: `acc_${Math.random().toString(16).slice(2, 14)}`,
        account_no: `GM-${String(DETAIL_MOCK_TOTAL_COUNT + accounts.length + 1).padStart(6, '0')}`,
        gmail_email: body.gmail_email,
        registered_at: body.registered_at ?? now,
        recovery_account_id: body.recovery_account_id ?? null,
        recovery_email_external: body.recovery_email_external ?? null,
        recovery_email: body.recovery_email_external ?? '',
        status: body.status ?? 'normal',
        two_factor_status: body.two_factor_status ?? 'enabled',
        purpose: body.purpose ?? null,
        tags: resolvedTags,
        last_login_at: now,
        last_verified_at: now,
        password_changed_at: null,
        archived_at: body.status === 'archived' ? now : null,
        deleted_at: null,
        row_version: 1,
        created_at: now,
        updated_at: now,
        phone: body.phone ?? null,
        notes: body.notes ?? null,
      };
      setAccounts((prev) => [created, ...prev]);
      setTimelines((prev) => ({
        ...prev,
        [created.id]: [
          {
            id: `evt-create-${created.id}`,
            title: '创建账号',
            timestamp: formatDetailDateTime(now, true),
            source: '管理员（本地控制台）',
          },
        ],
      }));
      setSelectedId(created.id);
      setDraft(createDraftFromAccount(created));
      setCreateDialogOpen(false);
      showToast(`已新建账号 ${created.gmail_email}`);
    },
    [accounts.length, showToast, tags],
  );

  const mockRevealPassword = useCallback(async (accountId: string) => {
    return DETAIL_MOCK_PASSWORDS[accountId] ?? 'Gm#Demo2026!Secure78';
  }, []);

  const currentTimeline = account ? (timelines[account.id] ?? []) : [];

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
        activeNav="accounts"
        onSelectNav={(key) => {
          if (key === 'accounts') {
            setFilterTab('all');
          } else if (key === 'archived') {
            setFilterTab('archived');
          } else if (key === 'audit') {
            setActiveTab('audit');
          } else if (key === 'backup') {
            setActiveTab('backups');
          } else if (key === 'dashboard' && onNavigateList) {
            onNavigateList();
          } else {
            showToast(`已切换入口：${key}`);
          }
        }}
        trashCount={trashCount}
        systemStatus={{
          healthy: true,
          headline: '系统运行正常',
          httpsEnabled: true,
          csrfEnabled: true,
          encryptionLabel: '字段加密 AES-256-GCM',
          totpEnabled: true,
          lastBackupLabel: DETAIL_MOCK_LAST_BACKUP,
          version: 'v1.1.0',
        }}
        notifications={[
          '导航栏毛玻璃透明度与显示设置已与账号列表页同步保存。',
          '最近一次数据库全量加密备份校验通过。',
        ]}
        onOpenSecurity={() => showToast('安全设置（预览模式）')}
        onOpenOperations={() => showToast('迁移与运维（预览模式）')}
        onLogout={() => showToast('当前为预览模式，未创建登录会话')}
        onNavigateAccountsList={() => {
          if (onNavigateList) onNavigateList();
          else setFilterTab('all');
        }}
        listPane={
          <AccountListPane
            accounts={filteredAccounts}
            totalCount={
              DETAIL_MOCK_TOTAL_COUNT + Math.max(0, accounts.length - 6)
            }
            selectedAccountId={account?.id ?? null}
            filterTab={filterTab}
            onFilterTabChange={setFilterTab}
            favorites={favorites}
            onToggleFavorite={(id) => {
              setFavorites((cur) => {
                const next = !cur[id];
                showToast(next ? '已加入收藏' : '已取消收藏');
                return { ...cur, [id]: next };
              });
            }}
            onSelectAccount={requestSwitchAccount}
            onCreateAccount={() => setCreateDialogOpen(true)}
          />
        }
        detailContent={
          account ? (
            <>
              <AccountHeaderCard
                account={account}
                availableTags={tags}
                isEditing={isEditing}
                onCopyEmail={(email) => void copyField('邮箱', email)}
                onEdit={() => {
                  setActiveTab('basic');
                  setSecretEpoch((n) => n + 1);
                  setDraft(createDraftFromAccount(account));
                  setIsEditing(true);
                }}
                onArchive={() => setConfirmAction('archive')}
                onDelete={() => setConfirmAction('delete')}
                onRestore={() => setConfirmAction('restore')}
                onViewAudit={() => setActiveTab('audit')}
                onAddTag={handleAttachTag}
                onCreateAndAttachTag={handleCreateAndAttachTag}
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
                      draft={draft}
                      isEditing={isEditing}
                      isDirty={dirty}
                      conflict={conflict}
                      conflictMessage={conflictMessage}
                      secretEpoch={secretEpoch}
                      mockRevealPassword={mockRevealPassword}
                      onDraftChange={setDraft}
                      onSubmit={handleSave}
                      onCancel={requestCancelEdit}
                      onReloadLatest={handleReloadLatest}
                      onCopyField={(label, val) => void copyField(label, val)}
                      onPasswordAuditEvent={(intent) =>
                        prependTimeline(
                          account.id,
                          intent === 'copy'
                            ? '复制凭据（密码）'
                            : '查看凭据（密码）',
                        )
                      }
                      onToast={showToast}
                    />
                    <div className="macos-detail-side-cards">
                      <AccountOverviewCard
                        account={account}
                        onCopyId={(id) => void copyField('记录 ID', id)}
                      />
                      <ActivityTimeline
                        items={currentTimeline.slice(0, 6)}
                        onViewFullLog={() => setActiveTab('audit')}
                      />
                    </div>
                  </div>
                )}

                {activeTab === 'credentials' && (
                  <SecurityCredentialsTabPanel
                    account={account}
                    secretEpoch={secretEpoch}
                    mockRevealPassword={mockRevealPassword}
                    onPasswordAuditEvent={(intent) =>
                      prependTimeline(
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
                    onCopyField={(label, val) => void copyField(label, val)}
                  />
                )}

                {activeTab === 'audit' && (
                  <AuditTabPanel items={currentTimeline} />
                )}

                {activeTab === 'backups' && (
                  <BackupsTabPanel
                    account={account}
                    lastBackupLabel={DETAIL_MOCK_LAST_BACKUP}
                  />
                )}
              </div>
            </>
          ) : (
            <EmptyState
              title="暂无可查看账号"
              onCreate={() => setCreateDialogOpen(true)}
            />
          )
        }
        toastMessage={toastMessage}
      />

      {/* 归档 / 删除 / 恢复 确认弹窗 */}
      <AccountActionDialog
        confirm={confirmAction}
        detail={account}
        busy={false}
        conflict={false}
        notice=""
        onClose={() => setConfirmAction(null)}
        onConfirm={handleConfirmAction}
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
              当前表单包含尚未保存的改动。继续切换或退出将放弃这些修改。
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
                  commitSwitchAccount(pending.accountId);
                } else {
                  setIsEditing(false);
                  setConflict(false);
                  setConflictMessage('');
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
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="macos-glass-modal flex max-h-[90vh] flex-col rounded-[22px] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>新建账号</DialogTitle>
            <DialogDescription>
              预览模式下新建的账号仅保存在当前会话内存中。
            </DialogDescription>
          </DialogHeader>
          <AccountForm
            tags={tags}
            busy={false}
            conflict={false}
            onFailure={() => {}}
            onSubmit={handleCreateAccount}
            onCancel={() => setCreateDialogOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
