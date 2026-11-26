import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { AccountsListData } from '@/api/generated';

const subscribe = (notify: () => void) => {
  window.addEventListener('popstate', notify);
  window.addEventListener('accounts-query', notify);
  return () => {
    window.removeEventListener('popstate', notify);
    window.removeEventListener('accounts-query', notify);
  };
};

export type AccountLocationChange = (
  values: Record<string, string>,
  reset?: boolean,
  replace?: boolean,
) => void;

export function useAccountLocation() {
  const search = useSyncExternalStore(subscribe, () => window.location.search);
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const change = useCallback<AccountLocationChange>(
    (values, reset = false, replace = false) => {
      const next = reset
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (!('page' in values)) next.delete('page');
      const nextUrl = `${window.location.pathname}${next.size ? '?' + next : ''}`;
      if (replace) {
        window.history.replaceState(null, '', nextUrl);
      } else {
        window.history.pushState(null, '', nextUrl);
      }
      window.dispatchEvent(new Event('accounts-query'));
    },
    [],
  );
  return { params, change, search };
}

// 按本地日历求零点，跨夏令时不加固定 24 小时；结束边界不包含。
export function dateBoundary(value: string, nextDay = false) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'invalid-date';
  const date = new Date(value + 'T00:00:00');
  const [year, month, day] = value.split('-').map(Number);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  )
    return 'invalid-date';
  if (nextDay) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export function accountQuery(
  params: URLSearchParams,
): NonNullable<AccountsListData['query']> {
  const rawStatuses = params.get('statuses');
  const parsedStatuses = rawStatuses
    ? rawStatuses
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const rawPage = Number(params.get('page') || 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const rawPageSize = params.has('page_size')
    ? Number(params.get('page_size'))
    : undefined;
  const pageSize =
    rawPageSize !== undefined &&
    Number.isInteger(rawPageSize) &&
    rawPageSize >= 1
      ? rawPageSize
      : undefined;

  return {
    search: params.get('search') || undefined,
    status: (params.get('status') || undefined) as NonNullable<
      AccountsListData['query']
    >['status'],
    statuses: parsedStatuses.length
      ? (parsedStatuses as NonNullable<AccountsListData['query']>['statuses'])
      : undefined,
    purpose: params.get('purpose') || undefined,
    tag: params.get('tag') || undefined,
    two_factor_status: (params.get('two_factor_status') ||
      undefined) as NonNullable<AccountsListData['query']>['two_factor_status'],
    registered_from: dateBoundary(params.get('from') || ''),
    registered_to: dateBoundary(params.get('to') || '', true),
    archived: params.has('archived')
      ? params.get('archived') === 'true'
      : undefined,
    deleted: params.get('deleted') === 'true',
    recovery_email: params.get('recovery_email') || undefined,
    sort: (params.get('sort') || '-account_no') as NonNullable<
      AccountsListData['query']
    >['sort'],
    page,
    page_size: pageSize,
  };
}

export function useAccountQueryState() {
  const { params, change, search } = useAccountLocation();
  const query = useMemo(() => accountQuery(params), [params]);
  const deleted = query.deleted === true;
  const recoveryView = params.get('view') === 'recovery';

  const setDeleted = useCallback(
    (value: boolean) =>
      change({ deleted: value ? 'true' : '', view: '' }, true),
    [change],
  );
  const openRecoveryView = useCallback(
    () => change({ view: 'recovery' }, true),
    [change],
  );

  return {
    params,
    change,
    search,
    query,
    deleted,
    recoveryView,
    setDeleted,
    openRecoveryView,
  };
}
