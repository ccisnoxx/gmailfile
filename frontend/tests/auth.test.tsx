import {
  act,
  fireEvent,
  render as rtlRender,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { Providers } from '@/app/providers';
import type { ReactElement } from 'react';
const render = (ui: ReactElement) => rtlRender(ui, { wrapper: Providers });
import { AuthPage } from '@/features/auth/auth-page';
import type { SessionResponse } from '@/api/generated';

const token = () => crypto.randomUUID();
const session = (
  state: SessionResponse['state'] = 'anonymous',
): SessionResponse => ({
  state,
  idle_timeout_seconds: 900,
  server_time: new Date().toISOString(),
  csrf_token: token(),
  expires_at: new Date(Date.now() + 43200000).toISOString(),
  idle_expires_at: new Date(Date.now() + 900000).toISOString(),
  reauthenticated_until: null,
});
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('StrictMode 只建立一次预会话，登录带 CSRF，MFA 完成前保持受限', async () => {
  const anonymous = session();
  const pending = session('mfa_pending');
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json(anonymous))
    .mockResolvedValueOnce(json(pending));
  vi.stubGlobal('fetch', fetchMock);
  render(
    <StrictMode>
      <AuthPage initialView="security" />
    </StrictMode>,
  );
  await screen.findByLabelText('管理员密码');
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const password = token();
  await userEvent.type(screen.getByLabelText('管理员密码'), password);
  await userEvent.click(screen.getByRole('button', { name: '登录' }));
  expect(
    await screen.findByRole('button', { name: '开始绑定验证器' }),
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('navigation', { name: '安全操作' }),
  ).not.toBeInTheDocument();
  const request = fetchMock.mock.calls[1][0] as Request;
  expect(request.headers.get('x-csrf-token')).toBe(anonymous.csrf_token);
  expect((await request.json()).password).toBe(password);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});

it('绑定展示二维码和手工 Secret，恢复码一次展示并主动清除', async () => {
  const pending = session('mfa_pending');
  const authenticated = session('authenticated');
  const secret = token();
  const codes = [token(), token()];
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json(pending))
      .mockResolvedValueOnce(
        json({
          secret,
          session: pending,
          qr_data_url: 'data:image/svg+xml;base64,PHN2Zy8+',
          expires_at: new Date(Date.now() + 600000).toISOString(),
        }),
      )
      .mockResolvedValueOnce(
        json({ session: authenticated, recovery_codes: codes }),
      ),
  );
  render(<AuthPage initialView="security" />);
  await userEvent.click(
    await screen.findByRole('button', { name: '开始绑定验证器' }),
  );
  expect(await screen.findByAltText('验证器绑定二维码')).toBeInTheDocument();
  expect(screen.getByLabelText('手工 Secret')).toHaveValue(secret);
  await userEvent.type(screen.getByLabelText('验证器验证码'), '123456');
  await userEvent.click(screen.getByRole('button', { name: '确认绑定' }));
  expect(await screen.findByLabelText('一次性恢复码')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '完成并清除展示' })).toBeDisabled();
  await userEvent.click(
    screen.getByRole('checkbox', { name: '我已离线保存恢复码' }),
  );
  await userEvent.click(screen.getByRole('button', { name: '完成并清除展示' }));
  expect(screen.queryByText(codes[0])).not.toBeInTheDocument();
  expect(screen.queryByLabelText('手工 Secret')).not.toBeInTheDocument();
  expect(screen.getByText('已通过二步验证')).toBeInTheDocument();
});

it('页面隐藏清除恢复码和输入字段', async () => {
  const auth = session('authenticated');
  const codes = [token()];
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json(auth))
      .mockResolvedValueOnce(json({ session: auth, recovery_codes: codes })),
  );
  render(<AuthPage initialView="security" />);
  await screen.findByText('已通过二步验证');
  await userEvent.click(screen.getByRole('button', { name: '重新生成恢复码' }));
  await userEvent.type(screen.getByLabelText('当前管理员密码'), token());
  await userEvent.type(screen.getByLabelText('TOTP 验证码'), '123456');
  await userEvent.click(screen.getByRole('button', { name: '验证并继续' }));
  await screen.findByLabelText('一次性恢复码');
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  expect(screen.queryByLabelText('一次性恢复码')).not.toBeInTheDocument();
  expect(screen.getByLabelText('当前管理员密码')).toHaveValue('');
});

it('重新验证采用新 CSRF，改密成功回登录页', async () => {
  const auth = session('authenticated');
  const verified = session('authenticated');
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json(auth))
    .mockResolvedValueOnce(json(verified))
    .mockResolvedValueOnce(json({ status: 'ok' }))
    .mockResolvedValueOnce(json(session()));
  vi.stubGlobal('fetch', fetchMock);
  render(<AuthPage initialView="security" />);
  await userEvent.type(await screen.findByLabelText('当前管理员密码'), token());
  await userEvent.click(
    screen
      .getByLabelText('当前管理员密码')
      .closest('form')!
      .querySelector('button[type="submit"]')!,
  );
  await screen.findByText('重新验证成功，5 分钟内可进行敏感操作。');
  await userEvent.click(screen.getByRole('button', { name: '修改密码' }));
  expect(screen.getByLabelText('新密码')).toHaveAttribute('minlength', '16');
  const newPassword = token().slice(0, 16);
  await userEvent.type(screen.getByLabelText('当前管理员密码'), token());
  await userEvent.type(screen.getByLabelText('新密码'), newPassword);
  await userEvent.click(
    screen.getByRole('button', { name: '修改密码并退出所有会话' }),
  );
  expect(await screen.findByLabelText('管理员密码')).toBeInTheDocument();
  const request = fetchMock.mock.calls[2][0] as Request;
  expect(request.headers.get('x-csrf-token')).toBe(verified.csrf_token);
  expect((await request.json()).new_password).toBe(newPassword);
});

it('CSRF 失效不自动重放修改请求，显示刷新指引并清空密码', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json(session()))
    .mockResolvedValueOnce(
      json(
        {
          error: { code: 'CSRF_INVALID', message: '请求校验失败' },
          request_id: token(),
        },
        403,
      ),
    );
  vi.stubGlobal('fetch', fetchMock);
  render(<AuthPage initialView="security" />);
  await userEvent.type(await screen.findByLabelText('管理员密码'), token());
  await userEvent.click(screen.getByRole('button', { name: '登录' }));
  expect(await screen.findByText(/页面校验已失效/)).toBeInTheDocument();
  expect(screen.queryByLabelText('管理员密码')).not.toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it('认证失败使用统一错误并清除输入', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json(session()))
      .mockResolvedValueOnce(
        json(
          {
            error: {
              code: 'AUTH_FAILED',
              message: '验证失败或暂时受限，请稍后重试',
            },
            request_id: token(),
          },
          401,
        ),
      ),
  );
  render(<AuthPage initialView="security" />);
  await userEvent.type(await screen.findByLabelText('管理员密码'), token());
  await userEvent.click(screen.getByRole('button', { name: '登录' }));
  expect(
    await screen.findByText('验证失败或暂时受限，请稍后重试'),
  ).toBeInTheDocument();
  expect(screen.getByLabelText('管理员密码')).toHaveValue('');
});

it('服务端 401 将认证界面退回登录页', async () => {
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json(session('authenticated')))
      .mockResolvedValueOnce(
        json(
          {
            error: { code: 'AUTH_REQUIRED', message: '会话已失效' },
            request_id: token(),
          },
          401,
        ),
      )
      .mockResolvedValueOnce(json(session())),
  );
  render(<AuthPage initialView="security" />);
  await userEvent.click(await screen.findByRole('button', { name: '退出' }));
  expect(await screen.findByLabelText('管理员密码')).toBeInTheDocument();
});

it('闲置期限到达后清除认证状态并返回登录页', async () => {
  vi.useFakeTimers();
  const auth = session('authenticated');
  auth.idle_expires_at = new Date(Date.now() + 1000).toISOString();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json(auth))
    .mockResolvedValueOnce(json({ status: 'ok' }))
    .mockResolvedValueOnce(json(session()));
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => {
    render(<AuthPage initialView="security" />);
  });
  expect(screen.getByText('已通过二步验证')).toBeInTheDocument();
  await act(async () => {
    vi.advanceTimersByTime(1001);
  });
  expect(screen.getByLabelText('管理员密码')).toBeInTheDocument();
  expect(screen.getByText('会话已超时，请重新登录。')).toBeInTheDocument();
});

it('隐藏页面时在途绑定响应不能重新展示 Secret', async () => {
  let resolve!: (response: Response) => void;
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json(session('mfa_pending')))
    .mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
  vi.stubGlobal('fetch', fetchMock);
  render(<AuthPage initialView="security" />);
  await userEvent.click(
    await screen.findByRole('button', { name: '开始绑定验证器' }),
  );
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  fireEvent(document, new Event('visibilitychange'));
  await act(async () =>
    resolve(
      json({
        secret: token(),
        session: session('mfa_pending'),
        qr_data_url: 'data:image/svg+xml;base64,PHN2Zy8+',
        expires_at: new Date().toISOString(),
      }),
    ),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: '开始绑定验证器' }),
    ).not.toBeDisabled(),
  );
  expect(screen.queryByLabelText('手工 Secret')).not.toBeInTheDocument();
});

it('点击退出即清除恢复码，网络失败也不会恢复展示', async () => {
  const auth = session('authenticated');
  const codes = [token()];
  let reject!: (reason: Error) => void;
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValueOnce(json(auth))
      .mockResolvedValueOnce(json({ session: auth, recovery_codes: codes }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((_done, fail) => {
            reject = fail;
          }),
      ),
  );
  render(<AuthPage initialView="security" />);
  await screen.findByText('已通过二步验证');
  await userEvent.click(screen.getByRole('button', { name: '重新生成恢复码' }));
  await userEvent.type(screen.getByLabelText('当前管理员密码'), token());
  await userEvent.type(screen.getByLabelText('TOTP 验证码'), '123456');
  await userEvent.click(screen.getByRole('button', { name: '验证并继续' }));
  await screen.findByLabelText('一次性恢复码');
  await userEvent.click(screen.getByRole('button', { name: '退出' }));
  expect(screen.queryByLabelText('一次性恢复码')).not.toBeInTheDocument();
  await act(async () => reject(new Error('offline')));
  expect(screen.queryByText(codes[0])).not.toBeInTheDocument();
  expect(screen.getByText('无法连接服务，请稍后重试。')).toBeInTheDocument();
});

it('客户端快钟不提前锁定，到期重查返回旧认证也不会循环请求', async () => {
  vi.useFakeTimers();
  const auth = session('authenticated');
  const serverNow = Date.now() - 300000;
  auth.server_time = new Date(serverNow).toISOString();
  auth.idle_expires_at = new Date(serverNow + 1000).toISOString();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(json(auth))
    .mockImplementation(() => Promise.resolve(json(auth)));
  vi.stubGlobal('fetch', fetchMock);
  await act(async () => {
    render(<AuthPage initialView="security" />);
  });
  expect(screen.getByText('已通过二步验证')).toBeInTheDocument();
  await act(async () => {
    vi.advanceTimersByTime(999);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await act(async () => {
    vi.advanceTimersByTime(2);
  });
  expect(
    screen.getByText('界面已锁定，请刷新页面后重新验证。'),
  ).toBeInTheDocument();
  await act(async () => {
    vi.advanceTimersByTime(60000);
  });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(screen.queryByText('已通过二步验证')).not.toBeInTheDocument();
});

it('恢复码只在生成展示时可下载，由浏览器 Blob 直接生成并释放', async () => {
  const auth = session('authenticated');
  const codes = [token(), token()];
  const createDescriptor = Object.getOwnPropertyDescriptor(
    URL,
    'createObjectURL',
  );
  const revokeDescriptor = Object.getOwnPropertyDescriptor(
    URL,
    'revokeObjectURL',
  );
  const create = vi.fn().mockReturnValue('blob:synthetic-download');
  const revoke = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: create,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revoke,
  });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
  try {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json(auth))
        .mockResolvedValueOnce(json({ session: auth, recovery_codes: codes })),
    );
    render(<AuthPage initialView="security" />);
    await screen.findByText('已通过二步验证');
    expect(
      screen.queryByRole('button', { name: '下载恢复码' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: '重新生成恢复码' }),
    );
    await userEvent.type(screen.getByLabelText('当前管理员密码'), token());
    await userEvent.type(screen.getByLabelText('TOTP 验证码'), '123456');
    await userEvent.click(screen.getByRole('button', { name: '验证并继续' }));
    await userEvent.click(
      await screen.findByRole('button', { name: '下载恢复码' }),
    );
    expect(create).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0]).toBeInstanceOf(Blob);
    await waitFor(() =>
      expect(revoke).toHaveBeenCalledWith('blob:synthetic-download'),
    );
    await userEvent.click(
      screen.getByRole('checkbox', { name: '我已离线保存恢复码' }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: '完成并清除展示' }),
    );
    expect(
      screen.queryByRole('button', { name: '下载恢复码' }),
    ).not.toBeInTheDocument();
  } finally {
    if (createDescriptor)
      Object.defineProperty(URL, 'createObjectURL', createDescriptor);
    else Reflect.deleteProperty(URL, 'createObjectURL');
    if (revokeDescriptor)
      Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor);
    else Reflect.deleteProperty(URL, 'revokeObjectURL');
  }
});

it('到期锁定期间晚到重新验证不能恢复认证工作区', async () => {
  vi.useFakeTimers();
  const auth = session('authenticated');
  auth.idle_expires_at = new Date(Date.now() + 1000).toISOString();
  let resolve!: (r: Response) => void;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname;
      if (path.endsWith('/reverify'))
        return new Promise<Response>((r) => {
          resolve = r;
        });
      if (path.endsWith('/logout')) return json({ status: 'ok' });
      return json(path.endsWith('/session') && !resolve ? auth : session());
    }),
  );
  await act(async () => {
    render(<AuthPage initialView="security" />);
  });
  fireEvent.change(screen.getByLabelText('当前管理员密码'), {
    target: { value: token() },
  });
  await act(async () => {
    fireEvent.submit(screen.getByLabelText('当前管理员密码').closest('form')!);
  });
  await act(async () => vi.advanceTimersByTime(1001));
  expect(screen.getByLabelText('管理员密码')).not.toBeDisabled();
  await act(async () =>
    resolve(
      json({
        ...auth,
        server_time: new Date().toISOString(),
        idle_expires_at: new Date(Date.now() + 900000).toISOString(),
      }),
    ),
  );
  expect(screen.queryByText('已通过二步验证')).not.toBeInTheDocument();
  expect(screen.getByLabelText('管理员密码')).toBeInTheDocument();
});

it('撤销自身先清空工作区；网络结果未知也不能恢复旧页面或自动刷新复活', async () => {
  const current = session('authenticated');
  const id = token();
  let rejectDelete!: (error: Error) => void;
  const fetchMock = vi.fn(async (req: Request) => {
    const path = new URL(req.url).pathname;
    if (path === '/api/v1/auth/session') return json(current);
    if (path === '/api/v1/system/version')
      return json({ version: '0.1.0', schema_version: '0004' });
    if (path === '/api/v1/system/backup-status')
      return json({ state: 'unconfigured' });
    if (path === '/api/v1/settings') return json({ idle_minutes: 15 });
    if (req.method === 'DELETE')
      return new Promise<Response>((_, reject) => {
        rejectDelete = reject;
      });
    if (path === '/api/v1/auth/sessions')
      return json({
        items: [
          {
            id,
            current: true,
            state: 'valid',
            auth_level: 'authenticated',
            created_at: current.server_time,
            last_seen_at: current.server_time,
            expires_at: current.expires_at,
            idle_expires_at: current.idle_expires_at,
            revoked_at: null,
            ip_address: null,
          },
        ],
        total: 1,
        page: 1,
        page_size: 10,
      });
    throw new Error('unexpected test route');
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<AuthPage initialView="security" />);
  await userEvent.click(
    await screen.findByRole('button', { name: '迁移与运维' }),
  );
  await userEvent.click(
    await screen.findByRole('button', { name: 'Session 管理' }),
  );
  await userEvent.click(
    await screen.findByRole('button', { name: '退出当前会话' }),
  );
  await userEvent.click(screen.getByRole('button', { name: '确认撤销' }));
  await screen.findByRole('heading', { name: '管理员登录' });
  expect(
    screen.queryByRole('heading', { name: '迁移与运维' }),
  ).not.toBeInTheDocument();
  await act(async () => {
    rejectDelete(new TypeError('connection lost'));
  });
  await screen.findByText(/撤销结果未知，界面已清空/);
  expect(
    fetchMock.mock.calls.filter(
      ([r]) => new URL(r.url).pathname === '/api/v1/auth/session',
    ),
  ).toHaveLength(1);
});
