import type { AccountSummary } from '@/api/generated';
import { localDate } from '@/lib/format';

export { localDate };

export type AccountAction =
  | 'archive'
  | 'unarchive'
  | 'delete'
  | 'restore'
  | 'verified'
  | 'logged-in';

export const actionLabels: Record<AccountAction, string> = {
  archive: '归档',
  unarchive: '取消归档',
  delete: '删除',
  restore: '恢复',
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

export const accountColumnLabels = {
  registered: '注册时间',
  recovery: '辅助邮箱',
  status: '状态',
  factor: '二步验证',
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
  purpose: true,
  tags: true,
  verified: true,
  updated: false,
};
