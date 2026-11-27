import { defaultVisibleColumns, type AccountColumnKey } from './constants';

export const ACCOUNT_SAVED_VIEWS_STORAGE_KEY = 'gm_account_saved_views_v1';
export const ACCOUNT_SAVED_VIEWS_SYNC_EVENT = 'gm:account-saved-views-change';

export const SAVED_VIEW_QUERY_KEYS = [
  'search',
  'status',
  'statuses',
  'two_factor_status',
  'tag',
  'app_id',
  'app_status',
  'app_statuses',
  'exclude_app_id',
  'archived',
  'deleted',
  'purpose',
  'from',
  'to',
  'recovery_email',
  'has_recovery_email',
  'unverified_over_days',
  'inactive_login_over_days',
  'password_stale_over_days',
  'missing_metadata',
  'conflict_check',
  'upstream_recovery_risk',
  'sort',
  'page_size',
] as const;

export type SavedAccountViewCategory = 'risk' | 'quality' | 'custom';

export type SavedAccountView = {
  id: string;
  name: string;
  description?: string;
  category?: SavedAccountViewCategory;
  query: Record<string, string>;
  columns?: Record<AccountColumnKey, boolean>;
  builtin?: boolean;
  createdAt?: string;
};

export type SavedViewsStore = {
  version: 1;
  defaultViewId: string | null;
  views: SavedAccountView[];
};

export const BUILTIN_ACCOUNT_VIEWS: readonly SavedAccountView[] = [
  {
    id: 'builtin:no-2fa',
    name: '无 2FA',
    description: '尚未启用双因素验证的账号',
    category: 'risk',
    query: { two_factor_status: 'disabled' },
    builtin: true,
  },
  {
    id: 'builtin:unverified-30d',
    name: '30 天未验证',
    description: '超过 30 天未核验状态的活跃账号',
    category: 'risk',
    query: { unverified_over_days: '30' },
    builtin: true,
  },
  {
    id: 'builtin:no-recovery',
    name: '无辅助邮箱',
    description: '未配置外部或站内辅助邮箱',
    category: 'risk',
    query: { has_recovery_email: 'false', archived: 'false' },
    builtin: true,
  },
  {
    id: 'builtin:risk',
    name: '风险账号',
    description: '受限或无法登录的异常账号',
    category: 'risk',
    query: { statuses: 'restricted,login_failed' },
    builtin: true,
  },
  {
    id: 'builtin:app-risk',
    name: '应用受限 / 封禁',
    description: '关联第三方应用处于受限或已封禁状态',
    category: 'risk',
    query: { app_statuses: 'restricted,banned' },
    builtin: true,
  },
  {
    id: 'builtin:upstream-risk',
    name: '上游辅助账号异常',
    description: '站内辅助账号受限、停用或已软删除的连带风险账号',
    category: 'risk',
    query: { upstream_recovery_risk: 'true' },
    builtin: true,
  },
  {
    id: 'builtin:pending',
    name: '待验证',
    description: '待人工核验可用性的账号',
    category: 'risk',
    query: { status: 'pending_verification' },
    builtin: true,
  },
  {
    id: 'builtin:inactive-90d',
    name: '90 天未登录',
    description: '超过 90 天无登录活动记录',
    category: 'risk',
    query: { inactive_login_over_days: '90' },
    builtin: true,
  },
  {
    id: 'builtin:password-stale-180d',
    name: '180 天未改密',
    description: '超过 180 天未轮换凭据密码',
    category: 'risk',
    query: { password_stale_over_days: '180' },
    builtin: true,
  },
  {
    id: 'builtin:missing-meta',
    name: '缺少用途或标签',
    description: '未归档但未填写用途或未打标签',
    category: 'quality',
    query: { missing_metadata: 'no_purpose_or_tags', archived: 'false' },
    builtin: true,
  },
  {
    id: 'builtin:app-conflict',
    name: '状态与应用矛盾',
    description: '停用/归档/异常账号仍挂有正常状态应用',
    category: 'quality',
    query: { conflict_check: 'inactive_with_active_apps' },
    builtin: true,
  },
  {
    id: 'builtin:archived',
    name: '已归档',
    description: '已归档封存的账号',
    category: 'quality',
    query: { archived: 'true' },
    builtin: true,
  },
  {
    id: 'builtin:trash',
    name: '回收站待清理',
    description: '已软删除待恢复或永久清理的账号',
    category: 'quality',
    query: { deleted: 'true' },
    builtin: true,
  },
];

const DEFAULT_STORE: SavedViewsStore = {
  version: 1,
  defaultViewId: null,
  views: [],
};

const columnKeys = Object.keys(defaultVisibleColumns) as AccountColumnKey[];

function normalizeQueryRecord(input: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  if (!input || typeof input !== 'object') return result;
  const source = input as Record<string, unknown>;
  for (const key of SAVED_VIEW_QUERY_KEYS) {
    const val = source[key];
    if (typeof val === 'string' && val.trim() !== '') {
      result[key] = val;
    }
  }
  return result;
}

function normalizeColumns(
  input: unknown,
): Record<AccountColumnKey, boolean> | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const source = input as Record<string, unknown>;
  const next = { ...defaultVisibleColumns };
  let validCount = 0;
  for (const key of columnKeys) {
    if (typeof source[key] === 'boolean') {
      next[key] = source[key];
      validCount += 1;
    }
  }
  return validCount > 0 ? next : undefined;
}

function normalizeStore(raw: unknown): SavedViewsStore {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STORE, views: [] };
  const candidate = raw as Partial<SavedViewsStore>;
  if (candidate.version !== 1 || !Array.isArray(candidate.views)) {
    return { ...DEFAULT_STORE, views: [] };
  }
  const views: SavedAccountView[] = [];
  const seen = new Set<string>();
  for (const item of candidate.views) {
    if (!item || typeof item !== 'object') continue;
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!id || !name || id.startsWith('builtin:') || seen.has(id)) continue;
    seen.add(id);
    views.push({
      id,
      name: name.slice(0, 40),
      query: normalizeQueryRecord(item.query),
      columns: normalizeColumns(item.columns),
      createdAt:
        typeof item.createdAt === 'string' ? item.createdAt : undefined,
    });
  }
  const validIds = new Set([
    ...BUILTIN_ACCOUNT_VIEWS.map((v) => v.id),
    ...views.map((v) => v.id),
  ]);
  const defaultViewId =
    typeof candidate.defaultViewId === 'string' &&
    validIds.has(candidate.defaultViewId)
      ? candidate.defaultViewId
      : null;
  return { version: 1, defaultViewId, views };
}

export function extractViewQueryFromParams(
  params: URLSearchParams,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const key of SAVED_VIEW_QUERY_KEYS) {
    const val = params.get(key);
    if (!val) continue;
    if (key === 'sort' && val === '-account_no') continue;
    result[key] = val;
  }
  return result;
}

export function doesParamsMatchView(
  params: URLSearchParams,
  view: SavedAccountView,
): boolean {
  const current = extractViewQueryFromParams(params);
  const target = normalizeQueryRecord(view.query);
  if (target.sort === '-account_no') delete target.sort;
  const currentKeys = Object.keys(current);
  const targetKeys = Object.keys(target);
  if (currentKeys.length !== targetKeys.length) return false;
  return targetKeys.every((key) => current[key] === target[key]);
}

export function readSavedViewsStore(): SavedViewsStore {
  if (typeof window === 'undefined') return { ...DEFAULT_STORE, views: [] };
  try {
    const raw = window.localStorage.getItem(ACCOUNT_SAVED_VIEWS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_STORE, views: [] };
    return normalizeStore(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_STORE, views: [] };
  }
}

export function persistSavedViewsStore(store: SavedViewsStore): void {
  const normalized = normalizeStore(store);
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      ACCOUNT_SAVED_VIEWS_STORAGE_KEY,
      JSON.stringify(normalized),
    );
  } catch {
    /* 浏览器隐私模式可能禁用存储，静默降级为会话内生效。 */
  }
  window.dispatchEvent(
    new CustomEvent<SavedViewsStore>(ACCOUNT_SAVED_VIEWS_SYNC_EVENT, {
      detail: normalized,
    }),
  );
}

export function subscribeSavedViewsStore(
  onUpdate: (store: SavedViewsStore) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === ACCOUNT_SAVED_VIEWS_STORAGE_KEY) {
      onUpdate(readSavedViewsStore());
    }
  };
  const handleSync = (event: Event) => {
    const detail = (event as CustomEvent<SavedViewsStore>).detail;
    if (detail) onUpdate(normalizeStore(detail));
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(ACCOUNT_SAVED_VIEWS_SYNC_EVENT, handleSync);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(ACCOUNT_SAVED_VIEWS_SYNC_EVENT, handleSync);
  };
}

export function createSavedViewId(): string {
  if (
    typeof crypto !== 'undefined' &&
    typeof crypto.randomUUID === 'function'
  ) {
    return `custom:${crypto.randomUUID()}`;
  }
  return `custom:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
