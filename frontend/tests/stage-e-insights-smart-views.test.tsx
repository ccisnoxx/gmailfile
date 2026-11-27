import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  AccountSummary,
  DashboardInsightsResponse,
  SessionResponse,
  TagResponse,
} from '@/api/generated';
import { AccountActiveFilters } from '@/features/accounts/account-active-filters';
import { BatchBar } from '@/features/accounts/account-batch-bar';
import { AccountSavedViews } from '@/features/accounts/account-saved-views';
import { defaultVisibleColumns } from '@/features/accounts/constants';
import { OverviewInsightsPanel } from '@/features/accounts/overview-insights-panel';
import { accountQuery } from '@/features/accounts/query-state';
import { ACCOUNT_SAVED_VIEWS_STORAGE_KEY } from '@/features/accounts/saved-views';
import { AuditLogCard } from '@/features/settings/audit-log-card';
import type { AuditLogEntry } from '@/features/settings/types';

function makeAccount(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: 'acc-1',
    account_no: 'GM-000001',
    gmail_email: 'alpha@gmail.com',
    registered_at: '2025-01-10T00:00:00Z',
    recovery_account_id: null,
    recovery_email_external: null,
    recovery_email: null,
    status: 'normal',
    two_factor_status: 'disabled',
    purpose: null,
    tags: [],
    apps: [],
    last_login_at: null,
    last_verified_at: null,
    password_changed_at: null,
    archived_at: null,
    deleted_at: null,
    row_version: 1,
    created_at: '2025-01-10T00:00:00Z',
    updated_at: '2025-01-10T00:00:00Z',
    ...overrides,
  };
}

function makeSession(): SessionResponse {
  return {
    state: 'authenticated',
    csrf_token: 'csrf-stage-e',
    idle_timeout_seconds: 900,
    server_time: '2026-11-27T08:00:00Z',
    expires_at: '2026-11-27T20:00:00Z',
    idle_expires_at: '2026-11-27T08:15:00Z',
    reauthenticated_until: '2026-11-27T08:05:00Z',
    mfa_reauthenticated_until: '2026-11-27T08:05:00Z',
    totp_enabled: true,
    step_up_totp_required: false,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('阶段 E：智能视图、风险待办中心、数据质量体检、批量预览与审计导出', () => {
  it('URL 查询解析支持全部阶段 E 智能视图筛选参数并安全忽略非法值', () => {
    const valid = accountQuery(
      new URLSearchParams(
        'has_recovery_email=false&unverified_over_days=30&inactive_login_over_days=90&password_stale_over_days=180&app_statuses=restricted,banned&missing_metadata=no_purpose_or_tags&conflict_check=inactive_with_active_apps',
      ),
    );
    expect(valid.has_recovery_email).toBe(false);
    expect(valid.unverified_over_days).toBe(30);
    expect(valid.inactive_login_over_days).toBe(90);
    expect(valid.password_stale_over_days).toBe(180);
    expect(valid.app_statuses).toEqual(['restricted', 'banned']);
    expect(valid.missing_metadata).toBe('no_purpose_or_tags');
    expect(valid.conflict_check).toBe('inactive_with_active_apps');

    const invalid = accountQuery(
      new URLSearchParams(
        'unverified_over_days=0&inactive_login_over_days=9999&missing_metadata=hack&conflict_check=bad',
      ),
    );
    expect(invalid.unverified_over_days).toBeUndefined();
    expect(invalid.inactive_login_over_days).toBeUndefined();
    expect(invalid.missing_metadata).toBeUndefined();
    expect(invalid.conflict_check).toBeUndefined();
  });

  it('活跃筛选条完整渲染阶段 E 智能筛选 Chips 并支持逐项清除', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const params = new URLSearchParams(
      'has_recovery_email=false&unverified_over_days=30&inactive_login_over_days=90&password_stale_over_days=180&app_statuses=restricted,banned&missing_metadata=no_purpose_or_tags&conflict_check=inactive_with_active_apps',
    );

    render(<AccountActiveFilters params={params} tags={[]} change={change} />);

    const bar = screen.getByRole('region', { name: '当前生效筛选条件' });
    expect(within(bar).getByText('辅助邮箱：未设置')).toBeInTheDocument();
    expect(within(bar).getByText('超过 30 天未验证')).toBeInTheDocument();
    expect(within(bar).getByText('超过 90 天未登录')).toBeInTheDocument();
    expect(within(bar).getByText('超过 180 天未改密')).toBeInTheDocument();
    expect(
      within(bar).getByText('应用状态：受限 / 已封禁'),
    ).toBeInTheDocument();
    expect(
      within(bar).getByText('资料缺失：缺少用途或标签'),
    ).toBeInTheDocument();
    expect(
      within(bar).getByText('质量冲突：停用/归档含活跃应用'),
    ).toBeInTheDocument();

    await user.click(
      within(bar).getByRole('button', { name: '移除未验证天数条件' }),
    );
    expect(change).toHaveBeenCalledWith({ unverified_over_days: '' });
  });

  it('保存视图菜单展示风险智能视图与数据质量分组并可保存新条件', async () => {
    const user = userEvent.setup();
    const onApplyView = vi.fn();
    const params = new URLSearchParams('unverified_over_days=30');

    render(
      <AccountSavedViews
        params={params}
        columns={defaultVisibleColumns}
        onApplyView={onApplyView}
      />,
    );

    // 匹配到内置“30 天未验证”智能视图
    const trigger = screen.getByRole('button', { name: '保存视图' });
    expect(trigger).toHaveTextContent('30 天未验证');

    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('风险智能视图')).toBeInTheDocument();
    expect(within(menu).getByText('数据质量与归档')).toBeInTheDocument();
    expect(within(menu).getByText('无辅助邮箱')).toBeInTheDocument();
    expect(within(menu).getByText('状态与应用矛盾')).toBeInTheDocument();

    await user.click(within(menu).getByText('保存当前条件为视图…'));
    const dialog = await screen.findByRole('dialog', {
      name: '保存当前筛选视图',
    });
    await user.type(within(dialog).getByLabelText('视图名称'), '月度核验巡检');
    await user.click(within(dialog).getByRole('button', { name: '保存视图' }));

    const savedRaw = window.localStorage.getItem(
      ACCOUNT_SAVED_VIEWS_STORAGE_KEY,
    );
    expect(savedRaw).toContain('月度核验巡检');
    expect(savedRaw).toContain('"unverified_over_days":"30"');
  });

  it('概览洞察面板渲染风险待办、数据质量体检与运维信号并精准下钻', async () => {
    const user = userEvent.setup();
    const onDrillDown = vi.fn();
    const onOpenBackup = vi.fn();
    const onOpenAudit = vi.fn();

    const insights: DashboardInsightsResponse = {
      disabled_2fa_count: 4,
      unknown_2fa_count: 1,
      pending_verification_count: 2,
      risk_status_count: 3,
      unverified_over_30_days: 5,
      inactive_login_over_90_days: 6,
      password_stale_over_180_days: 7,
      no_recovery_email_count: 8,
      app_risk_account_count: 2,
      concentrated_recovery_emails: [
        {
          email: 'hub@example.com',
          account_count: 5,
          normal_count: 4,
          abnormal_count: 1,
          latest_registered_at: '2026-11-20T00:00:00Z',
        },
      ],
      no_purpose_count: 9,
      no_tags_count: 10,
      inactive_with_active_apps_count: 2,
      external_recovery_matches_internal: [
        {
          email: 'backup@gmail.com',
          account_count: 3,
          matched_account_id: 'acc-12',
          matched_account_no: 'GM-000012',
        },
      ],
      backup_state: 'stale',
      backup_offsite: 'failed',
      backup_last_success_at: '2026-11-24T02:00:00Z',
      recent_auth_failures_7d: 2,
      generated_at: '2026-11-27T08:00:00Z',
    };

    render(
      <OverviewInsightsPanel
        stats={{
          all: 20,
          normal: 10,
          pending: 2,
          addedThisMonth: 3,
          risk: 3,
          disabled: 2,
          archived: 3,
        }}
        items={[]}
        insights={insights}
        recoveryBars={[]}
        liveAnalytics
        onDrillDown={onDrillDown}
        onOpenBackup={onOpenBackup}
        onOpenAudit={onOpenAudit}
      />,
    );

    const riskPanel = screen.getByLabelText('风险待办');
    await user.click(
      within(riskPanel).getByRole('button', { name: /30 天未验证/ }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      unverified_over_days: '30',
    });

    await user.click(
      within(riskPanel).getByRole('button', { name: /无辅助邮箱/ }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      has_recovery_email: 'false',
      archived: 'false',
    });

    await user.click(
      within(riskPanel).getByRole('button', { name: /关联应用异常/ }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      app_statuses: 'restricted,banned',
    });

    await user.click(
      within(riskPanel).getByRole('button', { name: /90 天未登录/ }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      inactive_login_over_days: '90',
    });

    await user.click(
      within(riskPanel).getByRole('button', { name: /180 天未改密/ }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      password_stale_over_days: '180',
    });

    const qualityPanel = screen.getByLabelText('数据质量与运维健康');
    expect(
      within(qualityPanel).getByText('备份已过期（>36h）'),
    ).toBeInTheDocument();
    expect(within(qualityPanel).getByText('异地同步失败')).toBeInTheDocument();
    expect(within(qualityPanel).getByText('2 次')).toBeInTheDocument();

    await user.click(
      within(qualityPanel).getByRole('button', { name: /状态与应用矛盾/ }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      conflict_check: 'inactive_with_active_apps',
    });

    await user.click(
      within(qualityPanel).getByRole('button', { name: /backup@gmail\.com/ }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      recovery_email: 'backup@gmail.com',
    });

    await user.click(
      within(qualityPanel).getByRole('button', { name: '备份与恢复' }),
    );
    expect(onOpenBackup).toHaveBeenCalledTimes(1);

    await user.click(
      within(qualityPanel).getByRole('button', { name: '审计日志' }),
    );
    expect(onOpenAudit).toHaveBeenCalledTimes(1);
  });

  it('批量操作确认弹窗展示精确变更数量与原值到目标值预览', async () => {
    const user = userEvent.setup();
    const tags: TagResponse[] = [
      { id: 't1', name: '主力', created_at: '2026-01-01T00:00:00Z' },
    ];
    const selected: AccountSummary[] = [
      makeAccount({ id: 'a1', account_no: 'GM-000001', status: 'normal' }),
      makeAccount({
        id: 'a2',
        account_no: 'GM-000002',
        gmail_email: 'beta@gmail.com',
        status: 'pending_verification',
      }),
    ];

    render(
      <BatchBar
        selected={selected}
        tags={tags}
        session={makeSession()}
        complete={vi.fn(async () => {})}
        onFailure={vi.fn()}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText('批量目标状态'),
      'restricted',
    );
    await user.click(screen.getByRole('button', { name: '批量修改状态' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/预计变更 2 条/)).toBeInTheDocument();
    expect(within(dialog).getByText('正常 → 受限')).toBeInTheDocument();
    expect(within(dialog).getByText('待验证 → 受限')).toBeInTheDocument();
  });

  it('审计日志卡片支持查看只读事件详情与导出防公式注入筛选 CSV', async () => {
    const user = userEvent.setup();
    let capturedBlob: Blob | null = null;
    const createObjectUrlSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation((blob: Blob | MediaSource) => {
        capturedBlob = blob as Blob;
        return 'blob:audit-export';
      });
    const revokeSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});

    const entries: AuditLogEntry[] = [
      {
        id: 'aud-1',
        seq: 108,
        createdAt: '2026-11-27 10:15',
        createdAtIso: '2026-11-27T10:15:00Z',
        eventType: 'csv_exported',
        eventLabel: '导出 CSV',
        objectType: 'export',
        objectLabel: '=HYPERLINK("http://evil")',
        result: 'success',
        ipAddress: '192.0.2.10',
        hashShort: 'a1b2c3d4e5f6',
      },
    ];

    render(<AuditLogCard entries={entries} expanded />);

    await user.click(screen.getByRole('button', { name: /详情\s*#108/ }));
    const dialog = await screen.findByRole('dialog', { name: '审计事件详情' });
    expect(within(dialog).getByText('#108')).toBeInTheDocument();
    expect(within(dialog).getByText('csv_exported')).toBeInTheDocument();
    expect(within(dialog).getByText('a1b2c3d4e5f6')).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: '导出筛选 CSV' }));
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(capturedBlob).not.toBeNull();
    const csvText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(capturedBlob!);
    });
    expect(csvText).toContain('csv_exported');
    // 公式注入前缀已转义
    expect(csvText).toContain("'=HYPERLINK(");
    revokeSpy.mockRestore();
  });
});
