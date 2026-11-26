import { webcrypto } from 'node:crypto';
Object.defineProperty(crypto, 'subtle', {
  configurable: true,
  value: webcrypto.subtle,
});
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountDetail, SessionResponse } from '@/api/generated';
import {
  DISPLAY_SETTINGS_STORAGE_KEY,
  NAV_ALPHA_STORAGE_KEY,
  persistNavAlpha,
} from '@/components/macos';
import {
  AccountBasicInfoForm,
  AccountDetailPage,
  AccountDetailPreviewPage,
  AccountHeaderCard,
  AccountListPane,
  AccountMasterDetailLayout,
  AccountOverviewCard,
  AccountTabs,
  ActivityTimeline,
  DisplaySettingsPopover,
  DETAIL_DEFAULT_ACCOUNT_ID,
} from '@/features/accounts/detail';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const makeSession = (): SessionResponse => ({
  state: 'authenticated',
  idle_timeout_seconds: 900,
  server_time: new Date().toISOString(),
  csrf_token: crypto.randomUUID(),
  expires_at: new Date(Date.now() + 43200000).toISOString(),
  idle_expires_at: new Date(Date.now() + 900000).toISOString(),
  reauthenticated_until: null,
});

const makeLiveAccount = (
  overrides: Partial<AccountDetail> = {},
): AccountDetail => ({
  id: 'acc_2f9e7c1a4b6d',
  account_no: 'GM-001248',
  gmail_email: 'example.account@gmail.com',
  registered_at: '2025-09-18T10:24:17Z',
  recovery_account_id: null,
  recovery_email_external: 'backup.example@outlook.com',
  recovery_email: 'backup.example@outlook.com',
  status: 'normal',
  two_factor_status: 'enabled',
  purpose: '开发测试与工具',
  tags: [
    { id: 'tag-dev', name: '开发环境', created_at: '2025-08-01T08:00:00Z' },
  ],
  last_login_at: '2026-01-10T15:18:22Z',
  last_verified_at: '2026-01-10T16:42:09Z',
  password_changed_at: '2025-12-02T09:14:37Z',
  archived_at: null,
  deleted_at: null,
  row_version: 12,
  created_at: '2025-09-18T10:24:17Z',
  updated_at: '2026-01-10T16:42:09Z',
  phone: '+86 139 8420 6728',
  notes: '用于开发环境注册、第三方工具授权等场景；不用于重要个人业务',
  ...overrides,
});

function renderPreviewRouter(
  initialPath = `/preview/accounts/${DETAIL_DEFAULT_ACCOUNT_ID}`,
) {
  const router = createMemoryRouter(
    [
      {
        path: '/preview/accounts/:accountId',
        element: <AccountDetailPreviewPage defaultDisplaySettingsOpen />,
      },
      {
        path: '/preview/accounts',
        element: <div>列表页占位</div>,
      },
    ],
    { initialEntries: [initialPath] },
  );
  return {
    router,
    ...render(<RouterProvider router={router} />),
  };
}

function renderLiveDetail(
  account: AccountDetail,
  handlers?: {
    onPatch?: (req: Request) => Promise<Response>;
    onReveal?: (req: Request) => Promise<Response>;
    onCopyEvent?: (req: Request) => Promise<Response>;
  },
) {
  const second = makeLiveAccount({
    id: 'acc_7c41d2e89a10',
    account_no: 'GM-001247',
    gmail_email: 'dev.tools@gmail.com',
    row_version: 6,
  });

  const fetchMock = vi.fn(async (req: Request) => {
    const url = new URL(req.url);
    if (
      req.method === 'PATCH' &&
      url.pathname.endsWith(`/accounts/${account.id}`)
    ) {
      if (handlers?.onPatch) return handlers.onPatch(req);
      const body = (await req.json()) as Record<string, unknown>;
      return json({
        ...account,
        ...body,
        row_version: account.row_version + 1,
        updated_at: new Date().toISOString(),
      });
    }
    if (req.method === 'POST' && url.pathname.endsWith('/reveal-password')) {
      if (handlers?.onReveal) return handlers.onReveal(req);
      return json({ password: 'Live#Secret2026!Value' });
    }
    if (
      req.method === 'POST' &&
      url.pathname.endsWith('/copy-password-event')
    ) {
      if (handlers?.onCopyEvent) return handlers.onCopyEvent(req);
      return json({ status: 'ok' });
    }
    if (req.method === 'POST' && url.pathname.endsWith('/archive')) {
      return json({
        ...account,
        status: 'archived',
        archived_at: new Date().toISOString(),
        row_version: account.row_version + 1,
      });
    }
    if (url.pathname === `/api/v1/accounts/${account.id}`) return json(account);
    if (url.pathname === `/api/v1/accounts/${second.id}`) return json(second);
    if (url.pathname === '/api/v1/accounts') {
      return json({
        items: [account, second],
        total: 2,
        page: 1,
        page_size: 50,
      });
    }
    if (url.pathname === '/api/v1/tags') return json(account.tags);
    if (url.pathname === '/api/v1/audit-events') {
      return json({
        items: [
          {
            id: 'aud-1',
            seq: 10,
            event_hash: 'abc123',
            event_type: 'account_updated',
            account_id: account.id,
            session_id: 'sess-1',
            ip_address: '127.0.0.1',
            operation: '更新账号信息',
            created_at: '2026-01-10T16:42:09Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 20,
        event_types: ['account_updated'],
      });
    }
    if (url.pathname === '/api/v1/dashboard/summary') {
      return json({
        total: 2,
        normal: 2,
        pending_verification: 0,
        abnormal: 0,
        added_this_month: 1,
        unverified_over_30_days: 0,
      });
    }
    if (url.pathname === '/api/v1/system/backup-status') {
      return json({
        state: 'success',
        offsite: 'success',
        last_success_at: '2026-01-15T02:30:00Z',
      });
    }
    if (url.pathname === '/api/v1/system/version') {
      return json({ version: '1.1.0', schema_version: '0004' });
    }
    return json({});
  });

  vi.stubGlobal('fetch', fetchMock);

  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });

  const router = createMemoryRouter(
    [
      {
        path: '/accounts/:accountId',
        element: (
          <AccountDetailPage
            session={makeSession()}
            onSession={vi.fn()}
            onFailure={vi.fn()}
            onSecurity={vi.fn()}
            onOperations={vi.fn()}
            onLogout={vi.fn()}
          />
        ),
      },
      { path: '/accounts', element: <div>账号列表</div> },
    ],
    { initialEntries: [`/accounts/${account.id}`] },
  );

  return {
    client,
    fetchMock,
    router,
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Gmail 账号详情与编辑三栏页面', () => {
  it('导出全部 8 个拆分模块组件并渲染三栏结构、导航状态、示例账号与概览时间线', () => {
    expect(AccountMasterDetailLayout).toBeTypeOf('function');
    expect(AccountListPane).toBeTypeOf('function');
    expect(AccountHeaderCard).toBeTypeOf('function');
    expect(AccountTabs).toBeTypeOf('function');
    expect(AccountBasicInfoForm).toBeTypeOf('function');
    expect(AccountOverviewCard).toBeTypeOf('function');
    expect(ActivityTimeline).toBeTypeOf('function');
    expect(DisplaySettingsPopover).toBeTypeOf('function');

    renderPreviewRouter();

    // 账号列表搜索框 + ⌘K 快捷键（弹窗开启时不抢焦点，关闭后聚焦搜索框）
    const searchInput =
      screen.getByPlaceholderText('搜索账号或备注（⌘K）');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(document.activeElement).not.toBe(searchInput);
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(document.activeElement).toBe(searchInput);

    // 左侧主导航 9 项入口 + 回收站徽标 3 + 底部系统运行状态
    const sidebar = screen.getByLabelText('侧边导航栏');
    for (const label of [
      '数据概览',
      'Gmail 账号',
      '标签管理',
      '导入 / 导出（CSV）',
      '归档账号',
      '回收站',
      '审计日志',
      '备份与恢复',
      '系统设置',
    ]) {
      expect(within(sidebar).getByText(label)).toBeInTheDocument();
    }
    expect(within(sidebar).getByLabelText('回收站 3 项')).toHaveTextContent(
      '3',
    );
    const statusCard = within(sidebar).getByLabelText('系统运行状态');
    expect(within(statusCard).getByText('系统运行正常')).toBeInTheDocument();
    expect(
      within(statusCard).getByText('会话与 CSRF 防护'),
    ).toBeInTheDocument();
    expect(
      within(statusCard).getByText('字段加密 AES-256-GCM'),
    ).toBeInTheDocument();
    expect(
      within(statusCard).getByText('TOTP 双因素认证已启用'),
    ).toBeInTheDocument();
    expect(
      within(statusCard).getByText(/最近备份：2026-01-15 02:30/),
    ).toBeInTheDocument();

    // 中间账号列表：Gmail 账号（1,248）与 6 条示例账号
    const listPane = screen.getByLabelText('账号列表面板');
    expect(within(listPane).getByText('（1,248）')).toBeInTheDocument();
    for (const email of [
      'example.account@gmail.com',
      'dev.tools@gmail.com',
      'marketing.data@gmail.com',
      'test.service@gmail.com',
      'archive.old@gmail.com',
      'personal.backup@gmail.com',
    ]) {
      expect(within(listPane).getByText(email)).toBeInTheDocument();
    }

    // 账号详情头部、标签页、表单字数、右侧概览与时间线
    expect(
      screen.getByRole('heading', { name: 'example.account@gmail.com' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('开发环境').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('工具账号').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('长期保留').length).toBeGreaterThanOrEqual(1);

    const tablist = screen.getByRole('tablist', { name: '账号详情分区' });
    expect(
      within(tablist).getByRole('tab', { name: '基本信息', selected: true }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole('tab', { name: '安全凭据' }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole('tab', { name: '关联账号与联系方式' }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole('tab', { name: '审计与活动' }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole('tab', { name: '备份版本' }),
    ).toBeInTheDocument();

    expect(screen.getByText('29 / 20000')).toBeInTheDocument();
    expect(screen.getByText('已启用（TOTP）')).toBeInTheDocument();
    expect(screen.getByLabelText('手机号')).toHaveTextContent(
      '+86 139 **** 6728',
    );
    expect(screen.getByLabelText('登录密码')).toHaveTextContent(
      '••••••••••••••••',
    );

    const overview = screen.getByLabelText('账号概览');
    expect(within(overview).getByText('acc_2f9e7c1a4b6d')).toBeInTheDocument();
    expect(within(overview).getByText('v12')).toBeInTheDocument();

    const timeline = screen.getByLabelText('活动时间线');
    expect(within(timeline).getByText(/更新账号信息/)).toBeInTheDocument();
    expect(within(timeline).getByText(/查看凭据/)).toBeInTheDocument();
    expect(within(timeline).getByText(/启用二步验证/)).toBeInTheDocument();
    expect(within(timeline).getByText('创建账号')).toBeInTheDocument();
  });

  it('DisplaySettingsPopover 默认打开并显示 72% 透明度，共享 gm_nav_alpha、支持开关、点击外部和 Escape 关闭', async () => {
    const user = userEvent.setup();
    const { container } = renderPreviewRouter();

    const popover = screen.getByRole('dialog', { name: '界面与显示' });
    const slider = within(popover).getByRole('slider', {
      name: '导航栏毛玻璃透明度',
    });
    expect(slider).toHaveValue('72');
    expect(within(popover).getByText('72%')).toBeInTheDocument();

    const shell = container.querySelector(
      '[data-slot="app-window-shell"]',
    ) as HTMLElement;
    expect(shell.style.getPropertyValue('--nav-alpha')).toBe('0.72');

    // 拖动滑块并同步至共享 localStorage key
    fireEvent.change(slider, { target: { value: '80' } });
    expect(shell.style.getPropertyValue('--nav-alpha')).toBe('0.8');
    expect(window.localStorage.getItem(NAV_ALPHA_STORAGE_KEY)).toBe('80');

    // macOS 风格 switch 切换流动背景 / 动画 / 紧凑模式
    const bgSwitch = within(popover).getByRole('switch', {
      name: '使用流动背景',
    });
    const animSwitch = within(popover).getByRole('switch', {
      name: '界面动画效果',
    });
    const compactSwitch = within(popover).getByRole('switch', {
      name: '紧凑模式',
    });
    expect(bgSwitch).toHaveAttribute('aria-checked', 'true');
    expect(animSwitch).toHaveAttribute('aria-checked', 'true');
    expect(compactSwitch).toHaveAttribute('aria-checked', 'false');

    await user.click(bgSwitch);
    await user.click(compactSwitch);
    expect(bgSwitch).toHaveAttribute('aria-checked', 'false');
    expect(compactSwitch).toHaveAttribute('aria-checked', 'true');
    expect(
      container.querySelector('[data-flowing-bg="false"]'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-compact="true"]'),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY)).toContain(
      '"compactMode":true',
    );

    // Escape 关闭浮层
    await user.keyboard('{Escape}');
    expect(
      screen.queryByRole('dialog', { name: '界面与显示' }),
    ).not.toBeInTheDocument();

    // 重新打开后点击外部关闭
    await user.click(screen.getByRole('button', { name: '界面与显示设置' }));
    expect(
      screen.getByRole('dialog', { name: '界面与显示' }),
    ).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByLabelText('账号概览'));
    expect(
      screen.queryByRole('dialog', { name: '界面与显示' }),
    ).not.toBeInTheDocument();
  });

  it('与账号列表页共享同一个 localStorage 透明度设置', () => {
    persistNavAlpha(54);
    const { container } = renderPreviewRouter();
    const shell = container.querySelector(
      '[data-slot="app-window-shell"]',
    ) as HTMLElement;
    expect(shell.style.getPropertyValue('--nav-alpha')).toBe('0.54');
    expect(screen.getByText('54%')).toBeInTheDocument();
  });

  it('支持编辑模式、禁止提交掩码密码、未保存切换账号确认、保存更新版本号与活动时间线，以及 Escape 退出编辑', async () => {
    const user = userEvent.setup();
    renderPreviewRouter();

    // 先关闭初始设置浮层
    await user.keyboard('{Escape}');

    // 默认可读，点击编辑切换为编辑模式
    await user.click(screen.getByRole('button', { name: '编辑' }));
    const passwordInput = screen.getByLabelText('登录密码');
    expect(passwordInput).toHaveValue('');

    // Escape 在未修改时直接退出编辑
    await user.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();

    // 再次进入编辑，测试禁止将密码掩码作为真实密码提交
    await user.click(screen.getByRole('button', { name: '编辑' }));
    await user.type(screen.getByLabelText('登录密码'), '••••••••');
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /不允许将密码掩码占位文本作为真实密码提交/,
    );
    await user.clear(screen.getByLabelText('登录密码'));

    // 修改用途后尝试切换中间列表账号 -> 弹出未保存确认
    const purposeInput = screen.getByLabelText('用途');
    await user.clear(purposeInput);
    await user.type(purposeInput, '核心研发与测试环境');

    const listPane = screen.getByLabelText('账号列表面板');
    await user.click(within(listPane).getByText('dev.tools@gmail.com'));
    const guardDialog = await screen.findByRole('alertdialog');
    expect(
      within(guardDialog).getByText('放弃未保存的修改？'),
    ).toBeInTheDocument();

    // 选择继续编辑，停留在当前账号
    await user.click(
      within(guardDialog).getByRole('button', { name: '继续编辑' }),
    );
    expect(
      screen.getByRole('heading', { name: 'example.account@gmail.com' }),
    ).toBeInTheDocument();

    // 保存修改 -> 版本号更新为 v13 且时间线新增记录
    await user.click(screen.getByRole('button', { name: '保存修改' }));
    const overview = screen.getByLabelText('账号概览');
    expect(within(overview).getByText('v13')).toBeInTheDocument();
    expect(
      screen.getByText('已保存修改，当前版本更新为 v13'),
    ).toBeInTheDocument();
    const timeline = screen.getByLabelText('活动时间线');
    expect(
      within(timeline).getByText('更新账号信息（用途）'),
    ).toBeInTheDocument();

    // 此时无未保存改动，点击列表项直接切换到 dev.tools@gmail.com
    await user.click(within(listPane).getByText('dev.tools@gmail.com'));
    expect(
      screen.getByRole('heading', { name: 'dev.tools@gmail.com' }),
    ).toBeInTheDocument();
  });

  it('支持手机号显示与复制、邮箱/ID 复制轻量 toast、归档二次确认与更多菜单（删除/恢复/查看完整审计）', async () => {
    const user = userEvent.setup();
    let clipboardText = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn(async (text: string) => {
          clipboardText = text;
        }),
        readText: vi.fn(async () => clipboardText),
      },
    });

    renderPreviewRouter();
    await user.keyboard('{Escape}');

    // 手机号显示与复制
    await user.click(screen.getByRole('button', { name: '显示手机号' }));
    expect(screen.getByLabelText('手机号')).toHaveTextContent(
      '+86 139 8420 6728',
    );
    await user.click(screen.getByRole('button', { name: '复制手机号' }));
    expect(clipboardText).toBe('+86 139 8420 6728');
    expect(screen.getByText('已复制手机号')).toBeInTheDocument();

    // 复制记录 ID
    await user.click(screen.getByRole('button', { name: '复制记录 ID' }));
    expect(clipboardText).toBe('acc_2f9e7c1a4b6d');
    expect(screen.getByText('已复制记录 ID')).toBeInTheDocument();

    // 归档需确认
    await user.click(screen.getByRole('button', { name: '归档' }));
    const archiveDialog = await screen.findByRole('alertdialog');
    await user.click(
      within(archiveDialog).getByRole('button', { name: '确认归档' }),
    );
    expect(
      within(screen.getByLabelText('账号概览')).getByText('v13'),
    ).toBeInTheDocument();

    // 更多菜单：查看完整审计 -> 切换到审计与活动标签页
    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(
      await screen.findByRole('menuitem', { name: '查看完整审计' }),
    );
    expect(
      screen.getByRole('tab', { name: '审计与活动', selected: true }),
    ).toBeInTheDocument();

    // 更多菜单：取消归档（归档后专用取消归档动作）与删除确认
    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(
      await screen.findByRole('menuitem', { name: '取消归档' }),
    );
    const unarchiveDialog = await screen.findByRole('alertdialog');
    await user.click(
      within(unarchiveDialog).getByRole('button', { name: '确认取消归档' }),
    );

    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(await screen.findByRole('menuitem', { name: '删除' }));
    const deleteDialog = await screen.findByRole('alertdialog');
    expect(within(deleteDialog).getByText(/确认删除账号/)).toBeInTheDocument();
    await user.click(
      within(deleteDialog).getByRole('button', { name: '取消' }),
    );
  });

  it('真实 API 模式下：保存不提交空密码、支持版本冲突提示与重新加载，密码显示不写入全局缓存并自动清除', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const record = makeLiveAccount();
    let patchPayloads: Record<string, unknown>[] = [];
    let conflictOnce = true;

    const { client } = renderLiveDetail(record, {
      onPatch: async (req) => {
        const body = (await req.json()) as Record<string, unknown>;
        patchPayloads.push(body);
        if (conflictOnce) {
          conflictOnce = false;
          return json(
            {
              error: {
                code: 'ROW_VERSION_CONFLICT',
                message: '版本冲突',
                details: {},
              },
              request_id: crypto.randomUUID(),
            },
            409,
          );
        }
        return json({
          ...record,
          ...body,
          row_version: record.row_version + 1,
        });
      },
    });

    await screen.findByRole('heading', { name: record.gmail_email });

    // 显示密码 -> 明文不进入 Query / Mutation 缓存，20 秒后自动清除
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
    });
    await waitFor(() =>
      expect(screen.getByLabelText('登录密码')).toHaveTextContent(
        'Live#Secret2026!Value',
      ),
    );
    expect(
      JSON.stringify(client.getQueryCache().getAll()) +
        JSON.stringify(
          client
            .getMutationCache()
            .getAll()
            .map((m) => m.state),
        ),
    ).not.toContain('Live#Secret2026!Value');
    expect(window.localStorage.getItem('password')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(20001);
    });
    expect(screen.getByLabelText('登录密码')).toHaveTextContent(
      '••••••••••••••••',
    );

    vi.useRealTimers();
    const user = userEvent.setup();

    // 编辑提交 -> 省略空密码 -> 命中 409 版本冲突 -> 禁用保存 -> 点击重新加载最新版本后恢复保存
    await user.click(screen.getByRole('button', { name: '编辑' }));
    const purposeInput = screen.getByLabelText('用途');
    await user.clear(purposeInput);
    await user.type(purposeInput, '更新后的用途');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/版本冲突/);
    expect(screen.getByRole('button', { name: '保存修改' })).toBeDisabled();
    expect(patchPayloads).toHaveLength(1);
    expect(patchPayloads[0]).not.toHaveProperty('password');
    expect(patchPayloads[0]).toMatchObject({
      row_version: 12,
      purpose: '更新后的用途',
    });

    await user.click(screen.getByRole('button', { name: '重新加载最新版本' }));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: '保存修改' }),
      ).not.toBeDisabled(),
    );
  });

  it('真实 API 模式下：编辑关联辅助邮箱账号时保持 XOR 约束，不同时提交 recovery_account_id 和 recovery_email_external', async () => {
    const user = userEvent.setup();
    const linked = makeLiveAccount({
      recovery_account_id: 'acc-recovery-target-001',
      recovery_email_external: null,
      recovery_email: 'linked.target@gmail.com',
    });
    const patchPayloads: Record<string, unknown>[] = [];

    renderLiveDetail(linked, {
      onPatch: async (req) => {
        const body = (await req.json()) as Record<string, unknown>;
        patchPayloads.push(body);
        if (body.recovery_account_id && body.recovery_email_external) {
          return json(
            {
              error: {
                code: 'RECOVERY_INVALID',
                message: '辅助邮箱必须且只能填写一种',
                details: {},
              },
              request_id: crypto.randomUUID(),
            },
            422,
          );
        }
        return json({
          ...linked,
          ...body,
          row_version: linked.row_version + 1,
        });
      },
    });

    await screen.findByRole('heading', { name: linked.gmail_email });
    await user.click(screen.getByRole('button', { name: '编辑' }));
    const purposeInput = screen.getByLabelText('用途');
    await user.clear(purposeInput);
    await user.type(purposeInput, '保留关联辅助邮箱的修改');
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => expect(patchPayloads).toHaveLength(1));
    expect(patchPayloads[0]).toMatchObject({
      recovery_account_id: 'acc-recovery-target-001',
      recovery_email_external: null,
      purpose: '保留关联辅助邮箱的修改',
    });
  });

  it('真实 API 模式下：备注支持超过 500 字（对齐后端 20,000 字符上限）而不被截断', async () => {
    const user = userEvent.setup();
    const longNotes = '长备注测试内容'.repeat(90); // 630 chars > 500
    const account = makeLiveAccount({ notes: '初始备注' });
    const patchPayloads: Record<string, unknown>[] = [];

    renderLiveDetail(account, {
      onPatch: async (req) => {
        const body = (await req.json()) as Record<string, unknown>;
        patchPayloads.push(body);
        return json({
          ...account,
          ...body,
          row_version: account.row_version + 1,
        });
      },
    });

    await screen.findByRole('heading', { name: account.gmail_email });
    await user.click(screen.getByRole('button', { name: '编辑' }));
    const notesBox = screen.getByLabelText('备注');
    fireEvent.change(notesBox, { target: { value: longNotes } });
    expect(screen.getByText(`${longNotes.length} / 20000`)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() => expect(patchPayloads).toHaveLength(1));
    expect(patchPayloads[0].notes).toBe(longNotes);
  });

  it('真实 API 模式下：已归档账号调用专用 /unarchive 动作而非 /restore，且切换账号时联系方式页重置手机号脱敏状态', async () => {
    const user = userEvent.setup();
    const archived = makeLiveAccount({
      status: 'archived',
      archived_at: '2026-01-12T08:00:00Z',
    });
    const unarchiveCalls: string[] = [];
    const restoreCalls: string[] = [];

    const { fetchMock } = renderLiveDetail(archived);
    const origImpl = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (req: Request) => {
      const url = new URL(req.url);
      if (req.method === 'POST' && url.pathname.endsWith('/unarchive')) {
        unarchiveCalls.push(url.pathname);
        return json({
          ...archived,
          status: 'normal',
          archived_at: null,
          row_version: archived.row_version + 1,
        });
      }
      if (req.method === 'POST' && url.pathname.endsWith('/restore')) {
        restoreCalls.push(url.pathname);
        return json(archived);
      }
      return origImpl(req);
    });

    await screen.findByRole('heading', { name: archived.gmail_email });

    // 1. 切到「关联账号与联系方式」展开手机号，再切换到另一账号，手机号必须恢复掩码
    await user.click(screen.getByRole('tab', { name: '关联账号与联系方式' }));
    await user.click(screen.getByRole('button', { name: '显示手机号' }));
    expect(screen.getByText('+86 139 8420 6728')).toBeInTheDocument();

    const listPane = screen.getByLabelText('账号列表面板');
    await user.click(within(listPane).getByText('dev.tools@gmail.com'));
    await screen.findByRole('heading', { name: 'dev.tools@gmail.com' });
    expect(screen.queryByText('+86 139 8420 6728')).not.toBeInTheDocument();

    // 切回已归档账号并执行「取消归档」
    await user.click(within(listPane).getByText(archived.gmail_email));
    await screen.findByRole('heading', { name: archived.gmail_email });
    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(
      await screen.findByRole('menuitem', { name: '取消归档' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: '确认取消归档' }),
    );

    await waitFor(() => expect(unarchiveCalls).toHaveLength(1));
    expect(unarchiveCalls[0]).toBe(`/api/v1/accounts/${archived.id}/unarchive`);
    expect(restoreCalls).toHaveLength(0);
  });
});
