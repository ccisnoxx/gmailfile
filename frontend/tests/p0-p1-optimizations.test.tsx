import { useState } from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Providers } from '@/app/providers';
import { buildRoutes } from '@/app/router';
import { GlassToolbar } from '@/components/macos';
import { AccountDetailDrawer } from '@/features/accounts/account-detail-drawer';
import { BatchBar } from '@/features/accounts/account-batch-bar';
import { AppsUsageView } from '@/features/accounts/apps-usage-view';
import { OverviewInsightsPanel } from '@/features/accounts/overview-insights-panel';
import { PasswordControl } from '@/features/accounts/password-control';
import {
  generateMemoryPassword,
  PasswordGeneratorPopover,
} from '@/features/accounts/password-generator-popover';
import { RecoverySelector } from '@/features/accounts/recovery-selector';
import type {
  AccountDetail,
  DashboardInsightsResponse,
  RegisteredAppUsage,
  SessionResponse,
} from '@/api/generated';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const makeSession = (
  overrides: Partial<SessionResponse> = {},
): SessionResponse => {
  const now = Date.now();
  return {
    state: 'authenticated',
    server_time: new Date(now).toISOString(),
    csrf_token: 'csrf-test-token',
    expires_at: new Date(now + 43_200_000).toISOString(),
    idle_expires_at: new Date(now + 900_000).toISOString(),
    idle_timeout_seconds: 900,
    reauthenticated_until: null,
    mfa_reauthenticated_until: null,
    totp_enabled: false,
    webauthn_enabled: false,
    ...overrides,
  };
};

const makeAccount = (
  index = 1,
  overrides: Partial<AccountDetail> = {},
): AccountDetail => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  account_no: `GM-${String(index).padStart(6, '0')}`,
  gmail_email: `acct${index}@gmail.com`,
  registered_at: '2026-11-01T00:00:00Z',
  recovery_account_id: null,
  recovery_email_external: null,
  recovery_email: null,
  status: 'normal',
  two_factor_status: 'enabled',
  purpose: '自动化测试',
  tags: [],
  apps: [],
  last_login_at: null,
  last_verified_at: null,
  password_changed_at: null,
  archived_at: null,
  deleted_at: null,
  row_version: 1,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  phone: null,
  notes: null,
  ...overrides,
});

function mountWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>),
  };
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('P0 + P1 交互与功能回归测试', () => {
  it('持久化壳层支持侧边栏折叠、⌘K 全局命令面板筛选与 / 聚焦页面搜索框', async () => {
    const auth = makeSession();
    const acct = makeAccount(1, { gmail_email: 'cmdk-target@gmail.com' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/api/v1/auth/session') return json(auth);
        if (url.pathname === '/api/v1/accounts') {
          return json({
            items: [acct],
            total: 1,
            page: 1,
            page_size: 30,
          });
        }
        if (url.pathname === '/api/v1/tags') return json([]);
        if (url.pathname === '/api/v1/apps') return json([]);
        if (url.pathname === '/api/v1/dashboard/summary') {
          return json({
            total: 1,
            normal: 1,
            pending_verification: 0,
            abnormal: 0,
            risk: 0,
            disabled: 0,
            archived: 0,
            deleted_count: 0,
            tag_counts: {},
            added_this_month: 1,
            unverified_over_30_days: 0,
          });
        }
        return json({});
      }),
    );

    const memoryRouter = createMemoryRouter(buildRoutes(false), {
      initialEntries: ['/accounts'],
    });
    render(
      <Providers>
        <RouterProvider router={memoryRouter} />
      </Providers>,
    );

    await screen.findByRole('heading', { name: '账号管理' });

    // 1. 侧边栏折叠与展开记忆
    const sidebar = document.querySelector('[data-slot="primary-sidebar"]');
    expect(sidebar).toHaveAttribute('data-collapsed', 'false');
    await userEvent.click(screen.getByRole('button', { name: '收起侧边栏' }));
    expect(
      document.querySelector('[data-slot="primary-sidebar"]'),
    ).toHaveAttribute('data-collapsed', 'true');
    expect(window.localStorage.getItem('gm_sidebar_collapsed_v1')).toBe('true');

    await userEvent.click(screen.getByRole('button', { name: '展开侧边栏' }));
    expect(
      document.querySelector('[data-slot="primary-sidebar"]'),
    ).toHaveAttribute('data-collapsed', 'false');

    // 2. 按「/」聚焦当前主视图内联搜索框
    (document.activeElement as HTMLElement | null)?.blur();
    fireEvent.keyDown(window, { key: '/' });
    const inlineSearch = document.querySelector<HTMLInputElement>(
      'main input[type="search"]',
    );
    expect(inlineSearch).not.toBeNull();
    expect(document.activeElement).toBe(inlineSearch);

    // 3. 按「⌘K」唤起全局命令面板并执行上游辅助账号连带风险筛选
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    await screen.findByText('新建 Gmail 账号');
    await userEvent.click(screen.getByText('筛选：上游辅助账号异常'));
    await waitFor(() => {
      expect(memoryRouter.state.location.search).toContain(
        'upstream_recovery_risk=true',
      );
    });
  });

  it('GlassToolbar 按需显示 Step-Up 剩余倒计时、会话即将锁定续期胶囊与一键锁定', async () => {
    const now = Date.now();
    const renewedSession = makeSession({
      idle_expires_at: new Date(now + 900_000).toISOString(),
    });
    const fetchMock = vi.fn(async (req: Request) => {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/v1/auth/activity' && req.method === 'POST') {
        return json(renewedSession);
      }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);

    const onLockSession = vi.fn();
    const onSession = vi.fn();
    const nearExpirySession = makeSession({
      server_time: new Date(now).toISOString(),
      idle_expires_at: new Date(now + 42_000).toISOString(),
      expires_at: new Date(now + 3_600_000).toISOString(),
      reauthenticated_until: new Date(now + 180_000).toISOString(),
    });

    render(
      <GlassToolbar
        navAlpha={0.78}
        onNavAlphaChange={vi.fn()}
        onSelectNav={vi.fn()}
        onOpenSecurity={vi.fn()}
        onLogout={vi.fn()}
        onLockSession={onLockSession}
        session={nearExpirySession}
        onSession={onSession}
      />,
    );

    expect(
      document.querySelector('[data-slot="step-up-countdown-badge"]'),
    ).toHaveTextContent(/已验证 0[23]:/);
    const warning = document.querySelector(
      '[data-slot="session-expiry-warning"]',
    );
    expect(warning).toHaveTextContent(/即将锁定 00:/);

    await userEvent.click(screen.getByRole('button', { name: '续期' }));
    await waitFor(() => expect(onSession).toHaveBeenCalledWith(renewedSession));

    await userEvent.click(screen.getByRole('button', { name: '立即锁定会话' }));
    expect(onLockSession).toHaveBeenCalledTimes(1);
  });

  it('纯内存密码生成器满足字符集熵要求并填入表单，PasswordControl 展示 20 秒倒计时条', async () => {
    const sample = generateMemoryPassword({
      length: 24,
      upper: true,
      lower: true,
      digits: true,
      symbols: true,
    });
    expect(sample.value).toHaveLength(24);
    expect(sample.entropyBits).toBeGreaterThanOrEqual(110);

    function Harness() {
      const [pwd, setPwd] = useState('');
      return (
        <div>
          <input aria-label="目标密码框" value={pwd} readOnly />
          <PasswordGeneratorPopover onApply={setPwd} />
        </div>
      );
    }

    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: /生成强密码/ }));
    const candidateOutput = await screen.findByLabelText('生成的候选随机密码');
    const candidateValue = candidateOutput.textContent ?? '';
    expect(candidateValue.length).toBe(20);

    await userEvent.click(screen.getByRole('button', { name: '填入密码框' }));
    expect(
      (screen.getByLabelText('目标密码框') as HTMLInputElement).value,
    ).toBe(candidateValue);

    // 验证 PasswordControl 显示密码时渲染 20 秒线性进度条
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname.endsWith('/reveal-password')) {
          return json({ password: 'Revealed#Secret!2026' });
        }
        return json({});
      }),
    );

    const activeStepUp = makeSession({
      reauthenticated_until: new Date(Date.now() + 240_000).toISOString(),
    });
    mountWithQuery(
      <PasswordControl
        accountId="00000000-0000-4000-8000-000000000001"
        session={activeStepUp}
        onSession={vi.fn()}
        onFailure={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: '显示密码' }));
    await screen.findByText('Revealed#Secret!2026');
    const bar = document.querySelector('[data-slot="secret-countdown-bar"]');
    expect(bar).not.toBeNull();
    expect(bar).toHaveAttribute('aria-valuemax', '20');
  });

  it('BatchBar 支持标签移除/清空替换、批量标记已核验与批量软删除移入回收站', async () => {
    const calls: { path: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        const url = new URL(req.url, 'http://localhost');
        const body = await req.json();
        calls.push({ path: url.pathname, body });
        return json({ updated_ids: [acct.id] });
      }),
    );

    const tag = {
      id: '11111111-1111-4111-8111-111111111111',
      name: '主力',
      created_at: '2026-11-01T00:00:00Z',
    };
    const acct = makeAccount(1, {
      status: 'pending_verification',
      tags: [tag],
    });
    const complete = vi.fn(async () => {});

    mountWithQuery(
      <BatchBar
        selected={[acct]}
        tags={[tag]}
        session={makeSession()}
        complete={complete}
        onFailure={vi.fn()}
      />,
    );

    // 1. 移除指定标签
    await userEvent.selectOptions(
      screen.getByLabelText('批量标签操作模式'),
      'remove',
    );
    await userEvent.selectOptions(
      screen.getByLabelText('批量添加标签'),
      tag.id,
    );
    await userEvent.click(
      screen.getByRole('button', { name: '从所选账号移除' }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: '确认整批提交' }),
    );
    await waitFor(() =>
      expect(calls[0]).toEqual({
        path: '/api/v1/accounts/batch-tags',
        body: {
          accounts: [{ id: acct.id, row_version: 1 }],
          mode: 'remove',
          tag_ids: [tag.id],
        },
      }),
    );

    // 2. 替换模式清空全部标签
    await userEvent.selectOptions(
      screen.getByLabelText('批量标签操作模式'),
      'replace',
    );
    await userEvent.selectOptions(screen.getByLabelText('批量添加标签'), '');
    await userEvent.click(screen.getByRole('button', { name: '清空所选标签' }));
    await userEvent.click(
      await screen.findByRole('button', { name: '确认整批提交' }),
    );
    await waitFor(() =>
      expect(calls[1]).toEqual({
        path: '/api/v1/accounts/batch-tags',
        body: {
          accounts: [{ id: acct.id, row_version: 1 }],
          mode: 'replace',
          tag_ids: [],
        },
      }),
    );

    // 3. 批量标记已核验（默认勾选将待验证转为正常）
    await userEvent.click(
      screen.getByRole('button', { name: /批量标记已核验/ }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: '确认整批提交' }),
    );
    await waitFor(() =>
      expect(calls[2]).toEqual({
        path: '/api/v1/accounts/batch-verify',
        body: {
          accounts: [{ id: acct.id, row_version: 1 }],
          promote_pending: true,
        },
      }),
    );

    // 4. 批量软删除移入回收站
    await userEvent.click(
      screen.getByRole('button', { name: /批量移入回收站/ }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: '确认移入回收站' }),
    );
    await waitFor(() =>
      expect(calls[3]).toEqual({
        path: '/api/v1/accounts/batch-delete',
        body: {
          accounts: [{ id: acct.id, row_version: 1 }],
        },
      }),
    );
  });

  it('AppsUsageView 支持弹窗创建、一键置顶与 AppAllocationDrawer 快速领号登记', async () => {
    const appRow: RegisteredAppUsage = {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Claude',
      domain: 'claude.ai',
      icon_data: null,
      sort_order: 100,
      created_at: '2026-11-01T00:00:00Z',
      total_count: 2,
      active_count: 2,
      restricted_count: 0,
      banned_count: 0,
    };
    const candidate = makeAccount(8, { gmail_email: 'clean-pool@gmail.com' });
    const mutations: { method: string; path: string; body: unknown }[] = [];

    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        const url = new URL(req.url, 'http://localhost');
        if (req.method === 'GET' && url.pathname === '/api/v1/apps/usage') {
          return json([appRow]);
        }
        if (req.method === 'GET' && url.pathname === '/api/v1/accounts') {
          expect(url.searchParams.get('exclude_app_id')).toBe(appRow.id);
          return json({
            items: [candidate],
            total: 1,
            page: 1,
            page_size: 20,
          });
        }
        const body = req.method !== 'DELETE' ? await req.json() : null;
        mutations.push({ method: req.method, path: url.pathname, body });
        if (req.method === 'POST' && url.pathname === '/api/v1/apps') {
          return json({ ...appRow, name: 'Cursor', sort_order: 20 }, 201);
        }
        if (
          req.method === 'PATCH' &&
          url.pathname.startsWith('/api/v1/apps/')
        ) {
          return json({ ...appRow, sort_order: 10 });
        }
        if (
          req.method === 'POST' &&
          url.pathname === `/api/v1/accounts/${candidate.id}/apps`
        ) {
          return json(candidate);
        }
        return json({});
      }),
    );

    const auth = makeSession();
    mountWithQuery(
      <AppsUsageView
        csrfToken={auth.csrf_token}
        session={auth}
        onSession={vi.fn()}
        onFailure={vi.fn()}
        onOpenRegisteredAccounts={vi.fn()}
        onOpenBannedAccounts={vi.fn()}
        onOpenAvailableAccounts={vi.fn()}
      />,
    );

    await screen.findByText('Claude');

    // 1. 一键置顶
    await userEvent.click(
      screen.getByRole('button', { name: '置顶应用 Claude' }),
    );
    await waitFor(() =>
      expect(mutations[0]).toEqual({
        method: 'PATCH',
        path: `/api/v1/apps/${appRow.id}`,
        body: { name: 'Claude', sort_order: 10 },
      }),
    );

    // 2. 新增应用弹窗支持设置 sort_order
    await userEvent.click(screen.getByRole('button', { name: /新增应用/ }));
    await userEvent.type(
      await screen.findByLabelText('新增应用名称'),
      'Cursor',
    );
    const orderInput = screen.getByLabelText(/排序权重/);
    await userEvent.clear(orderInput);
    await userEvent.type(orderInput, '20');
    await userEvent.click(screen.getByRole('button', { name: '保存应用' }));
    await waitFor(() =>
      expect(mutations[1]).toMatchObject({
        method: 'POST',
        path: '/api/v1/apps',
        body: { name: 'Cursor', sort_order: 20 },
      }),
    );

    // 3. 快速领号抽屉原子登记为已注册
    await userEvent.click(screen.getByRole('button', { name: /快速领号/ }));
    await screen.findByText('clean-pool@gmail.com');
    await userEvent.type(
      screen.getByLabelText('clean-pool@gmail.com 注册备注'),
      '主工作区席位',
    );
    await userEvent.click(screen.getByRole('button', { name: /登记已注册/ }));
    await waitFor(() =>
      expect(mutations[2]).toEqual({
        method: 'POST',
        path: `/api/v1/accounts/${candidate.id}/apps`,
        body: {
          row_version: candidate.row_version,
          app_id: appRow.id,
          status: 'active',
          note: '主工作区席位',
        },
      }),
    );
  });

  it('辅助邮箱负载提示、一键转站内关联、上游异常下钻及抽屉 J/K 切换正常运作', async () => {
    let linkInternalCalled = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/api/v1/accounts/options') {
          return json({
            items: [
              {
                id: '33333333-3333-4333-8333-333333333333',
                account_no: 'GM-000033',
                gmail_email: 'hub@gmail.com',
                status: 'normal',
                linked_recovery_count: 4,
              },
            ],
            page: 1,
            page_size: 20,
            has_more: false,
          });
        }
        if (
          url.pathname === '/api/v1/recovery-emails/link-internal' &&
          req.method === 'POST'
        ) {
          linkInternalCalled = true;
          return json({ linked_count: 2 });
        }
        return json({ items: [], total: 0, page: 1, page_size: 20 });
      }),
    );

    // 1. RecoverySelector 展示已绑负载与高集中度提醒
    function SelectorHost() {
      const [val, setVal] = useState('');
      return (
        <RecoverySelector value={val} onChange={setVal} onFailure={vi.fn()} />
      );
    }
    mountWithQuery(<SelectorHost />);
    await screen.findByText('已绑 4');
    await userEvent.click(screen.getByText('hub@gmail.com'));
    await screen.findByText(/该辅助账号已绑定 4 个子账号/);

    // 2. OverviewInsightsPanel 上游异常下钻与一键转站内强关联
    const onDrillDown = vi.fn();
    const insights: DashboardInsightsResponse = {
      generated_at: '2026-11-27T08:00:00Z',
      disabled_2fa_count: 0,
      unknown_2fa_count: 0,
      pending_verification_count: 0,
      risk_status_count: 0,
      unverified_over_30_days: 0,
      inactive_login_over_90_days: 0,
      password_stale_over_180_days: 0,
      no_recovery_email_count: 0,
      app_risk_account_count: 0,
      upstream_recovery_risk_count: 3,
      no_purpose_count: 0,
      no_tags_count: 0,
      inactive_with_active_apps_count: 0,
      concentrated_recovery_emails: [],
      external_recovery_matches_internal: [
        {
          email: 'hub@gmail.com',
          account_count: 2,
          matched_account_id: '33333333-3333-4333-8333-333333333333',
          matched_account_no: 'GM-000033',
        },
      ],
      recent_auth_failures_7d: 0,
      backup_state: 'success',
      backup_offsite: 'success',
      backup_last_success_at: '2026-11-27T08:00:00Z',
    };

    mountWithQuery(
      <OverviewInsightsPanel
        stats={{
          all: 10,
          normal: 10,
          pending: 0,
          addedThisMonth: 1,
          risk: 0,
          disabled: 0,
          archived: 0,
        }}
        items={[]}
        insights={insights}
        csrfToken="csrf-test-token"
        recoveryBars={[]}
        onDrillDown={onDrillDown}
      />,
    );

    await userEvent.click(screen.getByText('上游辅助号异常'));
    expect(onDrillDown).toHaveBeenCalledWith({
      upstream_recovery_risk: 'true',
    });

    await userEvent.click(
      screen.getByRole('button', { name: '一键全部转为站内关联' }),
    );
    await waitFor(() => expect(linkInternalCalled).toBe(true));
    await screen.findByText('已成功将 2 个账号转为站内辅助账号强关联。');

    // 3. AccountDetailDrawer 支持 J/K 键盘切换与展开完整详情
    const onSelectPrev = vi.fn();
    const onSelectNext = vi.fn();
    const onOpenFullPage = vi.fn();
    const detail = makeAccount(5);

    mountWithQuery(
      <AccountDetailDrawer
        open
        detail={detail}
        session={makeSession()}
        secretEpoch={1}
        busy={false}
        conflict={false}
        notice=""
        positionLabel="2 / 10"
        onSelectPrev={onSelectPrev}
        onSelectNext={onSelectNext}
        onOpenFullPage={onOpenFullPage}
        onClose={vi.fn()}
        onRestoreFocus={vi.fn()}
        onSession={vi.fn()}
        onFailure={vi.fn()}
        onCopy={vi.fn()}
        onReload={vi.fn()}
        onAction={vi.fn()}
        onEdit={vi.fn()}
        onRequestConfirm={vi.fn()}
      />,
    );

    await screen.findByText('2 / 10');
    act(() => {
      fireEvent.keyDown(window, { key: 'j' });
      fireEvent.keyDown(window, { key: 'k' });
    });
    expect(onSelectNext).toHaveBeenCalledTimes(1);
    expect(onSelectPrev).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: /完整详情/ }));
    expect(onOpenFullPage).toHaveBeenCalledWith(detail.id);
  });
});
