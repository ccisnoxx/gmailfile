import type { AccountDetail, TagResponse } from '@/api/generated';
import type { ActivityTimelineItem } from './activity-timeline';

export const DETAIL_MOCK_TAGS: TagResponse[] = [
  { id: 'tag-dev', name: '开发环境', created_at: '2025-08-01T08:00:00' },
  { id: 'tag-tools', name: '工具账号', created_at: '2025-08-02T08:00:00' },
  { id: 'tag-keep', name: '长期保留', created_at: '2025-08-03T08:00:00' },
  { id: 'tag-marketing', name: '营销', created_at: '2025-08-04T08:00:00' },
  { id: 'tag-data', name: '数据', created_at: '2025-08-05T08:00:00' },
  { id: 'tag-test', name: '测试', created_at: '2025-08-06T08:00:00' },
  { id: 'tag-history', name: '历史', created_at: '2025-08-07T08:00:00' },
  { id: 'tag-backup', name: '备用', created_at: '2025-08-08T08:00:00' },
  { id: 'tag-personal', name: '个人', created_at: '2025-08-09T08:00:00' },
];

export const DETAIL_MOCK_TOTAL_COUNT = 1248;
export const DETAIL_MOCK_TRASH_COUNT = 3;
export const DETAIL_MOCK_LAST_BACKUP = '2026-01-15 02:30';
export const DETAIL_DEFAULT_ACCOUNT_ID = 'acc_2f9e7c1a4b6d';

export function compactListTagLabel(name: string): string {
  switch (name) {
    case '开发环境':
      return '开发';
    case '工具账号':
      return '工具';
    case '测试账号':
      return '测试';
    case '长期保留':
      return '长期';
    default:
      return name;
  }
}

export function maskPhoneNumber(phone?: string | null): string {
  if (!phone) return '未绑定';
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 7) return '••••••';
  const match = trimmed.match(
    /^(\+\d{1,3}\s+)?(\d{3})[\s-]?(\d{3,4})[\s-]?(\d{4})$/,
  );
  if (match) {
    const [, prefix = '', head, , tail] = match;
    return `${prefix}${head} **** ${tail}`;
  }
  return `${trimmed.slice(0, Math.min(7, trimmed.length - 4))} **** ${trimmed.slice(-4)}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatDetailDateTime(
  value?: string | null,
  includeSeconds = true,
): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const datePart = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const timePart = includeSeconds
    ? `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
    : `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return `${datePart} ${timePart}`;
}

export function createDetailMockAccounts(): AccountDetail[] {
  const [
    devTag,
    toolsTag,
    keepTag,
    marketingTag,
    dataTag,
    testTag,
    historyTag,
    backupTag,
    personalTag,
  ] = DETAIL_MOCK_TAGS;

  return [
    {
      id: 'acc_2f9e7c1a4b6d',
      account_no: 'GM-001248',
      gmail_email: 'example.account@gmail.com',
      registered_at: '2025-09-18T10:24:17',
      recovery_account_id: null,
      recovery_email_external: 'backup.example@outlook.com',
      recovery_email: 'backup.example@outlook.com',
      status: 'normal',
      two_factor_status: 'enabled',
      purpose: '开发测试与工具',
      tags: [devTag, toolsTag, keepTag],
      last_login_at: '2026-01-10T15:18:22',
      last_verified_at: '2026-01-10T16:42:09',
      password_changed_at: '2025-12-02T09:14:37',
      archived_at: null,
      deleted_at: null,
      row_version: 12,
      created_at: '2025-09-18T10:24:17',
      updated_at: '2026-01-10T16:42:09',
      phone: '+86 139 8420 6728',
      notes: '用于开发环境注册、第三方工具授权等场景；不用于重要个人业务',
    },
    {
      id: 'acc_7c41d2e89a10',
      account_no: 'GM-001247',
      gmail_email: 'dev.tools@gmail.com',
      registered_at: '2025-10-04T09:12:00',
      recovery_account_id: null,
      recovery_email_external: 'ops.dev@proton.me',
      recovery_email: 'ops.dev@proton.me',
      status: 'normal',
      two_factor_status: 'enabled',
      purpose: 'CI 构建与插件发布通知',
      tags: [devTag],
      last_login_at: '2026-01-14T11:20:10',
      last_verified_at: '2026-01-14T11:20:10',
      password_changed_at: '2025-11-21T14:05:00',
      archived_at: null,
      deleted_at: null,
      row_version: 6,
      created_at: '2025-10-04T09:12:00',
      updated_at: '2026-01-14T11:20:10',
      phone: '+86 138 6612 3094',
      notes: '绑定 GitHub 与云端构建告警，仅限研发运维团队查阅。',
    },
    {
      id: 'acc_9a3b5e11c820',
      account_no: 'GM-001246',
      gmail_email: 'marketing.data@gmail.com',
      registered_at: '2025-07-22T14:35:08',
      recovery_account_id: null,
      recovery_email_external: 'analytics.backup@icloud.com',
      recovery_email: 'analytics.backup@icloud.com',
      status: 'normal',
      two_factor_status: 'enabled',
      purpose: '数据报表订阅与渠道投放分析',
      tags: [marketingTag, dataTag],
      last_login_at: '2026-01-12T18:02:45',
      last_verified_at: '2026-01-12T18:02:45',
      password_changed_at: '2025-10-19T10:30:00',
      archived_at: null,
      deleted_at: null,
      row_version: 8,
      created_at: '2025-07-22T14:35:08',
      updated_at: '2026-01-12T18:02:45',
      phone: '+86 137 5109 8841',
      notes: '用于 Looker 与投放平台周报投递，已开启独立 TOTP。',
    },
    {
      id: 'acc_4e8f1b20d531',
      account_no: 'GM-001245',
      gmail_email: 'test.service@gmail.com',
      registered_at: '2025-04-11T08:40:12',
      recovery_account_id: null,
      recovery_email_external: 'qa.fallback@outlook.com',
      recovery_email: 'qa.fallback@outlook.com',
      status: 'disabled',
      two_factor_status: 'disabled',
      purpose: '旧版集成测试环境回归验证',
      tags: [testTag],
      last_login_at: '2025-11-03T16:10:00',
      last_verified_at: '2025-11-03T16:10:00',
      password_changed_at: null,
      archived_at: null,
      deleted_at: null,
      row_version: 4,
      created_at: '2025-04-11T08:40:12',
      updated_at: '2025-11-28T13:45:20',
      phone: null,
      notes: '测试流水线迁移完成后已停用，保留审计记录供核查。',
    },
    {
      id: 'acc_1b6c9a77e042',
      account_no: 'GM-001244',
      gmail_email: 'archive.old@gmail.com',
      registered_at: '2024-03-19T11:15:30',
      recovery_account_id: null,
      recovery_email_external: 'vault.history@proton.me',
      recovery_email: 'vault.history@proton.me',
      status: 'archived',
      two_factor_status: 'enabled',
      purpose: '历史项目域名与证书留档',
      tags: [historyTag],
      last_login_at: '2025-06-15T09:22:00',
      last_verified_at: '2025-06-15T09:22:00',
      password_changed_at: '2025-01-12T08:00:00',
      archived_at: '2025-08-01T10:00:00',
      deleted_at: null,
      row_version: 5,
      created_at: '2024-03-19T11:15:30',
      updated_at: '2025-08-01T10:00:00',
      phone: '+86 135 2048 9130',
      notes: '归档只读账号，仅用于查阅历史账单与注册凭据。',
    },
    {
      id: 'acc_8d2a4f63b953',
      account_no: 'GM-001243',
      gmail_email: 'personal.backup@gmail.com',
      registered_at: '2025-01-08T19:05:44',
      recovery_account_id: null,
      recovery_email_external: 'personal.safe@icloud.com',
      recovery_email: 'personal.safe@icloud.com',
      status: 'normal',
      two_factor_status: 'enabled',
      purpose: '个人应急备份与离线联系人同步',
      tags: [backupTag, personalTag],
      last_login_at: '2026-01-13T20:15:33',
      last_verified_at: '2026-01-13T20:15:33',
      password_changed_at: '2025-11-30T21:00:00',
      archived_at: null,
      deleted_at: null,
      row_version: 7,
      created_at: '2025-01-08T19:05:44',
      updated_at: '2026-01-13T20:15:33',
      phone: '+86 186 7310 4519',
      notes: '个人长期冷备邮箱，定期每季度检查一次恢复方式。',
    },
  ];
}

export function createDetailMockTimelines(): Record<
  string,
  ActivityTimelineItem[]
> {
  return {
    acc_2f9e7c1a4b6d: [
      {
        id: 'evt-1',
        title: '更新账号信息（用途、备注）',
        timestamp: '2026-01-10 16:42:09',
        source: '管理员（本地控制台）',
      },
      {
        id: 'evt-2',
        title: '查看凭据（密码）',
        timestamp: '2026-01-10 15:18:22',
        source: '管理员（本地控制台）',
      },
      {
        id: 'evt-3',
        title: '启用二步验证（TOTP）',
        timestamp: '2025-12-02 09:14:37',
        source: '管理员（本地控制台）',
      },
      {
        id: 'evt-4',
        title: '创建账号',
        timestamp: '2025-09-18 10:24:17',
        source: '管理员（本地控制台）',
      },
    ],
    acc_7c41d2e89a10: [
      {
        id: 'evt-dev-1',
        title: '更新账号信息（标签）',
        timestamp: '2026-01-14 11:20:10',
        source: '管理员（本地控制台）',
      },
      {
        id: 'evt-dev-2',
        title: '启用二步验证（TOTP）',
        timestamp: '2025-11-21 14:05:00',
        source: '管理员（本地控制台）',
      },
      {
        id: 'evt-dev-3',
        title: '创建账号',
        timestamp: '2025-10-04 09:12:00',
        source: '管理员（本地控制台）',
      },
    ],
    acc_9a3b5e11c820: [
      {
        id: 'evt-mkt-1',
        title: '查看凭据（密码）',
        timestamp: '2026-01-12 18:02:45',
        source: '管理员（本地控制台）',
      },
      {
        id: 'evt-mkt-2',
        title: '创建账号',
        timestamp: '2025-07-22 14:35:08',
        source: '管理员（本地控制台）',
      },
    ],
    acc_4e8f1b20d531: [
      {
        id: 'evt-test-1',
        title: '更新账号状态（已停用）',
        timestamp: '2025-11-28 13:45:20',
        source: '管理员（本地控制台）',
      },
      {
        id: 'evt-test-2',
        title: '创建账号',
        timestamp: '2025-04-11 08:40:12',
        source: '管理员（本地控制台）',
      },
    ],
    acc_1b6c9a77e042: [
      {
        id: 'evt-arc-1',
        title: '归档账号',
        timestamp: '2025-08-01 10:00:00',
        source: '管理员（本地控制台）',
      },
      {
        id: 'evt-arc-2',
        title: '创建账号',
        timestamp: '2024-03-19 11:15:30',
        source: '管理员（本地控制台）',
      },
    ],
    acc_8d2a4f63b953: [
      {
        id: 'evt-per-1',
        title: '更新账号信息（辅助邮箱）',
        timestamp: '2026-01-13 20:15:33',
        source: '管理员（本地控制台）',
      },
      {
        id: 'evt-per-2',
        title: '启用二步验证（TOTP）',
        timestamp: '2025-11-30 21:00:00',
        source: '管理员（本地控制台）',
      },
      {
        id: 'evt-per-3',
        title: '创建账号',
        timestamp: '2025-01-08 19:05:44',
        source: '管理员（本地控制台）',
      },
    ],
  };
}

export const DETAIL_MOCK_PASSWORDS: Record<string, string> = {
  acc_2f9e7c1a4b6d: 'Gm#Dev2026!Example94',
  acc_7c41d2e89a10: 'Tools#CI98!Vault2026',
  acc_9a3b5e11c820: 'Mkt#Data71!Pulse2026',
  acc_4e8f1b20d531: 'Qa#Test40!Sandbox99',
  acc_1b6c9a77e042: 'Arc#Old24!Legacy88',
  acc_8d2a4f63b953: 'Per#Safe55!Backup26',
};
