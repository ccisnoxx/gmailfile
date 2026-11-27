import { QueryClient } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountSummary } from '@/api/generated';
import {
  resolveAccountFilterToken,
  resolveAccountSectionHref,
  resolveAppHref,
  resolveOperationsDestination,
  resolveWorkspaceNavDestination,
} from '@/app/navigation';
import {
  AppWindowShell,
  PrimarySidebar,
  useAppShellContext,
} from '@/components/macos';
import { ColumnToggle } from '@/features/accounts/account-table';
import { AccountsChartView } from '@/features/accounts/accounts-chart-view';
import { defaultVisibleColumns } from '@/features/accounts/constants';
import { SettingsPreviewPage } from '@/features/settings';
import {
  DEFAULT_QUERY_CLIENT_OPTIONS,
  purgeProtectedAccountDetailQueries,
  purgeProtectedAccountsQueries,
  purgeProtectedSettingsQueries,
} from '@/lib/query-cache-policy';

function makeAccount(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    id: 'acc-1',
    account_no: 'GM-0001',
    gmail_email: 'alpha@gmail.com',
    registered_at: '2026-03-15T08:00:00Z',
    recovery_account_id: null,
    recovery_email_external: 'shared-backup@example.com',
    recovery_email: 'shared-backup@example.com',
    status: 'normal',
    two_factor_status: 'enabled',
    purpose: '测试用途',
    tags: [{ id: 'tag-1', name: '主力', created_at: '2026-03-15T08:00:00Z' }],
    apps: [],
    last_login_at: null,
    last_verified_at: null,
    password_changed_at: null,
    archived_at: null,
    deleted_at: null,
    row_version: 1,
    created_at: '2026-03-15T08:00:00Z',
    updated_at: '2026-03-15T08:00:00Z',
    ...overrides,
  };
}

function MobileTriggerToolbar() {
  const shell = useAppShellContext();
  return (
    <button
      type="button"
      onClick={() => shell?.toggleMobileSidebar()}
      aria-expanded={shell?.mobileSidebarOpen ?? false}
    >
      打开导航菜单
    </button>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('阶段 C & D：统一路由、导航收敛、图表下钻、无障碍升级与缓存/懒加载策略', () => {
  it('统一路由映射在 Live 与 Preview 模式下生成一致的目标路径', () => {
    expect(resolveAppHref({ kind: 'dashboard' })).toBe('/accounts?view=chart');
    expect(resolveAppHref({ kind: 'dashboard' }, { preview: true })).toBe(
      '/preview/accounts',
    );
    expect(resolveAccountSectionHref('risk')).toBe(
      '/accounts?statuses=restricted%2Clogin_failed',
    );
    expect(resolveAccountSectionHref('trash')).toBe('/accounts?deleted=true');
    expect(resolveAccountSectionHref('trash', { preview: true })).toBe(
      '/preview/accounts',
    );
    expect(resolveAccountFilterToken('tag:vip')).toEqual({
      kind: 'accounts',
      query: { tag: 'vip' },
    });
    expect(resolveWorkspaceNavDestination('apps')).toEqual({ kind: 'apps' });
    expect(resolveWorkspaceNavDestination('recovery')).toEqual({
      kind: 'recovery-emails',
    });
    expect(
      resolveAppHref(resolveOperationsDestination('export', '?status=normal')),
    ).toBe('/transfers/csv?status=normal&tab=export');
    expect(resolveAppHref(resolveOperationsDestination('audit'))).toBe(
      '/settings/audit',
    );
    expect(
      resolveAppHref(
        { kind: 'settings', section: 'security', search: '?action=reverify' },
        { preview: true },
      ),
    ).toBe('/preview/settings/security?action=reverify');
  });

  it('主侧边栏收敛为 概览与账号 / 关系 / 数据操作 / 设置 四个分组并保留全部入口', () => {
    render(
      <PrimarySidebar
        mode="workspace"
        activeNav="accounts"
        activeSection="all"
        onSelectNav={vi.fn()}
        onSelectSection={vi.fn()}
        onSelectTag={vi.fn()}
      />,
    );

    const sidebar = screen.getByLabelText('侧边导航栏');
    expect(within(sidebar).getByText('概览与账号')).toBeInTheDocument();
    expect(within(sidebar).getByText('关系')).toBeInTheDocument();
    expect(within(sidebar).getByText('数据操作')).toBeInTheDocument();
    expect(within(sidebar).getByText('设置')).toBeInTheDocument();

    for (const label of [
      '数据概览',
      '全部账号',
      '回收站',
      '已注册应用',
      '辅助邮箱统计',
      '标签管理',
      '导入 / 导出（CSV）',
      '审计日志',
      '备份与恢复',
      '系统设置',
    ]) {
      expect(within(sidebar).getByText(label)).toBeInTheDocument();
    }
  });

  it('概览页风险待办与各图表区块支持点击/键盘下钻到精准筛选条件', async () => {
    const user = userEvent.setup();
    const onDrillDown = vi.fn();

    const items: AccountSummary[] = [
      makeAccount({
        id: 'a1',
        two_factor_status: 'disabled',
        registered_at: '2026-02-10T00:00:00Z',
        recovery_email: 'shared@example.com',
      }),
      makeAccount({
        id: 'a2',
        two_factor_status: 'enabled',
        registered_at: '2026-02-20T00:00:00Z',
        recovery_email: 'shared@example.com',
      }),
      makeAccount({
        id: 'a3',
        status: 'pending_verification',
        two_factor_status: 'disabled',
        registered_at: '2026-03-05T00:00:00Z',
        recovery_email: 'shared@example.com',
      }),
    ];

    render(
      <AccountsChartView
        stats={{
          all: 10,
          normal: 5,
          pending: 2,
          addedThisMonth: 3,
          risk: 1,
          disabled: 1,
          archived: 1,
        }}
        items={items}
        onDrillDown={onDrillDown}
        onOpenRecoveryUsage={vi.fn()}
      />,
    );

    const todos = screen.getByLabelText('风险待办');
    await user.click(within(todos).getByRole('button', { name: /未开启 2FA/ }));
    expect(onDrillDown).toHaveBeenLastCalledWith({
      two_factor_status: 'disabled',
    });

    await user.click(within(todos).getByRole('button', { name: /待验证账号/ }));
    expect(onDrillDown).toHaveBeenLastCalledWith({
      status: 'pending_verification',
    });

    await user.click(
      within(todos).getByRole('button', { name: /受限 \/ 无法登录/ }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      statuses: 'restricted,login_failed',
    });

    await user.click(
      within(todos).getByRole('button', { name: /高集中辅助邮箱/ }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      recovery_email: 'shared@example.com',
    });

    // 注册趋势按月下钻
    await user.click(screen.getByRole('button', { name: /2026-03/ }));
    expect(onDrillDown).toHaveBeenLastCalledWith({
      from: '2026-03-01',
      to: '2026-03-31',
    });

    // 2FA 覆盖率下钻
    await user.click(screen.getByRole('button', { name: /筛选 2FA 已开启/ }));
    expect(onDrillDown).toHaveBeenLastCalledWith({
      two_factor_status: 'enabled',
    });

    // 高频标签下钻
    await user.click(screen.getByRole('button', { name: '筛选标签 主力' }));
    expect(onDrillDown).toHaveBeenLastCalledWith({ tag: '主力' });

    // 状态分布下钻
    const statusList = screen.getByRole('list', { name: '状态分布快捷下钻' });
    await user.click(
      within(statusList).getByRole('button', { name: /已归档/ }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({ archived: 'true' });

    // 辅助邮箱 Top 条目下钻
    await user.click(
      screen.getByRole('button', {
        name: /筛选辅助邮箱 shared@example\.com/,
      }),
    );
    expect(onDrillDown).toHaveBeenLastCalledWith({
      recovery_email: 'shared@example.com',
    });
  });

  it('移动端导航抽屉使用 Radix Sheet 承载对话框语义并支持 Escape 关闭与焦点回退', async () => {
    const user = userEvent.setup();
    render(
      <AppWindowShell
        navAlpha={68}
        toolbar={<MobileTriggerToolbar />}
        sidebar={
          <nav aria-label="侧栏内容">
            <button type="button">全部账号</button>
          </nav>
        }
      >
        <div>工作区内容</div>
      </AppWindowShell>,
    );

    const trigger = screen.getByRole('button', { name: '打开导航菜单' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('data-slot', 'mobile-sidebar-drawer');
    expect(
      within(dialog).getByRole('button', { name: '全部账号' }),
    ).toBeVisible();

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(trigger);
  });

  it('账号表格列设置已升级为 Radix Popover，支持勾选切换与 Escape 关闭', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();

    render(
      <ColumnToggle columns={defaultVisibleColumns} onToggle={onToggle} />,
    );

    const trigger = screen.getByRole('button', { name: /显示列/ });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const dialog = await screen.findByRole('dialog', {
      name: '表格列显示设置',
    });
    const checkbox = within(dialog).getByRole('checkbox', { name: '更新时间' });
    await user.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith('updated', true);

    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: '表格列显示设置' }),
      ).not.toBeInTheDocument();
    });
  });

  it('TanStack Query 缓存策略在清理受保护工作区时仅移除受保护 key 而不误伤无关缓存', () => {
    const client = new QueryClient({
      defaultOptions: DEFAULT_QUERY_CLIENT_OPTIONS,
    });

    client.setQueryData(['accounts', { page: 1 }], { items: [] });
    client.setQueryData(['tags'], []);
    client.setQueryData(['account-detail', 'acc-1'], { id: 'acc-1' });
    client.setQueryData(['settings-sessions'], { items: [] });
    client.setQueryData(['settings-audits'], { items: [] });
    client.setQueryData(['public-theme-meta'], { version: 1 });

    purgeProtectedAccountsQueries(client);
    expect(client.getQueryData(['accounts', { page: 1 }])).toBeUndefined();
    expect(client.getQueryData(['tags'])).toBeUndefined();
    expect(client.getQueryData(['account-detail', 'acc-1'])).toBeDefined();

    purgeProtectedAccountDetailQueries(client);
    expect(client.getQueryData(['account-detail', 'acc-1'])).toBeUndefined();
    expect(client.getQueryData(['settings-sessions'])).toBeDefined();

    purgeProtectedSettingsQueries(client);
    expect(client.getQueryData(['settings-sessions'])).toBeUndefined();
    expect(client.getQueryData(['settings-audits'])).toBeUndefined();
    expect(client.getQueryData(['public-theme-meta'])).toEqual({ version: 1 });
  });

  it('系统设置页按 Section 懒加载对应分区并支持跨分区切换', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/settings/backup']}>
        <Routes>
          <Route path="/settings/:section" element={<SettingsPreviewPage />} />
          <Route
            path="/preview/settings/:section"
            element={<SettingsPreviewPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole('heading', { name: '最近加密归档快照' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: '管理员安全' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: '系统与维护' }));
    expect(
      await screen.findByRole('heading', { name: '运行环境与会话安全' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: '最近加密归档快照' }),
    ).not.toBeInTheDocument();
  });
});
