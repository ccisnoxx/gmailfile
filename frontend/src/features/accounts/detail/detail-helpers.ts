import { useCallback, useEffect, useRef, useState } from 'react';
import type { AccountDetail, AuditItem } from '@/api/generated';
import {
  DETAIL_DEFAULT_NAV_ALPHA,
  persistDisplaySettings,
  persistNavAlpha,
  readDisplaySettings,
  readStoredNavAlpha,
  subscribeDisplaySettings,
  subscribeNavAlpha,
  type DisplaySettingsState,
} from '@/components/macos';
import type { AccountBasicInfoDraft } from './account-basic-info-form';
import type { ActivityTimelineItem } from './activity-timeline';
import { formatDetailDateTime } from './detail-mock-fixtures';

export type PendingGuardAction =
  { type: 'switch'; accountId: string } | { type: 'cancel-edit' };

export const auditEventLabels: Record<string, string> = {
  account_created: '创建账号',
  account_updated: '更新账号信息',
  account_archived: '归档账号',
  account_unarchived: '取消归档账号',
  account_deleted: '删除账号',
  account_restored: '恢复账号',
  account_permanently_deleted: '永久删除账号',
  permanent_delete_confirmation_failed: '批量永久删除确认失败',
  account_batch_status: '批量修改状态',
  account_batch_tags: '批量管理标签',
  password_revealed: '查看凭据（密码）',
  password_copied: '复制凭据（密码）',
  sensitive_fields_revealed: '查看手机号与敏感备注',
  totp_bound: '绑定二步验证（TOTP）',
  csv_imported: 'CSV 批量导入',
};

export const auditOperationLabels: Record<string, string> = {
  'mark-verified': '标记今天已验证',
  'mark-logged-in': '标记今天已登录',
  'reveal-password': '查看凭据（密码）',
  'copy-password-event': '复制凭据（密码）',
  'reveal-sensitive': '查看手机号与敏感备注',
  unarchive: '取消归档账号',
  'permanent-delete': '永久删除账号',
  'batch-permanent-delete': '批量永久删除账号',
  'recovery-unlinked': '辅助邮箱转为外部记录',
};

export function mapAuditToTimeline(items: AuditItem[]): ActivityTimelineItem[] {
  return items.map((item) => ({
    id: item.id,
    title:
      (item.operation && auditOperationLabels[item.operation]) ||
      auditEventLabels[item.event_type] ||
      item.operation ||
      item.event_type,
    timestamp: formatDetailDateTime(item.created_at, true),
    source: item.ip_address
      ? `管理员（${item.ip_address}）`
      : '管理员（本地控制台）',
  }));
}

export function summarizeChangedFields(
  prev: AccountDetail,
  next: AccountBasicInfoDraft,
): string {
  const fields: string[] = [];
  if (prev.gmail_email !== next.gmail_email) fields.push('Gmail 地址');
  if (next.password) fields.push('密码');
  if ((prev.phone ?? '') !== next.phone) fields.push('手机号');
  if (
    (prev.recovery_email_external ?? prev.recovery_email ?? '') !==
    next.recovery_email_external
  ) {
    fields.push('辅助邮箱');
  }
  if (prev.status !== next.status) fields.push('状态');
  if (prev.two_factor_status !== next.two_factor_status) fields.push('2FA');
  if ((prev.purpose ?? '') !== next.purpose) fields.push('用途');
  if ((prev.notes ?? '') !== next.notes) fields.push('备注');
  return fields.length > 0
    ? `更新账号信息（${fields.slice(0, 3).join('、')}）`
    : '更新账号信息';
}

export function useSharedDisplayState(defaultOpen: boolean) {
  const [navAlpha, setNavAlpha] = useState<number>(() =>
    readStoredNavAlpha(DETAIL_DEFAULT_NAV_ALPHA),
  );
  const [displaySettings, setDisplaySettings] = useState<DisplaySettingsState>(
    () => readDisplaySettings(),
  );
  const [displaySettingsOpen, setDisplaySettingsOpen] =
    useState<boolean>(defaultOpen);

  useEffect(() => {
    const unsubAlpha = subscribeNavAlpha(setNavAlpha, DETAIL_DEFAULT_NAV_ALPHA);
    const unsubDisplay = subscribeDisplaySettings(setDisplaySettings);
    return () => {
      unsubAlpha();
      unsubDisplay();
    };
  }, []);

  const handleNavAlphaChange = useCallback((next: number) => {
    setNavAlpha(next);
    persistNavAlpha(next);
  }, []);

  const handleDisplaySettingsChange = useCallback(
    (next: DisplaySettingsState) => {
      setDisplaySettings(next);
      persistDisplaySettings(next);
    },
    [],
  );

  return {
    navAlpha,
    handleNavAlphaChange,
    displaySettings,
    handleDisplaySettingsChange,
    displaySettingsOpen,
    setDisplaySettingsOpen,
  };
}

export function useToast() {
  const [message, setMessage] = useState('');
  const timerRef = useRef<number | undefined>(undefined);

  const showToast = useCallback((text: string) => {
    setMessage(text);
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setMessage('');
    }, 2800);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(timerRef.current);
    },
    [],
  );

  return { toastMessage: message, showToast };
}
