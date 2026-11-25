import { expect, test } from '@playwright/test';
import { installMockBackend } from './helpers/mock-backend';

test('系统设置页修改管理员密码：先 reverify 轮换 CSRF，再用新 CSRF 改密并撤销所有会话回到登录页', async ({
  page,
}) => {
  const oldPassword = 'OldAdminPassphrase#2026';
  const newPassword = 'NewAdminStrongPassphrase#2026';
  const backend = await installMockBackend(page, {
    initialState: 'authenticated',
    adminPassword: oldPassword,
    totpEnabled: true,
    stepUpTotpRequired: false,
  });

  await page.goto('/settings/security');
  await expect(
    page.getByRole('heading', { level: 1, name: '系统设置' }),
  ).toBeVisible();

  // 打开“修改密码…”弹窗提交修改。
  await page.getByRole('button', { name: '修改密码…' }).click();
  const dialog = page.getByRole('dialog', { name: '修改管理员密码' });
  await dialog.getByLabel('当前管理员密码').fill(oldPassword);
  await dialog.getByLabel('新密码（至少 16 位）').fill(newPassword);
  await dialog.getByLabel('确认新密码').fill(newPassword);
  await dialog.getByRole('button', { name: '确认修改密码' }).click();

  // 改密后所有会话被撤销，界面自动清空并回到匿名登录页。
  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible();
  expect(backend.stats.reverifyCalls).toBe(1);
  expect(backend.stats.passwordChangeCalls).toBe(1);
  expect(backend.stats.csrfRejected).toBe(0);
  expect(backend.sessions.every((s) => s.revoked_at !== null)).toBe(true);

  // 旧密码登录被拒绝，新密码 + TOTP 正常重新登录。
  await page.getByLabel('管理员密码', { exact: true }).fill(oldPassword);
  await page
    .getByLabel('TOTP 验证码', { exact: true })
    .fill(backend.getValidTotpCode());
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    '验证失败或暂时受限，请稍后重试',
  );

  await page.getByLabel('管理员密码', { exact: true }).fill(newPassword);
  await page
    .getByLabel('TOTP 验证码', { exact: true })
    .fill(backend.getValidTotpCode());
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('heading', { name: '系统设置' })).toBeVisible();
});

test('系统设置页重新生成恢复码与退出其他会话：遵循 CSRF 轮换且不重放同一 TOTP', async ({
  page,
}) => {
  const backend = await installMockBackend(page, {
    initialState: 'authenticated',
    totpEnabled: true,
    stepUpTotpRequired: false,
  });

  await page.goto('/settings/security');
  await expect(page.getByText('192.0.2.25')).toBeVisible();

  // 1. 查看 / 重新生成恢复码：先 reverify 轮换 CSRF（不消耗 TOTP），再调用 regenerate 携带新 CSRF + TOTP。
  await page.getByRole('button', { name: '查看 / 重新生成…' }).click();
  const recDialog = page.getByRole('dialog', { name: '查看 / 重新生成恢复码' });
  await recDialog.getByLabel('当前管理员密码').fill(backend.getAdminPassword());
  await recDialog
    .getByLabel('TOTP 验证码（6 位）')
    .fill(backend.getValidTotpCode());
  await recDialog.getByRole('button', { name: '验证并重新生成' }).click();

  const codesList = page.getByLabel('新生成的备用恢复码');
  await expect(codesList).toBeVisible();
  await expect(codesList.getByRole('listitem')).toHaveCount(10);
  expect(backend.stats.csrfRejected).toBe(0);
  expect(backend.stats.totpReplayRejected).toBe(0);

  await page
    .getByRole('checkbox', { name: '我已将上述 10 个恢复码离线保存' })
    .check();
  await page.getByRole('button', { name: '完成并清除展示' }).click();

  // 2. 退出其他会话（已在 5 分钟重验窗口内，直接使用最新 CSRF）。
  await page.getByRole('button', { name: '退出其他会话' }).click();
  const revokeDialog = page.getByRole('dialog', { name: '退出全部其他会话？' });
  await revokeDialog.getByRole('button', { name: '确认退出其他会话' }).click();
  await expect(revokeDialog).toHaveCount(0);
  expect(backend.sessions.find((s) => !s.current)?.revoked_at).not.toBeNull();
  expect(backend.stats.csrfRejected).toBe(0);
});

test('经典安全设置页 /security 修改密码并撤销所有会话', async ({ page }) => {
  const oldPassword = 'ClassicOldPassphrase#2026';
  const newPassword = 'ClassicNewPassphrase#2026';
  const backend = await installMockBackend(page, {
    initialState: 'authenticated',
    adminPassword: oldPassword,
    totpEnabled: true,
    stepUpTotpRequired: false,
  });

  await page.goto('/security');
  await expect(page.getByRole('heading', { name: '安全设置' })).toBeVisible();

  // 先重新验证
  await page.getByLabel('当前管理员密码').fill(oldPassword);
  await page
    .locator('form')
    .getByRole('button', { name: '重新验证', exact: true })
    .click();
  await expect(
    page.getByText('重新验证成功，5 分钟内可进行敏感操作。'),
  ).toBeVisible();

  // 切换到修改密码并提交
  await page.getByRole('button', { name: '修改密码', exact: true }).click();
  await page.getByLabel('当前管理员密码').fill(oldPassword);
  await page.getByLabel('新密码', { exact: true }).fill(newPassword);
  await page.getByRole('button', { name: '修改密码并退出所有会话' }).click();

  await expect(page.getByRole('heading', { name: '管理员登录' })).toBeVisible();
  await expect(
    page.getByText('密码已修改，所有会话已退出。请使用新密码登录。'),
  ).toBeVisible();
  expect(backend.sessions.every((s) => s.revoked_at !== null)).toBe(true);
});
