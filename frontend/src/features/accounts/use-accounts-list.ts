import { useCallback, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AccountsListData } from '@/api/generated';
import { accountsList, appsList, tagsList } from '@/api/generated';
import { defaultVisibleColumns, type AccountColumnKey } from './constants';

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
    defaultVisibleColumns,
  );

  const list = useQuery({
    queryKey: ['accounts', query],
    queryFn: async ({ signal }) =>
      (await accountsList({ query, signal, throwOnError: true })).data,
    enabled: !recoveryView && !appsView,
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

  useEffect(
    () => () => {
      queryClient.removeQueries({ queryKey: ['accounts'] });
      queryClient.removeQueries({ queryKey: ['tags'] });
      queryClient.removeQueries({ queryKey: ['apps'] });
      queryClient.removeQueries({ queryKey: ['apps-usage'] });
      queryClient.removeQueries({ queryKey: ['summary'] });
      queryClient.removeQueries({ queryKey: ['recovery-usage'] });
      queryClient.removeQueries({ queryKey: ['recovery-email-accounts'] });
      queryClient.removeQueries({ queryKey: ['dashboard-registration-trend'] });
      queryClient.removeQueries({
        queryKey: ['dashboard-status-distribution'],
      });
      queryClient.removeQueries({
        queryKey: ['dashboard-recovery-email-usage'],
      });
      queryClient.removeQueries({ queryKey: ['account-options'] });
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
      setColumns((current) => ({ ...current, [key]: checked }));
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
  };
}
