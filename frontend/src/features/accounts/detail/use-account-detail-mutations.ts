import { useCallback, useState } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type {
  AccountCreateWritable,
  AccountDetail,
  AccountPatchWritable,
  ErrorResponse,
  RegisteredAppResponse,
  TagResponse,
} from '@/api/generated';
import {
  accountsArchive,
  accountsCreate,
  accountsDelete,
  accountsDetail,
  accountsMarkLoggedIn,
  accountsMarkVerified,
  accountsPatch,
  accountsPermanentDelete,
  accountsRestore,
  accountsUnarchive,
  appsCreate,
  appsFetchIcon,
  tagsCreate,
} from '@/api/generated';
import type { AccountAction, AppStatus } from '../constants';
import {
  createDraftFromAccount,
  type AccountBasicInfoDraft,
} from './account-basic-info-form';
import { summarizeChangedFields } from './detail-helpers';

type UseAccountDetailMutationsParams = {
  account: AccountDetail | null;
  headers: Record<string, string>;
  queryClient: QueryClient;
  onFailure: (error: unknown) => void;
  onNavigateList?: () => void;
  setSelectedId: (id: string) => void;
  setDraft: (draft: AccountBasicInfoDraft | null) => void;
  setIsEditing: (editing: boolean) => void;
  setCreateDialogOpen: (open: boolean) => void;
  bumpSecretEpoch: () => void;
  commitSwitchAccount: (id: string) => void;
  prependLocalTimeline: (accountId: string, title: string) => void;
  showToast: (text: string) => void;
};

export function useAccountDetailMutations({
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
}: UseAccountDetailMutationsParams) {
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [conflictMessage, setConflictMessage] = useState('');
  const [reauthRequired, setReauthRequired] = useState(false);
  const [editReauthRequired, setEditReauthRequired] = useState(false);
  const [confirmAction, setConfirmAction] = useState<AccountAction | null>(
    null,
  );

  const resetConflictState = useCallback(() => {
    setConflict(false);
    setConflictMessage('');
  }, []);

  const handleSaveBasicInfo = useCallback(
    async (nextDraft: AccountBasicInfoDraft) => {
      if (!account || busy) return;
      setBusy(true);
      setConflict(false);
      setConflictMessage('');

      try {
        const trimmedRecovery = nextDraft.recovery_email_external.trim();
        const keepLinkedRecovery =
          Boolean(account.recovery_account_id && trimmedRecovery) &&
          trimmedRecovery === (account.recovery_email ?? '');
        const encryptedPhoneHidden = Boolean(
          account.has_phone && !account.phone,
        );
        const encryptedNotesHidden = Boolean(
          account.has_notes && !account.notes,
        );
        const patch: AccountPatchWritable = {
          row_version: account.row_version,
          gmail_email: nextDraft.gmail_email,
          recovery_account_id: keepLinkedRecovery
            ? account.recovery_account_id
            : null,
          recovery_email_external: keepLinkedRecovery
            ? null
            : trimmedRecovery || null,
          status: nextDraft.status,
          two_factor_status: nextDraft.two_factor_status,
          purpose: nextDraft.purpose || null,
          tag_ids: account.tags.map((t) => t.id),
          apps: nextDraft.apps.map((item) => ({
            app_id: item.app_id,
            status: item.status ?? 'active',
            note: item.note?.trim() || null,
          })),
        };
        if (nextDraft.clearPhone) {
          patch.phone = null;
        } else if (!encryptedPhoneHidden || nextDraft.phone.trim()) {
          patch.phone = nextDraft.phone || null;
        }
        if (nextDraft.clearNotes) {
          patch.notes = null;
        } else if (!encryptedNotesHidden || nextDraft.notes) {
          patch.notes = nextDraft.notes || null;
        }
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
        setEditReauthRequired(false);
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
          queryClient.invalidateQueries({ queryKey: ['apps-usage'] }),
        ]);
      } catch (error) {
        const err = error as Partial<ErrorResponse>;
        const code = err?.error?.code;
        if (code === 'ROW_VERSION_CONFLICT') {
          setConflict(true);
          setConflictMessage(
            `版本冲突：账号已被其他页面修改（本地基于 v${account.row_version}），请重新加载最新版本后再编辑。`,
          );
        } else if (code === 'REAUTH_REQUIRED') {
          setEditReauthRequired(true);
          showToast(
            '覆盖已有密码需要最近 5 分钟内管理员重新验证，请完成验证后重新保存。',
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
      setDraft,
      setIsEditing,
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
  }, [account, onFailure, queryClient, setDraft, showToast]);

  const handleLifecycleAction = useCallback(
    async (action: AccountAction) => {
      if (!account || busy) return;
      setBusy(true);
      setConflict(false);
      try {
        if (action === 'permanent-delete') {
          const deletedId = account.id;
          await accountsPermanentDelete({
            path: { account_id: deletedId },
            body: { row_version: account.row_version },
            headers,
            throwOnError: true,
          });
          setConfirmAction(null);
          setIsEditing(false);
          bumpSecretEpoch();
          queryClient.removeQueries({
            queryKey: ['account-detail', deletedId],
          });
          showToast('账号已永久删除');
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: ['detail-accounts-list'],
            }),
            queryClient.invalidateQueries({ queryKey: ['accounts'] }),
            queryClient.invalidateQueries({ queryKey: ['summary'] }),
          ]);
          if (onNavigateList) {
            onNavigateList();
          } else {
            setSelectedId('');
          }
          return;
        }
        const fn = {
          archive: accountsArchive,
          unarchive: accountsUnarchive,
          delete: accountsDelete,
          restore: accountsRestore,
          verified: accountsMarkVerified,
          'logged-in': accountsMarkLoggedIn,
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
        bumpSecretEpoch();
        const label =
          action === 'archive'
            ? '归档账号'
            : action === 'unarchive'
              ? '取消归档账号'
              : action === 'delete'
                ? '删除账号'
                : action === 'restore'
                  ? '恢复账号'
                  : action === 'logged-in'
                    ? '标记今天已登录'
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
        } else if (code === 'REAUTH_REQUIRED') {
          setReauthRequired(true);
          setConflictMessage(
            '二次验证已过期，请先完成管理员二次验证后再确认永久删除（不会自动重放）。',
          );
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
      bumpSecretEpoch,
      busy,
      headers,
      onFailure,
      onNavigateList,
      prependLocalTimeline,
      queryClient,
      setDraft,
      setIsEditing,
      setSelectedId,
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
    [
      commitSwitchAccount,
      headers,
      onFailure,
      queryClient,
      setCreateDialogOpen,
      showToast,
    ],
  );

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
        headers,
        throwOnError: true,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['apps'] }),
        queryClient.invalidateQueries({ queryKey: ['apps-usage'] }),
      ]);
      return data;
    },
    [headers, queryClient],
  );

  const handleFetchAppIcon = useCallback(
    async (domain: string) => {
      const { data } = await appsFetchIcon({
        body: { domain },
        headers,
        throwOnError: true,
      });
      return data;
    },
    [headers],
  );

  const handleQuickToggleAppStatus = useCallback(
    async (appId: string, nextStatus: AppStatus) => {
      if (!account || busy) return;
      setBusy(true);
      setConflict(false);
      setConflictMessage('');
      try {
        const nextApps = (account.apps ?? []).map((item) => ({
          app_id: item.app_id,
          status: item.app_id === appId ? nextStatus : item.status,
          note: item.note ?? null,
        }));
        const { data } = await accountsPatch({
          path: { account_id: account.id },
          body: { row_version: account.row_version, apps: nextApps },
          headers,
          throwOnError: true,
        });
        queryClient.setQueryData(['account-detail', data.id], data);
        setDraft(createDraftFromAccount(data));
        const appName =
          account.apps?.find((item) => item.app_id === appId)?.app_name ??
          '应用';
        const label =
          nextStatus === 'banned'
            ? '已封禁'
            : nextStatus === 'restricted'
              ? '受限'
              : '正常';
        prependLocalTimeline(data.id, `更新应用「${appName}」状态为${label}`);
        showToast(`已将「${appName}」标记为${label}`);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['detail-accounts-list'] }),
          queryClient.invalidateQueries({ queryKey: ['apps-usage'] }),
          queryClient.invalidateQueries({
            queryKey: ['account-audits', data.id],
          }),
        ]);
      } catch (error) {
        const err = error as Partial<ErrorResponse>;
        if (err?.error?.code === 'ROW_VERSION_CONFLICT') {
          setConflict(true);
          setConflictMessage(
            `版本冲突：账号已被其他页面修改（本地基于 v${account.row_version}），请重新加载后再操作。`,
          );
        } else {
          showToast(err?.error?.message ?? '更新应用状态失败');
          if (
            ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(
              err?.error?.code ?? '',
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
      setDraft,
      showToast,
    ],
  );

  return {
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
  };
}
