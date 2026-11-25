import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionResponse } from '@/api/generated';
import {
  DISPLAY_SETTINGS_STORAGE_KEY,
  NAV_ALPHA_STORAGE_KEY,
  persistNavAlpha,
} from '@/components/macos';
import { AccountsPreviewPage } from '@/features/accounts/accounts-preview-page';
import {
  ActiveSessionsCard,
  AdminSecurityCard,
  AppearanceCard,
  AuditLogCard,
  BackupRestoreCard,
  NavigationOpacitySlider,
  RetentionPolicyCard,
  SensitiveActionDialog,
  SettingsLayout,
  SettingsPage,
  SettingsPreviewPage,
  SettingsSegmentedTabs,
  TotpSecurityCard,
  type SettingsPageProps,
} from '@/features/settings';

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
  csrf_token: 'csrf-settings-token-001',
  expires_at: new Date(Date.now() + 43_200_000).toISOString(),
  idle_expires_at: new Date(Date.now() + 900_000).toISOString(),
  reauthenticated_until: null,
  mfa_reauthenticated_until: null,
  step_up_totp_required: true,
  ...overrides,
});

function renderPreviewSettings(
  initialPath = '/settings/security',
  extraProps: Omit<SettingsPageProps, 'mode' | 'session'> = {},
) {
  const router = createMemoryRouter(
    [
      {
        path: '/settings',
        element: <SettingsPreviewPage {...extraProps} />,
      },
      {
        path: '/settings/:section',
        element: <SettingsPreviewPage {...extraProps} />,
      },
      {
        path: '/preview/settings',
        element: <SettingsPreviewPage {...extraProps} />,
      },
      {
        path: '/preview/settings/:section',
        element: <SettingsPreviewPage {...extraProps} />,
      },
      {
        path: '/preview/accounts',
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

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('系统设置页面（macOS 淡蓝亚克力设计系统）', () => {
  it('导出全部 11 个必需拆分组件并完整渲染基础布局、左右导航、顶部分类与 7 张核心卡片', () => {
    expect(SettingsLayout).toBeTypeOf('function');
    expect(SettingsSegmentedTabs).toBeTypeOf('function');
    expect(AdminSecurityCard).toBeTypeOf('function');
    expect(TotpSecurityCard).toBeTypeOf('function');
    expect(ActiveSessionsCard).toBeTypeOf('function');
    expect(BackupRestoreCard).toBeTypeOf('function');
    expect(AuditLogCard).toBeTypeOf('function');
    expect(RetentionPolicyCard).toBeTypeOf('function');
    expect(AppearanceCard).toBeTypeOf('function');
    expect(NavigationOpacitySlider).toBeTypeOf('function');
    expect(SensitiveActionDialog).toBeTypeOf('function');

    const { container } = renderPreviewSettings('/settings/security');

    // 主标题与副标题
    expect(
      screen.getByRole('heading', { level: 1, name: '系统设置' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('安全、备份、审计与系统行为配置'),
    ).toBeInTheDocument();

    // 顶部搜索框 + ⌘F 快捷键聚焦 + 右上角系统正常运行、通知、管理员菜单
    const searchInput = screen.getByPlaceholderText('搜索设置（⌘F）');
    fireEvent.keyDown(window, { key: 'f', metaKey: true });
    expect(document.activeElement).toBe(searchInput);
    expect(
      container.querySelector('[data-slot="topbar-system-status"]'),
    ).toHaveTextContent('系统正常运行');
    expect(screen.getByRole('button', { name: '通知' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '管理员菜单' }),
    ).toBeInTheDocument();

    // 左侧主导航 9 项 + 回收站 3 + 当前选中“系统设置”
    const mainNav = screen.getByRole('navigation', { name: '系统主导航' });
    for (const label of [
      '控制台',
      'Gmail 账号',
      '标签管理',
      '导入 / 导出（CSV）',
      '归档账号',
      '回收站',
      '审计日志',
      '备份与恢复',
      '系统设置',
    ]) {
      expect(within(mainNav).getByText(label)).toBeInTheDocument();
    }
    expect(within(mainNav).getByLabelText('回收站 3 项')).toHaveTextContent(
      '3',
    );
    expect(
      within(mainNav).getByRole('button', { name: '系统设置' }),
    ).toHaveAttribute('aria-current', 'page');

    // 系统设置二级导航 5 项，当前选中“安全与认证”
    const subNav = screen.getByRole('navigation', { name: '系统设置二级导航' });
    for (const label of [
      '安全与认证',
      '备份与恢复',
      '审计与合规',
      '界面与体验',
      '系统与维护',
    ]) {
      expect(within(subNav).getByText(label)).toBeInTheDocument();
    }
    expect(
      within(subNav).getByRole('button', { name: '安全与认证' }),
    ).toHaveAttribute('aria-current', 'location');

    // 顶部 macOS segmented control
    const tablist = screen.getByRole('tablist', { name: '系统设置分类' });
    expect(
      within(tablist).getByRole('tab', { name: '安全与认证', selected: true }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole('tab', { name: '备份与恢复' }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole('tab', { name: '审计与合规' }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole('tab', { name: '界面与体验' }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole('tab', { name: '系统与维护' }),
    ).toBeInTheDocument();

    // 卡片 1：管理员安全
    expect(
      screen.getByRole('heading', { name: '管理员安全' }),
    ).toBeInTheDocument();
    expect(screen.getByText('安全状态良好')).toBeInTheDocument();
    expect(screen.getByText('admin')).toBeInTheDocument();
    expect(screen.getByText('强（16+ 位）')).toBeInTheDocument();
    expect(screen.getByText('最小长度 16 位')).toBeInTheDocument();
    expect(screen.getByText('检查泄露密码')).toBeInTheDocument();
    expect(screen.getByText('建议使用密码短语')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '修改密码…' }),
    ).toBeInTheDocument();

    // 卡片 2：双因素认证（TOTP），展示抽象验证码且不泄露真实 Secret
    expect(
      screen.getByRole('heading', { name: '双因素认证（TOTP）' }),
    ).toBeInTheDocument();
    expect(screen.getByText('已启用')).toBeInTheDocument();
    expect(screen.getByText('已绑定')).toBeInTheDocument();
    expect(
      screen.getByText('Google Authenticator / Microsoft Authenticator 等'),
    ).toBeInTheDocument();
    expect(screen.getByText('10 个，剩余 10 个')).toBeInTheDocument();
    expect(screen.getByText('482 917')).toBeInTheDocument();
    expect(screen.getByText('演示状态')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('otpauth://');

    // 卡片 3：活动会话
    const sessionsTable = screen.getByRole('table', { name: '活动会话列表' });
    expect(
      within(sessionsTable).getByText('macOS · Safari'),
    ).toBeInTheDocument();
    expect(within(sessionsTable).getByText('当前会话')).toBeInTheDocument();
    expect(
      within(sessionsTable).getByText('Windows · Chrome'),
    ).toBeInTheDocument();

    // 卡片 4：加密备份与恢复
    expect(
      screen.getByRole('heading', { name: '加密备份与恢复' }),
    ).toBeInTheDocument();
    expect(screen.getByText('备份正常')).toBeInTheDocument();
    expect(screen.getByText('pg_dump + age 加密')).toBeInTheDocument();
    expect(
      screen.getByText('数据库、标签、配置、审计日志'),
    ).toBeInTheDocument();
    expect(screen.getByText('结构、约束与抽样解密')).toBeInTheDocument();

    // 卡片 5：审计日志
    const auditTable = screen.getByRole('table', { name: '审计日志摘要' });
    expect(within(auditTable).getByText('登录成功')).toBeInTheDocument();
    expect(within(auditTable).getByText('修改账号')).toBeInTheDocument();
    expect(within(auditTable).getByText('自动备份')).toBeInTheDocument();
    expect(within(auditTable).getByText('导出 CSV')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '查看完整日志' }),
    ).toBeInTheDocument();

    // 卡片 6：日志保留与数据生命周期
    expect(
      screen.getByRole('heading', { name: '日志保留与数据生命周期' }),
    ).toBeInTheDocument();
    expect(screen.getByText('730 天')).toBeInTheDocument();
    expect(screen.getByText('当前占用 1.28 GB，32%')).toBeInTheDocument();
    expect(screen.getByText('90 天')).toBeInTheDocument();
    expect(screen.getByText('当前占用 5.64 GB，56%')).toBeInTheDocument();

    // 卡片 7：界面与体验（默认 70%）
    expect(
      screen.getByRole('heading', { name: '界面与体验' }),
    ).toBeInTheDocument();
    const slider = screen.getByRole('slider', { name: '导航栏毛玻璃透明度' });
    expect(slider).toHaveValue('70');
    expect(
      container.querySelector('[data-slot="glass-opacity-preview"]'),
    ).toBeInTheDocument();
  });

  it('支持顶部 segmented control、键盘方向键与左侧二级导航同步切换内容，并支持顶部搜索过滤设置', async () => {
    const user = userEvent.setup();
    renderPreviewSettings('/settings/security');

    const tablist = screen.getByRole('tablist', { name: '系统设置分类' });
    const subNav = screen.getByRole('navigation', { name: '系统设置二级导航' });

    // 点击“备份与恢复”分段标签 -> 切换对应内容且隐藏管理员安全卡片
    await user.click(within(tablist).getByRole('tab', { name: '备份与恢复' }));
    expect(
      within(tablist).getByRole('tab', { name: '备份与恢复', selected: true }),
    ).toBeInTheDocument();
    expect(
      within(subNav).getByRole('button', { name: '备份与恢复' }),
    ).toHaveAttribute('aria-current', 'location');
    expect(
      screen.getByRole('heading', { name: '最近加密归档快照' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: '管理员安全' }),
    ).not.toBeInTheDocument();

    // 键盘 ArrowRight 切换到“审计与合规”
    fireEvent.keyDown(
      within(tablist).getByRole('tab', { name: '备份与恢复' }),
      { key: 'ArrowRight' },
    );
    expect(
      within(tablist).getByRole('tab', { name: '审计与合规', selected: true }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: '防篡改哈希链校验' }),
    ).toBeInTheDocument();

    // 切到“界面与体验”和“系统与维护”
    await user.click(within(tablist).getByRole('tab', { name: '界面与体验' }));
    expect(
      screen.getByRole('heading', { name: '交互快捷键与本地存储约束' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('switch', { name: '紧凑密度模式' }),
    ).toBeInTheDocument();

    await user.click(
      within(subNav).getByRole('button', { name: '系统与维护' }),
    );
    expect(
      screen.getByRole('heading', { name: '运行环境与会话安全' }),
    ).toBeInTheDocument();

    // 顶部搜索过滤设置与空搜索状态
    const searchInput = screen.getByPlaceholderText('搜索设置（⌘F）');
    await user.type(searchInput, 'TOTP');
    expect(
      screen.getByRole('heading', { name: '双因素认证（TOTP）' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: '加密备份与恢复' }),
    ).not.toBeInTheDocument();

    await user.clear(searchInput);
    await user.type(searchInput, '不存在的配置关键词');
    expect(screen.getByText('未找到匹配的设置项')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '清空搜索条件' }));
    expect(searchInput).toHaveValue('');
  });

  it('毛玻璃透明度滑块默认 70%、支持实时预览与 localStorage 持久化，并与账号列表共享同一配置状态', async () => {
    const user = userEvent.setup();
    const first = renderPreviewSettings('/settings/security');
    const shell = first.container.querySelector(
      '[data-slot="app-window-shell"]',
    ) as HTMLElement;
    const previewSurface = first.container.querySelector(
      '[data-slot="glass-opacity-preview-surface"]',
    ) as HTMLElement;

    expect(shell.style.getPropertyValue('--nav-alpha')).toBe('0.7');
    expect(previewSurface.style.backgroundColor).toContain('0.7');

    // 拖动滑块到 84% -> 立即更新窗口变量、预览块并写入共享 key
    const slider = screen.getByRole('slider', { name: '导航栏毛玻璃透明度' });
    fireEvent.change(slider, { target: { value: '84' } });
    expect(shell.style.getPropertyValue('--nav-alpha')).toBe('0.84');
    expect(previewSurface.style.backgroundColor).toContain('0.84');
    expect(window.localStorage.getItem(NAV_ALPHA_STORAGE_KEY)).toBe('84');

    // 切换到“界面与体验”开启紧凑模式，仅保存非敏感偏好
    await user.click(screen.getByRole('tab', { name: '界面与体验' }));
    await user.click(screen.getByRole('switch', { name: '紧凑密度模式' }));
    expect(window.localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY)).toContain(
      '"compactMode":true',
    );
    first.unmount();

    // 账号列表页读取同一 gm_nav_alpha = 84
    const accountsRender = render(<AccountsPreviewPage />);
    const accountsShell = accountsRender.container.querySelector(
      '[data-slot="app-window-shell"]',
    ) as HTMLElement;
    expect(accountsShell.style.getPropertyValue('--nav-alpha')).toBe('0.84');
    accountsRender.unmount();

    // 从其他页面修改为 52 后，系统设置页立即读取同一共享值
    persistNavAlpha(52);
    const second = renderPreviewSettings('/settings/security');
    const reloadedShell = second.container.querySelector(
      '[data-slot="app-window-shell"]',
    ) as HTMLElement;
    expect(reloadedShell.style.getPropertyValue('--nav-alpha')).toBe('0.52');
    expect(
      screen.getByRole('slider', { name: '导航栏毛玻璃透明度' }),
    ).toHaveValue('52');
  });

  it('支持修改密码、密码+TOTP 重新生成恢复码、终止会话确认、立即备份、4 步恢复验证与调整保留策略 Sheet', async () => {
    const user = userEvent.setup();
    renderPreviewSettings('/settings/security');

    // 1. 修改密码 Modal
    await user.click(screen.getByRole('button', { name: '修改密码…' }));
    const pwdDialog = await screen.findByRole('dialog', {
      name: '修改管理员密码',
    });
    await user.type(
      within(pwdDialog).getByLabelText('当前管理员密码'),
      'CurrentStrongPass2026!',
    );
    await user.type(
      within(pwdDialog).getByLabelText('TOTP 验证码（最近重新验证）'),
      '123456',
    );
    await user.type(
      within(pwdDialog).getByLabelText('新密码（至少 16 位）'),
      'NewUltraStrongPassphrase#2026',
    );
    await user.type(
      within(pwdDialog).getByLabelText('确认新密码'),
      'NewUltraStrongPassphrase#2026',
    );
    await user.click(
      within(pwdDialog).getByRole('button', { name: '确认修改密码' }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: '修改管理员密码' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText('极强（20+ 位）')).toBeInTheDocument();

    // 2. 查看 / 重新生成恢复码（需要密码 + TOTP，不存 localStorage，隐藏即清）
    await user.click(screen.getByRole('button', { name: '查看 / 重新生成…' }));
    const recDialog = await screen.findByRole('dialog', {
      name: '查看 / 重新生成恢复码',
    });
    await user.type(
      within(recDialog).getByLabelText('当前管理员密码'),
      'NewUltraStrongPassphrase#2026',
    );
    await user.type(
      within(recDialog).getByLabelText('TOTP 验证码（6 位）'),
      '654321',
    );
    await user.click(
      within(recDialog).getByRole('button', { name: '验证并重新生成' }),
    );
    const codesList = await screen.findByLabelText('新生成的备用恢复码');
    const codeItems = within(codesList).getAllByRole('listitem');
    expect(codeItems).toHaveLength(10);
    // 确认任何密码与恢复码均未进入 localStorage
    const allStorage = JSON.stringify(window.localStorage);
    expect(allStorage).not.toContain('NewUltraStrongPassphrase#2026');
    expect(allStorage).not.toContain(codeItems[0].textContent ?? 'XXXX');
    expect(
      screen.getByRole('button', { name: '完成并清除展示' }),
    ).toBeDisabled();
    await user.click(
      screen.getByRole('checkbox', { name: '我已将上述 10 个恢复码离线保存' }),
    );
    await user.click(screen.getByRole('button', { name: '完成并清除展示' }));
    await waitFor(() =>
      expect(
        screen.queryByLabelText('新生成的备用恢复码'),
      ).not.toBeInTheDocument(),
    );

    // 3. 终止活动会话（确认弹窗，刚刚已完成最近重新验证）
    await user.click(
      screen.getByRole('button', { name: '终止会话 Windows · Chrome' }),
    );
    const sessDialog = await screen.findByRole('dialog', {
      name: '终止活动会话？',
    });
    expect(
      within(sessDialog).getByText(/最近已完成管理员重新验证/),
    ).toBeInTheDocument();
    await user.click(
      within(sessDialog).getByRole('button', { name: '确认终止会话' }),
    );
    await waitFor(() =>
      expect(screen.queryByText('Windows · Chrome')).not.toBeInTheDocument(),
    );

    // 4. 立即备份显示执行中状态和完成 Toast
    await user.click(screen.getByRole('button', { name: '立即备份' }));
    expect(await screen.findByText(/加密备份已完成/)).toBeInTheDocument();

    // 5. 步骤式恢复验证 Modal（选择备份 -> 校验清单 -> 开始验证 -> 显示结果）
    await user.click(screen.getByRole('button', { name: '恢复验证…' }));
    const restoreDialog = await screen.findByRole('dialog', {
      name: '备份恢复验证演练',
    });
    expect(within(restoreDialog).getByText('选择备份')).toBeInTheDocument();
    await user.click(
      within(restoreDialog).getByRole('button', {
        name: '下一步：查看校验清单',
      }),
    );
    expect(
      within(restoreDialog).getByText('抽样记录 AES-256-GCM 解密校验'),
    ).toBeInTheDocument();
    await user.click(
      within(restoreDialog).getByRole('button', { name: '开始验证' }),
    );
    expect(
      await within(restoreDialog).findByText(
        '恢复验证全部通过（结构、约束与抽样解密）',
      ),
    ).toBeInTheDocument();
    await user.click(
      within(restoreDialog).getByRole('button', { name: '完成关闭' }),
    );

    // 6. 调整保留策略 Sheet
    await user.click(screen.getByRole('button', { name: '调整策略…' }));
    const sheet = await screen.findByRole('dialog', {
      name: '调整保留与生命周期策略',
    });
    const auditDaysInput = within(sheet).getByLabelText(/审计日志保留天数/);
    fireEvent.change(auditDaysInput, { target: { value: '365' } });
    // 缩短保留周期显示明确风险警告
    expect(
      within(sheet).getByText(/缩短保留周期将导致超过新窗口的历史归档/),
    ).toBeInTheDocument();
    await user.click(within(sheet).getByRole('button', { name: '保存策略' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: '调整保留与生命周期策略' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByText('365 天')).toBeInTheDocument();

    // 7. 审计日志卡片筛选与重置
    await user.selectOptions(screen.getByLabelText('筛选事件类型'), '导出 CSV');
    const auditTable = screen.getByRole('table', { name: '审计日志摘要' });
    expect(within(auditTable).getByText('导出 CSV')).toBeInTheDocument();
    expect(within(auditTable).queryByText('自动备份')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('搜索审计日志'), '无此事件关键字');
    expect(screen.getByText('没有符合筛选条件的审计记录')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '重置筛选' }));
    const resetAuditTable = screen.getByRole('table', { name: '审计日志摘要' });
    expect(
      within(resetAuditTable).getByText('调整生命周期策略'),
    ).toBeInTheDocument();
    expect(
      within(resetAuditTable).getByText('修改管理员密码'),
    ).toBeInTheDocument();
  });

  it('完整呈现加载、错误与空状态，且失败操作绝不伪装成成功', async () => {
    const user = userEvent.setup();

    // Loading 状态
    const loadingView = renderPreviewSettings('/settings/security', {
      uiStateOverride: 'loading',
    });
    expect(screen.getByText('正在读取活动会话…')).toBeInTheDocument();
    expect(screen.getByText('正在读取备份状态…')).toBeInTheDocument();
    expect(screen.getByText('正在读取审计日志…')).toBeInTheDocument();
    loadingView.unmount();

    // Error 状态
    const errorView = renderPreviewSettings('/settings/security', {
      uiStateOverride: 'error',
    });
    expect(screen.getAllByRole('alert').length).toBeGreaterThanOrEqual(3);
    expect(
      screen.getAllByRole('button', { name: '重试' }).length,
    ).toBeGreaterThanOrEqual(3);
    errorView.unmount();

    // Empty 状态
    const emptyView = renderPreviewSettings('/settings/security', {
      uiStateOverride: 'empty',
    });
    expect(screen.getByText('暂无活动会话')).toBeInTheDocument();
    expect(screen.getByText('尚未产生可用备份')).toBeInTheDocument();
    expect(screen.getByText('暂无审计日志')).toBeInTheDocument();
    emptyView.unmount();

    // 失败不能伪装成成功（立即备份失败 + 恢复验证失败）
    renderPreviewSettings('/settings/security', {
      simulateActionFailure: true,
    });
    await user.click(screen.getByRole('button', { name: '立即备份' }));
    expect(await screen.findByText('备份失败')).toBeInTheDocument();
    expect(
      screen.getByText(/备份执行失败：age 加密归档校验未通过/),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '恢复验证…' }));
    const restoreDialog = await screen.findByRole('dialog', {
      name: '备份恢复验证演练',
    });
    await user.click(
      within(restoreDialog).getByRole('button', {
        name: '下一步：查看校验清单',
      }),
    );
    await user.click(
      within(restoreDialog).getByRole('button', { name: '开始验证' }),
    );
    expect(
      await within(restoreDialog).findByText('恢复验证未通过'),
    ).toBeInTheDocument();
  });

  it('真实 API 模式下忠实呈现后端失败状态、带 CSRF 调用会话撤销，且敏感凭据不进入 Query Cache 或 localStorage', async () => {
    const user = userEvent.setup();
    const session = makeSession();
    const revokeCalls: Request[] = [];

    const fetchMock = vi.fn(async (req: Request) => {
      const url = new URL(req.url);
      if (url.pathname === '/api/v1/auth/sessions' && req.method === 'GET') {
        return json({
          items: [
            {
              id: 'sess-cur-1',
              current: true,
              state: 'valid',
              auth_level: 'authenticated',
              created_at: '2026-11-25T01:00:00Z',
              last_seen_at: '2026-11-25T09:00:00Z',
              expires_at: '2026-11-25T13:00:00Z',
              idle_expires_at: '2026-11-25T09:15:00Z',
              revoked_at: null,
              ip_address: '10.0.0.10',
            },
            {
              id: 'sess-oth-2',
              current: false,
              state: 'valid',
              auth_level: 'authenticated',
              created_at: '2026-11-24T12:00:00Z',
              last_seen_at: '2026-11-25T08:00:00Z',
              expires_at: '2026-11-25T12:00:00Z',
              idle_expires_at: '2026-11-25T08:15:00Z',
              revoked_at: null,
              ip_address: '10.0.0.22',
            },
          ],
          total: 2,
          page: 1,
          page_size: 20,
        });
      }
      if (url.pathname === '/api/v1/audit-events') {
        return json({
          items: [
            {
              id: 'aud-live-1',
              seq: 88,
              event_hash: 'abcdef0123456789',
              event_type: 'csv_exported',
              account_id: null,
              session_id: 'sess-cur-1',
              ip_address: '10.0.0.10',
              operation: '导出 CSV（全量）',
              created_at: '2026-11-25T08:30:00Z',
            },
          ],
          total: 1,
          page: 1,
          page_size: 30,
          event_types: ['csv_exported'],
        });
      }
      if (url.pathname === '/api/v1/audit-events/integrity') {
        return json({
          valid: true,
          total_events: 88,
          latest_seq: 88,
          latest_hash: 'abcdef0123456789',
          retention_days: 730,
        });
      }
      if (url.pathname === '/api/v1/system/backup-status') {
        return json({
          state: 'failed',
          offsite: 'failed',
          last_attempt_at: '2026-11-25T02:30:00Z',
          last_success_at: '2026-11-23T02:30:00Z',
        });
      }
      if (url.pathname === '/api/v1/system/version') {
        return json({ version: '1.2.0', schema_version: '0004' });
      }
      if (url.pathname === '/api/v1/settings') {
        return json({ idle_minutes: 15, max_idle_minutes: 720 });
      }
      if (url.pathname === '/api/v1/auth/reverify' && req.method === 'POST') {
        return json(
          makeSession({
            reauthenticated_until: new Date(Date.now() + 300_000).toISOString(),
            mfa_reauthenticated_until: new Date(
              Date.now() + 300_000,
            ).toISOString(),
          }),
        );
      }
      if (
        url.pathname === '/api/v1/auth/sessions/others' &&
        req.method === 'DELETE'
      ) {
        revokeCalls.push(req);
        return json({ status: 'ok' });
      }
      return json({});
    });

    vi.stubGlobal('fetch', fetchMock);

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={client}>
        <SettingsPage
          mode="live"
          session={session}
          onSession={vi.fn()}
          onFailure={vi.fn()}
          onRefreshSession={vi.fn()}
          onSignedOut={vi.fn()}
          onLogout={vi.fn()}
        />
      </QueryClientProvider>,
    );

    // 真实后端返回 failed 时必须如实展示“备份失败”而非伪装“备份正常”
    expect(await screen.findByText('备份失败')).toBeInTheDocument();
    expect(screen.queryByText('备份正常')).not.toBeInTheDocument();
    expect(await screen.findByText('10.0.0.22')).toBeInTheDocument();

    // 退出其他会话 -> 需要先输入密码和 TOTP 重新验证 -> 带 CSRF 调用 DELETE /api/v1/auth/sessions/others
    await user.click(screen.getByRole('button', { name: '退出其他会话' }));
    const dialog = await screen.findByRole('dialog', {
      name: '退出全部其他会话？',
    });
    const secretPassword = 'AdminLiveSecretPassword#2026';
    await user.type(
      within(dialog).getByLabelText('当前管理员密码'),
      secretPassword,
    );
    await user.type(
      within(dialog).getByLabelText('TOTP 验证码（6 位）'),
      '778899',
    );
    await user.click(
      within(dialog).getByRole('button', { name: '确认退出其他会话' }),
    );

    await waitFor(() => expect(revokeCalls).toHaveLength(1));
    expect(revokeCalls[0].headers.get('x-csrf-token')).toBe(session.csrf_token);

    // 严格核查敏感密码与 TOTP 均不写入 Query Cache 与 localStorage
    const cacheDump =
      JSON.stringify(client.getQueryCache().getAll()) +
      JSON.stringify(
        client
          .getMutationCache()
          .getAll()
          .map((m) => m.state),
      );
    expect(cacheDump).not.toContain(secretPassword);
    expect(cacheDump).not.toContain('778899');
    expect(JSON.stringify(window.localStorage)).not.toContain(secretPassword);
    expect(JSON.stringify(window.localStorage)).not.toContain('778899');
  });
});
