import { expect, test } from '@playwright/test';
import { installMockBackend } from './helpers/mock-backend';

test('初次 TOTP 绑定：首次登录受限、设置二维码/Secret、错误码拦截、确认绑定与一次性恢复码保存', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.name));

  const backend = await installMockBackend(page, {
    initialState: 'anonymous',
    totpEnabled: false,
  });

  await page.goto('/');
  await expect(page).toHaveTitle('Gmail 账号管理面板');
  await page
    .getByLabel('管理员密码', { exact: true })
    .fill(backend.getAdminPassword());
  await page.getByRole('button', { name: '登录', exact: true }).click();

  // 首次登录进入 mfa_pending，不得展示业务工作区或安全操作导航。
  await expect(
    page.getByRole('button', { name: '开始绑定验证器' }),
  ).toBeVisible();
  await expect(page.getByRole('navigation', { name: '安全操作' })).toHaveCount(
    0,
  );
  await expect(page.getByRole('table', { name: '账号列表' })).toHaveCount(0);

  // 开始绑定，展示二维码和手工 Secret。
  await page.getByRole('button', { name: '开始绑定验证器' }).click();
  await expect(page.getByAltText('验证器绑定二维码')).toBeVisible();
  await expect(page.getByLabel('手工 Secret')).toHaveValue('JBSWY3DPEHPK3PXP');

  // 错误验证码无法完成绑定。
  await page.getByLabel('验证器验证码').fill('000000');
  await page.getByRole('button', { name: '确认绑定' }).click();
  await expect(page.getByRole('alert')).toContainText(
    '验证失败或暂时受限，请稍后重试',
  );

  // 正确验证码完成绑定并展示 10 个一次性恢复码。
  await page.getByLabel('验证器验证码').fill(backend.getNextTotpCode());
  await page.getByRole('button', { name: '确认绑定' }).click();
  const list = page.getByRole('list', { name: '一次性恢复码' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('listitem')).toHaveCount(10);

  // 未勾选保存确认前禁止离开恢复码页面。
  const doneButton = page.getByRole('button', { name: '完成并清除展示' });
  await expect(doneButton).toBeDisabled();
  await page.getByLabel('我已离线保存恢复码').check();
  await expect(doneButton).toBeEnabled();
  await doneButton.click();

  // 进入完整认证后的账号工作区，且恢复码与密码均不留存在 DOM 或存储中。
  await expect(page.getByRole('heading', { name: '账号管理' })).toBeVisible();
  await expect(page.getByRole('list', { name: '一次性恢复码' })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
    ),
  ).not.toContain(backend.getAdminPassword());
  expect(errors).toEqual([]);
});

test('正常登录（密码 + TOTP）、登录失败键盘操作与 CSRF 失效不自动重放', async ({
  page,
}) => {
  const backend = await installMockBackend(page, {
    initialState: 'anonymous',
    totpEnabled: true,
    accounts: [{ gmail_email: 'normal.login@gmail.com' }],
  });

  await page.goto('/');

  // 错误凭据键盘回车：提示通用错误并清空密码输入。
  await page.getByLabel('管理员密码', { exact: true }).focus();
  await page.keyboard.type('WrongAdminPassword#2026');
  await page.getByLabel('TOTP 验证码', { exact: true }).fill('000000');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText(
    '验证失败或暂时受限，请稍后重试',
  );
  await expect(page.getByLabel('管理员密码', { exact: true })).toHaveValue('');

  // 正确密码 + TOTP 正常登录进入账号工作区。
  await page
    .getByLabel('管理员密码', { exact: true })
    .fill(backend.getAdminPassword());
  await page
    .getByLabel('TOTP 验证码', { exact: true })
    .fill(backend.getValidTotpCode());
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'normal.login@gmail.com', exact: true }),
  ).toBeVisible();

  // 模拟后续业务写请求触发 403 CSRF_INVALID：立即清空工作区、提示刷新、不自动重放。
  await page
    .getByRole('button', { name: '更多操作 normal.login@gmail.com' })
    .click();
  const markVerifiedItem = page.getByRole('menuitem', { name: '今天已验证' });
  await expect(markVerifiedItem).toBeVisible();
  backend.hooks.forceNextCsrfInvalid = true;
  await markVerifiedItem.click();
  await expect(page.getByRole('alert')).toContainText(
    '页面校验已失效。请刷新页面后重试，操作未自动重放。',
  );
  await expect(page.getByRole('table', { name: '账号列表' })).toHaveCount(0);
  expect(backend.stats.csrfRejected).toBe(1);
});

test('恢复码登录进入受限态并强制重新绑定新 TOTP 与恢复码', async ({ page }) => {
  const backend = await installMockBackend(page, {
    initialState: 'anonymous',
    totpEnabled: true,
    accounts: [{ gmail_email: 'after.rebind@gmail.com' }],
  });
  const oldRecoveryCode = backend.getRecoveryCodes()[0];

  await page.goto('/');
  await page
    .getByLabel('管理员密码', { exact: true })
    .fill(backend.getAdminPassword());
  await page.getByRole('button', { name: '使用恢复码' }).click();
  await page.getByLabel('恢复码', { exact: true }).fill(oldRecoveryCode);
  await page.getByRole('button', { name: '登录', exact: true }).click();

  // 恢复码登录后必须重新绑定，不能直接进入业务工作区。
  await expect(
    page.getByRole('button', { name: '开始绑定验证器' }),
  ).toBeVisible();
  await expect(page.getByRole('table', { name: '账号列表' })).toHaveCount(0);

  await page.getByRole('button', { name: '开始绑定验证器' }).click();
  await page.getByLabel('验证器验证码').fill(backend.getNextTotpCode());
  await page.getByRole('button', { name: '确认绑定' }).click();

  const newList = page.getByRole('list', { name: '一次性恢复码' });
  await expect(newList.getByRole('listitem')).toHaveCount(10);
  await expect(newList).not.toContainText(oldRecoveryCode);

  await page.getByLabel('我已离线保存恢复码').check();
  await page.getByRole('button', { name: '完成并清除展示' }).click();
  await expect(
    page.getByRole('button', { name: 'after.rebind@gmail.com', exact: true }),
  ).toBeVisible();
});
