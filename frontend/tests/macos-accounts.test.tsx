import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AppWindowShell,
  DEFAULT_NAV_ALPHA,
  EmptyState,
  GlassPanel,
  GlassToolbar,
  LoadingState,
  MacTrafficLights,
  NAV_ALPHA_STORAGE_KEY,
  NavigationOpacitySlider,
  PrimarySidebar,
  StatCard,
  StatusPill,
  TagPill,
  clampNavAlpha,
  persistNavAlpha,
  readStoredNavAlpha,
} from '@/components/macos';
import { AccountTable } from '@/features/accounts/account-table';
import { AccountsPreviewPage } from '@/features/accounts/accounts-preview-page';
import { defaultVisibleColumns } from '@/features/accounts/constants';
import { createMockAccounts } from '@/features/accounts/mock-fixtures';

afterEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

function renderPreviewRouter(initialPath = '/preview/accounts') {
  const router = createMemoryRouter(
    [
      { path: '/preview/accounts', element: <AccountsPreviewPage /> },
      {
        path: '/preview/accounts/:accountId',
        element: <AccountsPreviewPage />,
      },
    ],
    { initialEntries: [initialPath] },
  );
  return {
    router,
    ...render(<RouterProvider router={router} />),
  };
}

describe('macOS 亚克力视觉系统与共享组件', () => {
  it('导出并正确渲染所有可复用基础组件', () => {
    const accounts = createMockAccounts().slice(0, 2);
    const onAlphaChange = vi.fn();

    render(
      <AppWindowShell
        navAlpha={60}
        toolbar={
          <GlassToolbar
            activeNav="accounts"
            navAlpha={60}
            onNavAlphaChange={onAlphaChange}
            onSelectNav={vi.fn()}
            onOpenSecurity={vi.fn()}
            onLogout={vi.fn()}
          />
        }
        sidebar={
          <PrimarySidebar
            activeSection="all"
            counts={{
              all: 128,
              normal: 112,
              risk: 5,
              disabled: 3,
              archived: 8,
              trash: 2,
            }}
            tags={[{ id: 't1', name: '开发环境', count: 24 }]}
            onSelectSection={vi.fn()}
            onSelectTag={vi.fn()}
            onAddTag={vi.fn()}
            onOpenAudit={vi.fn()}
            onOpenBackup={vi.fn()}
          />
        }
      >
        <MacTrafficLights />
        <GlassPanel variant="strong">
          <StatCard
            icon={<span aria-hidden="true">M</span>}
            title="全部账号"
            value={128}
            trend="↑ +6 本月"
          />
          <StatusPill status="normal" />
          <StatusPill status="restricted" />
          <StatusPill status="disabled" />
          <StatusPill status="archived" />
          <TagPill name="开发环境" />
          <TagPill name="长期保留" />
        </GlassPanel>
        <AccountTable
          items={accounts}
          total={accounts.length}
          isPending={false}
          isError={false}
          deleted={false}
          busy={false}
          columns={defaultVisibleColumns}
          selected={{}}
          onToggleAll={vi.fn()}
          onToggleOne={vi.fn()}
          onOpen={vi.fn()}
          onCopy={vi.fn()}
          onMarkVerified={vi.fn()}
        />
        <EmptyState onCreate={vi.fn()} onImportCsv={vi.fn()} />
        <LoadingState />
      </AppWindowShell>,
    );

    expect(screen.getByText('Gmail 账号管理系统')).toBeInTheDocument();
    // 虚假的 1.2 GB / 10 GB 存储卡已移除
    expect(screen.queryByText('1.2 GB / 10 GB')).not.toBeInTheDocument();
    expect(screen.getByText('暂无账号')).toBeInTheDocument();
    expect(screen.getByText('正在加载账号列表…')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: '账号列表' })).toBeInTheDocument();
  });

  it('NavigationOpacitySlider 支持 35%~90% 范围、默认 60%、实时更新 --nav-alpha 并持久化到 localStorage', () => {
    expect(readStoredNavAlpha()).toBe(DEFAULT_NAV_ALPHA);
    expect(clampNavAlpha(10)).toBe(35);
    expect(clampNavAlpha(99)).toBe(90);

    const onChange = vi.fn();
    render(<NavigationOpacitySlider value={60} onChange={onChange} />);

    const slider = screen.getByRole('slider', { name: '导航栏毛玻璃透明度' });
    expect(slider).toHaveAttribute('min', '35');
    expect(slider).toHaveAttribute('max', '90');
    expect(slider).toHaveValue('60');
    expect(screen.getByText('60%')).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: '78' } });
    expect(onChange).toHaveBeenCalledWith(78);

    persistNavAlpha(78);
    expect(window.localStorage.getItem(NAV_ALPHA_STORAGE_KEY)).toBe('78');
    expect(readStoredNavAlpha()).toBe(78);
  });

  it('AccountsPreviewPage 通过界面与显示浮层拖动毛玻璃滑块实时更新 --nav-alpha 并在重新挂载后恢复', async () => {
    const user = userEvent.setup();
    const first = renderPreviewRouter();
    const shell = first.container.querySelector(
      '[data-slot="app-window-shell"]',
    ) as HTMLElement;
    expect(shell.style.getPropertyValue('--nav-alpha')).toBe('0.6');
    // 顶栏不再常驻透明度滑块，也没有无通知时的常亮红点
    expect(
      screen.queryByRole('slider', { name: '导航栏毛玻璃透明度' }),
    ).not.toBeInTheDocument();
    expect(
      first.container.querySelector('[data-slot="notification-badge"]'),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '界面与显示设置' }));
    const popover = screen.getByRole('dialog', { name: '界面与显示' });
    const slider = within(popover).getByRole('slider', {
      name: '导航栏毛玻璃透明度',
    });
    fireEvent.change(slider, { target: { value: '42' } });
    expect(shell.style.getPropertyValue('--nav-alpha')).toBe('0.42');
    expect(within(popover).getByText('42%')).toBeInTheDocument();
    expect(window.localStorage.getItem(NAV_ALPHA_STORAGE_KEY)).toBe('42');

    first.unmount();

    const second = renderPreviewRouter();
    const reloadedShell = second.container.querySelector(
      '[data-slot="app-window-shell"]',
    ) as HTMLElement;
    expect(reloadedShell.style.getPropertyValue('--nav-alpha')).toBe('0.42');
    await user.click(screen.getByRole('button', { name: '界面与显示设置' }));
    expect(screen.getByText('42%')).toBeInTheDocument();
  });

  it('悬停在顶栏和视图切换图标上时显示对应提示文字', async () => {
    const user = userEvent.setup();
    renderPreviewRouter();

    const notifBtn = screen.getByRole('button', { name: '通知' });
    await user.hover(notifBtn);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('通知');
    await user.unhover(notifBtn);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    const chartBtn = screen.getByRole('button', { name: '图表视图' });
    await user.hover(chartBtn);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('图表视图');
  });
});

describe('账号管理高保真页面交互与状态展示', () => {
  it('展示 6 条示例账号、侧栏分类统计、标签与数据存储，支持实时搜索与 ⌘K 聚焦', async () => {
    const user = userEvent.setup();
    renderPreviewRouter();

    const table = screen.getByRole('table', { name: '账号列表' });
    for (const email of [
      'dev.team@gmail.com',
      'test.account@gmail.com',
      'tools.sync@gmail.com',
      'backup.main@gmail.com',
      'old.archived@gmail.com',
      'disabled.sample@gmail.com',
    ]) {
      expect(within(table).getByText(email)).toBeInTheDocument();
    }

    const searchInput = screen.getByPlaceholderText('搜索编号、邮箱或辅助邮箱');
    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    expect(document.activeElement).toBe(searchInput);

    await user.type(searchInput, 'proton.me');
    expect(
      within(table).getByText('backup.main@gmail.com'),
    ).toBeInTheDocument();
    expect(
      within(table).queryByText('dev.team@gmail.com'),
    ).not.toBeInTheDocument();
  });

  it('支持状态/2FA/标签/回收站筛选、多选全选、行点击跳转 /accounts/:id 与新建账号弹窗', async () => {
    const user = userEvent.setup();
    const { router } = renderPreviewRouter();

    // 全选当前页
    const selectAll = screen.getByLabelText('选择当前页全部账号');
    await user.click(selectAll);
    expect(screen.getByRole('navigation', { name: '分页' })).toHaveTextContent(
      '已选择 6 项，共 128 项',
    );
    await user.click(selectAll);

    // 侧栏展开「全部账号」后筛选风险账号
    const sidebar = screen.getByLabelText('侧边导航栏');
    await user.click(
      within(sidebar).getByRole('button', { name: '展开账号状态分组' }),
    );
    await user.click(within(sidebar).getByRole('button', { name: /风险账号/ }));
    const table = screen.getByRole('table', { name: '账号列表' });
    expect(
      within(table).getByText('backup.main@gmail.com'),
    ).toBeInTheDocument();
    expect(
      within(table).queryByText('dev.team@gmail.com'),
    ).not.toBeInTheDocument();

    // 回到全部账号并使用 2FA 筛选
    await user.click(within(sidebar).getByRole('button', { name: /全部账号/ }));
    await user.click(screen.getByRole('button', { name: /筛选/ }));
    await user.selectOptions(screen.getByLabelText('筛选二步验证'), 'disabled');
    expect(within(table).getByText('tools.sync@gmail.com')).toBeInTheDocument();
    expect(
      within(table).queryByText('dev.team@gmail.com'),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重置筛选' }));

    // 点击行进入 /preview/accounts/:id 详情抽屉
    await user.click(
      screen.getByRole('button', { name: 'dev.team@gmail.com' }),
    );
    expect(router.state.location.pathname).toBe(
      '/preview/accounts/acc-dev-team',
    );
    expect(
      await screen.findByRole('dialog', { name: '账号详情' }),
    ).toBeInTheDocument();
    await user.keyboard('{Escape}');

    // 新建账号打开玻璃弹窗并新增记录
    await user.click(screen.getAllByRole('button', { name: '新建账号' })[0]);
    const dialog = await screen.findByRole('dialog', { name: '新建账号' });
    await user.type(
      within(dialog).getByLabelText('Gmail 地址'),
      'fresh.team@gmail.com',
    );
    await user.type(
      within(dialog).getByLabelText('Gmail 登录密码'),
      'StrongPassPhrase2026!',
    );
    await user.type(
      within(dialog).getByLabelText('辅助邮箱'),
      'fresh-backup@outlook.com',
    );
    await user.click(within(dialog).getByRole('button', { name: '保存账号' }));
    expect(
      await screen.findByRole('button', { name: 'fresh.team@gmail.com' }),
    ).toBeInTheDocument();
  });

  it('省略号菜单支持归档、删除二次确认与回收站恢复，并可切换图表视图与状态展示区', async () => {
    const user = userEvent.setup();
    renderPreviewRouter();

    // 默认展示并列的空状态与加载状态展示区
    const showcase = screen.getByLabelText('组件状态展示');
    expect(within(showcase).getByText('暂无账号')).toBeInTheDocument();
    expect(within(showcase).getByText('正在加载账号列表…')).toBeInTheDocument();

    // 省略号菜单触发删除 -> 出现二次确认 -> 确认删除进入回收站
    await user.click(
      screen.getByRole('button', { name: '更多操作 test.account@gmail.com' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: '删除' }));
    const confirmDialog = await screen.findByRole('alertdialog');
    expect(within(confirmDialog).getByText(/确认删除账号/)).toBeInTheDocument();
    await user.click(
      within(confirmDialog).getByRole('button', { name: '确认删除' }),
    );
    expect(
      screen.queryByRole('button', { name: 'test.account@gmail.com' }),
    ).not.toBeInTheDocument();

    // 切到回收站恢复账号
    const sidebar = screen.getByLabelText('侧边导航栏');
    await user.click(within(sidebar).getByRole('button', { name: /回收站/ }));
    expect(
      await screen.findByRole('button', { name: 'test.account@gmail.com' }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: '更多操作 test.account@gmail.com' }),
    );
    await user.click(await screen.findByRole('menuitem', { name: '恢复' }));
    const restoreDialog = await screen.findByRole('alertdialog');
    await user.click(
      within(restoreDialog).getByRole('button', { name: '确认恢复' }),
    );

    // 切换列表 / 图表视图
    await user.click(screen.getByRole('button', { name: '图表视图' }));
    expect(
      await screen.findByLabelText('账号数据图表视图'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '列表视图' }));
    expect(screen.getByRole('table')).toBeInTheDocument();

    // 管理员菜单可隐藏状态展示区
    await user.click(screen.getByRole('button', { name: '管理员菜单' }));
    await user.click(
      await screen.findByRole('menuitem', { name: '隐藏状态展示区' }),
    );
    expect(screen.queryByLabelText('组件状态展示')).not.toBeInTheDocument();
  });
});
