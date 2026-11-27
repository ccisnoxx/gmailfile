import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type { AccountDetail, SessionResponse } from '@/api/generated';
import { AccountDetailDrawer } from '@/features/accounts/account-detail-drawer';
import { AccountForm } from '@/features/accounts/account-form';
import { AccountsPage } from '@/features/accounts/accounts-page';

const id = () => crypto.randomUUID();

const session = (): SessionResponse => ({
  state: 'authenticated',
  idle_timeout_seconds: 900,
  server_time: new Date().toISOString(),
  csrf_token: id(),
  expires_at: new Date(Date.now() + 43200000).toISOString(),
  idle_expires_at: new Date(Date.now() + 900000).toISOString(),
  reauthenticated_until: null,
});

const makeAccount = (
  overrides: Partial<AccountDetail> = {},
): AccountDetail => ({
  id: id(),
  account_no: 'GM-000001',
  gmail_email: 'stageb.user@gmail.com',
  registered_at: '2026-06-15T10:00:00Z',
  recovery_account_id: null,
  recovery_email_external: 'stageb.bak@example.test',
  recovery_email: 'stageb.bak@example.test',
  status: 'restricted',
  two_factor_status: 'disabled',
  purpose: '运营主号',
  tags: [{ id: 'tag-ops', name: '运营', created_at: '2026-01-01T00:00:00Z' }],
  apps: [
    {
      app_id: 'app-gh',
      app_name: 'GitHub',
      app_domain: 'github.com',
      app_icon_data: null,
      status: 'active',
      note: null,
      banned_at: null,
      updated_at: '2026-11-21T08:00:00Z',
    },
  ],
  last_login_at: '2026-11-20T08:00:00Z',
  last_verified_at: '2026-11-21T08:00:00Z',
  password_changed_at: '2026-10-01T08:00:00Z',
  archived_at: null,
  deleted_at: null,
  row_version: 2,
  created_at: '2026-06-15T10:00:00Z',
  updated_at: '2026-11-21T08:00:00Z',
  phone: null,
  notes: null,
  has_phone: true,
  has_notes: true,
  ...overrides,
});

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function mountWithQuery(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{node}</QueryClientProvider>,
  );
}

function stubBackend(records: AccountDetail[]) {
  const mock = vi.fn(async (req: Request) => {
    const url = new URL(req.url);
    if (url.pathname === '/api/v1/tags') {
      return json([
        { id: 'tag-ops', name: '运营', created_at: '2026-01-01T00:00:00Z' },
      ]);
    }
    if (url.pathname === '/api/v1/apps') {
      return json([
        {
          id: 'app-gh',
          name: 'GitHub',
          domain: 'github.com',
          icon_data: null,
          sort_order: 1,
          created_at: '2026-01-01T00:00:00Z',
        },
      ]);
    }
    if (url.pathname === '/api/v1/dashboard/summary') {
      return json({
        total: records.length,
        normal: 1,
        pending_verification: 1,
        risk: 1,
        disabled: 0,
        archived: 0,
        deleted_count: 0,
        added_this_month: 2,
      });
    }
    if (url.pathname === '/api/v1/dashboard/registration-trend') {
      return json({
        timezone: 'Asia/Shanghai',
        months: 12,
        items: [{ month: '2026-11', count: 2, cumulative: 2 }],
      });
    }
    if (url.pathname === '/api/v1/dashboard/status-distribution') {
      return json({
        total: records.length,
        statuses: [{ status: 'restricted', count: 1 }],
        two_factor: [{ two_factor_status: 'disabled', count: 1 }],
        top_tags: [],
      });
    }
    if (url.pathname === '/api/v1/dashboard/recovery-email-usage') {
      return json({
        total_accounts: records.length,
        total_recovery_emails: 1,
        items: [],
        others_count: 0,
      });
    }
    return json({
      items: records,
      total: records.length,
      page: 1,
      page_size: 30,
    });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('列表页以紧凑状态条替代重复六卡，活跃筛选条在折叠筛选面板后完整显示并支持单项与全部清除', async () => {
  const user = userEvent.setup();
  stubBackend([makeAccount()]);
  window.history.replaceState(
    null,
    '',
    '/?status=restricted&two_factor_status=disabled&tag=tag-ops&purpose=%E8%BF%90%E8%90%A5%E4%B8%BB%E5%8F%B7&from=2026-01-01&sort=registered_at',
  );

  const { container } = mountWithQuery(
    <AccountsPage
      session={session()}
      onSession={vi.fn()}
      onFailure={vi.fn()}
      onSecurity={vi.fn()}
      onLogout={vi.fn()}
    />,
  );

  await screen.findByRole('table');
  expect(
    container.querySelector('[data-slot="account-status-strip"]'),
  ).toBeInTheDocument();

  // 折叠筛选面板时，常驻活跃筛选条仍展示所有条件 Chip
  const activeBar = screen.getByRole('region', { name: '当前生效筛选条件' });
  expect(activeBar).toHaveTextContent('状态：受限');
  expect(activeBar).toHaveTextContent('2FA：未开启');
  expect(activeBar).toHaveTextContent('标签：运营');
  expect(activeBar).toHaveTextContent('用途：运营主号');
  expect(activeBar).toHaveTextContent('注册时间：2026-01-01 起');
  expect(activeBar).toHaveTextContent('排序：注册时间 ↑');

  // 单项清除用途筛选
  await user.click(
    within(activeBar).getByRole('button', { name: '移除用途条件' }),
  );
  expect(location.search).not.toContain('purpose=');
  expect(location.search).toContain('status=restricted');

  // 清空全部
  await user.click(within(activeBar).getByRole('button', { name: '清空全部' }));
  expect(location.search).toBe('');
  expect(
    screen.queryByRole('region', { name: '当前生效筛选条件' }),
  ).not.toBeInTheDocument();

  // 切换到图表/概览视图时再显示完整 KPI 统计卡
  await user.click(screen.getByRole('button', { name: '图表视图' }));
  const chartView = await screen.findByLabelText('账号数据图表视图');
  expect(within(chartView).getByLabelText('账号全局统计')).toBeInTheDocument();
  expect(
    container.querySelector('[data-slot="account-status-strip"]'),
  ).not.toBeInTheDocument();
});

it('筛选面板拆分常用与高级筛选，并提供已有用途 datalist 建议；支持保存视图与默认视图持久化', async () => {
  const user = userEvent.setup();
  stubBackend([makeAccount()]);

  const first = mountWithQuery(
    <AccountsPage
      session={session()}
      onSession={vi.fn()}
      onFailure={vi.fn()}
      onSecurity={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
  await screen.findByRole('table');

  // 展开筛选面板：默认只展示常用筛选，高级筛选折叠
  await user.click(screen.getByRole('button', { name: /筛选/ }));
  expect(screen.getByLabelText('筛选状态')).toBeInTheDocument();
  expect(screen.getByLabelText('筛选二步验证')).toBeInTheDocument();
  expect(screen.queryByLabelText('归档条件')).not.toBeInTheDocument();

  // 展开高级筛选并验证用途建议 datalist
  await user.click(screen.getByRole('button', { name: /高级筛选/ }));
  expect(screen.getByLabelText('归档条件')).toBeInTheDocument();
  const purposeInput = screen.getByLabelText('筛选用途（精确匹配）');
  expect(purposeInput).toHaveAttribute(
    'list',
    'account-filter-purpose-options',
  );
  expect(
    document.querySelector(
      '#account-filter-purpose-options option[value="运营主号"]',
    ),
  ).not.toBeNull();

  // 应用内置“无 2FA”视图，再保存为默认自定义视图
  await user.click(screen.getByRole('button', { name: '保存视图' }));
  await user.click(await screen.findByRole('menuitem', { name: /无 2FA/ }));
  expect(location.search).toContain('two_factor_status=disabled');

  await user.click(screen.getByRole('button', { name: '保存视图' }));
  await user.click(
    await screen.findByRole('menuitem', { name: '保存当前条件为视图…' }),
  );
  const dialog = await screen.findByRole('dialog', {
    name: '保存当前筛选视图',
  });
  await user.type(within(dialog).getByLabelText('视图名称'), '待处理无2FA');
  await user.click(within(dialog).getByLabelText('设为进入账号页时的默认视图'));
  await user.click(within(dialog).getByRole('button', { name: '保存视图' }));

  const stored = JSON.parse(
    window.localStorage.getItem('gm_account_saved_views_v1') || '{}',
  );
  expect(stored.version).toBe(1);
  expect(stored.views).toHaveLength(1);
  expect(stored.defaultViewId).toBe(stored.views[0].id);

  // 回到干净 URL 重新挂载，自动恢复默认视图条件
  first.unmount();
  window.history.replaceState(null, '', '/');
  mountWithQuery(
    <AccountsPage
      session={session()}
      onSession={vi.fn()}
      onFailure={vi.fn()}
      onSecurity={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
  await waitFor(() =>
    expect(location.search).toContain('two_factor_status=disabled'),
  );
});

it('移动端视口（<768px）切换为账号卡片模式，无需表格横向滚动且常显复制与显式多选', async () => {
  const user = userEvent.setup();
  const account = makeAccount();
  stubBackend([account]);

  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(max-width: 767px)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );

  const { container } = mountWithQuery(
    <AccountsPage
      session={session()}
      onSession={vi.fn()}
      onFailure={vi.fn()}
      onSecurity={vi.fn()}
      onLogout={vi.fn()}
    />,
  );

  await screen.findByRole('list', { name: '账号列表' });
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  expect(
    container.querySelector('[data-slot="account-mobile-card-list"]'),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: `复制邮箱 ${account.gmail_email}` }),
  ).toBeVisible();
  expect(
    screen.getByRole('button', {
      name: `复制辅助邮箱 ${account.recovery_email}`,
    }),
  ).toBeVisible();

  // 显式点击“选择”进入多选模式
  expect(
    screen.queryByLabelText(`选择 ${account.account_no}`),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '选择' }));
  await user.click(screen.getByLabelText(`选择 ${account.account_no}`));
  expect(screen.getByText('已选当前页 1 条（不跨页）')).toBeInTheDocument();
});

it('账号详情抽屉按概览/安全/关系/活动分区，支持键盘切换且次级操作收纳至更多菜单', async () => {
  const user = userEvent.setup();
  const detail = makeAccount();
  const onAction = vi.fn();
  const onEdit = vi.fn();
  const onRequestConfirm = vi.fn();

  mountWithQuery(
    <AccountDetailDrawer
      open
      detail={detail}
      session={session()}
      secretEpoch={0}
      busy={false}
      conflict={false}
      notice=""
      onClose={vi.fn()}
      onRestoreFocus={vi.fn()}
      onSession={vi.fn()}
      onFailure={vi.fn()}
      onCopy={vi.fn()}
      onReload={vi.fn()}
      onAction={onAction}
      onEdit={onEdit}
      onRequestConfirm={onRequestConfirm}
    />,
  );

  const overviewTab = screen.getByRole('tab', { name: '概览' });
  expect(overviewTab).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByText('运营主号')).toBeInTheDocument();

  // 方向键切至“安全”分区查看密码与敏感资料控制区
  overviewTab.focus();
  fireEvent.keyDown(overviewTab, { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: '安全' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  expect(screen.getByRole('button', { name: '显示密码' })).toBeInTheDocument();

  // 切至“关系”与“活动”
  await user.click(screen.getByRole('tab', { name: '关系' }));
  expect(screen.getByText('GitHub')).toBeInTheDocument();
  await user.click(screen.getByRole('tab', { name: '活动' }));
  expect(screen.getByText('v2')).toBeInTheDocument();

  // 底部主操作与更多菜单
  await user.click(screen.getByRole('button', { name: '编辑账号' }));
  expect(onEdit).toHaveBeenCalledOnce();

  await user.click(screen.getByRole('button', { name: '详情更多操作' }));
  await user.click(await screen.findByRole('menuitem', { name: '归档' }));
  expect(onRequestConfirm).toHaveBeenCalledWith('archive');
});

it('账号表单采用分组结构、默认折叠活动时间，并对已加密手机号与备注提供保留/替换/清空三态控件', async () => {
  const user = userEvent.setup();
  const submitted: unknown[] = [];
  const existing = makeAccount({
    has_phone: true,
    phone: null,
    has_notes: true,
    notes: null,
  });

  render(
    <AccountForm
      account={existing}
      tags={[]}
      purposeSuggestions={['运营主号', '云服务']}
      onFailure={vi.fn()}
      busy={false}
      conflict={false}
      onSubmit={async (body) => {
        submitted.push(body);
      }}
      onCancel={vi.fn()}
    />,
  );

  expect(screen.getByRole('region', { name: '基本信息' })).toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: '恢复与安全' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: '分类与关系' }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole('region', { name: '敏感备注高风险区' }),
  ).toBeInTheDocument();

  // 活动时间默认折叠，点击展开后显示时间输入框
  expect(screen.queryByLabelText('最后登录时间')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: /活动时间/ }));
  expect(screen.getByLabelText('最后登录时间')).toBeInTheDocument();

  // 默认“保留原值”：提交时省略 phone 与 notes，避免误清空
  await user.click(screen.getByRole('button', { name: '保存账号' }));
  await waitFor(() => expect(submitted).toHaveLength(1));
  expect('phone' in (submitted[0] as Record<string, unknown>)).toBe(false);
  expect('notes' in (submitted[0] as Record<string, unknown>)).toBe(false);

  // 手机号改为“清空”，敏感备注改为“替换”并填写新值
  const phoneGroup = screen.getByRole('group', { name: '绑定手机号变更策略' });
  await user.click(within(phoneGroup).getByRole('button', { name: '清空' }));
  expect(
    screen.getByText('保存后将清空已保存的绑定手机号。'),
  ).toBeInTheDocument();

  const notesGroup = screen.getByRole('group', { name: '敏感备注变更策略' });
  await user.click(within(notesGroup).getByRole('button', { name: '替换' }));
  await user.type(
    screen.getByPlaceholderText('输入新的敏感备注以覆盖原值'),
    '更新后的加密备注',
  );

  await user.click(screen.getByRole('button', { name: '保存账号' }));
  await waitFor(() => expect(submitted).toHaveLength(2));
  expect((submitted[1] as Record<string, unknown>).phone).toBeNull();
  expect((submitted[1] as Record<string, unknown>).notes).toBe(
    '更新后的加密备注',
  );
});
