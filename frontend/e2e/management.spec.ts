import { expect, test } from '@playwright/test';
import { installMockBackend } from './helpers/mock-backend';

test('URL刷新/前后导航、筛选展开、当前页选择、固定操作列与键盘确认', async ({
  page,
}) => {
  await installMockBackend(page, {
    initialState: 'authenticated',
    accounts: Array.from({ length: 35 }, (_, idx) => ({
      account_no: `GM-${String(idx + 1).padStart(6, '0')}`,
      gmail_email: `synthetic${idx + 1}@gmail.com`,
      status: 'normal',
    })),
  });

  await page.goto('/?search=synthetic&page=2');
  await expect(page.getByText('共 35 条 · 第 2 / 2 页')).toBeVisible();

  await page.getByRole('button', { name: /^筛选/ }).click();
  await page.getByLabel('筛选状态', { exact: true }).selectOption('normal');
  await expect(page).not.toHaveURL(/page=2/);

  await page.reload();
  await page.getByRole('button', { name: /^筛选/ }).click();
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
  await expect(page.getByRole('navigation', { name: '分页' })).toContainText(
    '已选择 0 项，共 35 项',
  );

  await page.goForward();
  const statusSelect = page.getByLabel('筛选状态', { exact: true });
  if (!(await statusSelect.isVisible())) {
    await page.getByRole('button', { name: /^筛选/ }).click();
  }
  await expect(statusSelect).toHaveValue('normal');

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

test('批量事务回滚：任意记录版本冲突整批回滚并定位问题编号，绝不自动重试', async ({
  page,
}) => {
  const firstId = crypto.randomUUID();
  const secondId = crypto.randomUUID();
  const backend = await installMockBackend(page, {
    initialState: 'authenticated',
    accounts: [
      {
        id: firstId,
        account_no: 'GM-000101',
        gmail_email: 'batch.first@gmail.com',
        status: 'normal',
        row_version: 1,
      },
      {
        id: secondId,
        account_no: 'GM-000102',
        gmail_email: 'batch.second@gmail.com',
        status: 'normal',
        row_version: 1,
      },
    ],
  });

  await page.goto('/');
  await page.getByLabel('选择当前页全部账号').check();
  await expect(page.getByText('已选当前页 2 条（不跨页）')).toBeVisible();

  await page.getByLabel('批量目标状态').selectOption('archived');
  await page.getByRole('button', { name: '批量修改状态' }).click();

  // 确认前第二条记录被并发修改，触发服务端整批回滚。
  backend.bumpVersion(secondId);

  const dialog = page.getByRole('alertdialog');
  await dialog.getByRole('button', { name: '确认整批提交' }).click();
  await expect(dialog.getByRole('alert')).toContainText(
    '整批未提交（GM-000102）',
  );
  await expect(dialog.getByRole('alert')).toContainText('不会自动重放');
  await expect(
    dialog.getByRole('button', { name: '确认整批提交' }),
  ).toBeDisabled();

  // 严格只发出 1 次请求，且第一条账号状态和版本都保持未修改（整批回滚）。
  expect(backend.stats.batchCalls).toBe(1);
  expect(backend.accounts.find((a) => a.id === firstId)?.status).toBe('normal');
  expect(backend.accounts.find((a) => a.id === firstId)?.row_version).toBe(1);

  // 刷新列表重新选择后整批提交成功。
  await dialog.getByRole('button', { name: '取消批量操作' }).click();
  await page.getByRole('button', { name: '刷新列表' }).click();
  await page.getByLabel('选择当前页全部账号').check();
  await page.getByLabel('批量目标状态').selectOption('archived');
  await page.getByRole('button', { name: '批量修改状态' }).click();
  await page.getByRole('button', { name: '确认整批提交' }).click();
  await expect(page.getByText('整批操作已提交。')).toBeVisible();
  expect(backend.accounts.every((a) => a.status === 'archived')).toBe(true);
});

test('Session 空闲续期：可信交互触发 activity 续期，后台不保活，绝对到期强制锁定', async ({
  page,
}) => {
  let activities = 0;
  const now = Date.now();
  const baseSession = {
    state: 'authenticated',
    server_time: new Date(now).toISOString(),
    csrf_token: 'synthetic-csrf',
    expires_at: new Date(now + 50_000).toISOString(),
    idle_expires_at: new Date(now + 30_000).toISOString(),
    idle_timeout_seconds: 30,
  };
  await page.clock.install({ time: now });
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ json: baseSession }),
  );
  await page.route('**/api/v1/auth/logout', (route) =>
    route.fulfill({ json: { status: 'ok' } }),
  );
  await page.route('**/api/v1/auth/activity', (route) => {
    activities++;
    return route.fulfill({
      json: {
        ...baseSession,
        server_time: new Date(
          now + (activities === 1 ? 10_000 : 35_000),
        ).toISOString(),
        idle_expires_at: new Date(
          now + (activities === 1 ? 40_000 : 50_000),
        ).toISOString(),
      },
    });
  });
  await page.route('**/api/v1/tags', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/v1/dashboard/summary**', (route) =>
    route.fulfill({
      json: {
        total: 1,
        normal: 1,
        pending_verification: 0,
        abnormal: 0,
        added_this_month: 1,
        unverified_over_30_days: 0,
      },
    }),
  );
  await page.route('**/api/v1/accounts**', (route) =>
    route.fulfill({
      json: {
        items: [],
        total: 0,
        page: 1,
        page_size: 30,
      },
    }),
  );

  await page.goto('/');
  await page.clock.runFor(10_000);
  expect(activities).toBe(0);

  // 可信点击触发 activity 续期，越过原 30s 闲置截止仍保持登录。
  await page.getByRole('button', { name: '刷新列表' }).click();
  await expect.poll(() => activities).toBe(1);
  await page.clock.runFor(24_000);
  await expect(page.getByRole('heading', { name: '账号管理' })).toBeVisible();

  // 再次续期接近绝对上限，但绝对到期（50s）后必须强制锁定清空界面。
  await page.getByRole('button', { name: '刷新列表' }).click();
  await expect.poll(() => activities).toBe(2);
  await page.clock.runFor(8_000);
  await expect(page.getByRole('heading', { name: '账号管理' })).toBeVisible();
  await page.clock.runFor(10_000);
  await expect(
    page.getByText('界面已锁定，请刷新页面后重新验证。'),
  ).toBeVisible();
  await expect(page.getByRole('table')).toHaveCount(0);
  expect(activities).toBe(2);
});
