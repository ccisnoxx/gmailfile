import { lazy } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { Providers } from '@/app/providers';
import { buildRoutes } from '@/app/router';
import { AuthPage } from '@/features/auth/auth-page';
import { accountQuery } from '@/features/accounts/query-state';
import type { SessionResponse } from '@/api/generated';

const AccountsRoute = lazy(() => import('@/app/routes/accounts-route'));
const SecurityRoute = lazy(() => import('@/app/routes/security-route'));
const OperationsRoute = lazy(() => import('@/app/routes/operations-route'));

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const makeSession = (
  state: SessionResponse['state'] = 'authenticated',
): SessionResponse => ({
  state,
  idle_timeout_seconds: 900,
  server_time: new Date().toISOString(),
  csrf_token: crypto.randomUUID(),
  expires_at: new Date(Date.now() + 43200000).toISOString(),
  idle_expires_at: new Date(Date.now() + 900000).toISOString(),
  reauthenticated_until: null,
});

function renderRoutes(initialEntries: string[]) {
  const memoryRouter = createMemoryRouter(
    [
      {
        path: '/',
        element: <AuthPage />,
        children: [
          { index: true, element: <AccountsRoute /> },
          { path: 'accounts', element: <AccountsRoute /> },
          { path: 'security', element: <SecurityRoute /> },
          { path: 'operations', element: <OperationsRoute /> },
        ],
      },
      {
        path: '*',
        element: (
          <main>
            <h1>页面不存在</h1>
            <Link to="/">返回登录页</Link>
          </main>
        ),
      },
    ],
    { initialEntries },
  );
  return {
    memoryRouter,
    ...render(
      <Providers>
        <RouterProvider router={memoryRouter} />
      </Providers>,
    ),
  };
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('按路由动态加载账号页、安全设置与运维页，并在路由切换时保留筛选查询串', async () => {
  window.history.replaceState(null, '', '/?status=normal');
  const auth = makeSession('authenticated');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname;
      if (path === '/api/v1/auth/session') return json(auth);
      if (path === '/api/v1/accounts')
        return json({ items: [], total: 0, page: 1, page_size: 30 });
      if (path === '/api/v1/tags') return json([]);
      if (path === '/api/v1/dashboard/summary')
        return json({
          total: 0,
          normal: 0,
          pending_verification: 0,
          abnormal: 0,
          added_this_month: 0,
          unverified_over_30_days: 0,
        });
      if (path === '/api/v1/system/version')
        return json({ version: '0.1.0', schema_version: '0004' });
      if (path === '/api/v1/system/backup-status')
        return json({
          state: 'unconfigured',
          offsite: 'unconfigured',
          last_attempt_at: null,
          last_success_at: null,
        });
      if (path === '/api/v1/settings') return json({ idle_minutes: 15 });
      throw new Error(`unexpected path: ${path}`);
    }),
  );

  const { memoryRouter } = renderRoutes(['/?status=normal']);
  await screen.findByRole('heading', { name: '账号管理' });

  await userEvent.click(screen.getByRole('button', { name: '系统设置' }));
  await screen.findByRole('heading', { name: '安全设置' });
  expect(memoryRouter.state.location.pathname).toBe('/security');
  expect(memoryRouter.state.location.search).toBe('?status=normal');

  await userEvent.click(screen.getByRole('button', { name: '迁移与运维' }));
  await screen.findByRole('heading', { name: '迁移与运维' });
  expect(memoryRouter.state.location.pathname).toBe('/operations');
  expect(memoryRouter.state.location.search).toBe('?status=normal');

  await userEvent.click(screen.getByRole('button', { name: '账号列表' }));
  await screen.findByRole('heading', { name: '账号管理' });
  expect(memoryRouter.state.location.pathname).toBe('/');
  expect(memoryRouter.state.location.search).toBe('?status=normal');
});

it('未登录访问运维路由仍留在登录界面，不渲染子工作区', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json(makeSession('anonymous'))),
  );
  renderRoutes(['/operations']);
  await screen.findByRole('heading', { name: '管理员登录' });
  expect(
    screen.queryByRole('heading', { name: '迁移与运维' }),
  ).not.toBeInTheDocument();
});

it('未知路径渲染 404 页面', async () => {
  renderRoutes(['/missing-page']);
  expect(
    await screen.findByRole('heading', { name: '页面不存在' }),
  ).toBeInTheDocument();
});

it('accountQuery 正确解析布尔、分页、排序与日期边界参数', () => {
  const params = new URLSearchParams(
    'search=alice&status=normal&archived=false&deleted=true&page=3&page_size=50&sort=registered_at',
  );
  expect(accountQuery(params)).toMatchObject({
    search: 'alice',
    status: 'normal',
    archived: false,
    deleted: true,
    page: 3,
    page_size: 50,
    sort: 'registered_at',
  });
});

it('生产构建路由表（includePreview=false）不注册任何 /preview/* 演示路由，访问时落入 404', async () => {
  const prodRoutes = buildRoutes(false);
  expect(prodRoutes.some((route) => route.path?.startsWith('/preview/'))).toBe(
    false,
  );

  const devRoutes = buildRoutes(true);
  expect(devRoutes.some((route) => route.path === '/preview/accounts')).toBe(
    true,
  );

  const memoryRouter = createMemoryRouter(prodRoutes, {
    initialEntries: ['/preview/settings'],
  });
  render(
    <Providers>
      <RouterProvider router={memoryRouter} />
    </Providers>,
  );
  expect(
    await screen.findByRole('heading', { name: '页面不存在' }),
  ).toBeInTheDocument();
});
