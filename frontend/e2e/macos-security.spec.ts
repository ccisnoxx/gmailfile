import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  assertNoSensitiveLeak,
  buildSyntheticCsvPayload,
  installDeterministicMacosApp,
  MACOS_PAGES,
  openMacosPage,
  SECONDARY_ACCOUNT_ID,
  SENTINELS,
} from './helpers/macos-fixtures';

const FRONTEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);

const ALL_SENTINELS = Object.values(SENTINELS);

async function dispatchPageHide(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

test.describe('安全边界：敏感内容绝不进入截图、Trace 或浏览器存储', () => {
  test('Playwright 全局配置强制关闭 trace、失败截图与录屏，防止敏感输入落盘', async () => {
    const configPath = path.join(FRONTEND_ROOT, 'playwright.config.ts');
    const source = fs.readFileSync(configPath, 'utf-8');

    expect(source).toMatch(/trace:\s*['"]off['"]/);
    expect(source).toMatch(/screenshot:\s*['"]off['"]/);
    expect(source).toMatch(/video:\s*['"]off['"]/);

    // 确认 test-results 中不存在包含哨兵密钥的 trace zip 文件
    const testResultsDir = path.join(FRONTEND_ROOT, 'test-results');
    if (fs.existsSync(testResultsDir)) {
      const stack = [testResultsDir];
      const traceFiles: string[] = [];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        for (const entry of fs.readdirSync(cur, { withFileTypes: true })) {
          const full = path.join(cur, entry.name);
          if (entry.isDirectory()) stack.push(full);
          else if (entry.name.endsWith('.zip')) traceFiles.push(full);
        }
      }
      expect(traceFiles, '禁止生成包含敏感上下文的 trace .zip').toEqual([]);
    }
  });

  test('账号列表与账号详情：密码默认掩码、绝不写入存储、隐藏/切页/编辑时立即清除', async ({
    page,
  }) => {
    await installDeterministicMacosApp(page, { navAlpha: 60 });

    // 1. 账号列表绝不渲染或存储明文密码
    await openMacosPage(page, 'accounts');
    await assertNoSensitiveLeak(page, ALL_SENTINELS, '账号列表默认态');

    // 2. 账号详情默认掩码，无明文密码泄露
    await openMacosPage(page, 'account-detail');
    await assertNoSensitiveLeak(page, ALL_SENTINELS, '账号详情默认掩码态');

    // 3. 重新验证后按需显示密码：仅短时存在于组件内存，绝不写入任何浏览器存储
    await page.getByRole('button', { name: '显示密码' }).click();
    await page.getByLabel('当前管理员密码').fill(SENTINELS.adminPassword);
    await page.getByRole('button', { name: '重新验证' }).click();
    await expect(page.getByRole('button', { name: '显示密码' })).toBeVisible();
    await page.getByRole('button', { name: '显示密码' }).click();
    await expect(page.getByLabel('登录密码')).toHaveText(
      SENTINELS.accountPassword,
    );

    // 即使在显示状态，所有浏览器持久化存储中仍不得出现任何哨兵密钥
    const storageDump = await page.evaluate(async () => {
      const idb =
        'indexedDB' in window && typeof indexedDB.databases === 'function'
          ? JSON.stringify(await indexedDB.databases())
          : '';
      const cacheKeys =
        'caches' in window && typeof caches.keys === 'function'
          ? JSON.stringify(await caches.keys())
          : '';
      return (
        JSON.stringify(window.localStorage) +
        JSON.stringify(window.sessionStorage) +
        document.cookie +
        idb +
        cacheKeys
      );
    });
    for (const secret of ALL_SENTINELS) {
      expect(storageDump).not.toContain(secret);
    }

    // 4. 页面切入后台（visibilitychange hidden=true）立即清空明文密码
    await dispatchPageHide(page);
    await assertNoSensitiveLeak(
      page,
      ALL_SENTINELS,
      '账号详情 visibilitychange 隐藏后',
    );

    // 5. 切回前台再显示 -> 进入编辑模式 -> 密码输入框必须留空且不得回填原密码
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.getByRole('button', { name: '显示密码' }).click();
    await expect(page.getByLabel('登录密码')).toHaveText(
      SENTINELS.accountPassword,
    );
    await page.getByRole('button', { name: '编辑' }).click();
    await expect(page.getByLabel(/登录密码/)).toHaveValue('');
    await assertNoSensitiveLeak(page, ALL_SENTINELS, '账号详情编辑模式');

    // 6. 切换至其他账号同样不得残留上一账号敏感内容
    await page.goto(`/accounts/${SECONDARY_ACCOUNT_ID}`);
    await expect(
      page.getByRole('heading', { name: 'billing.archive@gmail.com' }),
    ).toBeVisible();
    await assertNoSensitiveLeak(page, ALL_SENTINELS, '账号详情切换账号后');
  });

  test('系统设置：管理员改密与恢复码在后台切换/关闭后立即清除且不进入存储', async ({
    page,
  }) => {
    await installDeterministicMacosApp(page, { navAlpha: 60 });
    await openMacosPage(page, 'settings');
    await assertNoSensitiveLeak(page, ALL_SENTINELS, '系统设置默认态');

    // 1. 修改密码弹窗输入凭据后切入后台 -> AuthMachine 清空工作区状态并立即销毁敏感弹窗与输入
    await page.getByRole('button', { name: '修改密码…' }).click();
    const pwdDialog = page.getByRole('dialog', { name: '修改管理员密码' });
    await pwdDialog.getByLabel('当前管理员密码').fill(SENTINELS.adminPassword);
    await pwdDialog
      .getByLabel('新密码（至少 16 位）')
      .fill(SENTINELS.newAdminPassword);
    await pwdDialog.getByLabel('确认新密码').fill(SENTINELS.newAdminPassword);

    await dispatchPageHide(page);
    await expect(pwdDialog).toHaveCount(0);
    await assertNoSensitiveLeak(page, ALL_SENTINELS, '修改密码弹窗后台隐藏后');

    // 恢复前台状态，验证重新生成恢复码后离线保存完成清除 DOM 与存储
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        get: () => false,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await page.getByRole('button', { name: '查看 / 重新生成…' }).click();
    const recDialog = page.getByRole('dialog', {
      name: '查看 / 重新生成恢复码',
    });
    await recDialog.getByLabel('当前管理员密码').fill(SENTINELS.adminPassword);
    await recDialog.getByLabel('TOTP 验证码（6 位）').fill(SENTINELS.totpCode);
    await recDialog.getByRole('button', { name: '验证并重新生成' }).click();
    await expect(page.getByLabel('新生成的备用恢复码')).toContainText(
      SENTINELS.recoveryCode,
    );

    // 恢复码显示期间也不允许写入 localStorage / sessionStorage / cookie
    const storageWhileOpen = await page.evaluate(
      () =>
        JSON.stringify(window.localStorage) +
        JSON.stringify(window.sessionStorage) +
        document.cookie,
    );
    expect(storageWhileOpen).not.toContain(SENTINELS.recoveryCode);
    expect(storageWhileOpen).not.toContain(SENTINELS.adminPassword);
    expect(storageWhileOpen).not.toContain(SENTINELS.totpCode);

    await page
      .getByRole('checkbox', { name: '我已将上述 10 个恢复码离线保存' })
      .check();
    await page.getByRole('button', { name: '完成并清除展示' }).click();
    await assertNoSensitiveLeak(page, ALL_SENTINELS, '恢复码关闭清除后');
  });

  test('CSV 导入：上传含密码文件时 DOM 严格掩码，不写存储，切入后台自动清空内存文件', async ({
    page,
  }) => {
    await installDeterministicMacosApp(page, { navAlpha: 60 });
    await openMacosPage(page, 'csv-import');

    await page
      .getByLabel('选择 CSV 文件')
      .setInputFiles(buildSyntheticCsvPayload(SENTINELS.csvPassword));
    await expect(page.getByText('csv.alpha@gmail.com')).toBeVisible();

    // 明文密码绝不能出现在预览表、映射样本、DOM 或浏览器存储中
    await expect(
      page.locator('[data-slot="password-sample-masked"]'),
    ).toContainText('••••');
    await assertNoSensitiveLeak(page, ALL_SENTINELS, 'CSV 预览态');

    // 页面切入后台自动清空内存 CSV 文件与预览数据（由 AuthMachine + CsvImportPage 双重清零）
    await dispatchPageHide(page);
    await expect(page.getByText('csv.alpha@gmail.com')).toHaveCount(0);
    await expect(page.getByText(/暂无预览数据/)).toBeVisible();
    await assertNoSensitiveLeak(page, ALL_SENTINELS, 'CSV 页面隐藏清除后');
  });

  test('截图前安全守卫：四个页面截图态均零哨兵敏感明文', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await installDeterministicMacosApp(page, { navAlpha: 60 });

    for (const spec of MACOS_PAGES) {
      await openMacosPage(page, spec.id, { populateCsv: true });
      await assertNoSensitiveLeak(
        page,
        ALL_SENTINELS,
        `视觉基线前置守卫 ${spec.label}`,
      );
    }
  });
});
