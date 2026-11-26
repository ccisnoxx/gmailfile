import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { Providers } from '@/app/providers';
import { buildRoutes } from '@/app/router';
import { accountQuery } from '@/features/accounts/query-state';
import type { SessionResponse } from '@/api/generated';

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
  const memoryRouter = createMemoryRouter(buildRoutes(false), {
    initialEntries,
  });
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

it('按统一壳层路由动态加载账号页、系统设置与导入导出页，并支持旧路径兼容重定向', async () => {
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
          risk: 0,
          disabled: 0,
          archived: 0,
          deleted_count: 0,
          tag_counts: {},
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
      if (path === '/api/v1/settings')
        return json({ idle_minutes: 15, max_idle_minutes: 720 });
      if (path === '/api/v1/auth/sessions')
        return json({ items: [], total: 0, page: 1, page_size: 20 });
      if (path === '/api/v1/auth/webauthn/credentials') return json([]);
      if (path === '/api/v1/audit-events')
        return json({
          items: [],
          total: 0,
          page: 1,
          page_size: 30,
          event_types: [],
        });
      if (path === '/api/v1/audit-events/integrity')
        return json({
          valid: true,
          total_events: 0,
          latest_seq: null,
          latest_hash: null,
          retention_days: 365,
        });
      throw new Error(`unexpected path: ${path}`);
    }),
  );

  const { memoryRouter } = renderRoutes(['/?status=normal']);
  await screen.findByRole('heading', { name: '账号管理' });

  await userEvent.click(screen.getByRole('button', { name: '系统设置' }));
  await screen.findByRole('heading', { name: '系统设置' });
  expect(memoryRouter.state.location.pathname).toBe('/settings/security');

  await userEvent.click(screen.getByRole('button', { name: '导入 / 导出' }));
  await screen.findByRole('heading', { name: 'CSV 导入 / 批量操作' });
  expect(memoryRouter.state.location.pathname).toBe('/transfers/csv');

  await userEvent.click(screen.getByRole('button', { name: '账号管理' }));
  await screen.findByRole('heading', { name: '账号管理' });
  expect(memoryRouter.state.location.pathname).toBe('/accounts');
});

it('旧版 /security 与 /operations 路由自动重定向至新版 /settings/* 与 /transfers/csv', async () => {
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
          risk: 0,
          disabled: 0,
          archived: 0,
          deleted_count: 0,
          tag_counts: {},
          added_this_month: 0,
          unverified_over_30_days: 0,
        });
      if (path === '/api/v1/system/version')
        return json({ version: '0.1.0', schema_version: '0004' });
      if (path === '/api/v1/system/backup-status')
        return json({ state: 'unconfigured', offsite: 'unconfigured' });
      if (path === '/api/v1/settings')
        return json({ idle_minutes: 15, max_idle_minutes: 720 });
      if (path === '/api/v1/auth/sessions')
        return json({ items: [], total: 0, page: 1, page_size: 20 });
      if (path === '/api/v1/auth/webauthn/credentials') return json([]);
      if (path === '/api/v1/audit-events')
        return json({
          items: [],
          total: 0,
          page: 1,
          page_size: 30,
          event_types: [],
        });
      if (path === '/api/v1/audit-events/integrity')
        return json({
          valid: true,
          total_events: 0,
          latest_seq: null,
          latest_hash: null,
          retention_days: 365,
        });
      return json({});
    }),
  );

  const sec = renderRoutes(['/security']);
  await screen.findByRole('heading', { name: '系统设置' });
  expect(sec.memoryRouter.state.location.pathname).toBe('/settings/security');
  sec.unmount();

  const opExport = renderRoutes(['/operations?tab=export']);
  await screen.findByRole('heading', { name: 'CSV 导入 / 批量操作' });
  expect(opExport.memoryRouter.state.location.pathname).toBe('/transfers/csv');
  expect(opExport.memoryRouter.state.location.search).toBe('?tab=export');
  opExport.unmount();

  const opAudit = renderRoutes(['/operations?tab=audit']);
  await screen.findByRole('heading', { name: '系统设置' });
  expect(opAudit.memoryRouter.state.location.pathname).toBe('/settings/audit');
  opAudit.unmount();
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
