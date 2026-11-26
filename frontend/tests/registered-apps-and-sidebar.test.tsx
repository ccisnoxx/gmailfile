import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrimarySidebar } from '@/components/macos';
import { AccountActionDialog } from '@/features/accounts/account-action-dialog';
import { AccountAppPill } from '@/features/accounts/account-app-pill';
import { AccountAppsEditor } from '@/features/accounts/account-apps-editor';
import { AppBrandIcon } from '@/features/accounts/app-brand-icon';
import { AuthShell } from '@/features/auth/auth-shell';
import type {
  AccountAppInput,
  AccountDetail,
  RegisteredAppResponse,
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
    expect(
      within(coreNav).getByRole('button', { name: '已注册应用' }),
    ).toBeInTheDocument();
    expect(
      within(coreNav).getByRole('button', { name: '辅助邮箱统计' }),
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
      within(coreNav).getByRole('button', { name: '已注册应用' }),
    );
    expect(onOpenApps).toHaveBeenCalledTimes(1);

    await user.click(
      within(coreNav).getByRole('button', { name: '辅助邮箱统计' }),
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

  it('AccountActionDialog 在回收站永久删除时展示不可逆警告并触发确认回调', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const detail = {
      id: 'acc-1',
      gmail_email: 'trash.demo@gmail.com',
      row_version: 2,
    } as AccountDetail;

    render(
      <AccountActionDialog
        confirm="permanent-delete"
        detail={detail}
        busy={false}
        conflict={false}
        notice=""
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText('确认永久删除账号？')).toBeInTheDocument();
    expect(screen.getByText(/此操作不可逆/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '确认永久删除' }));
    expect(onConfirm).toHaveBeenCalledWith('permanent-delete');
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
    expect(
      document.querySelector('[data-slot="auth-shell"]'),
    ).toHaveClass('macos-desktop-bg');
    expect(
      screen.getByRole('list', { name: '工作区安全特性' }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '深色模式' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    await user.click(screen.getByRole('button', { name: '浅色模式' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
