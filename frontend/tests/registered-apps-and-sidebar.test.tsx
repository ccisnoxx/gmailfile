import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrimarySidebar } from '@/components/macos';
import { AccountAppsEditor } from '@/features/accounts/account-apps-editor';
import { AccountAppPill } from '@/features/accounts/account-app-pill';
import type { AccountAppInput, RegisteredAppResponse } from '@/api/generated';
import { useState } from 'react';

const sampleApps: RegisteredAppResponse[] = [
  {
    id: 'app-claude',
    name: 'Claude',
    sort_order: 10,
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'app-chatgpt',
    name: 'ChatGPT',
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
    expect(
      within(coreNav).getByRole('button', { name: /全部账号/ }),
    ).toBeInTheDocument();
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

    // 展开后展示 5 个子状态
    await user.click(
      within(coreNav).getByRole('button', { name: '展开账号状态分组' }),
    );
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

    await user.click(within(subGroup).getByRole('button', { name: /待验证/ }));
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
});
