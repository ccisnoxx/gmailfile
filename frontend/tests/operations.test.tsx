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
import { OperationsPage } from '@/features/operations/operations-page';
import type { SessionResponse, CsvPreview } from '@/api/generated';
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
const session: SessionResponse = {
  state: 'authenticated',
  csrf_token: 'synthetic-csrf',
  idle_timeout_seconds: 900,
  server_time: new Date().toISOString(),
  expires_at: new Date(Date.now() + 43200000).toISOString(),
  idle_expires_at: new Date(Date.now() + 900000).toISOString(),
  reauthenticated_until: null,
};
const preview: CsvPreview = {
  receipt_id: crypto.randomUUID(),
  expires_at: new Date(Date.now() + 600000).toISOString(),
  mapping: { gmail_email: 0, password: 1, recovery_email: 2 },
  strategy: 'skip',
  columns: [
    { index: 0, suggested_field: 'gmail_email' },
    { index: 1, suggested_field: 'password' },
    { index: 2, suggested_field: 'recovery_email' },
  ],
  rows: [{ row: 2, action: 'create' }],
  errors: [],
};
function setup(handler?: (req: Request) => Promise<Response>) {
  const onFailure = vi.fn(),
    onSignedOut = vi.fn(),
    onRefreshSession = vi.fn();
  const fetch = vi.fn(async (req: Request) => {
    const path = new URL(req.url).pathname;
    if (path === '/api/v1/system/version')
      return json({ version: '0.1.0', schema_version: '0003' });
    if (path === '/api/v1/system/backup-status')
      return json({
        state: 'unconfigured',
        offsite: 'unconfigured',
        last_attempt_at: null,
        last_success_at: null,
      });
    if (path === '/api/v1/settings') return json({ idle_minutes: 15 });
    return handler ? handler(req) : json({});
  });
  vi.stubGlobal('fetch', fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rendered = render(
    <QueryClientProvider client={client}>
      <OperationsPage
        session={session}
        onBack={vi.fn()}
        onSecurity={vi.fn()}
        onFailure={onFailure}
        onSignedOut={onSignedOut}
        onRefreshSession={onRefreshSession}
      />
    </QueryClientProvider>,
  );
  return {
    ...rendered,
    fetch,
    client,
    onFailure,
    onSignedOut,
    onRefreshSession,
  };
}
async function upload() {
  await userEvent.click(screen.getByRole('button', { name: 'CSV 导入' }));
  await userEvent.upload(
    screen.getByLabelText('CSV 文件'),
    new File(
      [
        'gmail_email,password,recovery_email\na@example.test,private-synthetic,b@example.test',
      ],
      'synthetic.csv',
      { type: 'text/csv' },
    ),
  );
  await userEvent.click(screen.getByRole('button', { name: '上传并预览' }));
  await screen.findByText('字段映射');
}
afterEach(() => {
  vi.unstubAllGlobals();
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  window.history.replaceState(null, '', '/');
});
it('shows real unconfigured status without fabricated success and saves idle with CSRF', async () => {
  const env = setup(async (req) => {
    expect(req.headers.get('X-CSRF-Token')).toBe(session.csrf_token);
    return json({ idle_minutes: 5 });
  });
  await screen.findAllByText('未配置');
  const input = screen.getByLabelText('自动锁定时间（分钟）');
  fireEvent.change(input, { target: { value: '5' } });
  await userEvent.click(screen.getByRole('button', { name: '保存' }));
  await waitFor(() => expect(env.onRefreshSession).toHaveBeenCalledTimes(1));
});
it('binds preview file and confirmation; import payload never enters Query cache', async () => {
  const env = setup(async (req) =>
    new URL(req.url).pathname.endsWith('preview')
      ? json(preview)
      : json({
          status: 'committed',
          created: 1,
          updated: 0,
          skipped: 0,
          errors: [],
        }),
  );
  await upload();
  expect(screen.queryByText('private-synthetic')).not.toBeInTheDocument();
  const confirm = screen.getByRole('button', { name: '确认提交整批导入' });
  expect(confirm).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(confirm);
  await screen.findByText('已提交：新增 1，更新 0，跳过 0。');
  const call = env.fetch.mock.calls.find(([r]) =>
    new URL(r.url).pathname.endsWith('/commit'),
  )![0];
  expect(new URL(call.url).searchParams.get('receipt_id')).toBe(
    preview.receipt_id,
  );
  expect(call.headers.get('X-CSRF-Token')).toBe(session.csrf_token);
  expect(
    JSON.stringify(env.client.getQueryData(['operations-status'])),
  ).not.toContain('private-synthetic');
  expect(env.client.getMutationCache().getAll()).toHaveLength(0);
});
it('changing mapping invalidates confirmation until previewed again', async () => {
  setup(async () => json(preview));
  await upload();
  await userEvent.selectOptions(
    screen.getByLabelText('映射密码（不预览）'),
    '',
  );
  expect(
    screen.queryByRole('button', { name: '确认提交整批导入' }),
  ).not.toBeInTheDocument();
});
it('clears file on hidden state and discards a late preview', async () => {
  let resolve!: (v: Response) => void;
  setup(
    async () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'CSV 导入' }));
  await userEvent.upload(
    screen.getByLabelText('CSV 文件'),
    new File(['a,b\na,b'], 'synthetic.csv', { type: 'text/csv' }),
  );
  await userEvent.click(screen.getByRole('button', { name: '上传并预览' }));
  await act(async () => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    resolve(json(preview));
  });
  expect(screen.queryByText('字段映射')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '上传并预览' })).toBeDisabled();
  expect(localStorage.length + sessionStorage.length).toBe(0);
});
it('leaving import discards preview and late commit cannot contaminate another tab', async () => {
  let resolve!: (r: Response) => void;
  setup(async (req) =>
    new URL(req.url).pathname.endsWith('preview')
      ? json(preview)
      : new Promise((r) => {
          resolve = r;
        }),
  );
  await upload();
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(
    screen.getByRole('button', { name: '确认提交整批导入' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'CSV 导出' }));
  await act(async () => {
    resolve(json({ status: 'committed', created: 1, updated: 0, skipped: 0 }));
  });
  expect(
    screen.queryByText('已提交：新增 1，更新 0，跳过 0。'),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'CSV 导入' }));
  expect(screen.getByRole('button', { name: '上传并预览' })).toBeDisabled();
});
it('unknown commit result is not retried or described as rollback', async () => {
  const env = setup(async (req) => {
    if (new URL(req.url).pathname.endsWith('preview')) return json(preview);
    throw new TypeError('connection lost');
  });
  await upload();
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(
    screen.getByRole('button', { name: '确认提交整批导入' }),
  );
  await screen.findByText(/结果未知/);
  expect(screen.queryByText(/整批未提交/)).not.toBeInTheDocument();
  expect(
    env.fetch.mock.calls.filter(([r]) => r.url.includes('/commit')),
  ).toHaveLength(1);
  expect(
    screen.queryByRole('button', { name: '确认提交整批导入' }),
  ).not.toBeInTheDocument();
});
it('renders safe row errors returned by commit conflict', async () => {
  setup(async (req) =>
    new URL(req.url).pathname.endsWith('preview')
      ? json(preview)
      : json(
          {
            status: 'rejected',
            created: 0,
            updated: 0,
            skipped: 0,
            errors: [
              { row: 2, field: 'row_version', reason: '预览后记录已变化' },
            ],
          },
          409,
        ),
  );
  await upload();
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(
    screen.getByRole('button', { name: '确认提交整批导入' }),
  );
  await screen.findByText('第 2 行 · row_version：预览后记录已变化');
});
it('revokes current session with explicit confirmation and clears caller state', async () => {
  const id = crypto.randomUUID();
  const env = setup(async (req) =>
    req.method === 'GET'
      ? json({
          items: [
            {
              id,
              current: true,
              state: 'valid',
              auth_level: 'authenticated',
              last_seen_at: session.server_time,
              created_at: session.server_time,
              expires_at: session.expires_at,
              idle_expires_at: session.idle_expires_at,
              revoked_at: null,
              ip_address: null,
            },
          ],
          total: 1,
          page: 1,
          page_size: 10,
        })
      : json({ status: 'ok' }),
  );
  await userEvent.click(screen.getByRole('button', { name: 'Session 管理' }));
  await userEvent.click(
    await screen.findByRole('button', { name: '退出当前会话' }),
  );
  await userEvent.click(screen.getByRole('button', { name: '确认撤销' }));
  await waitFor(() => expect(env.onSignedOut).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(env.fetch.mock.calls.some(([r]) => r.method === 'DELETE')).toBe(
      true,
    ),
  );
  const call = env.fetch.mock.calls.find(([r]) => r.method === 'DELETE')![0];
  expect(call.headers.get('X-CSRF-Token')).toBe(session.csrf_token);
});
