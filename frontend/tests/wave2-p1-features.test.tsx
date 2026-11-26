import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@/api/generated';
import { AccountsChartView } from '@/features/accounts/accounts-chart-view';
import { ExportPanel } from '@/features/operations/csv-export-panel';

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const makeSession = (
  overrides: Partial<SessionResponse> = {},
): SessionResponse => ({
  state: 'authenticated',
  server_time: new Date().toISOString(),
  csrf_token: 'csrf-wave2-01',
  expires_at: new Date(Date.now() + 43_200_000).toISOString(),
  idle_expires_at: new Date(Date.now() + 900_000).toISOString(),
  idle_timeout_seconds: 900,
  reauthenticated_until: null,
  mfa_reauthenticated_until: null,
  step_up_totp_required: true,
  ...overrides,
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Wave 2 P1 前端功能验证', () => {
  it('流式加密导出先完成密码+TOTP Step-Up 轮换 CSRF 再请求 /exports/encrypted 并清空表单口令', async () => {
    const calls: { url: string; csrf: string | null }[] = [];
    const onSession = vi.fn();
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});
    const createObjSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:mock-gmenc');
    const revokeObjSpy = vi
      .spyOn(URL, 'revokeObjectURL')
      .mockImplementation(() => {});

    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        const url = new URL(req.url);
        calls.push({
          url: url.pathname,
          csrf: req.headers.get('x-csrf-token'),
        });
        if (url.pathname === '/api/v1/auth/reverify') {
          return json(
            makeSession({
              csrf_token: 'csrf-wave2-rotated',
              reauthenticated_until: new Date(
                Date.now() + 300_000,
              ).toISOString(),
              mfa_reauthenticated_until: new Date(
                Date.now() + 300_000,
              ).toISOString(),
            }),
          );
        }
        if (url.pathname === '/api/v1/exports/encrypted') {
          return new Response(new Uint8Array([0x47, 0x4d, 0x45, 0x31]), {
            status: 200,
            headers: {
              'content-type': 'application/octet-stream',
              'content-disposition':
                'attachment; filename="gmail-accounts-encrypted-2026.gmenc"',
            },
          });
        }
        return json({}, 404);
      }),
    );

    render(
      <ExportPanel
        session={makeSession()}
        onSession={onSession}
        onFailure={vi.fn()}
        onBack={vi.fn()}
        onSecurity={vi.fn()}
        onRefreshSession={vi.fn()}
        onSignedOut={vi.fn()}
      />,
    );

    const pwdInput = screen.getByLabelText('当前管理员密码（Step-Up）');
    const totpInput = screen.getByLabelText('6 位 TOTP 验证码');
    const exportPass = screen.getByLabelText(
      '导出文件独立加密口令（至少 16 位）',
    );
    const exportConfirm = screen.getByLabelText('确认导出加密口令');

    await userEvent.type(pwdInput, 'AdminSecretPass#2026!');
    await userEvent.type(totpInput, '123456');
    await userEvent.type(exportPass, 'ocean velvet lantern compass 2026!');
    await userEvent.type(exportConfirm, 'ocean velvet lantern compass 2026!');

    await userEvent.click(
      screen.getByRole('button', { name: '下载加密完整导出（.gmenc）' }),
    );

    await waitFor(() => expect(calls.length).toBe(2));
    expect(calls[0]).toEqual({
      url: '/api/v1/auth/reverify',
      csrf: 'csrf-wave2-01',
    });
    expect(calls[1]).toEqual({
      url: '/api/v1/exports/encrypted',
      csrf: 'csrf-wave2-rotated',
    });
    expect(onSession).toHaveBeenCalledTimes(1);
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(createObjSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjSpy).toHaveBeenCalledTimes(1);
    // 口令输入框已在提交后立即清空
    expect((exportPass as HTMLInputElement).value).toBe('');
    expect((pwdInput as HTMLInputElement).value).toBe('');
    expect(await screen.findByText(/decrypt-export/)).toBeInTheDocument();
  });

  it('图表视图接入全局聚合接口展示注册趋势、状态分布、2FA 覆盖率与辅助邮箱集中度', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (req: Request) => {
        const url = new URL(req.url);
        if (url.pathname === '/api/v1/dashboard/registration-trend') {
          return json({
            timezone: 'Asia/Shanghai',
            months: 12,
            items: [
              { month: '2026-10', count: 2, cumulative: 5 },
              { month: '2026-11', count: 3, cumulative: 8 },
            ],
          });
        }
        if (url.pathname === '/api/v1/dashboard/status-distribution') {
          return json({
            total: 8,
            statuses: [
              { status: 'normal', count: 5 },
              { status: 'pending_verification', count: 1 },
              { status: 'restricted', count: 1 },
              { status: 'login_failed', count: 0 },
              { status: 'disabled', count: 0 },
              { status: 'archived', count: 1 },
            ],
            two_factor: [
              { two_factor_status: 'enabled', count: 6 },
              { two_factor_status: 'disabled', count: 1 },
              { two_factor_status: 'unknown', count: 1 },
            ],
            top_tags: [{ id: 't1', name: '主力生产', count: 5 }],
          });
        }
        if (url.pathname === '/api/v1/dashboard/recovery-email-usage') {
          return json({
            total_accounts: 8,
            total_recovery_emails: 2,
            items: [
              {
                email: 'primary-hub@example.test',
                account_count: 6,
                normal_count: 5,
                abnormal_count: 1,
                latest_registered_at: '2026-11-10T00:00:00Z',
              },
            ],
            others_count: 2,
          });
        }
        return json({}, 404);
      }),
    );

    mount(
      <AccountsChartView
        liveAnalytics
        timezone="Asia/Shanghai"
        stats={{
          all: 8,
          normal: 5,
          addedThisMonth: 3,
          risk: 1,
          disabled: 0,
          archived: 1,
        }}
        items={[]}
      />,
    );

    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.getByText('主力生产 · 5')).toBeInTheDocument();
    expect(screen.getByText('primary-hub@example.test')).toBeInTheDocument();
    expect(
      screen.getByText('其余辅助邮箱共关联 2 个账号。'),
    ).toBeInTheDocument();
  });
});
