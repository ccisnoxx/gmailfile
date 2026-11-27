import type {
  SidebarSectionKey,
  WorkspaceNavKey,
} from '@/components/macos/primary-sidebar';
import type { SettingsSectionKey } from '@/features/settings/types';

export type TransferTab = 'import' | 'export' | 'batch';
export type OperationsRouteTab =
  'status' | 'import' | 'export' | 'audit' | 'sessions';

export type AppDestination =
  | { kind: 'dashboard' }
  | { kind: 'accounts'; query?: Record<string, string> }
  | { kind: 'account-detail'; accountId: string; search?: string }
  | { kind: 'apps' }
  | { kind: 'recovery-emails' }
  | { kind: 'transfer'; tab?: TransferTab; search?: string }
  | { kind: 'settings'; section: SettingsSectionKey; search?: string };

export const SIDEBAR_SECTION_QUERY_MAP: Record<
  SidebarSectionKey,
  Record<string, string>
> = {
  all: {},
  normal: { status: 'normal' },
  pending: { status: 'pending_verification' },
  risk: { statuses: 'restricted,login_failed' },
  disabled: { status: 'disabled' },
  archived: { archived: 'true' },
  trash: { deleted: 'true' },
};

export function sectionToAccountQuery(
  section: SidebarSectionKey,
): Record<string, string> {
  return { ...SIDEBAR_SECTION_QUERY_MAP[section] };
}

function buildSearch(query?: Record<string, string>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value) params.set(key, value);
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : '';
}

export function resolveAppHref(
  dest: AppDestination,
  options?: { preview?: boolean },
): string {
  const preview = Boolean(options?.preview);
  const prefix = preview ? '/preview' : '';

  switch (dest.kind) {
    case 'dashboard':
      return preview ? '/preview/accounts' : '/accounts?view=chart';
    case 'accounts':
      return preview
        ? '/preview/accounts'
        : `/accounts${buildSearch(dest.query)}`;
    case 'account-detail': {
      const search = dest.search
        ? dest.search.startsWith('?')
          ? dest.search
          : `?${dest.search}`
        : '';
      return `${prefix}/accounts/${dest.accountId}${search}`;
    }
    case 'apps':
      return preview ? '/preview/accounts' : '/apps';
    case 'recovery-emails':
      return preview ? '/preview/accounts' : '/recovery-emails';
    case 'transfer': {
      const params = new URLSearchParams(dest.search ?? '');
      if (dest.tab && dest.tab !== 'import') {
        params.set('tab', dest.tab);
      } else if (dest.tab === 'import') {
        params.delete('tab');
      }
      const query = params.toString();
      return `${prefix}/transfers/csv${query ? `?${query}` : ''}`;
    }
    case 'settings': {
      const search = dest.search
        ? dest.search.startsWith('?')
          ? dest.search
          : `?${dest.search}`
        : '';
      return `${prefix}/settings/${dest.section}${search}`;
    }
  }
}

export function resolveAccountSectionHref(
  section: SidebarSectionKey,
  options?: { preview?: boolean },
): string {
  return resolveAppHref(
    { kind: 'accounts', query: sectionToAccountQuery(section) },
    options,
  );
}

export function resolveAccountFilterToken(token?: string): AppDestination {
  if (!token || token === 'all') return { kind: 'accounts' };
  if (token === 'dashboard') return { kind: 'dashboard' };
  if (token === 'apps') return { kind: 'apps' };
  if (token === 'tags') return { kind: 'accounts', query: { modal: 'tags' } };
  if (token.startsWith('tag:')) {
    return { kind: 'accounts', query: { tag: token.slice(4) } };
  }
  if (token in SIDEBAR_SECTION_QUERY_MAP) {
    return {
      kind: 'accounts',
      query: sectionToAccountQuery(token as SidebarSectionKey),
    };
  }
  return { kind: 'accounts' };
}

export function resolveWorkspaceNavDestination(
  key: WorkspaceNavKey,
): AppDestination {
  switch (key) {
    case 'dashboard':
      return { kind: 'dashboard' };
    case 'accounts':
      return { kind: 'accounts' };
    case 'apps':
      return { kind: 'apps' };
    case 'recovery':
      return { kind: 'recovery-emails' };
    case 'tags':
      return { kind: 'accounts', query: { modal: 'tags' } };
    case 'archived':
      return { kind: 'accounts', query: { archived: 'true' } };
    case 'trash':
      return { kind: 'accounts', query: { deleted: 'true' } };
    case 'transfer':
      return { kind: 'transfer', tab: 'import' };
    case 'audit':
      return { kind: 'settings', section: 'audit' };
    case 'backup':
      return { kind: 'settings', section: 'backup' };
    case 'settings':
      return { kind: 'settings', section: 'security' };
  }
}

export function resolveOperationsDestination(
  tab?: OperationsRouteTab,
  currentSearch?: string,
): AppDestination {
  if (tab === 'audit') return { kind: 'settings', section: 'audit' };
  if (tab === 'sessions') return { kind: 'settings', section: 'security' };
  if (tab === 'status') return { kind: 'settings', section: 'backup' };
  if (tab === 'export') {
    return { kind: 'transfer', tab: 'export', search: currentSearch };
  }
  return { kind: 'transfer', tab: 'import' };
}
