import { expect, test } from '@playwright/test';
import {
  assertNoOverflow,
  buildSyntheticCsvPayload,
  installDeterministicMacosApp,
  MACOS_PAGES,
  OPACITIES,
  openMacosPage,
  PRIMARY_ACCOUNT_ID,
  SENTINELS,
  VIEWPORTS,
  waitForStableFontsAndPaint,
} from './helpers/macos-fixtures';

test.describe('四个 macOS 页面：多分辨率、透明度、状态、200% 缩放与减弱动态效果', () => {
  for (const vp of VIEWPORTS) {
    test(`分辨率 ${vp.name}：四个页面渲染完整且无意外溢出`, async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await installDeterministicMacosApp(page, { navAlpha: 60 });

      for (const spec of MACOS_PAGES) {
        await openMacosPage(page, spec.id, { populateCsv: true });
        await assertNoOverflow(page, `${spec.label} @ ${vp.name}`);
      }

      expect(pageErrors, `pageerror @ ${vp.name}`).toEqual([]);
    });
  }

  for (const alpha of OPACITIES) {
    test(`毛玻璃透明度 ${alpha}%：四个页面正确应用 --nav-alpha、同步 localStorage 且无溢出`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await installDeterministicMacosApp(page, { navAlpha: alpha });

      for (const spec of MACOS_PAGES) {
        await openMacosPage(page, spec.id, { populateCsv: true });

        const cssAlpha = await page
          .locator('[data-slot="app-window-shell"]')
          .evaluate((el) =>
            getComputedStyle(el).getPropertyValue('--nav-alpha').trim(),
          );
        expect(
          Number(cssAlpha),
          `${spec.label} --nav-alpha should equal ${alpha / 100}`,
        ).toBeCloseTo(alpha / 100, 2);

        const navSurfaceBg = await page
          .locator('.macos-nav-surface')
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor);
        expect(navSurfaceBg).toMatch(/rgba?\(/);

        const stored = await page.evaluate(() =>
          window.localStorage.getItem('gm_nav_alpha'),
        );
        expect(stored).toBe(String(alpha));

        await assertNoOverflow(page, `${spec.label} @ alpha=${alpha}%`);
      }
    });
  }

  test('透明度滑块实时联动：在账号列表切换 35% -> 60% -> 90% 并跨四页同步持久化', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installDeterministicMacosApp(page, { navAlpha: 60 });
    await openMacosPage(page, 'accounts');

    await page.getByRole('button', { name: '界面与显示设置' }).click();
    const slider = page.getByRole('slider', { name: '导航栏毛玻璃透明度' });
    await expect(slider).toBeVisible();

    for (const alpha of OPACITIES) {
      await slider.fill(String(alpha));
      await expect(slider).toHaveValue(String(alpha));
      const cssAlpha = await page
        .locator('[data-slot="app-window-shell"]')
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue('--nav-alpha').trim(),
        );
      expect(Number(cssAlpha)).toBeCloseTo(alpha / 100, 2);
      expect(
        await page.evaluate(() => window.localStorage.getItem('gm_nav_alpha')),
      ).toBe(String(alpha));
    }

    // 90% 应自动同步到账号详情、系统设置与 CSV 导入页面
    for (const pageId of [
      'account-detail',
      'settings',
      'csv-import',
    ] as const) {
      await openMacosPage(page, pageId);
      const cssAlpha = await page
        .locator('[data-slot="app-window-shell"]')
        .evaluate((el) =>
          getComputedStyle(el).getPropertyValue('--nav-alpha').trim(),
        );
      expect(Number(cssAlpha), `${pageId} synced --nav-alpha`).toBeCloseTo(
        0.9,
        2,
      );
    }
  });

  test('加载、空状态与错误恢复状态：账号列表', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const app = await installDeterministicMacosApp(page, {
      navAlpha: 60,
      pageMode: 'loading',
    });

    await openMacosPage(page, 'accounts', { mode: 'loading' });
    await assertNoOverflow(page, '账号列表 loading');

    app.releaseLoading();
    await expect(
      page.getByRole('button', { name: 'ops.primary@gmail.com', exact: true }),
    ).toBeVisible();

    app.setPageMode('empty');
    await openMacosPage(page, 'accounts', { mode: 'empty' });
    await assertNoOverflow(page, '账号列表 empty');

    app.setPageMode('error');
    await openMacosPage(page, 'accounts', { mode: 'error' });
    await expect(page.getByRole('alert')).toContainText('账号加载失败');
    await assertNoOverflow(page, '账号列表 error');

    // 点击重试恢复
    app.setPageMode('ready');
    await page.getByRole('button', { name: /重试/ }).click();
    await expect(
      page.getByRole('button', { name: 'ops.primary@gmail.com', exact: true }),
    ).toBeVisible();
  });

  test('加载、空状态与错误恢复状态：账号详情', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const app = await installDeterministicMacosApp(page, {
      navAlpha: 60,
      pageMode: 'loading',
    });

    await openMacosPage(page, 'account-detail', {
      mode: 'loading',
      accountId: PRIMARY_ACCOUNT_ID,
    });
    await assertNoOverflow(page, '账号详情 loading');

    app.releaseLoading();
    await expect(
      page.getByRole('heading', { name: 'ops.primary@gmail.com' }),
    ).toBeVisible();

    app.setPageMode('empty');
    await openMacosPage(page, 'account-detail', {
      mode: 'empty',
      accountId: PRIMARY_ACCOUNT_ID,
    });
    await expect(page.getByText('未找到该账号')).toBeVisible();
    await assertNoOverflow(page, '账号详情 empty');

    app.setPageMode('error');
    await openMacosPage(page, 'account-detail', {
      mode: 'error',
      accountId: PRIMARY_ACCOUNT_ID,
    });
    await expect(page.getByRole('alert').first()).toContainText('加载失败');
    await assertNoOverflow(page, '账号详情 error');

    app.setPageMode('ready');
    await page.getByRole('button', { name: '重试加载' }).last().click();
    await expect(
      page.getByRole('heading', { name: 'ops.primary@gmail.com' }),
    ).toBeVisible();
  });

  test('加载、空状态与错误恢复状态：系统设置', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const app = await installDeterministicMacosApp(page, {
      navAlpha: 60,
      pageMode: 'loading',
    });

    await openMacosPage(page, 'settings', { mode: 'loading' });
    await assertNoOverflow(page, '系统设置 loading');

    app.releaseLoading();
    await expect(page.getByText('192.0.2.10').first()).toBeVisible();

    app.setPageMode('empty');
    await openMacosPage(page, 'settings', { mode: 'empty' });
    await assertNoOverflow(page, '系统设置 empty');

    app.setPageMode('error');
    await openMacosPage(page, 'settings', { mode: 'error' });
    await expect(page.getByRole('alert').first()).toBeVisible();
    await assertNoOverflow(page, '系统设置 error');

    app.setPageMode('ready');
    await page.getByRole('button', { name: /重试/ }).first().click();
    await expect(page.getByText('192.0.2.10').first()).toBeVisible();
  });

  test('加载、空状态与错误状态：CSV 导入', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const app = await installDeterministicMacosApp(page, {
      navAlpha: 60,
      pageMode: 'ready',
    });

    // 空状态（未上传文件）
    await openMacosPage(page, 'csv-import', { mode: 'empty' });
    await expect(page.getByRole('button', { name: '开始导入' })).toBeDisabled();
    await assertNoOverflow(page, 'CSV 导入 empty');

    // 加载状态（预览请求挂起）
    app.setPageMode('loading');
    await page
      .getByLabel('选择 CSV 文件')
      .setInputFiles(buildSyntheticCsvPayload());
    await expect(page.getByText('正在校验 CSV 文件…')).toBeVisible();
    await assertNoOverflow(page, 'CSV 导入 loading');

    app.releaseLoading();
    await expect(page.getByText('csv.alpha@gmail.com')).toBeVisible();

    // 错误状态（服务端 422 或含错误行）
    await page.getByRole('button', { name: '移除文件' }).click();
    await page
      .getByLabel('选择 CSV 文件')
      .setInputFiles(
        buildSyntheticCsvPayload(SENTINELS.csvPassword, { withErrors: true }),
      );
    await expect(page.getByRole('alert').first()).toContainText('错误');
    await expect(page.getByRole('button', { name: '开始导入' })).toBeDisabled();
    await assertNoOverflow(page, 'CSV 导入 error');
  });

  test('200% 缩放（640×400 @ 2x 与 200% 字体缩放）：四个页面无横向溢出且核心操作可达', async ({
    browser,
    baseURL,
  }) => {
    // 1. 浏览器 200% 视口缩放模拟：1280×800 逻辑分辨率缩放 200% = 640×400 CSS px @ DPR 2
    const zoomContext = await browser.newContext({
      baseURL,
      viewport: { width: 640, height: 400 },
      deviceScaleFactor: 2,
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    const zoomPage = await zoomContext.newPage();
    try {
      await installDeterministicMacosApp(zoomPage, { navAlpha: 60 });
      for (const spec of MACOS_PAGES) {
        await openMacosPage(zoomPage, spec.id, { populateCsv: true });
        await assertNoOverflow(zoomPage, `${spec.label} @ 200% viewport zoom`);
      }
    } finally {
      await zoomContext.close();
    }

    // 2. WCAG 1.4.4 200% 文本缩放（1280×800 + html font-size: 200%）
    const textZoomContext = await browser.newContext({
      baseURL,
      viewport: { width: 1280, height: 800 },
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
    });
    const textZoomPage = await textZoomContext.newPage();
    try {
      await installDeterministicMacosApp(textZoomPage, { navAlpha: 60 });
      for (const spec of MACOS_PAGES) {
        await openMacosPage(textZoomPage, spec.id, { populateCsv: true });
        await textZoomPage.addStyleTag({
          content: 'html { font-size: 200% !important; }',
        });
        await waitForStableFontsAndPaint(textZoomPage);
        await assertNoOverflow(textZoomPage, `${spec.label} @ 200% text zoom`);
      }
    } finally {
      await textZoomContext.close();
    }
  });

  test('reduced motion：遵循 prefers-reduced-motion: reduce 且支持应用内动画开关', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installDeterministicMacosApp(page, {
      navAlpha: 60,
      reducedMotion: true,
    });

    for (const spec of MACOS_PAGES) {
      await openMacosPage(page, spec.id, { populateCsv: true });

      const motionCheck = await page.evaluate(() => {
        const matches = window.matchMedia(
          '(prefers-reduced-motion: reduce)',
        ).matches;
        const parseSeconds = (val: string) => {
          const first = val.split(',')[0].trim();
          if (first.endsWith('ms')) return Number.parseFloat(first) / 1000;
          if (first.endsWith('s')) return Number.parseFloat(first);
          return 0;
        };
        const samples = Array.from(
          document.querySelectorAll<HTMLElement>(
            '[data-slot="app-window-shell"], .macos-nav-surface, button, .macos-spinner',
          ),
        ).slice(0, 20);
        const maxAnim = Math.max(
          0,
          ...samples.map((el) =>
            parseSeconds(getComputedStyle(el).animationDuration),
          ),
        );
        const maxTrans = Math.max(
          0,
          ...samples.map((el) =>
            parseSeconds(getComputedStyle(el).transitionDuration),
          ),
        );
        return { matches, maxAnim, maxTrans };
      });

      expect(motionCheck.matches).toBe(true);
      expect(
        motionCheck.maxAnim,
        `${spec.label}: animationDuration under reduced-motion`,
      ).toBeLessThanOrEqual(0.002);
      expect(
        motionCheck.maxTrans,
        `${spec.label}: transitionDuration under reduced-motion`,
      ).toBeLessThanOrEqual(0.002);
    }

    // 验证账号详情页内“显示设置 -> 界面动画效果”开关同步 data-animations="off"
    await openMacosPage(page, 'account-detail');
    await page.getByRole('button', { name: '显示设置' }).click();
    const animSwitch = page.getByRole('switch', { name: '界面动画效果' });
    await expect(animSwitch).toHaveAttribute('aria-checked', 'true');
    await animSwitch.click();
    await expect(animSwitch).toHaveAttribute('aria-checked', 'false');
    await expect(page.locator('[data-animations="false"]')).toBeVisible();
  });
});
