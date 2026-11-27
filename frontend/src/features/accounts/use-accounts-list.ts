import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountsListData } from '@/api/generated';
import { accountsList, appsList, tagsList } from '@/api/generated';
import { purgeProtectedAccountsQueries } from '@/lib/query-cache-policy';
import {
  persistVisibleColumns,
  readVisibleColumns,
  subscribeVisibleColumns,
  type AccountColumnKey,
} from './constants';

export function useAccountsList({
  query,
  search,
  recoveryView,
  appsView = false,
  onFailure,
}: {
  query: NonNullable<AccountsListData['query']>;
  search: string;
  recoveryView: boolean;
  appsView?: boolean;
  onFailure: (error: unknown) => void;
}) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [columns, setColumns] = useState<Record<AccountColumnKey, boolean>>(
    () => readVisibleColumns(),
  );

  useEffect(() => subscribeVisibleColumns(setColumns), []);

  const list = useQuery({
    queryKey: ['accounts', query],
    queryFn: async ({ signal }) =>
      (await accountsList({ query, signal, throwOnError: true })).data,
    enabled: !recoveryView && !appsView,
    // 同一视图（普通列表或回收站内）翻页/筛选切换时保持上一次表格内容稳定，避免整页闪烁。
    placeholderData: (previousData, previousQuery) => {
      const prevQuery = previousQuery?.queryKey?.[1] as
        { deleted?: boolean } | undefined;
      return prevQuery?.deleted === query.deleted ? previousData : undefined;
    },
  });

  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: async ({ signal }) =>
      (await tagsList({ signal, throwOnError: true })).data,
  });

  const apps = useQuery({
    queryKey: ['apps'],
    queryFn: async ({ signal }) => {
      const { data } = await appsList({ signal, throwOnError: true });
      return Array.isArray(data) ? data : [];
    },
  });

  useEffect(() => {
    if (list.error) onFailure(list.error);
  }, [list.error, onFailure]);

  useEffect(() => {
    if (tags.error) onFailure(tags.error);
  }, [tags.error, onFailure]);

  useEffect(() => {
    if (!apps.error) return;
    const code = (apps.error as { error?: { code?: string } })?.error?.code;
    if (
      ['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(code ?? '')
    ) {
      onFailure(apps.error);
    }
  }, [apps.error, onFailure]);

  // 安全缓存策略：卸载受保护账号工作区时先取消在途请求并清除元数据缓存，防止晚到响应回填。
  useEffect(
    () => () => {
      purgeProtectedAccountsQueries(queryClient);
    },
    [queryClient],
  );

  useEffect(() => {
    setSelected({});
  }, [search, list.dataUpdatedAt]);

  const refresh = useCallback(async () => {
    setSelected({});
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['summary'] }),
      queryClient.invalidateQueries({ queryKey: ['recovery-usage'] }),
      queryClient.invalidateQueries({ queryKey: ['account-options'] }),
      queryClient.invalidateQueries({ queryKey: ['accounts'] }),
      queryClient.invalidateQueries({ queryKey: ['tags'] }),
      queryClient.invalidateQueries({ queryKey: ['apps'] }),
      queryClient.invalidateQueries({ queryKey: ['apps-usage'] }),
    ]);
  }, [queryClient]);

  const items = list.data?.items ?? [];
  const selectedItems = items.filter((item) => selected[item.id]);

  const toggleAll = useCallback(
    (checked: boolean) => {
      setSelected(
        checked ? Object.fromEntries(items.map((item) => [item.id, true])) : {},
      );
    },
    [items],
  );

  const toggleOne = useCallback((id: string, checked: boolean) => {
    setSelected((current) => ({ ...current, [id]: checked }));
  }, []);

  const toggleColumn = useCallback(
    (key: AccountColumnKey, checked: boolean) => {
      setColumns((current) => {
        const next = { ...current, [key]: checked };
        persistVisibleColumns(next);
        return next;
      });
    },
    [],
  );

  const applyColumns = useCallback(
    (nextColumns: Record<AccountColumnKey, boolean>) => {
      const next = { ...nextColumns };
      setColumns(next);
      persistVisibleColumns(next);
    },
    [],
  );

  return {
    list,
    tags,
    apps,
    items,
    selected,
    selectedItems,
    columns,
    refresh,
    toggleAll,
    toggleOne,
    toggleColumn,
    applyColumns,
  };
}
