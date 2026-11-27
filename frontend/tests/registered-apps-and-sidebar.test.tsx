import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as generatedApi from '@/api/generated';
import { PrimarySidebar } from '@/components/macos';
import { AccountActionDialog } from '@/features/accounts/account-action-dialog';
import { AccountAppPill } from '@/features/accounts/account-app-pill';
import { AccountAppsEditor } from '@/features/accounts/account-apps-editor';
import { AccountForm } from '@/features/accounts/account-form';
import { BatchBar } from '@/features/accounts/account-batch-bar';
import { AppBrandIcon } from '@/features/accounts/app-brand-icon';
import { SensitiveFieldsControl } from '@/features/accounts/sensitive-fields-control';
import { AuthShell } from '@/features/auth/auth-shell';
import type {
  AccountAppInput,
  AccountDetail,
  AccountSummary,
  RegisteredAppResponse,
  SessionResponse,
} from '@/api/generated';
import { useState } from 'react';

const sampleApps: RegisteredAppResponse[] = [
  {
    id: 'app-claude',
    name: 'Claude',
    domain: 'claude.ai',
    icon_data: null,
    sort_order: 10,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'app-chatgpt',
    name: 'ChatGPT',
    domain: 'chatgpt.com',
    icon_data: null,
    sort_order: 20,
    created_at: '2026-01-01T00:00:00Z',
  },
];

describe('统一可展开侧边栏与第三方已注册应用交互', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('全部账号默认收起子状态，展开后显示正常/待验证/风险/停用/已归档，且与已注册应用、辅助邮箱统计同级', async () => {
    const user = userEvent.setup();
    const onSelectSection = vi.fn();
    const onOpenApps = vi.fn();
    const onOpenRecovery = vi.fn();

    render(
      <PrimarySidebar
        activeSection="all"
        counts={{
          all: 20,
          normal: 12,
          pending: 3,
          risk: 2,
          disabled: 1,
          archived: 2,
          trash: 1,
        }}
        tags={[{ id: 't1', name: '主力', count: 5 }]}
        onSelectSection={onSelectSection}
        onSelectTag={vi.fn()}
        onAddTag={vi.fn()}
        onOpenDashboard={vi.fn()}
        onOpenApps={onOpenApps}
        onOpenRecoveryUsage={onOpenRecovery}
        onOpenTransfer={vi.fn()}
        onOpenAudit={vi.fn()}
        onOpenBackup={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const sidebar = screen.getByLabelText('侧边导航栏');
    const coreNav = screen.getByRole('navigation', { name: '核心资产导航' });
    const allBtn = within(coreNav).getByRole('button', { name: /全部账号/ });
    const chevronBtn = within(coreNav).getByRole('button', {
      name: '展开账号状态分组',
    });
    expect(allBtn).toBeInTheDocument();
    // 展开箭头必须位于「全部账号」右侧（DOM 顺序在主按钮之后）
    expect(
      allBtn.compareDocumentPosition(chevronBtn) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(sidebar).getByText('关系')).toBeInTheDocument();
    expect(
      within(sidebar).getByRole('button', { name: '已注册应用' }),
    ).toBeInTheDocument();
    expect(
      within(sidebar).getByRole('button', { name: '辅助邮箱统计' }),
    ).toBeInTheDocument();

    // 默认折叠，不展示状态子菜单
    expect(
      within(coreNav).queryByRole('group', { name: '账号状态子菜单' }),
    ).not.toBeInTheDocument();

    // 直接点击「全部账号」即可展开二级状态子菜单
    await user.click(allBtn);
    const subGroup = within(coreNav).getByRole('group', {
      name: '账号状态子菜单',
    });
    for (const label of [
      '正常账号',
      '待验证',
      '风险账号',
      '停用账号',
      '已归档',
    ]) {
      expect(within(subGroup).getByText(label)).toBeInTheDocument();
    }

    // 右侧箭头仍支持独立收起与再次展开
    await user.click(
      within(coreNav).getByRole('button', { name: '收起账号状态分组' }),
    );
    expect(
      within(coreNav).queryByRole('group', { name: '账号状态子菜单' }),
    ).not.toBeInTheDocument();
    await user.click(
      within(coreNav).getByRole('button', { name: '展开账号状态分组' }),
    );
    const reopenedSubGroup = within(coreNav).getByRole('group', {
      name: '账号状态子菜单',
    });

    await user.click(
      within(reopenedSubGroup).getByRole('button', { name: /待验证/ }),
    );
    expect(onSelectSection).toHaveBeenCalledWith('pending');

    await user.click(
      within(sidebar).getByRole('button', { name: '已注册应用' }),
    );
    expect(onOpenApps).toHaveBeenCalledTimes(1);

    await user.click(
      within(sidebar).getByRole('button', { name: '辅助邮箱统计' }),
    );
    expect(onOpenRecovery).toHaveBeenCalledTimes(1);
  });

  it('AccountAppsEditor 支持勾选应用、切换已封禁状态、填写备注及快捷新增自定义应用', async () => {
    const user = userEvent.setup();
    const onCreateApp = vi.fn(async (name: string) => ({
      id: `app-${name.toLowerCase()}`,
      name,
      sort_order: 100,
      created_at: '2026-01-01T00:00:00Z',
    }));

    function Harness() {
      const [catalog, setCatalog] =
        useState<RegisteredAppResponse[]>(sampleApps);
      const [value, setValue] = useState<AccountAppInput[]>([]);
      return (
        <AccountAppsEditor
          catalog={catalog}
          value={value}
          onChange={setValue}
          onCreateApp={async (name) => {
            const created = await onCreateApp(name);
            setCatalog((prev) => [...prev, created]);
            return created;
          }}
        />
      );
    }

    render(<Harness />);

    await user.click(screen.getByRole('button', { name: 'Claude' }));
    const claudeGroup = screen.getByRole('group', { name: 'Claude 应用状态' });
    await user.click(
      within(claudeGroup).getByRole('button', { name: '已封禁' }),
    );
    expect(
      within(claudeGroup).getByRole('button', { name: '已封禁' }),
    ).toHaveAttribute('aria-pressed', 'true');

    await user.type(screen.getByLabelText('Claude 备注'), '风控误封');
    expect(screen.getByLabelText('Claude 备注')).toHaveValue('风控误封');

    await user.type(screen.getByLabelText('自定义应用名称'), 'Perplexity');
    await user.click(screen.getByRole('button', { name: '新增并选择' }));
    expect(onCreateApp).toHaveBeenCalledWith('Perplexity');
    expect(
      await screen.findByRole('group', { name: 'Perplexity 应用状态' }),
    ).toBeInTheDocument();
  });

  it('AccountAppPill 以差异化语义区分正常与已封禁状态', () => {
    render(
      <div>
        <AccountAppPill
          app={{
            app_name: 'ChatGPT',
            status: 'active',
            note: null,
            banned_at: null,
          }}
        />
        <AccountAppPill
          app={{
            app_name: 'Claude',
            status: 'banned',
            note: '疑似代理触发',
            banned_at: '2026-10-01T00:00:00Z',
          }}
        />
      </div>,
    );

    expect(
      screen.getByText('ChatGPT').closest('[data-slot="account-app-pill"]'),
    ).toHaveAttribute('data-status', 'active');
    const bannedPill = screen
      .getByText('Claude')
      .closest('[data-slot="account-app-pill"]');
    expect(bannedPill).toHaveAttribute('data-status', 'banned');
    expect(screen.getByText('Claude')).toHaveClass('line-through');
  });

  it('AppBrandIcon 支持内置品牌矢量图标、抓取缓存图标及未知应用首字母兜底', () => {
    const sampleDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const { container } = render(
      <div>
        <AppBrandIcon name="Claude" />
        <AppBrandIcon
          name="CustomApp"
          domain="custom.example"
          iconData={sampleDataUrl}
        />
        <AppBrandIcon name="UnknownTool" />
      </div>,
    );

    const icons = container.querySelectorAll('[data-slot="app-brand-icon"]');
    expect(icons).toHaveLength(3);
    expect(icons[0]).toHaveAttribute('data-source', 'builtin');
    expect(icons[0]).toHaveAttribute('data-brand', 'claude');
    expect(icons[1]).toHaveAttribute('data-source', 'fetched');
    expect(icons[1]).toHaveAttribute('src', sampleDataUrl);
    expect(icons[2]).toHaveAttribute('data-source', 'monogram');
  });

  it('AccountAppsEditor 支持按域名抓取图标并在新增应用时携带图标数据', async () => {
    const user = userEvent.setup();
    const fetchedIcon =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const onFetchAppIcon = vi.fn(async (domain: string) => ({
      domain,
      icon_data: fetchedIcon,
    }));
    const onCreateApp = vi.fn(
      async (
        name: string,
        options?: { domain?: string | null; icon_data?: string | null },
      ) => ({
        id: 'app-custom',
        name,
        domain: options?.domain ?? null,
        icon_data: options?.icon_data ?? null,
        sort_order: 100,
        created_at: '2026-01-01T00:00:00Z',
      }),
    );

    render(
      <AccountAppsEditor
        catalog={sampleApps}
        value={[]}
        onChange={vi.fn()}
        onCreateApp={onCreateApp}
        onFetchAppIcon={onFetchAppIcon}
      />,
    );

    await user.type(screen.getByLabelText('自定义应用名称'), 'Raycast');
    await user.type(screen.getByLabelText('应用官网域名'), 'raycast.com');
    await user.click(screen.getByRole('button', { name: '获取图标' }));
    expect(onFetchAppIcon).toHaveBeenCalledWith('raycast.com');

    await user.click(screen.getByRole('button', { name: '新增并选择' }));
    expect(onCreateApp).toHaveBeenCalledWith('Raycast', {
      domain: 'raycast.com',
      icon_data: fetchedIcon,
    });
  });

  it('AccountActionDialog 在回收站永久删除时要求管理员 MFA Step-Up 后方可确认', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onSession = vi.fn();
    const detail = {
      id: 'acc-1',
      gmail_email: 'trash.demo@gmail.com',
      row_version: 2,
    } as AccountDetail;
    const unverifiedSession: SessionResponse = {
      state: 'authenticated',
      csrf_token: 'csrf-old',
      server_time: '2026-11-27T02:00:00Z',
      expires_at: '2026-11-27T14:00:00Z',
      idle_expires_at: '2026-11-27T02:15:00Z',
      idle_timeout_seconds: 900,
      reauthenticated_until: null,
      mfa_reauthenticated_until: null,
      step_up_totp_required: true,
      totp_enabled: true,
      webauthn_enabled: false,
      webauthn_count: 0,
      can_passwordless_login: false,
    };
    const verifiedSession: SessionResponse = {
      ...unverifiedSession,
      csrf_token: 'csrf-fresh',
      reauthenticated_until: '2026-11-27T02:05:00Z',
      mfa_reauthenticated_until: '2026-11-27T02:05:00Z',
    };
    const reverifySpy = vi
      .spyOn(generatedApi, 'authReverify')
      .mockResolvedValue({ data: verifiedSession } as never);

    try {
      render(
        <AccountActionDialog
          confirm="permanent-delete"
          detail={detail}
          session={unverifiedSession}
          busy={false}
          conflict={false}
          notice=""
          onClose={vi.fn()}
          onSession={onSession}
          onConfirm={onConfirm}
        />,
      );

      expect(screen.getByText('确认永久删除账号？')).toBeInTheDocument();
      expect(screen.getByText(/将彻底清除该账号密码/)).toBeInTheDocument();

      const confirmBtn = screen.getByRole('button', { name: '确认永久删除' });
      expect(confirmBtn).toBeDisabled();

      await user.type(
        screen.getByLabelText('当前管理员密码'),
        'correct-horse-battery',
      );
      await user.type(screen.getByLabelText('TOTP 验证码（6 位）'), '123456');
      await user.click(
        screen.getByRole('button', { name: '完成管理员二次验证' }),
      );

      expect(reverifySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { password: 'correct-horse-battery', totp_code: '123456' },
          headers: { 'X-CSRF-Token': 'csrf-old' },
        }),
      );
      expect(onSession).toHaveBeenCalledWith(verifiedSession);
      expect(confirmBtn).toBeEnabled();

      await user.click(confirmBtn);
      expect(onConfirm).toHaveBeenCalledWith('permanent-delete');
    } finally {
      reverifySpy.mockRestore();
    }
  });

  it('BatchBar 批量永久删除同时要求 MFA Step-Up 与准确确认短语 DELETE <条数>', async () => {
    const user = userEvent.setup();
    const complete = vi.fn(async () => {});
    const onSession = vi.fn();
    const selected = [
      { id: 'acc-1', account_no: 'GM-001', row_version: 2 },
      { id: 'acc-2', account_no: 'GM-002', row_version: 4 },
    ] as AccountSummary[];
    const unverifiedSession: SessionResponse = {
      state: 'authenticated',
      csrf_token: 'csrf-batch-old',
      server_time: '2026-11-27T02:00:00Z',
      expires_at: '2026-11-27T14:00:00Z',
      idle_expires_at: '2026-11-27T02:15:00Z',
      idle_timeout_seconds: 900,
      reauthenticated_until: null,
      mfa_reauthenticated_until: null,
      step_up_totp_required: true,
      totp_enabled: true,
      webauthn_enabled: false,
      webauthn_count: 0,
      can_passwordless_login: false,
    };
    const verifiedSession: SessionResponse = {
      ...unverifiedSession,
      csrf_token: 'csrf-batch-fresh',
      reauthenticated_until: '2026-11-27T02:05:00Z',
      mfa_reauthenticated_until: '2026-11-27T02:05:00Z',
    };
    const reverifySpy = vi
      .spyOn(generatedApi, 'authReverify')
      .mockResolvedValue({ data: verifiedSession } as never);
    const batchDeleteSpy = vi
      .spyOn(generatedApi, 'accountsBatchPermanentDelete')
      .mockResolvedValue({
        data: { updated_ids: ['acc-1', 'acc-2'] },
      } as never);

    try {
      render(
        <BatchBar
          selected={selected}
          tags={[]}
          session={unverifiedSession}
          deleted
          onSession={onSession}
          complete={complete}
          onFailure={vi.fn()}
        />,
      );

      await user.click(screen.getByRole('button', { name: '批量永久删除' }));
      const submitBtn = screen.getByRole('button', {
        name: '确认整批永久删除',
      });
      expect(submitBtn).toBeDisabled();

      // 仅填确认短语但未完成 MFA Step-Up 时仍不可提交
      const phraseInput = screen.getByPlaceholderText('DELETE 2');
      await user.type(phraseInput, 'DELETE 2');
      expect(submitBtn).toBeDisabled();

      // 完成 Step-Up 后启用确认按钮
      await user.type(
        screen.getByLabelText('当前管理员密码'),
        'correct-horse-battery',
      );
      await user.type(screen.getByLabelText('TOTP 验证码（6 位）'), '654321');
      await user.click(
        screen.getByRole('button', { name: '完成管理员二次验证' }),
      );
      expect(onSession).toHaveBeenCalledWith(verifiedSession);
      expect(submitBtn).toBeEnabled();

      // 改错确认短语会重新禁用
      await user.clear(phraseInput);
      await user.type(phraseInput, 'DELETE 1');
      expect(submitBtn).toBeDisabled();

      await user.clear(phraseInput);
      await user.type(phraseInput, 'DELETE 2');
      expect(submitBtn).toBeEnabled();

      await user.click(submitBtn);
      expect(batchDeleteSpy).toHaveBeenCalledWith({
        headers: { 'X-CSRF-Token': 'csrf-batch-fresh' },
        throwOnError: true,
        body: {
          accounts: [
            { id: 'acc-1', row_version: 2 },
            { id: 'acc-2', row_version: 4 },
          ],
          confirmation: 'DELETE 2',
        },
      });
      expect(complete).toHaveBeenCalledWith('permanent-delete');
    } finally {
      reverifySpy.mockRestore();
      batchDeleteSpy.mockRestore();
    }
  });

  it('AuthShell 使用统一的 macOS 毛玻璃风格并支持切换深浅色主题', async () => {
    const user = userEvent.setup();
    render(
      <AuthShell
        title="管理员登录"
        showLogout={false}
        busy={false}
        notice={{ kind: 'error', message: '' }}
        onLogout={vi.fn()}
      >
        <p>登录表单内容</p>
      </AuthShell>,
    );

    expect(
      screen.getByRole('heading', { name: '管理员登录' }),
    ).toBeInTheDocument();
    expect(document.querySelector('[data-slot="auth-shell"]')).toHaveClass(
      'macos-desktop-bg',
    );
    expect(
      screen.getByRole('list', { name: '工作区安全特性' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '深色模式' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.click(screen.getByRole('button', { name: '浅色模式' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('SensitiveFieldsControl 默认隐藏手机号与备注，经 Step-Up 验证后按需展示并可立即隐藏', async () => {
    const user = userEvent.setup();
    const onSession = vi.fn();
    const detail = {
      id: 'acc-sec-1',
      gmail_email: 'secure.demo@gmail.com',
      has_phone: true,
      has_notes: true,
      phone: null,
      notes: null,
    } as AccountDetail;
    const baseSession: SessionResponse = {
      state: 'authenticated',
      csrf_token: 'csrf-sec-1',
      server_time: '2026-11-27T02:00:00Z',
      expires_at: '2026-11-27T14:00:00Z',
      idle_expires_at: '2026-11-27T02:15:00Z',
      idle_timeout_seconds: 900,
      reauthenticated_until: null,
      mfa_reauthenticated_until: null,
      step_up_totp_required: true,
      totp_enabled: true,
      webauthn_enabled: false,
      webauthn_count: 0,
      can_passwordless_login: false,
    };
    const verifiedSession: SessionResponse = {
      ...baseSession,
      csrf_token: 'csrf-sec-2',
      reauthenticated_until: '2026-11-27T02:05:00Z',
      mfa_reauthenticated_until: '2026-11-27T02:05:00Z',
    };

    const revealSpy = vi
      .spyOn(generatedApi, 'accountsRevealSensitive')
      .mockRejectedValueOnce({
        error: { code: 'REAUTH_REQUIRED', message: '请先重新验证' },
      })
      .mockResolvedValueOnce({
        data: { phone: '+86 138 0013 8000', notes: '核心恢复信息' },
      } as never);
    const reverifySpy = vi
      .spyOn(generatedApi, 'authReverify')
      .mockResolvedValue({ data: verifiedSession } as never);

    try {
      render(
        <SensitiveFieldsControl
          detail={detail}
          session={baseSession}
          onSession={onSession}
          onFailure={vi.fn()}
          onCopy={vi.fn()}
        />,
      );

      expect(screen.queryByText('+86 138 0013 8000')).not.toBeInTheDocument();
      expect(screen.queryByText('核心恢复信息')).not.toBeInTheDocument();

      await user.click(
        screen.getByRole('button', { name: '查看手机号与备注' }),
      );
      await user.type(
        screen.getByLabelText('当前管理员密码'),
        'correct-horse-battery',
      );
      await user.type(screen.getByLabelText('TOTP 验证码（6 位）'), '112233');
      await user.click(
        screen.getByRole('button', { name: '完成管理员二次验证' }),
      );
      expect(onSession).toHaveBeenCalledWith(verifiedSession);

      await user.click(
        screen.getByRole('button', { name: '查看手机号与备注' }),
      );
      expect(await screen.findByText('+86 138 0013 8000')).toBeInTheDocument();
      expect(screen.getByText('核心恢复信息')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: '立即隐藏' }));
      expect(screen.queryByText('+86 138 0013 8000')).not.toBeInTheDocument();
    } finally {
      revealSpy.mockRestore();
      reverifySpy.mockRestore();
    }
  });

  it('AccountForm 编辑已加密手机号与备注的账号时，留空提交不会误清空原密文', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn(async (_body: unknown) => {});
    const existing = {
      id: 'acc-edit-1',
      account_no: 'GM-001',
      gmail_email: 'keep.secrets@gmail.com',
      registered_at: '2026-01-01T00:00:00Z',
      recovery_account_id: null,
      recovery_email_external: 'backup@example.com',
      recovery_email: 'backup@example.com',
      status: 'normal',
      two_factor_status: 'enabled',
      purpose: '原用途',
      tags: [],
      apps: [],
      last_login_at: null,
      last_verified_at: null,
      password_changed_at: null,
      archived_at: null,
      deleted_at: null,
      row_version: 3,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      has_phone: true,
      has_notes: true,
      phone: null,
      notes: null,
    } as AccountDetail;

    render(
      <AccountForm
        account={existing}
        onFailure={vi.fn()}
        tags={[]}
        busy={false}
        conflict={false}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );

    const purposeInput = screen.getByLabelText('账号用途');
    await user.clear(purposeInput);
    await user.type(purposeInput, '新用途');
    await user.click(screen.getByRole('button', { name: '保存账号' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submitted = onSubmit.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(submitted.purpose).toBe('新用途');
    expect('phone' in submitted).toBe(false);
    expect('notes' in submitted).toBe(false);
  });
});
