import { expect, test } from '@playwright/test';

const session = () => ({
  state: 'authenticated',
  server_time: new Date().toISOString(),
  csrf_token: 'synthetic-csrf',
  expires_at: new Date(Date.now() + 43200000).toISOString(),
  idle_expires_at: new Date(Date.now() + 900000).toISOString(),
  idle_timeout_seconds: 900,
});
const row = {
  id: crypto.randomUUID(),
  account_no: 'GM-000035',
  gmail_email: 'synthetic@gmail.com',
  registered_at: '2026-11-01T00:00:00Z',
  recovery_email: 'recovery@example.test',
  status: 'normal',
  two_factor_status: 'unknown',
  tags: [],
  row_version: 1,
};
test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (url.pathname.includes('/auth/'))
      return route.fulfill({ json: session() });
    if (url.pathname.endsWith('/tags')) return route.fulfill({ json: [] });
    if (url.pathname.endsWith('/summary'))
      return route.fulfill({
        json: {
          total: 35,
          normal: 35,
          pending_verification: 0,
          abnormal: 0,
          added_this_month: 35,
          unverified_over_30_days: 0,
        },
      });
    if (url.pathname.endsWith('batch-status'))
      return route.fulfill({ json: { updated_ids: [row.id] } });
    if (url.pathname.endsWith('/accounts'))
      return route.fulfill({
        json: {
          items: [row],
          total: 35,
          page: Number(url.searchParams.get('page') || 1),
          page_size: 30,
        },
      });
    return route.fulfill({ status: 404, json: {} });
  });
});
test('URL刷新/前后导航、当前页选择与固定列和键盘确认（响应桩）', async ({
  page,
}) => {
  await page.goto('/?search=synthetic&page=2');
  await expect(page.getByText('共 35 条 · 第 2 / 2 页')).toBeVisible();
  await page.getByLabel('筛选状态', { exact: true }).selectOption('normal');
  await expect(page).not.toHaveURL(/page=2/);
  await page.reload();
  await expect(page.getByLabel('筛选状态', { exact: true })).toHaveValue(
    'normal',
  );
  await page.getByLabel('选择当前页全部账号').check();
  await page.getByRole('button', { name: '批量修改状态' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alertdialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: '批量修改状态' }),
  ).toBeFocused();
  await page.goBack();
  await expect(page.getByText('共 35 条 · 第 2 / 2 页')).toBeVisible();
  await expect(page.getByText('已选当前页 0 条（不跨页）')).toBeVisible();
  await page.goForward();
  await expect(page.getByLabel('筛选状态', { exact: true })).toHaveValue(
    'normal',
  );
  await page.setViewportSize({ width: 1280, height: 720 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const head = page.getByRole('columnheader', { name: '操作', exact: true });
  expect(await head.evaluate((el) => getComputedStyle(el).position)).toBe(
    'sticky',
  );
});
test('真实浏览器可信交互触发activity，后台刷新不保活，绝对到期锁定（响应桩）', async ({
  page,
}) => {
  let activities = 0;
  const now = Date.now();
  const auth = {
    ...session(),
    server_time: new Date(now).toISOString(),
    idle_expires_at: new Date(now + 10000).toISOString(),
    expires_at: new Date(now + 20000).toISOString(),
    idle_timeout_seconds: 10,
  };
  await page.clock.install({ time: now });
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ json: auth }),
  );
  await page.route('**/api/v1/auth/logout', (route) =>
    route.fulfill({ json: { status: 'ok' } }),
  );
  await page.route('**/api/v1/auth/activity', (route) => {
    activities++;
    return route.fulfill({
      json: {
        ...auth,
        server_time: new Date(
          now + (activities === 1 ? 5000 : 14000),
        ).toISOString(),
        idle_expires_at: new Date(
          now + (activities === 1 ? 15000 : 24000),
        ).toISOString(),
      },
    });
  });
  await page.goto('/');
  await page.clock.runFor(5000);
  expect(activities).toBe(0);
  await page.getByRole('button', { name: '刷新列表' }).click();
  await expect.poll(() => activities).toBe(1);
  await page.clock.runFor(9000);
  await expect(page.getByRole('heading', { name: '账号管理' })).toBeVisible();
  await page.getByRole('button', { name: '刷新列表' }).click();
  await expect.poll(() => activities).toBe(2);
  await page.clock.runFor(4000);
  await expect(page.getByRole('heading', { name: '账号管理' })).toBeVisible();
  await page.clock.runFor(4000);
  await expect(
    page.getByText('界面已锁定，请刷新页面后重新验证。'),
  ).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  expect(activities).toBe(2);
});
