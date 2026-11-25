import { expect, test } from '@playwright/test';
import { installMockBackend } from './helpers/mock-backend';

const csvPayload = (secret = 'UltraSecretCsvPass#2026') => ({
  name: 'accounts_batch.csv',
  mimeType: 'text/csv',
  buffer: Buffer.from(
    [
      'gmail_email,password,recovery_email,phone,status,two_factor_status',
      `import.alpha@gmail.com,${secret},alpha.bak@example.test,+86 13812345678,normal,enabled`,
      `import.beta@gmail.com,${secret}2,beta.bak@example.test,+86 13987654321,normal,enabled`,
    ].join('\r\n'),
    'utf-8',
  ),
});

test('CSV 预览和原子提交：预览掩码不泄露密码、修改策略重预览、确认提交成功与预览失败禁提交', async ({
  page,
}) => {
  const secret = 'NeverShowThisCsvSecret#2026';
  const backend = await installMockBackend(page, {
    initialState: 'authenticated',
    accounts: [{ gmail_email: 'import.alpha@gmail.com' }],
  });

  await page.goto('/transfers/csv');
  await expect(
    page.getByRole('heading', { level: 1, name: 'CSV 导入 / 批量操作' }),
  ).toBeVisible();

  // 1. 服务端预览失败时禁用“开始导入”，不能伪造 receipt_id。
  backend.hooks.forceNextPreviewFail = true;
  await page.getByLabel('选择 CSV 文件').setInputFiles(csvPayload(secret));
  await expect(page.getByText('CSV 服务端校验未通过')).toBeVisible();
  const confirmBox = page.getByLabel(
    '我已确认数据无误，并知悉该操作将以事务方式原子提交',
  );
  await confirmBox.check();
  await expect(page.getByRole('button', { name: '开始导入' })).toBeDisabled();
  expect(backend.stats.commitCalls).toBe(0);

  // 2. 移除并重新上传成功预览：明文密码绝不进入 DOM 或持久化存储。
  await page.getByRole('button', { name: '移除文件' }).click();
  await page.getByLabel('选择 CSV 文件').setInputFiles(csvPayload(secret));
  await expect(page.getByText('import.alpha@gmail.com')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(secret);
  expect(
    await page.evaluate(
      () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
    ),
  ).not.toContain(secret);

  // 3. 切换策略为 insert_only（skip）使原凭据失效并要求重新预览。
  await page.getByLabel('导入策略').selectOption('insert_only');
  await expect(
    page.getByRole('button', { name: '重新预览' }).first(),
  ).toBeVisible();
  await page.getByRole('button', { name: '重新预览' }).first().click();

  // 4. 勾选确认并原子提交成功（1 新增、1 跳过）。
  await confirmBox.check();
  await page.getByRole('button', { name: '开始导入' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('CSV 原子导入成功')).toBeVisible();
  expect(backend.stats.commitCalls).toBe(1);

  // 提交成功后消费了凭据，关闭弹窗重新勾选也不能重复提交同一凭据。
  await page.keyboard.press('Escape');
  await confirmBox.check();
  await expect(page.getByRole('button', { name: '开始导入' })).toBeDisabled();
});

test('CSV 并发重复提交：快速双击仅发出一次提交；409 冲突要求重新预览；断网提示结果未知不重试', async ({
  page,
}) => {
  const backend = await installMockBackend(page, {
    initialState: 'authenticated',
    commitDelayMs: 200,
  });

  await page.goto('/transfers/csv');
  await page.getByLabel('选择 CSV 文件').setInputFiles(csvPayload());
  await expect(page.getByText('import.alpha@gmail.com')).toBeVisible();

  const confirmBox = page.getByLabel(
    '我已确认数据无误，并知悉该操作将以事务方式原子提交',
  );
  const startBtn = page.getByRole('button', { name: '开始导入' });

  // 1. 首次提交命中服务端并发 409 冲突，同时快速双触发验证前端防并发重放（仅发 1 次）。
  backend.hooks.forceNextCommitConflict = true;
  await confirmBox.check();
  await expect(startBtn).toBeEnabled();
  await startBtn.evaluate((btn: HTMLButtonElement) => {
    btn.click();
    btn.click();
  });

  const conflictDialog = page.getByRole('dialog');
  await expect(
    conflictDialog.getByText('服务端返回冲突，需要重新预览'),
  ).toBeVisible();
  expect(backend.stats.commitCalls).toBe(1);

  // 2. 点击“重新预览”获取新凭据，然后模拟网络中断 -> 显示“结果未知，请刷新确认”且不自动重试。
  await conflictDialog.getByRole('button', { name: '重新预览' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  backend.hooks.commitDelayMs = 0;
  backend.hooks.forceNextCommitAbort = true;
  await confirmBox.check();
  await startBtn.click();
  await expect(page.getByText('结果未知，请刷新确认').first()).toBeVisible();
  expect(backend.stats.commitCalls).toBe(2);
});
