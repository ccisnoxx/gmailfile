import type { AccountAppItem, AccountSummary } from '@/api/generated';
import { localDate } from '@/lib/format';

export { localDate };

export type AccountAction =
  | 'archive'
  | 'unarchive'
  | 'delete'
  | 'restore'
  | 'permanent-delete'
  | 'verified'
  | 'logged-in';

export const actionLabels: Record<AccountAction, string> = {
  archive: '归档',
  unarchive: '取消归档',
  delete: '删除',
  restore: '恢复',
  'permanent-delete': '永久删除',
  verified: '今天已验证',
  'logged-in': '今天已登录',
};

export const statusLabels: Record<AccountSummary['status'], string> = {
  normal: '正常',
  pending_verification: '待验证',
  restricted: '受限',
  login_failed: '无法登录',
  disabled: '已停用',
  archived: '已归档',
};

export const factorLabels: Record<AccountSummary['two_factor_status'], string> =
  { unknown: '未知', disabled: '未开启', enabled: '已开启' };

export type AppStatus = AccountAppItem['status'];

export const appStatusLabels: Record<AppStatus, string> = {
  active: '正常',
  restricted: '受限',
  banned: '已封禁',
};

export const accountColumnLabels = {
  registered: '注册时间',
  recovery: '辅助邮箱',
  status: '状态',
  factor: '二步验证',
  apps: '已注册应用',
  purpose: '用途',
  tags: '标签',
  verified: '最后验证',
  updated: '更新时间',
} as const;

export type AccountColumnKey = keyof typeof accountColumnLabels;

export const defaultVisibleColumns: Record<AccountColumnKey, boolean> = {
  registered: true,
  recovery: true,
  status: true,
  factor: true,
  apps: true,
  purpose: true,
  tags: true,
  verified: true,
  updated: false,
};

export const ACCOUNT_COLUMNS_STORAGE_KEY = 'gm_account_columns_v1';
export const ACCOUNT_COLUMNS_SYNC_EVENT = 'gm:account-columns-change';

type StoredAccountColumnsPayload = {
  version: 1;
  columns: Partial<Record<AccountColumnKey, unknown>>;
};

const accountColumnKeys = Object.keys(
  defaultVisibleColumns,
) as AccountColumnKey[];

function normalizeVisibleColumns(
  source: Partial<Record<AccountColumnKey, unknown>> | null | undefined,
): Record<AccountColumnKey, boolean> {
  const next = { ...defaultVisibleColumns };
  if (!source || typeof source !== 'object') return next;
  for (const key of accountColumnKeys) {
    if (typeof source[key] === 'boolean') {
      next[key] = source[key];
    }
  }
  return next;
}

export function readVisibleColumns(): Record<AccountColumnKey, boolean> {
  if (typeof window === 'undefined') return { ...defaultVisibleColumns };
  try {
    const raw = window.localStorage.getItem(ACCOUNT_COLUMNS_STORAGE_KEY);
    if (!raw) return { ...defaultVisibleColumns };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { ...defaultVisibleColumns };
    }
    if ('version' in parsed && 'columns' in parsed) {
      const candidate = parsed as StoredAccountColumnsPayload;
      if (candidate.version === 1) {
        return normalizeVisibleColumns(candidate.columns);
      }
      return { ...defaultVisibleColumns };
    }
    return normalizeVisibleColumns(
      parsed as Partial<Record<AccountColumnKey, unknown>>,
    );
  } catch {
    return { ...defaultVisibleColumns };
  }
}

export function persistVisibleColumns(
  columns: Record<AccountColumnKey, boolean>,
): void {
  const normalized = normalizeVisibleColumns(columns);
  if (typeof window === 'undefined') return;
  try {
    const payload: StoredAccountColumnsPayload = {
      version: 1,
      columns: normalized,
    };
    window.localStorage.setItem(
      ACCOUNT_COLUMNS_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    /* 浏览器隐私模式可能禁用存储，静默降级为会话内生效。 */
  }
  window.dispatchEvent(
    new CustomEvent<Record<AccountColumnKey, boolean>>(
      ACCOUNT_COLUMNS_SYNC_EVENT,
      { detail: normalized },
    ),
  );
}

export function subscribeVisibleColumns(
  onUpdate: (columns: Record<AccountColumnKey, boolean>) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === ACCOUNT_COLUMNS_STORAGE_KEY) {
      onUpdate(readVisibleColumns());
    }
  };
  const handleSync = (event: Event) => {
    const detail = (event as CustomEvent<Record<AccountColumnKey, boolean>>)
      .detail;
    if (detail) onUpdate(normalizeVisibleColumns(detail));
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(ACCOUNT_COLUMNS_SYNC_EVENT, handleSync);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(ACCOUNT_COLUMNS_SYNC_EVENT, handleSync);
  };
}
