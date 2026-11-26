import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import {
  assertNoOverflow,
  installDeterministicMacosApp,
  MACOS_PAGES,
  openMacosPage,
} from './helpers/macos-fixtures';

const SPEC_VIEWPORTS = [
  { name: '1280x720', width: 1280, height: 720 },
  { name: '1440x900', width: 1440, height: 900 },
  { name: '1920x1080', width: 1920, height: 1080 },
] as const;

async function assertZeroSeriousOrCriticalAxe(page: Page, label: string) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const severe = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  const summary = severe.map((v) => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
  }));
  expect(summary, `${label}: axe-core Serious/Critical 违规`).toEqual([]);
}

test.describe('Wave 4 (TC-P2-003 & TC-P2-004): WCAG 2.1 AA 无障碍与三浏览器多视口兼容', () => {
  test('TC-P2-003: 登录页（未认证态 + 表单校验态）零 Serious/Critical 无障碍违规且无溢出', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/v1/auth/session', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          state: 'anonymous',
          csrf_token: 'csrf-anon-a11y-001',
          idle_timeout_seconds: 900,
          reauthenticated_until: null,
          mfa_reauthenticated_until: null,
          step_up_totp_required: true,
          server_time: '2026-11-25T10:00:00Z',
        }),
      });
    });

    await page.goto('/');
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible();
    await assertNoOverflow(page, '登录页 1440x900');
    await assertZeroSeriousOrCriticalAxe(page, '登录页初始态');

    // 提交空表单验证错误提示态的可访问性
    await page.getByRole('button', { name: '登录' }).click();
    await assertZeroSeriousOrCriticalAxe(page, '登录页校验态');
    expect(pageErrors).toEqual([]);
  });

  test('TC-P2-003: 已登录核心页面及弹窗（Dialog / Sheet / AlertDialog）WCAG 2.1 AA 零严重违规', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await page.setViewportSize({ width: 1440, height: 900 });
    await installDeterministicMacosApp(page, { navAlpha: 60 });

    // 1. 账号列表 + 新建账号 Dialog + 批量确认 AlertDialog
    await openMacosPage(page, 'accounts');
    await assertZeroSeriousOrCriticalAxe(page, '账号列表页');

    await page.getByRole('button', { name: '新建账号' }).first().click();
    await expect(page.getByRole('dialog', { name: '新建账号' })).toBeVisible();
    await assertZeroSeriousOrCriticalAxe(page, '新建账号弹窗');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: '新建账号' })).toHaveCount(0);

    // 2. 账号详情页
    await openMacosPage(page, 'account-detail');
    await assertZeroSeriousOrCriticalAxe(page, '账号详情页');

    // 3. CSV 导入页 + 导出弹窗
    await openMacosPage(page, 'csv-import', { populateCsv: true });
    await assertZeroSeriousOrCriticalAxe(page, 'CSV 导入页');
    await page.getByRole('button', { name: '导出数据' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await assertZeroSeriousOrCriticalAxe(page, 'CSV 导出弹窗');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 4. 系统设置页 + 改密 Modal + 生命周期策略 Sheet
    await openMacosPage(page, 'settings');
    await assertZeroSeriousOrCriticalAxe(page, '系统设置页');
    await page.getByRole('button', { name: '修改密码…' }).click();
    await expect(
      page.getByRole('dialog', { name: '修改管理员密码' }),
    ).toBeVisible();
    await assertZeroSeriousOrCriticalAxe(page, '系统设置改密弹窗');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: '修改管理员密码' }),
    ).toHaveCount(0);

    await page.getByRole('button', { name: '调整策略…' }).click();
    await expect(
      page.getByRole('dialog', { name: '调整保留与生命周期策略' }),
    ).toBeVisible();
    await assertZeroSeriousOrCriticalAxe(page, '系统设置生命周期抽屉');
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('dialog', { name: '调整保留与生命周期策略' }),
    ).toHaveCount(0);

    expect(pageErrors).toEqual([]);
  });

  for (const vp of SPEC_VIEWPORTS) {
    test(`TC-P2-004: ${vp.name} 视口布局、无页面级横向溢出与毛玻璃透明度滑块交互`, async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      const consoleErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await installDeterministicMacosApp(page, { navAlpha: 60 });

      for (const spec of MACOS_PAGES) {
        await openMacosPage(page, spec.id, { populateCsv: true });
        await assertNoOverflow(page, `${spec.label} @ ${vp.name}`);
      }

      // 回到账号列表验证表格仅容器内横向滚动，且毛玻璃透明度滑块在三引擎下正常响应
      await openMacosPage(page, 'accounts');
      const tableCheck = await page.evaluate(() => {
        const docOverflow =
          document.documentElement.scrollWidth - window.innerWidth;
        const table = document.querySelector('table');
        return {
          docOverflow,
          hasTable: Boolean(table),
        };
      });
      expect(tableCheck.hasTable).toBe(true);
      expect(tableCheck.docOverflow).toBeLessThanOrEqual(1);

      await page.getByRole('button', { name: '界面与显示设置' }).click();
      const slider = page.getByRole('slider', { name: '导航栏毛玻璃透明度' });
      await expect(slider).toBeVisible();
      await slider.focus();
      await page.keyboard.press('ArrowRight');
      await expect(slider).toHaveValue('61');
      await page.keyboard.press('ArrowLeft');
      await expect(slider).toHaveValue('60');

      expect(pageErrors, `${vp.name} pageerror`).toEqual([]);
      expect(consoleErrors, `${vp.name} console.error`).toEqual([]);
    });
  }
});
