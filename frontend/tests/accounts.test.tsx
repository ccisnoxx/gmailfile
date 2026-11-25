import React from 'react';
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
import { afterEach, expect, it, vi } from 'vitest';
import { AccountsPage } from '@/features/accounts/accounts-page';
import { PasswordControl } from '@/features/accounts/password-control';
import type { AccountDetail, SessionResponse } from '@/api/generated';

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
const row = (): AccountDetail => ({
  id: id(),
  account_no: 'GM-000001',
  gmail_email: 'synthetic@gmail.com',
  registered_at: new Date().toISOString(),
  recovery_account_id: null,
  recovery_email_external: 'recovery@example.test',
  recovery_email: 'recovery@example.test',
  status: 'normal',
  two_factor_status: 'unknown',
  purpose: '合成测试',
  tags: [],
  last_login_at: null,
  last_verified_at: null,
  password_changed_at: null,
  archived_at: null,
  deleted_at: null,
  row_version: 1,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  phone: null,
  notes: null,
});
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const error = (code: string, status = 409) =>
  json(
    { error: { code, message: '合成错误', details: {} }, request_id: id() },
    status,
  );
function provider(child: React.ReactNode) {
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
  return provider(
    <AccountsPage
      session={session()}
      onSession={vi.fn()}
      onFailure={vi.fn()}
      onSecurity={vi.fn()}
      onLogout={vi.fn()}
    />,
  );
}
function stubRows(
  record: AccountDetail,
  mutation?: (req: Request) => Promise<Response>,
) {
  const mock = vi.fn(async (req: Request) => {
    const url = new URL(req.url);
    if (req.method !== 'GET')
      return mutation ? mutation(req) : json({ ...record, row_version: 2 });
    if (url.pathname === '/api/v1/tags') return json([]);
    if (url.pathname === `/api/v1/accounts/${record.id}`) return json(record);
    if (url.pathname === '/api/v1/dashboard/summary')
      return json({
        total: 1,
        normal: 1,
        pending_verification: 0,
        abnormal: 0,
        added_this_month: 1,
        unverified_over_30_days: 0,
      });
    const items =
      url.searchParams.get('deleted') === 'true'
        ? record.deleted_at
          ? [record]
          : []
        : record.deleted_at
          ? []
          : [record];
    return json({ items, total: items.length, page: 1, page_size: 30 });
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

it('列表与详情来自 API，邮箱和辅助邮箱可复制，键盘可打开抽屉', async () => {
  const record = row();
  stubRows(record);
  const user = userEvent.setup();
  page();
  await screen.findByRole('table', { name: '账号列表' });
  await user.click(
    screen.getByRole('button', { name: `复制邮箱 ${record.gmail_email}` }),
  );
  expect(await navigator.clipboard.readText()).toBe(record.gmail_email);
  await user.click(
    screen.getByRole('button', {
      name: `复制辅助邮箱 ${record.recovery_email}`,
    }),
  );
  expect(await navigator.clipboard.readText()).toBe(record.recovery_email);
  screen.getByRole('button', { name: '详情' }).focus();
  await user.keyboard('{Enter}');
  const drawer = await screen.findByRole('dialog', { name: '账号详情' });
  expect(within(drawer).getByText(record.account_no)).toBeInTheDocument();
  await user.keyboard('{Escape}');
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
});

it('新增与编辑共用表单，编辑密码为空且保存时省略，不读取密码', async () => {
  const record = row();
  let body: Record<string, unknown> | null = null;
  const mock = stubRows(record, async (req) => {
    body = await req.json();
    return json({ ...record, purpose: '新用途', row_version: 2 });
  });
  page();
  await userEvent.click(await screen.findByRole('button', { name: '编辑' }));
  const form = await screen.findByRole('dialog', { name: '编辑账号' });
  expect(within(form).getByLabelText(/Gmail 登录密码/)).toHaveValue('');
  await userEvent.clear(within(form).getByLabelText('账号用途'));
  await userEvent.type(within(form).getByLabelText('账号用途'), '新用途');
  await userEvent.click(within(form).getByRole('button', { name: '保存账号' }));
  await waitFor(() =>
    expect(body).toMatchObject({ purpose: '新用途', row_version: 1 }),
  );
  expect(body).not.toHaveProperty('password');
  expect(
    mock.mock.calls.some(([req]) => req.url.includes('reveal-password')),
  ).toBe(false);
  await userEvent.click(screen.getByRole('button', { name: '新增账号' }));
  expect(screen.getByLabelText('Gmail 地址')).toHaveValue('');
  expect(screen.getByLabelText('Gmail 登录密码')).toBeRequired();
});

it('新增提交真实字段和UTC，关联切换不会同时提交两种辅助邮箱', async () => {
  const record = row();
  let submitted: Record<string, unknown> | null = null;
  stubRows(record, async (req) => {
    submitted = await req.json();
    return json(record, 201);
  });
  page();
  await userEvent.click(
    await screen.findByRole('button', { name: '新增账号' }),
  );
  await userEvent.type(screen.getByLabelText('Gmail 地址'), 'new@gmail.com');
  const secret = id();
  await userEvent.type(screen.getByLabelText('Gmail 登录密码'), secret);
  await userEvent.selectOptions(
    screen.getByLabelText('辅助邮箱方式'),
    'account',
  );
  await userEvent.selectOptions(screen.getByLabelText('关联账号'), record.id);
  await userEvent.click(screen.getByRole('button', { name: '保存账号' }));
  await waitFor(() =>
    expect(submitted).toMatchObject({
      gmail_email: 'new@gmail.com',
      password: secret,
      recovery_account_id: record.id,
      recovery_email_external: null,
    }),
  );
  expect(submitted).not.toHaveProperty('recovery_mode');
  expect(String(submitted!.registered_at)).toMatch(/Z$/);
});

it('表单阻止辅助邮箱与主邮箱同一规范化地址', async () => {
  const record = row();
  const mock = stubRows(record);
  page();
  await userEvent.click(
    await screen.findByRole('button', { name: '新增账号' }),
  );
  await userEvent.type(
    screen.getByLabelText('Gmail 地址'),
    'user.name+tag@googlemail.com',
  );
  await userEvent.type(screen.getByLabelText('Gmail 登录密码'), id());
  await userEvent.type(
    within(screen.getByRole('dialog', { name: '新增账号' })).getByLabelText(
      '辅助邮箱',
    ),
    'username@gmail.com',
  );
  await userEvent.click(screen.getByRole('button', { name: '保存账号' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    '辅助邮箱不能与主邮箱相同',
  );
  expect(mock.mock.calls.filter(([req]) => req.method === 'POST')).toHaveLength(
    0,
  );
});

it('版本冲突保留表单，禁用保存，明确加载最新版本且不自动重放', async () => {
  const record = row();
  const mock = stubRows(record, async () => error('ROW_VERSION_CONFLICT'));
  page();
  await userEvent.click(await screen.findByRole('button', { name: '编辑' }));
  await screen.findByRole('dialog', { name: '编辑账号' });
  await userEvent.click(screen.getByRole('button', { name: '保存账号' }));
  expect(
    await within(screen.getByRole('dialog', { name: '编辑账号' })).findByText(
      /当前内容未覆盖服务器/,
      {
        selector: '[data-slot="alert-description"]',
      },
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '保存账号' })).toBeDisabled();
  expect(
    mock.mock.calls.filter(([req]) => req.method === 'PATCH'),
  ).toHaveLength(1);
  await userEvent.click(
    screen.getByRole('button', { name: '重新加载最新版本（放弃当前编辑）' }),
  );
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '保存账号' })).not.toBeDisabled(),
  );
});

it.each(['归档', '删除'])(
  '%s必须确认，取消不请求且确认携带版本',
  async (action) => {
    const record = row();
    const mock = stubRows(record);
    page();
    await userEvent.click(await screen.findByRole('button', { name: '详情' }));
    await screen.findByRole('dialog', { name: '账号详情' });
    await userEvent.click(screen.getByRole('button', { name: action }));
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    expect(
      mock.mock.calls.filter(([req]) => req.method !== 'GET'),
    ).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: action }));
    await userEvent.click(
      screen.getByRole('button', { name: `确认${action}` }),
    );
    await waitFor(() =>
      expect(mock.mock.calls.some(([req]) => req.method !== 'GET')).toBe(true),
    );
    const request = mock.mock.calls.find(([req]) => req.method !== 'GET')![0];
    expect(await request.json()).toEqual({ row_version: 1 });
  },
);

it('已删除记录入口提供单条恢复并携带版本', async () => {
  const record = row();
  record.deleted_at = new Date().toISOString();
  const mock = stubRows(record);
  page();
  await userEvent.click(
    await screen.findByRole('button', { name: '已删除记录' }),
  );
  await screen.findByRole('table', { name: '已删除账号列表' });
  await userEvent.click(screen.getByRole('button', { name: '详情' }));
  await userEvent.click(
    await screen.findByRole('button', { name: '恢复账号' }),
  );
  await waitFor(() =>
    expect(mock.mock.calls.some(([req]) => req.url.endsWith('/restore'))).toBe(
      true,
    ),
  );
});

function passwordPanel(
  props: Partial<React.ComponentProps<typeof PasswordControl>> = {},
) {
  return provider(
    <PasswordControl
      accountId={id()}
      session={session()}
      onSession={vi.fn()}
      onFailure={vi.fn()}
      {...props}
    />,
  );
}

it('密码mutation不缓存敏感值，20秒自动清除且隐藏立即清除', async () => {
  vi.useFakeTimers();
  const secret = id();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => json({ password: secret })),
  );
  const { client } = passwordPanel();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
  });
  expect(screen.getByLabelText('Gmail 密码')).toHaveTextContent(secret);
  expect(
    JSON.stringify(client.getQueryCache().getAll()) +
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
      ),
  ).not.toContain(secret);
  await act(async () => {
    vi.advanceTimersByTime(20001);
  });
  expect(screen.getByLabelText('Gmail 密码')).toHaveTextContent('••••••••');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '显示密码' }));
  });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  expect(screen.getByLabelText('Gmail 密码')).not.toHaveTextContent(secret);
  expect(localStorage.length + sessionStorage.length).toBe(0);
});

it.each(['hidden', 'unmount'])(
  '晚到密码响应在%s之后不能重新显示',
  async (boundary) => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const { unmount, client } = passwordPanel();
    await userEvent.click(screen.getByRole('button', { name: '显示密码' }));
    if (boundary === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      fireEvent(document, new Event('visibilitychange'));
    } else unmount();
    const secret = id();
    await act(async () => resolve(json({ password: secret })));
    expect(screen.queryByText(secret)).not.toBeInTheDocument();
    expect(
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
      ),
    ).not.toContain(secret);
  },
);

it('复制事件不传密码，审计挂起也在20秒清除展示并尝试清理剪贴板', async () => {
  vi.useFakeTimers();
  const secret = id();
  let clipboard = '';
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn(async (text: string) => {
        clipboard = text;
      }),
      readText: vi.fn(async () => clipboard),
    },
  });
  let resolve!: (value: Response) => void;
  const mock = vi.fn((req: Request) =>
    req.url.endsWith('reveal-password')
      ? Promise.resolve(json({ password: secret }))
      : new Promise<Response>((done) => {
          resolve = done;
        }),
  );
  vi.stubGlobal('fetch', mock);
  passwordPanel();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '复制密码' }));
  });
  expect(clipboard).toBe(secret);
  const request = mock.mock.calls.find(([req]) =>
    req.url.endsWith('copy-password-event'),
  )![0];
  expect(await request.json()).toEqual({});
  await act(async () => {
    vi.advanceTimersByTime(20001);
  });
  expect(screen.getByLabelText('Gmail 密码')).not.toHaveTextContent(secret);
  expect(navigator.clipboard.readText).toHaveBeenCalledTimes(1);
  vi.useRealTimers();
  await waitFor(() => expect(clipboard).toBe(''));
  await act(async () => resolve(json({ status: 'ok' })));
  expect(screen.getByLabelText('Gmail 密码')).not.toHaveTextContent(secret);
});

it('重新验证采用轮换后的CSRF，不自动重放显示请求', async () => {
  const first = session(),
    next = session();
  let calls = 0;
  const mock = vi.fn(async (req: Request) => {
    if (req.url.endsWith('reverify')) return json(next);
    calls++;
    return calls === 1
      ? error('REAUTH_REQUIRED', 403)
      : json({ password: id() });
  });
  vi.stubGlobal('fetch', mock);
  function Wrapper() {
    const [state, setState] = React.useState(first);
    return (
      <PasswordControl
        accountId={id()}
        session={state}
        onSession={setState}
        onFailure={vi.fn()}
      />
    );
  }
  provider(<Wrapper />);
  await userEvent.click(screen.getByRole('button', { name: '显示密码' }));
  await userEvent.type(await screen.findByLabelText('当前管理员密码'), id());
  await userEvent.click(screen.getByRole('button', { name: '重新验证' }));
  await screen.findByText('重新验证成功，请再次选择显示或复制。');
  expect(calls).toBe(1);
  await userEvent.click(screen.getByRole('button', { name: '显示密码' }));
  await waitFor(() => expect(calls).toBe(2));
  expect(mock.mock.calls.at(-1)![0].headers.get('X-CSRF-Token')).toBe(
    next.csrf_token,
  );
});

it.each(['hidden', 'unmount'])(
  '重新验证在%s后完成也不能重新接受会话',
  async (boundary) => {
    const accepted = vi.fn();
    let resolve!: (value: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((req: Request) =>
        req.url.endsWith('reverify')
          ? new Promise<Response>((done) => {
              resolve = done;
            })
          : Promise.resolve(error('REAUTH_REQUIRED', 403)),
      ),
    );
    const { unmount } = passwordPanel({ onSession: accepted });
    await userEvent.click(screen.getByRole('button', { name: '显示密码' }));
    await userEvent.type(await screen.findByLabelText('当前管理员密码'), id());
    await userEvent.click(screen.getByRole('button', { name: '重新验证' }));
    if (boundary === 'hidden') {
      vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
      fireEvent(document, new Event('visibilitychange'));
    } else unmount();
    await act(async () => resolve(json(session())));
    expect(accepted).not.toHaveBeenCalled();
  },
);

it('管理标签新增、重命名及删除确认不删除账号', async () => {
  const record = row();
  const tag = {
    id: id(),
    name: '初始标签',
    created_at: new Date().toISOString(),
  };
  let items = [tag];
  const mock = vi.fn(async (req: Request) => {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/v1/tags')) {
      if (req.method === 'POST') {
        items.push({
          id: id(),
          name: (await req.json()).name,
          created_at: new Date().toISOString(),
        });
        return json(items.at(-1), 201);
      }
      if (req.method === 'PATCH') {
        items = [{ ...tag, name: (await req.json()).name }];
        return json(items[0]);
      }
      if (req.method === 'DELETE') {
        items = [];
        return json({ status: 'ok' });
      }
      return json(items);
    }
    if (url.pathname === '/api/v1/dashboard/summary')
      return json({
        total: 1,
        normal: 1,
        pending_verification: 0,
        abnormal: 0,
        added_this_month: 1,
        unverified_over_30_days: 0,
      });
    return json({ items: [record], total: 1, page: 1, page_size: 30 });
  });
  vi.stubGlobal('fetch', mock);
  page();
  await userEvent.click(
    await screen.findByRole('button', { name: '管理标签' }),
  );
  await userEvent.click(await screen.findByRole('button', { name: '重命名' }));
  await userEvent.clear(screen.getByLabelText('标签名称'));
  await userEvent.type(screen.getByLabelText('标签名称'), '更新标签');
  await userEvent.click(screen.getByRole('button', { name: '保存标签' }));
  expect(
    await within(screen.getByRole('dialog', { name: '管理标签' })).findByText(
      '更新标签',
    ),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: '删除标签' }));
  await userEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(items).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: '删除标签' }));
  await userEvent.click(screen.getByRole('button', { name: '确认删除标签' }));
  await waitFor(() => expect(items).toHaveLength(0));
  expect(
    mock.mock.calls.some(
      ([req]) =>
        req.method === 'DELETE' &&
        new URL(req.url).pathname.startsWith('/api/v1/accounts'),
    ),
  ).toBe(false);
  await userEvent.type(screen.getByLabelText('标签名称'), '新标签');
  await userEvent.click(screen.getByRole('button', { name: '添加标签' }));
  expect(
    await within(screen.getByRole('dialog', { name: '管理标签' })).findByText(
      '新标签',
    ),
  ).toBeInTheDocument();
});

it('剪贴板拒绝时给出权限与焦点提示，不伪装成服务故障或复制成功', async () => {
  const failure = vi.fn();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: vi.fn(async () => {
        throw new DOMException('Document is not focused', 'NotAllowedError');
      }),
      readText: vi.fn(async () => ''),
    },
  });
  const mock = vi.fn(async () => json({ password: id() }));
  vi.stubGlobal('fetch', mock);
  passwordPanel({ onFailure: failure });
  await userEvent.click(screen.getByRole('button', { name: '复制密码' }));
  expect(
    await screen.findByText(
      '浏览器未允许复制，请保持页面聚焦并检查剪贴板权限。',
    ),
  ).toBeInTheDocument();
  expect(failure).not.toHaveBeenCalled();
  expect(mock.mock.calls).toHaveLength(1);
});
