import { expect, test } from '@playwright/test';

const record = () => ({
  id: crypto.randomUUID(),
  account_no: 'GM-000001',
  gmail_email: 'synthetic@gmail.com',
  registered_at: new Date().toISOString(),
  recovery_account_id: null,
  recovery_email_external: 'recovery@example.test',
  recovery_email: 'recovery@example.test',
  status: 'normal',
  two_factor_status: 'unknown',
  purpose: '合成样本',
  tags: [],
  last_login_at: null,
  last_verified_at: null,
  password_changed_at: null,
  archived_at: null,
  deleted_at: null,
  row_version: 1,
  phone: null,
  notes: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
});

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      json: {
        state: 'authenticated',
        idle_timeout_seconds: 900,
        server_time: new Date().toISOString(),
        csrf_token: crypto.randomUUID(),
        expires_at: new Date(Date.now() + 43200000).toISOString(),
        idle_expires_at: new Date(Date.now() + 900000).toISOString(),
        reauthenticated_until: null,
      },
    }),
  );
  await page.route('**/api/v1/auth/activity', (route) =>
    route.fulfill({
      json: {
        state: 'authenticated',
        idle_timeout_seconds: 900,
        server_time: new Date().toISOString(),
        csrf_token: 'synthetic-csrf',
        idle_expires_at: new Date(Date.now() + 900000).toISOString(),
        expires_at: new Date(Date.now() + 43200000).toISOString(),
      },
    }),
  );
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
  await page.route('**/api/v1/tags', (route) => route.fulfill({ json: [] }));
});

test('真实布局中的键盘抽屉、危险确认与版本请求（响应桩）', async ({ page }) => {
  const row = record();
  let writes = 0;
  await page.route('**/api/v1/accounts**', async (route) => {
    const req = route.request();
    if (req.method() !== 'GET') {
      writes++;
      expect(req.postDataJSON()).toEqual({ row_version: 1 });
      return route.fulfill({
        json: { ...row, deleted_at: new Date().toISOString(), row_version: 2 },
      });
    }
    return route.fulfill({
      json: req.url().includes(row.id)
        ? row
        : { items: [row], total: 1, page: 1, page_size: 30 },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('table', { name: '账号列表' })).toBeVisible();
  await page.getByRole('button', { name: '详情', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '账号详情' })).toBeVisible();
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: '删除', exact: true }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复账号' })).toBeVisible();
  expect(writes).toBe(1);
});

test('编辑密码保持为空，冲突禁止静默覆盖（响应桩）', async ({ page }) => {
  const row = record();
  let writes = 0;
  await page.route('**/api/v1/accounts**', (route) => {
    if (route.request().method() === 'PATCH') {
      writes++;
      expect(route.request().postDataJSON()).not.toHaveProperty('password');
      return route.fulfill({
        status: 409,
        json: {
          error: {
            code: 'ROW_VERSION_CONFLICT',
            message: '版本冲突',
            details: {},
          },
          request_id: crypto.randomUUID(),
        },
      });
    }
    return route.fulfill({
      json: route.request().url().includes(row.id)
        ? row
        : { items: [row], total: 1, page: 1, page_size: 30 },
    });
  });
  await page.goto('/');
  await page.getByRole('button', { name: '编辑', exact: true }).click();
  await expect(page.getByLabel(/Gmail 登录密码/)).toHaveValue('');
  await page.getByRole('button', { name: '保存账号' }).click();
  await expect(page.getByRole('button', { name: '保存账号' })).toBeDisabled();
  await expect(
    page.getByRole('button', { name: '重新加载最新版本（放弃当前编辑）' }),
  ).toBeVisible();
  expect(writes).toBe(1);
});
