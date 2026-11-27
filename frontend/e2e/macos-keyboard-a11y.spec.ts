import { expect, test } from '@playwright/test';
import {
  assertFocusTrap,
  assertNoOverflow,
  assertWcag22AA,
  installDeterministicMacosApp,
  MACOS_PAGES,
  OPACITIES,
  openMacosPage,
} from './helpers/macos-fixtures';

test.describe('四个 macOS 页面：WCAG 2.2 AA、键盘导航、Focus Trap 与 Escape', () => {
  for (const alpha of OPACITIES) {
    test(`WCAG 2.2 AA 全检（透明度 ${alpha}%）：四个页面零违规且触控目标 ≥ 24px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await installDeterministicMacosApp(page, { navAlpha: alpha });

      for (const spec of MACOS_PAGES) {
        await openMacosPage(page, spec.id, { populateCsv: true });
        await assertWcag22AA(page, `${spec.label} @ alpha=${alpha}%`);
      }
    });
  }

  test('WCAG 2.2 AA 全检：加载、空状态与错误状态均零违规', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const app = await installDeterministicMacosApp(page, { navAlpha: 60 });

    for (const mode of ['loading', 'empty', 'error'] as const) {
      app.setPageMode(mode);
      for (const spec of MACOS_PAGES) {
        await openMacosPage(page, spec.id, {
          mode,
          settingsUiStateQuery: true,
        });
        await assertWcag22AA(page, `${spec.label} [${mode}]`);
      }
      if (mode === 'loading') {
        app.releaseLoading();
      }
    }
  });

  test('账号列表：键盘导航、滑块键盘调节、弹窗 Focus Trap 与 Escape 焦点恢复', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installDeterministicMacosApp(page, { navAlpha: 60 });
    await openMacosPage(page, 'accounts');

    // 1. 打开「界面与显示设置」浮层，透明度滑块支持键盘方向键调节且 Escape 恢复焦点
    const displayBtn = page.getByRole('button', { name: '界面与显示设置' });
    await displayBtn.click();
    const slider = page.getByRole('slider', { name: '导航栏毛玻璃透明度' });
    await slider.focus();
    await assertWcag22AA(page, '账号列表滑块聚焦态', {
      checkTargetSize: false,
      checkFocusNotObscured: true,
    });
    await page.keyboard.press('ArrowRight');
    await expect(slider).toHaveValue('61');
    await page.keyboard.press('ArrowLeft');
    await expect(slider).toHaveValue('60');
    await page.keyboard.press('Escape');
    await expect(displayBtn).toBeFocused();

    // 2. 顶部通知浮层与管理员菜单：Escape 关闭并恢复焦点到触发按钮
    const notifBtn = page.getByRole('button', { name: '通知' });
    await notifBtn.click();
    await expect(page.getByRole('region', { name: '系统通知' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: '系统通知' })).toHaveCount(0);
    await expect(notifBtn).toBeFocused();

    // 3. “新建账号” Dialog：WCAG 2.2 AA + 严格 Focus Trap + Escape 关闭并恢复焦点
    const createBtn = page.getByRole('button', { name: '新建账号' }).first();
    await createBtn.focus();
    await page.keyboard.press('Enter');
    const createDialog = page.getByRole('dialog', { name: '新建账号' });
    await expect(createDialog).toBeVisible();
    await assertNoOverflow(page, '账号列表 新建账号弹窗');
    await assertWcag22AA(page, '账号列表 新建账号弹窗');
    await assertFocusTrap(page, createDialog, '账号列表 新建账号弹窗');
    await page.keyboard.press('Escape');
    await expect(createDialog).toHaveCount(0);
    await expect(createBtn).toBeFocused();

    // 4. 批量确认 AlertDialog：Focus Trap + Escape 关闭并恢复焦点
    await page.getByLabel('选择当前页全部账号').check();
    const batchStatusBtn = page.getByRole('button', { name: '批量修改状态' });
    await batchStatusBtn.focus();
    await page.keyboard.press('Enter');
    const batchAlert = page.getByRole('alertdialog');
    await assertNoOverflow(page, '账号列表 批量修改确认框');
    await assertWcag22AA(page, '账号列表 批量修改确认框');
    await assertFocusTrap(page, batchAlert, '账号列表 批量修改确认框');
    await page.keyboard.press('Escape');
    await expect(batchAlert).toHaveCount(0);
    await expect(batchStatusBtn).toBeFocused();
  });

  test('账号详情：⌘K 快捷搜索、双 Tablist 键盘方向键、分层 Escape 与弹窗 Focus Trap', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installDeterministicMacosApp(page, { navAlpha: 60 });
    await openMacosPage(page, 'account-detail');

    // 1. Ctrl+K / ⌘K 聚焦顶部搜索框
    await page.keyboard.press('Control+k');
    const searchInput = page.getByLabel('搜索账号');
    await expect(searchInput).toBeFocused();

    // 2. 列表筛选 Tablist（全部 / 正常 / 停用 / 已归档）方向键与 Home/End
    const filterAll = page.getByRole('tab', { name: '全部' });
    await filterAll.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: '正常' })).toBeFocused();
    await expect(page.getByRole('tab', { name: '正常' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: '已归档' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(filterAll).toBeFocused();

    // 3. 详情子标签 Tablist 方向键切换并移动焦点
    const basicTab = page.getByRole('tab', { name: '基本信息' });
    await basicTab.focus();
    await page.keyboard.press('ArrowRight');
    const credTab = page.getByRole('tab', { name: '安全凭据' });
    await expect(credTab).toBeFocused();
    await expect(credTab).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: '备份版本' })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(basicTab).toBeFocused();

    // 4. “显示设置” Popover：Space 切换开关，Escape 关闭并恢复焦点
    const displayBtn = page.getByRole('button', { name: '显示设置' });
    await displayBtn.click();
    await assertWcag22AA(page, '账号详情 显示设置浮层');
    const compactSwitch = page.getByRole('switch', { name: '紧凑模式' });
    await compactSwitch.focus();
    await page.keyboard.press('Space');
    await expect(compactSwitch).toHaveAttribute('aria-checked', 'true');
    await page.keyboard.press('Escape');
    await expect(compactSwitch).toHaveCount(0);
    await expect(displayBtn).toBeFocused();

    // 5. 分层 Escape：编辑模式下打开“添加标签”浮层，首次 Escape 仅关浮层并回焦，二次 Escape 退出编辑模式
    await page.getByRole('button', { name: '编辑' }).click();
    await expect(page.getByRole('button', { name: '保存修改' })).toBeVisible();
    const addTagBtn = page.getByRole('button', { name: '添加标签' });
    await addTagBtn.click();
    await expect(
      page.getByRole('dialog', { name: '为账号添加标签' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: '为账号添加标签' }),
    ).toHaveCount(0);
    await expect(addTagBtn).toBeFocused();
    // 仍处于编辑模式
    await expect(page.getByRole('button', { name: '保存修改' })).toBeVisible();
    // 第二次 Escape 退出未脏编辑模式
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: '保存修改' })).toHaveCount(0);

    // 6. 归档 AlertDialog Focus Trap & Escape
    const archiveBtn = page.getByRole('button', { name: '归档', exact: true });
    await archiveBtn.click();
    const alertDialog = page.getByRole('alertdialog');
    await assertNoOverflow(page, '账号详情 归档确认框');
    await assertWcag22AA(page, '账号详情 归档确认框');
    await assertFocusTrap(page, alertDialog, '账号详情 归档确认框');
    await page.keyboard.press('Escape');
    await expect(alertDialog).toHaveCount(0);
  });

  test('系统设置：⌘K / Ctrl+K 搜索、分组 Tablist 键盘导航、Modal/Sheet Focus Trap 与 Escape 焦点恢复', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installDeterministicMacosApp(page, { navAlpha: 60 });
    await openMacosPage(page, 'settings');

    // 1. Ctrl+K 聚焦设置搜索框（不劫持浏览器原生 Ctrl+F）
    await page.keyboard.press('Control+k');
    await expect(page.getByLabel('搜索设置')).toBeFocused();

    // 2. 分段标签页方向键切换
    const securityTab = page.getByRole('tab', { name: '安全与认证' });
    await securityTab.focus();
    await page.keyboard.press('ArrowRight');
    const backupTab = page.getByRole('tab', { name: '备份与恢复' });
    await expect(backupTab).toBeFocused();
    await expect(backupTab).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await expect(securityTab).toBeFocused();

    // 3. “修改密码…” Modal Focus Trap + WCAG + Escape 恢复焦点
    const pwdBtn = page.getByRole('button', { name: '修改密码…' });
    await pwdBtn.focus();
    await page.keyboard.press('Enter');
    const pwdDialog = page.getByRole('dialog', { name: '修改管理员密码' });
    await assertNoOverflow(page, '系统设置 修改密码弹窗');
    await assertWcag22AA(page, '系统设置 修改密码弹窗');
    await assertFocusTrap(page, pwdDialog, '系统设置 修改密码弹窗');
    await page.keyboard.press('Escape');
    await expect(pwdDialog).toHaveCount(0);
    await expect(pwdBtn).toBeFocused();

    // 4. “查看 / 重新生成…” 恢复码 Modal Focus Trap + Escape
    const recBtn = page.getByRole('button', { name: '查看 / 重新生成…' });
    await recBtn.focus();
    await page.keyboard.press('Enter');
    const recDialog = page.getByRole('dialog', {
      name: '查看 / 重新生成恢复码',
    });
    await assertNoOverflow(page, '系统设置 恢复码弹窗');
    await assertWcag22AA(page, '系统设置 恢复码弹窗');
    await assertFocusTrap(page, recDialog, '系统设置 恢复码弹窗');
    await page.keyboard.press('Escape');
    await expect(recDialog).toHaveCount(0);
    await expect(recBtn).toBeFocused();

    // 5. “调整策略…” 抽屉 Sheet Focus Trap + WCAG + Escape
    const policyBtn = page.getByRole('button', { name: '调整策略…' });
    await policyBtn.focus();
    await page.keyboard.press('Enter');
    const policySheet = page.getByRole('dialog', {
      name: '调整保留与生命周期策略',
    });
    await assertNoOverflow(page, '系统设置 生命周期策略抽屉');
    await assertWcag22AA(page, '系统设置 生命周期策略抽屉');
    await assertFocusTrap(page, policySheet, '系统设置 生命周期策略抽屉');
    await page.keyboard.press('Escape');
    await expect(policySheet).toHaveCount(0);
    await expect(policyBtn).toBeFocused();

    // 6. 顶部通知浮层 Escape 恢复焦点
    const notifBtn = page.getByRole('button', { name: '通知' });
    await notifBtn.click();
    await expect(page.getByRole('region', { name: '系统通知' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: '系统通知' })).toHaveCount(0);
    await expect(notifBtn).toBeFocused();
  });

  test('CSV 导入：子标签 Tablist 键盘切换、历史/导出弹窗 Focus Trap 与 Escape', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installDeterministicMacosApp(page, { navAlpha: 60 });
    await openMacosPage(page, 'csv-import', { populateCsv: true });

    // 1. 子标签 Tablist 键盘方向键切换
    const importTab = page.getByRole('tab', { name: 'CSV 导入' });
    const batchTab = page.getByRole('tab', { name: '批量操作' });
    await importTab.focus();
    await page.keyboard.press('ArrowRight');
    await expect(batchTab).toBeFocused();
    await expect(batchTab).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowLeft');
    await expect(importTab).toBeFocused();
    await expect(importTab).toHaveAttribute('aria-selected', 'true');

    // 3. “导入历史” Dialog Focus Trap + WCAG + Escape 恢复焦点
    const historyBtn = page.getByRole('button', { name: '导入历史' });
    await historyBtn.focus();
    await page.keyboard.press('Enter');
    const historyDialog = page.getByRole('dialog');
    await assertNoOverflow(page, 'CSV 导入 历史记录弹窗');
    await assertWcag22AA(page, 'CSV 导入 历史记录弹窗');
    await assertFocusTrap(page, historyDialog, 'CSV 导入 历史记录弹窗');
    await page.keyboard.press('Escape');
    await expect(historyDialog).toHaveCount(0);
    await expect(historyBtn).toBeFocused();

    // 4. “导出数据” Dialog Focus Trap + WCAG + Escape 恢复焦点
    const exportBtn = page.getByRole('button', { name: '导出数据' });
    await exportBtn.focus();
    await page.keyboard.press('Enter');
    const exportDialog = page.getByRole('dialog');
    await assertNoOverflow(page, 'CSV 导入 导出数据弹窗');
    await assertWcag22AA(page, 'CSV 导入 导出数据弹窗');
    await assertFocusTrap(page, exportDialog, 'CSV 导入 导出数据弹窗');
    await page.keyboard.press('Escape');
    await expect(exportDialog).toHaveCount(0);
    await expect(exportBtn).toBeFocused();

    // 5. 顶部通知浮层 Escape 恢复焦点
    const notifBtn = page.getByRole('button', { name: '通知' });
    await notifBtn.click();
    await expect(page.getByRole('region', { name: '系统通知' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('region', { name: '系统通知' })).toHaveCount(0);
    await expect(notifBtn).toBeFocused();
  });
});
