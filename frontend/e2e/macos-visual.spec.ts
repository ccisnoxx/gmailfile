import { expect, test } from '@playwright/test';
import {
  ALT_NOW_ISO,
  assertNoOverflow,
  assertNoSensitiveLeak,
  getDynamicScreenshotMasks,
  installDeterministicMacosApp,
  MACOS_PAGES,
  openMacosPage,
  SENTINELS,
  VIEWPORTS,
} from './helpers/macos-fixtures';

const ALL_SENTINELS = Object.values(SENTINELS);
const MASK_COLOR = '#d9e8fb';

async function expectCleanBaselineScreenshot(
  page: import('@playwright/test').Page,
  name: string,
  contextLabel: string,
) {
  // 任何截图断言执行前必须先通过敏感内容守卫，确保敏感明文绝不进入基线截图。
  await assertNoSensitiveLeak(
    page,
    ALL_SENTINELS,
    `pre-screenshot ${contextLabel}`,
  );
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    mask: getDynamicScreenshotMasks(page),
    maskColor: MASK_COLOR,
  });
}

test.describe('四个 macOS 页面：Playwright 视觉回归基线（屏蔽动态时间、随机 ID 与动画）', () => {
  // 1. 4 页面 × 3 标准桌面分辨率（默认 60% 透明度）
  for (const vp of VIEWPORTS) {
    for (const spec of MACOS_PAGES) {
      test(`基线 [${spec.id}] ${vp.name} alpha=60%`, async ({ page }) => {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        await installDeterministicMacosApp(page, {
          navAlpha: 60,
          reducedMotion: true,
        });
        await openMacosPage(page, spec.id, { populateCsv: true });
        await assertNoOverflow(page, `${spec.label} ${vp.name} alpha=60`);
        await expectCleanBaselineScreenshot(
          page,
          `${spec.id}-${vp.name}-alpha60.png`,
          `${spec.id} ${vp.name} alpha60`,
        );
      });
    }
  }

  // 2. 4 页面 × 35% 与 90% 透明度基线（1440×900）
  for (const alpha of [35, 90] as const) {
    for (const spec of MACOS_PAGES) {
      test(`基线 [${spec.id}] 1440x900 alpha=${alpha}%`, async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await installDeterministicMacosApp(page, {
          navAlpha: alpha,
          reducedMotion: true,
        });
        await openMacosPage(page, spec.id, { populateCsv: true });
        await assertNoOverflow(page, `${spec.label} 1440x900 alpha=${alpha}`);
        await expectCleanBaselineScreenshot(
          page,
          `${spec.id}-1440x900-alpha${alpha}.png`,
          `${spec.id} 1440x900 alpha${alpha}`,
        );
      });
    }
  }

  // 3. 4 页面 × 加载 / 空状态 / 错误状态基线（1280×800）
  for (const stateMode of ['loading', 'empty', 'error'] as const) {
    for (const spec of MACOS_PAGES) {
      test(`基线 [${spec.id}] 状态=${stateMode}`, async ({ page }) => {
        await page.setViewportSize({ width: 1280, height: 800 });
        await installDeterministicMacosApp(page, {
          navAlpha: 60,
          reducedMotion: true,
          pageMode: stateMode,
        });
        await openMacosPage(page, spec.id, {
          mode: stateMode,
          settingsUiStateQuery: true,
        });
        await assertNoOverflow(page, `${spec.label} state=${stateMode}`);
        await expectCleanBaselineScreenshot(
          page,
          `${spec.id}-1280x800-${stateMode}.png`,
          `${spec.id} ${stateMode}`,
        );
      });
    }
  }

  // 4. 动态遮罩稳定性验证：变更系统时间与随机 UUID/哈希，仍应与固定基线零像素差异匹配
  for (const spec of MACOS_PAGES) {
    test(`动态时间与随机 ID 遮罩稳定性 [${spec.id}]`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      const app = await installDeterministicMacosApp(page, {
        nowIso: ALT_NOW_ISO,
        randomIds: true,
        navAlpha: 60,
        reducedMotion: true,
      });
      await openMacosPage(page, spec.id, {
        accountId: app.primaryId,
        populateCsv: true,
      });
      // 直接复用同分辨率 60% 基线，验证动态时钟、相对时间、随机 ID 与哈希已被有效屏蔽
      await expectCleanBaselineScreenshot(
        page,
        `${spec.id}-1280x800-alpha60.png`,
        `${spec.id} dynamic-mask-stability`,
      );
    });
  }
});
