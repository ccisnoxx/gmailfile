import { useState as __useState } from 'react';

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { AccountsPage } from '@/features/accounts/accounts-page';
import { RecoverySelector } from '@/features/accounts/recovery-selector';
import { dateBoundary } from '@/features/accounts/query-state';
import { useIdleSession } from '@/features/auth/use-idle-session';
import type { AccountDetail, SessionResponse } from '@/api/generated';
const id = () => crypto.randomUUID();
const session = (): SessionResponse => ({
  state: 'authenticated',
  server_time: new Date().toISOString(),
  csrf_token: id(),
  expires_at: new Date(Date.now() + 43200000).toISOString(),
  idle_expires_at: new Date(Date.now() + 900000).toISOString(),
  idle_timeout_seconds: 900,
  reauthenticated_until: null,
});
const row = (n = 1): AccountDetail => ({
  id: id(),
  account_no: `GM-${String(n).padStart(6, '0')}`,
  gmail_email: `sample${n}@gmail.com`,
  registered_at: '2026-11-01T00:00:00Z',
  recovery_account_id: null,
  recovery_email_external: 'recovery@example.test',
  recovery_email: 'recovery@example.test',
  status: 'normal',
  two_factor_status: 'unknown',
  purpose: null,
  tags: [],
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
});
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
function mount(child: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    ...render(
      <QueryClientProvider client={client}>{child}</QueryClientProvider>,
    ),
    client,
  };
}
function page() {
  return mount(
    <AccountsPage
      session={session()}
      onSession={vi.fn()}
      onFailure={vi.fn()}
      onSecurity={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
}
function stub(
  rows: AccountDetail[],
  mutate?: (r: Request) => Promise<Response>,
) {
  const mock = vi.fn(async (req: Request) => {
    const url = new URL(req.url);
    if (req.method !== 'GET')
      return mutate
        ? mutate(req)
        : json({ updated_ids: rows.map((r) => r.id) });
    if (url.pathname.endsWith('/tags'))
      return json([
        { id: 'tag-one', name: '追加', created_at: new Date().toISOString() },
      ]);
    if (url.pathname.endsWith('/summary'))
      return json({
        total: 35,
        normal: 35,
        pending_verification: 0,
        abnormal: 0,
        added_this_month: 35,
        unverified_over_30_days: 0,
      });
    if (url.pathname === '/api/v1/recovery-emails')
      return json({
        items: [
          {
            email: 'shared@example.test',
            account_count: 35,
            normal_count: 35,
            abnormal_count: 0,
            latest_registered_at: '2026-11-01T00:00:00Z',
          },
        ],
        total: 1,
        page: 1,
        page_size: 30,
      });
    if (url.pathname === `/api/v1/accounts/${rows[0].id}`) return json(rows[0]);
    const p = Number(url.searchParams.get('page') || 1);
    return json({
      items: p === 1 ? rows : [],
      total: 35,
      page: p,
      page_size: 30,
    });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}
afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('URL恢复查询，条件变化回第一页，前进/后退恢复并清空选择', async () => {
  const r = row();
  const mock = stub([r]);
  window.history.replaceState(
    null,
    '',
    '/?search=sample&status=normal&page=2&sort=registered_at',
  );
  page();
  await screen.findByText('共 35 条 · 第 2 / 2 页');
  expect(
    mock.mock.calls.some(
      ([req]) => new URL(req.url).searchParams.get('page') === '2',
    ),
  ).toBe(true);
  await userEvent.selectOptions(
    screen.getByLabelText('筛选二步验证'),
    'enabled',
  );
  await screen.findByText('共 35 条 · 第 1 / 2 页');
  expect(location.search).toContain('search=sample');
  expect(location.search).not.toContain('page=2');
  await userEvent.click(screen.getByLabelText('选择当前页全部账号'));
  expect(screen.getByText('已选当前页 1 条（不跨页）')).toBeInTheDocument();
  await act(async () => {
    window.history.back();
  });
  await waitFor(() => expect(location.search).toContain('page=2'));
  await screen.findByText('共 35 条 · 第 2 / 2 页');
  expect(screen.getByText('已选当前页 0 条（不跨页）')).toBeInTheDocument();
  await act(async () => {
    window.history.forward();
  });
  await screen.findByText('共 35 条 · 第 1 / 2 页');
  expect(screen.getByLabelText('筛选二步验证')).toHaveValue('enabled');
});
it('分页改变URL且选择不跨页，列显示可用，重置保留删除入口', async () => {
  stub([row()]);
  page();
  await screen.findByRole('table');
  expect(
    screen.queryByRole('columnheader', { name: '更新时间' }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByText('显示列'));
  await userEvent.click(screen.getByLabelText('更新时间'));
  expect(
    screen.getByRole('columnheader', { name: '更新时间' }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('选择当前页全部账号'));
  await userEvent.click(screen.getByRole('button', { name: '下一页' }));
  expect(location.search).toContain('page=2');
  await screen.findByText('已选当前页 0 条（不跨页）');
  await userEvent.click(screen.getByRole('button', { name: '已删除记录' }));
  await userEvent.selectOptions(screen.getByLabelText('筛选状态'), 'normal');
  await userEvent.click(screen.getByRole('button', { name: '重置筛选' }));
  expect(location.search).toBe('?deleted=true');
});
it('批量追加只发送选中ID和版本，成功反馈刷新', async () => {
  const rows = [row(), row(2)];
  const mock = stub(rows);
  page();
  await screen.findByRole('table');
  await userEvent.click(screen.getByLabelText(`选择 ${rows[0].account_no}`));
  await userEvent.selectOptions(
    screen.getByLabelText('批量添加标签'),
    'tag-one',
  );
  await userEvent.click(screen.getByRole('button', { name: '添加到所选账号' }));
  await userEvent.click(screen.getByRole('button', { name: '确认整批提交' }));
  await screen.findByText('整批操作已提交。');
  const req = mock.mock.calls.map(([r]) => r).find((r) => r.method === 'POST')!;
  expect(await req.json()).toEqual({
    accounts: [{ id: rows[0].id, row_version: 1 }],
    tag_ids: ['tag-one'],
  });
  expect(req.headers.get('x-csrf-token')).toBeTruthy();
});
it('批量冲突定位记录，禁止重放，刷新后重新选择', async () => {
  const rows = [row(), row(2)];
  const mock = stub(rows, async () =>
    json(
      {
        error: {
          code: 'ROW_VERSION_CONFLICT',
          message: '版本冲突',
          details: { account_id: rows[1].id },
        },
        request_id: id(),
      },
      409,
    ),
  );
  page();
  await screen.findByRole('table');
  await userEvent.click(screen.getByLabelText('选择当前页全部账号'));
  await userEvent.click(screen.getByRole('button', { name: '批量修改状态' }));
  await userEvent.click(screen.getByRole('button', { name: '确认整批提交' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('GM-000002');
  expect(screen.getByRole('button', { name: '确认整批提交' })).toBeDisabled();
  expect(mock.mock.calls.filter(([r]) => r.method === 'POST')).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: '取消批量操作' }));
  await userEvent.click(screen.getByRole('button', { name: '刷新列表' }));
  await screen.findByText('已选当前页 0 条（不跨页）');
});
it('辅助邮箱页面跳转为精确关联条件，保留分页API而非下载全量', async () => {
  const mock = stub([row()]);
  page();
  await userEvent.click(
    await screen.findByRole('button', { name: '辅助邮箱使用情况' }),
  );
  await screen.findByRole('table', { name: '辅助邮箱统计' });
  await userEvent.click(screen.getByRole('button', { name: '查看关联账号' }));
  expect(location.search).toContain('recovery_email=shared%40example.test');
  await waitFor(() =>
    expect(
      mock.mock.calls.some(
        ([r]) =>
          new URL(r.url).searchParams.get('recovery_email') ===
          'shared@example.test',
      ),
    ).toBe(true),
  );
});
it('辅助选择可搜索翻页，已有非当前页/已删除引用可显示并保留', async () => {
  const current = row();
  current.recovery_account_id = id();
  current.recovery_email = 'existing@gmail.com';
  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: Request) => {
      const page = new URL(req.url).searchParams.get('page') || '1';
      return json({
        items: [
          {
            id: page === '1' ? 'first' : 'last',
            gmail_email: page === '1' ? 'first@gmail.com' : 'last@gmail.com',
            account_no: 'GM-000090',
          },
        ],
        total: 31,
        page: Number(page),
        page_size: 30,
      });
    }),
  );
  const changed = vi.fn();
  mount(
    <RecoverySelector
      account={current}
      value={current.recovery_account_id}
      onChange={changed}
      onFailure={vi.fn()}
    />,
  );
  await screen.findByText('GM-000090 · first@gmail.com');
  expect(
    screen.getByText('existing@gmail.com（当前关联，可保留）'),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '下一组账号' }));
  await screen.findByText('GM-000090 · last@gmail.com');
  await userEvent.selectOptions(screen.getByRole('combobox'), 'last');
  expect(changed).toHaveBeenCalledWith('last');
});
it('关闭/锁定卸载取消账号查询，晚到响应不进入缓存', async () => {
  let resolve!: (r: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn((req: Request) =>
      new URL(req.url).pathname === '/api/v1/accounts'
        ? new Promise<Response>((r) => {
            resolve = r;
          })
        : Promise.resolve(json([])),
    ),
  );
  const { unmount, client } = page();
  await waitFor(() => expect(resolve).toBeTypeOf('function'));
  unmount();
  await act(async () =>
    resolve(json({ items: [row()], total: 1, page: 1, page_size: 30 })),
  );
  expect(
    client.getQueryCache().findAll({ queryKey: ['accounts'] }),
  ).toHaveLength(0);
});
it('本地日期边界跨DST仍用下一个本地零点而非加24小时', () => {
  const before = process.env.TZ;
  process.env.TZ = 'America/New_York';
  try {
    expect(dateBoundary('2026-03-08')).toBe('2026-03-08T05:00:00.000Z');
    expect(dateBoundary('2026-03-08', true)).toBe('2026-03-09T04:00:00.000Z');
    expect(dateBoundary('2026-11-01', true)).toBe('2026-11-02T05:00:00.000Z');
  } finally {
    process.env.TZ = before;
  }
});
it('后台无心跳；合成交互不能续期；绝对期限清理且晚到activity不恢复', async () => {
  vi.useFakeTimers();
  const auth = session();
  auth.idle_expires_at = new Date(Date.now() + 500).toISOString();
  auth.expires_at = new Date(Date.now() + 800).toISOString();
  const lock = vi.fn();
  const mock = vi.fn();
  vi.stubGlobal('fetch', mock);
  function Harness() {
    useIdleSession(auth, vi.fn(), lock, vi.fn());
    return <button>操作</button>;
  }
  render(<Harness />);
  fireEvent.keyDown(window, { key: 'a' });
  await act(async () => vi.advanceTimersByTime(501));
  expect(lock).toHaveBeenCalledOnce();
  expect(mock).not.toHaveBeenCalled();
});

it('真实活动信号续闲置但延迟活动响应不能后移已知绝对期限', async () => {
  vi.useFakeTimers();
  const initial = session();
  initial.expires_at = new Date(Date.now() + 100000).toISOString();
  let resolve!: (r: Response) => void;
  const fetchMock = vi.fn(
    () =>
      new Promise<Response>((r) => {
        resolve = r;
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  const listen = vi.spyOn(window, 'addEventListener');
  const lock = vi.fn();
  const accept = vi.fn();
  function Harness() {
    const [state, setState] = __useState(initial);
    useIdleSession(
      state,
      (s) => {
        accept(s);
        setState(s);
      },
      lock,
      vi.fn(),
    );
    return null;
  }
  render(<Harness />);
  await act(async () => vi.advanceTimersByTime(10000));
  expect(fetchMock).not.toHaveBeenCalled();
  const handler = listen.mock.calls.find(
    ([name]) => name === 'keydown',
  )![1] as EventListener;
  act(() => handler({ isTrusted: true } as Event));
  const response = {
    ...initial,
    server_time: new Date().toISOString(),
    idle_expires_at: new Date(Date.now() + 900000).toISOString(),
  };
  await act(async () => vi.advanceTimersByTime(50000));
  await act(async () => resolve(json(response)));
  expect(accept).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTime(39999));
  expect(lock).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(2));
  expect(lock).toHaveBeenCalledOnce();
});

it('提交响应丢失只提示结果未知，不能宣称整批未提交', async () => {
  stub([row()], async () => {
    throw new Error('connection lost');
  });
  page();
  await screen.findByRole('table');
  await userEvent.click(screen.getByLabelText('选择当前页全部账号'));
  await userEvent.click(screen.getByRole('button', { name: '批量修改状态' }));
  await userEvent.click(screen.getByRole('button', { name: '确认整批提交' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('提交结果未知');
  expect(alert).not.toHaveTextContent('整批未提交');
});

it.each(['success', 'conflict'])(
  '旧账号修改晚到不能覆盖新打开的详情：%s',
  async (outcome) => {
    const rows = [row(), row(2)];
    let resolve!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        const path = new URL(req.url).pathname;
        if (req.method === 'POST')
          return new Promise<Response>((r) => {
            resolve = r;
          });
        if (path.endsWith(rows[0].id)) return json(rows[0]);
        if (path.endsWith(rows[1].id)) return json(rows[1]);
        if (path.endsWith('/tags')) return json([]);
        if (path.endsWith('/summary')) return json({ total: 2 });
        return json({ items: rows, total: 2, page: 1, page_size: 30 });
      }),
    );
    page();
    await userEvent.click(
      await screen.findByRole('button', { name: rows[0].gmail_email }),
    );
    await screen.findByRole('heading', { name: rows[0].gmail_email });
    await userEvent.click(screen.getByRole('button', { name: '今天已验证' }));
    await waitFor(() => expect(resolve).toBeTypeOf('function'));
    fireEvent.keyDown(screen.getByRole('dialog', { name: '账号详情' }), {
      key: 'Escape',
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    await userEvent.click(
      screen.getByRole('button', { name: rows[1].gmail_email }),
    );
    await screen.findByRole('heading', { name: rows[1].gmail_email });
    await act(async () =>
      resolve(
        outcome === 'success'
          ? json({ ...rows[0], row_version: 2 })
          : json(
              {
                error: {
                  code: 'ROW_VERSION_CONFLICT',
                  message: '版本冲突',
                  details: {},
                },
                request_id: id(),
              },
              409,
            ),
      ),
    );
    expect(
      screen.getByRole('heading', { name: rows[1].gmail_email }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '编辑账号' })).not.toBeDisabled();
  },
);

it('锁定后晚到的活动响应不恢复会话', async () => {
  vi.useFakeTimers();
  const auth = session();
  auth.expires_at = new Date(Date.now() + 1000).toISOString();
  const listen = vi.spyOn(window, 'addEventListener');
  let resolve!: (r: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((r) => {
          resolve = r;
        }),
    ),
  );
  const accept = vi.fn(),
    lock = vi.fn();
  function Harness() {
    useIdleSession(auth, accept, lock, vi.fn());
    return null;
  }
  render(<Harness />);
  const handler = listen.mock.calls.find(
    ([name]) => name === 'keydown',
  )![1] as EventListener;
  act(() => handler({ isTrusted: true } as Event));
  await act(async () => vi.advanceTimersByTime(1001));
  expect(lock).toHaveBeenCalledOnce();
  await act(async () =>
    resolve(json({ ...auth, server_time: new Date().toISOString() })),
  );
  expect(accept).not.toHaveBeenCalled();
});

it('未知服务器错误不能宣称整批未提交', async () => {
  stub([row()], async () =>
    json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: '服务暂时无法处理请求',
          details: {},
        },
        request_id: id(),
      },
      500,
    ),
  );
  page();
  await screen.findByRole('table');
  await userEvent.click(screen.getByLabelText('选择当前页全部账号'));
  await userEvent.click(screen.getByRole('button', { name: '批量修改状态' }));
  await userEvent.click(screen.getByRole('button', { name: '确认整批提交' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('提交结果未知');
  expect(screen.getByRole('alert')).not.toHaveTextContent('整批未提交');
});
