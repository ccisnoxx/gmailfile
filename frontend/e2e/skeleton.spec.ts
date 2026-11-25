import { expect, test } from '@playwright/test';

function state(
  kind: 'anonymous' | 'mfa_pending' | 'authenticated' = 'anonymous',
) {
  return {
    state: kind,
    idle_timeout_seconds: 900,
    server_time: new Date().toISOString(),
    csrf_token: crypto.randomUUID(),
    expires_at: new Date(Date.now() + 43200000).toISOString(),
    idle_expires_at: new Date(Date.now() + 900000).toISOString(),
    reauthenticated_until: null,
  };
}

test('登录带 CSRF，首次登录进入 MFA 受限状态', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));
  const anonymous = state();
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ json: anonymous }),
  );
  await page.route('**/api/v1/auth/activity', (route) =>
    route.fulfill({ json: state('mfa_pending') }),
  );
  await page.route('**/api/v1/auth/login', (route) => {
    expect(route.request().headers()['x-csrf-token']).toBe(
      anonymous.csrf_token,
    );
    return route.fulfill({ json: state('mfa_pending') });
  });
  await page.goto('/');
  await expect(page).toHaveTitle('Gmail 账号管理面板');
  await page
    .getByLabel('管理员密码', { exact: true })
    .fill(crypto.randomUUID());
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(
    page.getByRole('button', { name: '开始绑定验证器' }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: '安全操作' })).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});

test('登录失败与键盘操作', async ({ page }) => {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ json: state() }),
  );
  await page.route('**/api/v1/auth/activity', (route) =>
    route.fulfill({ json: state('mfa_pending') }),
  );
  await page.route('**/api/v1/auth/login', (route) =>
    route.fulfill({
      status: 401,
      json: {
        error: {
          code: 'AUTH_FAILED',
          message: '验证失败或暂时受限，请稍后重试',
          details: {},
        },
        request_id: crypto.randomUUID(),
      },
    }),
  );
  await page.goto('/');
  await page.getByLabel('管理员密码', { exact: true }).focus();
  await page.keyboard.type(crypto.randomUUID());
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText(
    '验证失败或暂时受限，请稍后重试',
  );
  await expect(page.getByLabel('管理员密码', { exact: true })).toHaveValue('');
});
