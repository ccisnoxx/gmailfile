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

  const rawAppStatuses = params.get('app_statuses');
  const parsedAppStatuses = rawAppStatuses
    ? rawAppStatuses
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
  const parsePositiveDays = (key: string): number | undefined => {
    const raw = params.get(key);
    if (!raw) return undefined;
    const num = Number(raw);
    return Number.isInteger(num) && num >= 1 && num <= 3650 ? num : undefined;
  };
  const rawMissingMeta = params.get('missing_metadata');
  const missingMetadata =
    rawMissingMeta === 'no_purpose' ||
    rawMissingMeta === 'no_tags' ||
    rawMissingMeta === 'no_purpose_or_tags'
      ? rawMissingMeta
      : undefined;
  const rawConflict = params.get('conflict_check');
  const conflictCheck =
    rawConflict === 'inactive_with_active_apps' ? rawConflict : undefined;

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
    app_id: params.get('app_id') || undefined,
    app_status: (params.get('app_status') || undefined) as NonNullable<
      AccountsListData['query']
    >['app_status'],
    app_statuses: parsedAppStatuses.length
      ? (parsedAppStatuses as NonNullable<
          AccountsListData['query']
        >['app_statuses'])
      : undefined,
    exclude_app_id: params.get('exclude_app_id') || undefined,
    two_factor_status: (params.get('two_factor_status') ||
      undefined) as NonNullable<AccountsListData['query']>['two_factor_status'],
    registered_from: dateBoundary(params.get('from') || ''),
    registered_to: dateBoundary(params.get('to') || '', true),
    archived: params.has('archived')
      ? params.get('archived') === 'true'
      : undefined,
    deleted: params.get('deleted') === 'true',
    recovery_email: params.get('recovery_email') || undefined,
    has_recovery_email: params.has('has_recovery_email')
      ? params.get('has_recovery_email') === 'true'
      : undefined,
    unverified_over_days: parsePositiveDays('unverified_over_days'),
    inactive_login_over_days: parsePositiveDays('inactive_login_over_days'),
    password_stale_over_days: parsePositiveDays('password_stale_over_days'),
    missing_metadata: missingMetadata,
    conflict_check: conflictCheck,
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
  const appsView = params.get('view') === 'apps';
  const chartView = params.get('view') === 'chart';

  const setDeleted = useCallback(
    (value: boolean) =>
      change({ deleted: value ? 'true' : '', view: '' }, true),
    [change],
  );
  const openRecoveryView = useCallback(
    () => change({ view: 'recovery' }, true),
    [change],
  );
  const openAppsView = useCallback(
    () => change({ view: 'apps' }, true),
    [change],
  );
  const openChartView = useCallback(
    () => change({ view: 'chart' }, true),
    [change],
  );

  return {
    params,
    change,
    search,
    query,
    deleted,
    recoveryView,
    appsView,
    chartView,
    setDeleted,
    openRecoveryView,
    openAppsView,
    openChartView,
  };
}
