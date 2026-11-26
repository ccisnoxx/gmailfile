import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@/api/generated';
import { AuthPage } from '@/features/auth/auth-page';
import { PasswordControl } from '@/features/accounts/password-control';
import { ExportPanel } from '@/features/operations/csv-export-panel';
import { SettingsPage } from '@/features/settings/settings-page';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const makeSession = (
  overrides: Partial<SessionResponse> = {},
): SessionResponse => ({
  state: 'authenticated',
  idle_timeout_seconds: 900,
  server_time: new Date().toISOString(),
  csrf_token: 'csrf-w4-001',
  expires_at: new Date(Date.now() + 43_200_000).toISOString(),
  idle_expires_at: new Date(Date.now() + 900_000).toISOString(),
  reauthenticated_until: null,
  mfa_reauthenticated_until: null,
  step_up_totp_required: true,
  totp_enabled: true,
  webauthn_enabled: true,
  webauthn_count: 1,
  can_passwordless_login: true,
  ...overrides,
});

function stubWebAuthnApis() {
  const bytes = (text: string) => new TextEncoder().encode(text).buffer;
  const create = vi.fn(async () => ({
    id: 'cred-id-b64url',
    rawId: bytes('cred-raw'),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: bytes('client-data'),
      attestationObject: bytes('attestation'),
      getTransports: () => ['internal', 'hybrid'],
    },
  }));
  const get = vi.fn(async () => ({
    id: 'cred-id-b64url',
    rawId: bytes('cred-raw'),
    type: 'public-key',
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: bytes('client-data'),
      authenticatorData: bytes('auth-data'),
      signature: bytes('sig-bytes'),
      userHandle: bytes('user-handle'),
    },
  }));

  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    value: function PublicKeyCredential() {},
  });
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: { create, get },
  });
  return { create, get };
}

function renderWithQuery(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Wave 4 P1 #9: WebAuthn / Passkey 前端全链路', () => {
  it('支持匿名页一键无密码 Passkey 登录', async () => {
    const user = userEvent.setup();
    const { get } = stubWebAuthnApis();
    let authed = false;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const req = input instanceof Request ? input : new Request(String(input));
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/v1/auth/session') {
        return json(
          makeSession({
            state: authed ? 'authenticated' : 'anonymous',
            can_passwordless_login: true,
          }),
        );
      }
      if (url.pathname === '/api/v1/auth/webauthn/login/options') {
        return json({
          challenge_id: 'ch-login-1',
          options: {
            challenge: 'YWJjZGVm',
            rpId: 'localhost',
            allowCredentials: [{ id: 'Y3JlZC1yYXc', type: 'public-key' }],
            userVerification: 'required',
          },
          expires_at: new Date(Date.now() + 300_000).toISOString(),
        });
      }
      if (url.pathname === '/api/v1/auth/webauthn/login/verify') {
        authed = true;
        return json(
          makeSession({ state: 'authenticated', csrf_token: 'csrf-w4-002' }),
        );
      }
      return json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(<AuthPage initialView="security" />);

    const passkeyBtn = await screen.findByRole('button', {
      name: /使用通行密钥（Passkey）登录/,
    });
    await user.click(passkeyBtn);

    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(1);
      expect(screen.getByText('已通过二步验证')).toBeInTheDocument();
    });
  });

  it('支持 mfa_pending 阶段直接绑定首个 Passkey 并展示 10 个离线恢复码', async () => {
    const user = userEvent.setup();
    const { create } = stubWebAuthnApis();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const req = input instanceof Request ? input : new Request(String(input));
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/v1/auth/session') {
        return json(
          makeSession({
            state: 'mfa_pending',
            totp_enabled: false,
            webauthn_enabled: false,
            webauthn_count: 0,
            can_passwordless_login: false,
          }),
        );
      }
      if (url.pathname === '/api/v1/auth/webauthn/register/options') {
        return json({
          challenge_id: 'ch-reg-1',
          options: {
            challenge: 'YWJjZGVm',
            rp: { name: 'Gmail Manager', id: 'localhost' },
            user: {
              id: 'dXNlci0x',
              name: 'Administrator',
              displayName: 'Administrator',
            },
            pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
            excludeCredentials: [],
          },
          expires_at: new Date(Date.now() + 300_000).toISOString(),
        });
      }
      if (url.pathname === '/api/v1/auth/webauthn/register/verify') {
        return json({
          credential: {
            id: 'cred-uuid-1',
            label: 'MacBook Touch ID',
            transports: ['internal', 'hybrid'],
            discoverable: true,
            backup_eligible: true,
            backup_state: true,
            created_at: new Date().toISOString(),
            last_used_at: null,
          },
          session: makeSession({
            state: 'authenticated',
            totp_enabled: false,
            webauthn_enabled: true,
            webauthn_count: 1,
          }),
          recovery_codes: Array.from(
            { length: 10 },
            (_, idx) => `RC-${idx + 1}-ABCD`,
          ),
        });
      }
      return json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(<AuthPage initialView="security" />);

    const labelInput = await screen.findByLabelText('通行密钥设备名称');
    await user.clear(labelInput);
    await user.type(labelInput, 'MacBook Touch ID');
    await user.click(
      screen.getByRole('button', { name: /绑定通行密钥（Passkey）/ }),
    );

    await waitFor(() => {
      expect(create).toHaveBeenCalledTimes(1);
      expect(screen.getByText('保存你的恢复码')).toBeInTheDocument();
      expect(screen.getByText('RC-1-ABCD')).toBeInTheDocument();
    });
  });

  it('PasswordControl 与 ExportPanel 支持通行密钥 UV Step-Up 验证', async () => {
    const user = userEvent.setup();
    const { get } = stubWebAuthnApis();
    const onSession = vi.fn();

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const req = input instanceof Request ? input : new Request(String(input));
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.endsWith('/reveal-password')) {
        return json(
          { error: { code: 'REAUTH_REQUIRED', message: '需要二次验证' } },
          403,
        );
      }
      if (url.pathname === '/api/v1/auth/webauthn/step-up/options') {
        return json({
          challenge_id: 'ch-su-1',
          options: {
            challenge: 'YWJjZGVm',
            rpId: 'localhost',
            allowCredentials: [{ id: 'Y3JlZC1yYXc', type: 'public-key' }],
            userVerification: 'required',
          },
          expires_at: new Date(Date.now() + 300_000).toISOString(),
        });
      }
      if (url.pathname === '/api/v1/auth/webauthn/step-up/verify') {
        const until = new Date(Date.now() + 300_000).toISOString();
        return json(
          makeSession({
            csrf_token: 'csrf-w4-su',
            reauthenticated_until: until,
            mfa_reauthenticated_until: until,
            totp_enabled: false,
            webauthn_enabled: true,
          }),
        );
      }
      return json({ error: { code: 'NOT_FOUND', message: 'not found' } }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    const baseSession = makeSession({
      totp_enabled: false,
      webauthn_enabled: true,
      reauthenticated_until: null,
      mfa_reauthenticated_until: null,
    });

    const { unmount } = renderWithQuery(
      <PasswordControl
        accountId="acc-1"
        session={baseSession}
        onSession={onSession}
        onFailure={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: '显示密码' }));
    const suBtn = await screen.findByRole('button', {
      name: /使用通行密钥（Passkey）验证/,
    });
    await user.click(suBtn);
    await waitFor(() => {
      expect(get).toHaveBeenCalledTimes(1);
      expect(onSession).toHaveBeenCalled();
    });
    unmount();

    // ExportPanel 在 TOTP 停用时仅需 Passkey Step-Up 即可解锁
    renderWithQuery(
      <ExportPanel
        session={baseSession}
        onBack={vi.fn()}
        onSecurity={vi.fn()}
        onSession={onSession}
        onFailure={vi.fn()}
        onRefreshSession={vi.fn()}
        onSignedOut={vi.fn()}
      />,
    );
    const exportSuBtn = screen.getByRole('button', {
      name: /使用通行密钥（Passkey）完成 Step-Up/,
    });
    await user.click(exportSuBtn);
    await waitFor(() => {
      expect(screen.getByText('MFA Step-Up 有效')).toBeInTheDocument();
    });
  });

  it('系统设置页支持管理 Passkey（绑定、重命名、停用 TOTP 与最后因子保护）', async () => {
    const user = userEvent.setup();
    stubWebAuthnApis();

    renderWithQuery(<SettingsPage mode="mock" initialSection="security" />);

    const passkeyHeading = screen.getByRole('heading', {
      name: '通行密钥（WebAuthn / Passkey）',
    });
    expect(passkeyHeading).toBeInTheDocument();
    expect(screen.getByText('MacBook Pro Touch ID')).toBeInTheDocument();

    // 1. 重命名通行密钥
    await user.click(
      screen.getByRole('button', { name: '重命名 MacBook Pro Touch ID' }),
    );
    const renameInput = screen.getByLabelText('修改通行密钥名称');
    await user.clear(renameInput);
    await user.type(renameInput, '主力工作站 Touch ID');
    await user.click(screen.getByRole('button', { name: '保存密钥名称' }));
    await waitFor(() => {
      const credList = screen.getByRole('list', {
        name: '已绑定的通行密钥列表',
      });
      expect(
        within(credList).getByText('主力工作站 Touch ID'),
      ).toBeInTheDocument();
    });

    // 2. 已有 1 个 Passkey 时，TOTP 卡片显示“停用 TOTP…”并允许通过 Passkey 验证完成停用
    await user.click(screen.getByRole('button', { name: '停用 TOTP…' }));
    const dialog = await screen.findByRole('dialog', {
      name: '停用 TOTP 验证器？',
    });
    await user.click(
      within(dialog).getByRole('button', {
        name: /使用通行密钥（Passkey）完成二次验证/,
      }),
    );
    await user.click(
      within(dialog).getByRole('button', { name: '确认停用 TOTP' }),
    );

    // 3. TOTP 停用后，唯一的通行密钥删除按钮自动禁用（LAST_MFA_FACTOR 保护）
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: '删除 主力工作站 Touch ID' }),
      ).toBeDisabled();
    });
  });
});
