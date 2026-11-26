import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountDetail, SessionResponse } from '@/api/generated';
import { AccountsPage } from '@/features/accounts/accounts-page';
import { ActiveSessionsCard } from '@/features/settings/active-sessions-card';
import { mapApiSessionToRow } from '@/features/settings/mock-fixtures';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const makeSession = (): SessionResponse => ({
  state: 'authenticated',
  server_time: new Date().toISOString(),
  csrf_token: 'csrf-wave1-token',
  expires_at: new Date(Date.now() + 43_200_000).toISOString(),
  idle_expires_at: new Date(Date.now() + 900_000).toISOString(),
  idle_timeout_seconds: 900,
  reauthenticated_until: null,
});

const deletedAccount = (n: number): AccountDetail => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  account_no: `GM-00000${n}`,
  gmail_email: `deleted${n}@gmail.com`,
  registered_at: '2026-11-01T00:00:00Z',
  recovery_account_id: null,
  recovery_email_external: 'hub@example.test',
  recovery_email: 'hub@example.test',
  status: 'normal',
  two_factor_status: 'enabled',
  purpose: '测试',
  tags: [],
  last_login_at: null,
  last_verified_at: null,
  password_changed_at: null,
  archived_at: null,
  deleted_at: '2026-11-10T00:00:00Z',
  row_version: 2,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-10T00:00:00Z',
  phone: null,
  notes: null,
});

function mount(child: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{child}</QueryClientProvider>,
  );
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Wave 1 P1 前端功能验证', () => {
  it('回收站支持多选并调用 POST /api/v1/accounts/batch-restore 原子恢复', async () => {
    const rows = [deletedAccount(1), deletedAccount(2)];
    let restoredBody: unknown = null;
    const fetchMock = vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      if (
        req.method === 'POST' &&
        url.pathname === '/api/v1/accounts/batch-restore'
      ) {
        restoredBody = await req.json();
        return json({ updated_ids: rows.map((r) => r.id) });
      }
      if (url.pathname.endsWith('/tags')) return json([]);
      if (url.pathname.endsWith('/summary')) {
        return json({
          total: 0,
          normal: 0,
          pending_verification: 0,
          abnormal: 0,
          added_this_month: 0,
          unverified_over_30_days: 0,
          deleted_count: restoredBody ? 0 : 2,
          timezone: 'UTC',
          month_from: '2026-11-01T00:00:00Z',
          month_to: '2026-12-01T00:00:00Z',
        });
      }
      return json({
        max_page_size: 100,
        items: restoredBody ? [] : rows,
        total: restoredBody ? 0 : 2,
        page: 1,
        page_size: 30,
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    window.history.replaceState(null, '', '/?deleted=true');

    mount(
      <AccountsPage
        session={makeSession()}
        onSession={vi.fn()}
        onFailure={vi.fn()}
        onSecurity={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    const selectAll = await screen.findByLabelText('选择当前页全部账号');
    expect(selectAll).not.toBeDisabled();
    await userEvent.click(selectAll);

    const restoreBtn = screen.getByRole('button', { name: '批量恢复所选账号' });
    await userEvent.click(restoreBtn);
    await userEvent.click(screen.getByRole('button', { name: '确认整批恢复' }));

    await waitFor(() => expect(restoredBody).not.toBeNull());
    expect(restoredBody).toEqual({
      accounts: [
        { id: rows[0].id, row_version: 2 },
        { id: rows[1].id, row_version: 2 },
      ],
    });
    expect(await screen.findByText('整批账号已恢复。')).toBeInTheDocument();
  });

  it('辅助邮箱独立统计视图支持搜索、排序与关联账号快速预览', async () => {
    const fetchMock = vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      if (url.pathname.endsWith('/tags')) return json([]);
      if (url.pathname.endsWith('/summary')) {
        return json({
          total: 4,
          normal: 3,
          pending_verification: 0,
          abnormal: 1,
          added_this_month: 2,
          unverified_over_30_days: 0,
          deleted_count: 0,
          timezone: 'UTC',
          month_from: '2026-11-01T00:00:00Z',
          month_to: '2026-12-01T00:00:00Z',
        });
      }
      if (url.pathname === '/api/v1/recovery-emails') {
        return json({
          items: [
            {
              email: 'hub@example.test',
              account_count: 4,
              normal_count: 3,
              abnormal_count: 1,
              latest_registered_at: '2026-11-05T00:00:00Z',
            },
          ],
          total: 1,
          total_accounts: 4,
          abnormal_recovery_emails: 1,
          page: 1,
          page_size: 30,
        });
      }
      if (url.pathname.startsWith('/api/v1/recovery-emails/')) {
        return json({
          max_page_size: 100,
          items: [{ ...deletedAccount(1), deleted_at: null }],
          total: 1,
          page: 1,
          page_size: 20,
        });
      }
      return json({
        max_page_size: 100,
        items: [],
        total: 0,
        page: 1,
        page_size: 30,
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    mount(
      <AccountsPage
        initialRecoveryView
        session={makeSession()}
        onSession={vi.fn()}
        onFailure={vi.fn()}
        onSecurity={vi.fn()}
        onLogout={vi.fn()}
      />,
    );

    expect(await screen.findByText('hub@example.test')).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', {
        name: '快速预览 hub@example.test 关联账号',
      }),
    );
    expect(await screen.findByText('deleted1@gmail.com')).toBeInTheDocument();
  });

  it('Session 卡片展示服务端解析的真实设备/浏览器标签并支持仅看活跃筛选', async () => {
    const active = mapApiSessionToRow({
      id: 'sess-1',
      current: true,
      state: 'valid',
      auth_level: 'authenticated',
      created_at: '2026-11-20T08:00:00Z',
      last_seen_at: '2026-11-20T08:05:00Z',
      expires_at: '2026-11-20T20:00:00Z',
      idle_expires_at: '2026-11-20T08:20:00Z',
      revoked_at: null,
      ip_address: '192.0.2.10',
      device_label: 'macOS · Safari',
      browser: 'Safari',
      os: 'macOS',
      device_type: 'desktop',
      mfa_reauthenticated: true,
    });
    const revoked = mapApiSessionToRow({
      id: 'sess-2',
      current: false,
      state: 'revoked',
      auth_level: 'authenticated',
      created_at: '2026-11-19T08:00:00Z',
      last_seen_at: '2026-11-19T08:05:00Z',
      expires_at: '2026-11-19T20:00:00Z',
      idle_expires_at: '2026-11-19T08:20:00Z',
      revoked_at: '2026-11-19T09:00:00Z',
      ip_address: '192.0.2.99',
      device_label: 'iOS · Chrome（移动端）',
      browser: 'Chrome',
      os: 'iOS',
      device_type: 'mobile',
      mfa_reauthenticated: false,
    });

    render(
      <ActiveSessionsCard
        sessions={[active, revoked]}
        onTerminateSession={vi.fn()}
        onLogoutOtherSessions={vi.fn()}
      />,
    );

    expect(screen.getByText('macOS · Safari')).toBeInTheDocument();
    expect(screen.getByText('iOS · Chrome（移动端）')).toBeInTheDocument();
    expect(screen.getByText('Step-Up')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '仅活跃' }));
    expect(screen.getByText('macOS · Safari')).toBeInTheDocument();
    expect(
      screen.queryByText('iOS · Chrome（移动端）'),
    ).not.toBeInTheDocument();
  });
});
