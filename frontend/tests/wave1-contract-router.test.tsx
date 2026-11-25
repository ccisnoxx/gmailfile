import {
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
import { buildRoutes } from '@/app/router';
import {
  buildAccountDetail,
  createStatefulApiServer,
} from './fixtures/api-contract';

function renderProductionRouter(initialEntries: string[]) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
  const memoryRouter = createMemoryRouter(buildRoutes(false), {
    initialEntries,
  });
  const rendered = render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={memoryRouter} />
    </QueryClientProvider>,
  );
  return { queryClient, memoryRouter, ...rendered };
}

function serializedQueryCache(client: QueryClient): string {
  return JSON.stringify(
    client
      .getQueryCache()
      .getAll()
      .map((q) => ({ key: q.queryKey, data: q.state.data })),
  );
}

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Wave 1 真实路由与 OpenAPI 有状态 CSRF 契约集成测试', () => {
  it('生产路由 buildRoutes(false) 阻断全部 8 条 /preview/* 演示路由且未登录态隔离受保护工作区', async () => {
    const previewPaths = [
      '/preview/accounts',
      '/preview/accounts/acc-1',
      '/preview/account-detail',
      '/preview/settings',
      '/preview/settings/security',
      '/preview/settings/audit',
      '/preview/transfers/csv',
      '/preview/imports/csv',
    ];

    for (const previewPath of previewPaths) {
      const { unmount } = renderProductionRouter([previewPath]);
      expect(
        await screen.findByRole('heading', { name: '页面不存在' }),
      ).toBeInTheDocument();
      unmount();
    }

    const anonServer = createStatefulApiServer({ sessionState: 'anonymous' });
    vi.stubGlobal('fetch', vi.fn(anonServer.fetchMock));

    for (const protectedPath of [
      '/accounts/acc-contract-01',
      '/settings/security',
      '/transfers/csv',
    ]) {
      const { unmount } = renderProductionRouter([protectedPath]);
      expect(
        await screen.findByRole('heading', { name: '管理员登录' }),
      ).toBeInTheDocument();
      expect(
        anonServer.requests.every((r) => r.pathname === '/api/v1/auth/session'),
      ).toBe(true);
      unmount();
    }
  });

  it('真实路由 /accounts/:accountId：库内关联恢复邮箱编辑保持 XOR、支持 >500 字备注，并调用 mark-logged-in', async () => {
    const user = userEvent.setup();
    const recoveryTarget = buildAccountDetail({
      id: 'acc-recovery-00',
      account_no: 'GM-000100',
      gmail_email: 'vault.recovery@gmail.com',
      recovery_account_id: null,
      recovery_email_external: 'root.backup@example.test',
      recovery_email: 'root.backup@example.test',
    });
    const linkedAccount = buildAccountDetail({
      id: 'acc-linked-01',
      account_no: 'GM-000101',
      gmail_email: 'linked.primary@gmail.com',
      recovery_account_id: recoveryTarget.id,
      recovery_email_external: null,
      recovery_email: recoveryTarget.gmail_email,
      row_version: 5,
    });
    const server = createStatefulApiServer({
      accounts: [recoveryTarget, linkedAccount],
    });
    vi.stubGlobal('fetch', vi.fn(server.fetchMock));

    renderProductionRouter(['/accounts/acc-linked-01']);
    await screen.findByRole('heading', { name: 'linked.primary@gmail.com' });

    // 进入编辑态并保存超过 500 字的备注：必须保持库内恢复邮箱 XOR（绝不附带 recovery_email_external）
    await user.click(screen.getByRole('button', { name: '编辑' }));
    const notesBox = await screen.findByLabelText('备注');
    const longNote = 'W1契约长备注-'.repeat(80); // 640 字符 (> 500, <= 20000)
    fireEvent.change(notesBox, { target: { value: longNote } });
    await user.click(screen.getByRole('button', { name: '保存修改' }));

    await waitFor(() =>
      expect(
        server.requests.some(
          (r) =>
            r.method === 'PATCH' &&
            r.pathname === '/api/v1/accounts/acc-linked-01' &&
            r.status === 200,
        ),
      ).toBe(true),
    );
    const patchReq = server.requests.find(
      (r) =>
        r.method === 'PATCH' && r.pathname === '/api/v1/accounts/acc-linked-01',
    )!;
    const patchBody = JSON.parse(patchReq.bodyText) as Record<string, unknown>;
    expect(patchBody.row_version).toBe(5);
    expect(patchBody.notes).toBe(longNote);
    expect(patchBody.recovery_account_id).toBe('acc-recovery-00');
    expect(patchBody.recovery_email_external).toBeNull();
    expect(server.getAccount('acc-linked-01')?.row_version).toBe(6);

    // 打开“更多”菜单点击“标记今天已登录”：必须调用 /mark-logged-in 并携带更新后的 row_version=6 与最新 CSRF
    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(
      await screen.findByRole('menuitem', { name: '标记今天已登录' }),
    );
    await waitFor(() =>
      expect(
        server.requests.some(
          (r) =>
            r.method === 'POST' &&
            r.pathname === '/api/v1/accounts/acc-linked-01/mark-logged-in' &&
            r.status === 200,
        ),
      ).toBe(true),
    );
    const markLoggedInReq = server.requests.find(
      (r) => r.pathname === '/api/v1/accounts/acc-linked-01/mark-logged-in',
    )!;
    expect(JSON.parse(markLoggedInReq.bodyText)).toEqual({ row_version: 6 });
    expect(markLoggedInReq.csrfHeader).toBe(server.getCurrentCsrf());
    expect(
      server.requests.some((r) => r.pathname.endsWith('/mark-verified')),
    ).toBe(false);
  });

  it('真实路由 /settings/security：严格有状态 CSRF 连续轮换、零 TOTP 重放且敏感凭据零落盘', async () => {
    const user = userEvent.setup();
    const adminPassword = 'Wave1AdminPass#2026';
    const totpStepUp = '111222';
    const totpRegen = '654321';
    const server = createStatefulApiServer({
      adminPassword,
      stepUpTotpRequired: true,
      trashCount: 9,
      idleMinutes: 15,
    });
    vi.stubGlobal('fetch', vi.fn(server.fetchMock));

    const { queryClient } = renderProductionRouter(['/settings/security']);
    expect(await screen.findByText('备份正常')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '立即备份' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '恢复验证…' })).toBeDisabled();
    expect(
      await within(
        screen.getByRole('navigation', { name: '系统主导航' }),
      ).findByLabelText('回收站 9 项'),
    ).toHaveTextContent('9');

    // 1. Step-Up 开启且未重新验证时直接尝试重新生成恢复码：客户端防重放守卫立即拦截，不消耗 TOTP 也不发写请求
    await user.click(screen.getByRole('button', { name: '查看 / 重新生成…' }));
    const blockedDialog = await screen.findByRole('dialog');
    await user.type(
      within(blockedDialog).getByLabelText('当前管理员密码'),
      adminPassword,
    );
    await user.type(
      within(blockedDialog).getByLabelText(/TOTP 验证码/),
      totpRegen,
    );
    await user.click(
      within(blockedDialog).getByRole('button', { name: '验证并重新生成' }),
    );
    expect(
      await within(blockedDialog).findByText(/请先完成重新验证并待验证码刷新/),
    ).toBeInTheDocument();
    expect(
      server.requests.some((r) => r.pathname === '/api/v1/auth/reverify'),
    ).toBe(false);
    expect(
      server.requests.some(
        (r) => r.pathname === '/api/v1/auth/totp/regenerate-recovery-codes',
      ),
    ).toBe(false);
    await user.keyboard('{Escape}');

    // 2. 通过“调整策略…”完成 Step-Up reverify（消耗 TOTP #1，轮换 CSRF 0001 -> 0002）并立即保存 idle_minutes=30
    await user.click(screen.getByRole('button', { name: '调整策略…' }));
    const policySheet1 = await screen.findByRole('dialog', {
      name: '调整保留与生命周期策略',
    });
    fireEvent.change(within(policySheet1).getByLabelText(/会话空闲自动锁定/), {
      target: { value: '30' },
    });
    await user.type(
      within(policySheet1).getByLabelText('当前管理员密码'),
      adminPassword,
    );
    await user.type(
      within(policySheet1).getByLabelText(/TOTP 验证码/),
      totpStepUp,
    );
    await user.click(
      within(policySheet1).getByRole('button', { name: '保存策略' }),
    );

    await waitFor(() => expect(server.getIdleMinutes()).toBe(30));
    const reverifyReq = server.requests.find(
      (r) => r.pathname === '/api/v1/auth/reverify',
    )!;
    const idleReq1 = server.requests.find(
      (r) => r.method === 'PATCH' && r.pathname === '/api/v1/settings/idle',
    )!;
    expect(reverifyReq.status).toBe(200);
    expect(reverifyReq.csrfHeader).toBe('csrf-stateful-0001');
    expect(idleReq1.status).toBe(200);
    expect(idleReq1.csrfHeader).toBe('csrf-stateful-0002');

    // 3. 在有效 Step-Up 窗口内重新生成恢复码：使用新 TOTP #2 与 CSRF 0002 -> 轮换至 CSRF 0003
    await user.click(screen.getByRole('button', { name: '查看 / 重新生成…' }));
    const regenDialog = await screen.findByRole('dialog');
    await user.type(
      within(regenDialog).getByLabelText('当前管理员密码'),
      adminPassword,
    );
    await user.type(
      within(regenDialog).getByLabelText(/TOTP 验证码/),
      totpRegen,
    );
    await user.click(
      within(regenDialog).getByRole('button', { name: '验证并重新生成' }),
    );

    await screen.findByText('REC1-WAVE1-AAAA');
    const regenReq = server.requests.find(
      (r) => r.pathname === '/api/v1/auth/totp/regenerate-recovery-codes',
    )!;
    expect(regenReq.status).toBe(200);
    expect(regenReq.csrfHeader).toBe('csrf-stateful-0002');
    expect(JSON.parse(regenReq.bodyText)).toEqual({
      password: adminPassword,
      totp_code: totpRegen,
    });
    expect(server.getCurrentCsrf()).toBe('csrf-stateful-0003');

    await user.click(
      screen.getByRole('checkbox', {
        name: /我已将上述 .* 个恢复码离线保存/,
      }),
    );
    await user.click(screen.getByRole('button', { name: '完成并清除展示' }));

    // 4. 后续写操作（再次修改 idle_minutes=45，免重复验证）必须携带最新轮换后的 csrf-stateful-0003
    await user.click(screen.getByRole('button', { name: '调整策略…' }));
    const policySheet2 = await screen.findByRole('dialog', {
      name: '调整保留与生命周期策略',
    });
    fireEvent.change(within(policySheet2).getByLabelText(/会话空闲自动锁定/), {
      target: { value: '45' },
    });
    await user.click(
      within(policySheet2).getByRole('button', { name: '保存策略' }),
    );

    await waitFor(() => expect(server.getIdleMinutes()).toBe(45));
    const idleReqs = server.requests.filter(
      (r) => r.method === 'PATCH' && r.pathname === '/api/v1/settings/idle',
    );
    expect(idleReqs).toHaveLength(2);
    expect(idleReqs[1].status).toBe(200);
    expect(idleReqs[1].csrfHeader).toBe('csrf-stateful-0003');
    expect(server.requests.every((r) => r.status !== 403)).toBe(true);

    // 5. 敏感凭据零落盘断言：localStorage / sessionStorage / TanStack Query 缓存均不得残留密码、TOTP 与恢复码
    const cacheDump = serializedQueryCache(queryClient);
    const storageDump = JSON.stringify({
      local: { ...window.localStorage },
      session: { ...window.sessionStorage },
    });
    for (const secret of [
      adminPassword,
      totpStepUp,
      totpRegen,
      'REC1-WAVE1-AAAA',
    ]) {
      expect(cacheDump).not.toContain(secret);
      expect(storageDump).not.toContain(secret);
    }
  });

  it('真实路由 /transfers/csv：严格契约完成 preview -> 单次 receipt commit，且导入密码不落盘、不回显', async () => {
    const user = userEvent.setup();
    const csvSecret = 'CsvSynthSecret!Wave1#99';
    const server = createStatefulApiServer();
    vi.stubGlobal('fetch', vi.fn(server.fetchMock));

    const { queryClient } = renderProductionRouter(['/transfers/csv']);
    const fileInput = (await screen.findByLabelText(
      '选择 CSV 文件',
    )) as HTMLInputElement;

    const csvContent = [
      'gmail,password,recovery_email,phone,status,totp_enabled',
      `wave1.csv.one@gmail.com,${csvSecret},bak.one@example.test,+86 13800001111,normal,true`,
    ].join('\r\n');
    await user.upload(
      fileInput,
      new File([csvContent], 'wave1_import.csv', { type: 'text/csv' }),
    );

    await screen.findByText('wave1_import.csv');
    await waitFor(() =>
      expect(
        server.requests.some(
          (r) =>
            r.pathname === '/api/v1/imports/csv/preview' && r.status === 200,
        ),
      ).toBe(true),
    );

    await user.click(
      screen.getByLabelText(
        '我已确认数据无误，并知悉该操作将以事务方式原子提交',
      ),
    );
    const startBtn = screen.getByRole('button', { name: '开始导入' });
    expect(startBtn).toBeEnabled();
    await user.click(startBtn);

    await waitFor(() =>
      expect(
        server.requests.some(
          (r) =>
            r.pathname === '/api/v1/imports/csv/commit' &&
            r.search.includes('receipt_id=rcpt-') &&
            r.status === 200,
        ),
      ).toBe(true),
    );
    await screen.findByText('CSV 原子导入成功');

    // 确认导入明文密码绝不渲染在 DOM、不进入存储、不进入 Query 缓存
    expect(document.body.textContent ?? '').not.toContain(csvSecret);
    expect(serializedQueryCache(queryClient)).not.toContain(csvSecret);
    expect(JSON.stringify({ ...window.localStorage })).not.toContain(csvSecret);
    expect(JSON.stringify({ ...window.sessionStorage })).not.toContain(
      csvSecret,
    );
  });
});
