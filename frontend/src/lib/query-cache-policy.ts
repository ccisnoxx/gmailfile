import type { DefaultOptions, QueryClient } from '@tanstack/react-query';

/**
 * TanStack Query 缓存与敏感数据清理策略（安全边界）：
 *
 * 1. 敏感明文（Gmail 密码、绑定手机号、敏感备注、TOTP 密钥与恢复码）严格禁止进入
 *    Query Cache，仅保留在局部组件状态中并短时自动清零。
 * 2. 受保护工作区的元数据查询（账号摘要、辅助邮箱分布、审计日志等）采用短 staleTime
 *    与有限 gcTime：在工作区内平滑分页/筛选（配合 keepPreviousData 防闪烁），降低重复请求。
 * 3. 当用户离开受保护账号工作区（卸载）、空闲锁定或登出时，必须先取消在途请求再移除缓存，
 *    既缩短元数据驻留内存的窗口，也防止卸载后晚到响应回填 Query Cache。
 */
export const WORKSPACE_QUERY_STALE_MS = 15_000;
export const WORKSPACE_QUERY_GC_MS = 60_000;

export const DEFAULT_QUERY_CLIENT_OPTIONS: DefaultOptions = {
  queries: {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: WORKSPACE_QUERY_STALE_MS,
    gcTime: WORKSPACE_QUERY_GC_MS,
  },
  mutations: {
    retry: false,
  },
};

export const PROTECTED_ACCOUNTS_QUERY_KEYS = [
  ['accounts'],
  ['tags'],
  ['apps'],
  ['apps-usage'],
  ['summary'],
  ['recovery-usage'],
  ['recovery-email-accounts'],
  ['dashboard-registration-trend'],
  ['dashboard-status-distribution'],
  ['dashboard-recovery-email-usage'],
  ['dashboard-insights'],
  ['account-options'],
] as const;

export const PROTECTED_ACCOUNT_DETAIL_QUERY_KEYS = [
  ['detail-accounts-list'],
  ['account-detail'],
  ['account-audits'],
] as const;

export const PROTECTED_SETTINGS_QUERY_KEYS = [
  ['settings-sessions'],
  ['settings-audits'],
  ['settings-audit-integrity'],
  ['settings-backup-status'],
  ['settings-system-meta'],
  ['settings-trash-count'],
  ['settings-webauthn-credentials'],
] as const;

export function purgeProtectedAccountsQueries(queryClient: QueryClient): void {
  for (const queryKey of PROTECTED_ACCOUNTS_QUERY_KEYS) {
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }
}

export function purgeProtectedAccountDetailQueries(
  queryClient: QueryClient,
): void {
  for (const queryKey of PROTECTED_ACCOUNT_DETAIL_QUERY_KEYS) {
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }
}

export function purgeProtectedSettingsQueries(queryClient: QueryClient): void {
  for (const queryKey of PROTECTED_SETTINGS_QUERY_KEYS) {
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }
}
