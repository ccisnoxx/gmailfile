import { expect, test } from '@playwright/test';
import { installMockBackend } from './helpers/mock-backend';

test('账号完整生命周期：新建、详情页查看密码与编辑关联账号、归档、软删除取消/确认与回收站恢复', async ({
  page,
}) => {
  const targetId = crypto.randomUUID();
  const linkedId = crypto.randomUUID();
  const backend = await installMockBackend(page, {
    initialState: 'authenticated',
    accounts: [
      {
        id: targetId,
        account_no: 'GM-000001',
        gmail_email: 'recovery.base@gmail.com',
        recovery_email_external: 'external.root@example.test',
        recovery_email: 'external.root@example.test',
      },
      {
        id: linkedId,
        account_no: 'GM-000002',
        gmail_email: 'linked.owner@gmail.com',
        recovery_account_id: targetId,
        recovery_email_external: null,
        recovery_email: 'recovery.base@gmail.com',
        password: 'LinkedSecretPassword#2026',
        purpose: '关联辅助邮箱账号',
      },
    ],
  });

  await page.goto('/');
  await expect(page.getByRole('table', { name: '账号列表' })).toBeVisible();

  // 1. 新建账号弹窗
  await page.getByRole('button', { name: '新建账号' }).first().click();
  const createDialog = page.getByRole('dialog', { name: '新建账号' });
  await createDialog
    .getByLabel('Gmail 地址')
    .fill('lifecycle.created@gmail.com');
  await createDialog
    .getByLabel('Gmail 登录密码')
    .fill('LifecyclePass#2026!Secret');
  await createDialog
    .getByLabel('辅助邮箱', { exact: true })
    .fill('life.bak@example.test');
  await createDialog.getByRole('button', { name: '保存账号' }).click();
  await expect(
    page.getByRole('button', {
      name: 'lifecycle.created@gmail.com',
      exact: true,
    }),
  ).toBeVisible();

  // 2. 点击关联辅助邮箱账号进入三栏详情页 /accounts/:id
  await page
    .getByRole('button', { name: 'linked.owner@gmail.com', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/accounts/${linkedId}`));
  await expect(
    page.getByRole('heading', { name: 'linked.owner@gmail.com' }),
  ).toBeVisible();

  // 3. 按需显示密码：触发重新验证 -> 轮换 CSRF -> 再次点击显示明文密码
  await page.getByRole('button', { name: '显示密码' }).click();
  await page.getByLabel('当前管理员密码').fill(backend.getAdminPassword());
  await page.getByRole('button', { name: '重新验证' }).click();
  await expect(
    page.getByText('重新验证成功，请再次选择显示或复制。'),
  ).toBeVisible();
  await page.getByRole('button', { name: '显示密码' }).click();
  await expect(page.getByLabel('登录密码')).toHaveText(
    'LinkedSecretPassword#2026',
  );

  // 4. 在详情页编辑带关联辅助邮箱（recovery_account_id）的账号，必须满足 XOR 约束成功保存至 v2
  await page.getByRole('button', { name: '编辑' }).click();
  const purposeInput = page.getByLabel('用途');
  await purposeInput.fill('详情页编辑关联账号');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByLabel('账号概览').getByText('v2')).toBeVisible();

  // 5. 返回列表完成归档（切至“已归档”可见）、删除二次确认（先取消不写，再确认删除）与回收站恢复
  await page.goto('/');
  await page
    .getByRole('button', { name: '更多操作 linked.owner@gmail.com' })
    .click();
  await page.getByRole('menuitem', { name: '归档' }).click();
  await page.getByRole('button', { name: '确认归档' }).click();
  await expect(
    page.getByRole('dialog', { name: '账号详情' }).getByText('归档成功。'),
  ).toBeVisible();

  await page.keyboard.press('Escape');
  const sidebar = page.getByLabel('侧边导航栏');
  await sidebar.getByRole('button', { name: '展开账号状态分组' }).click();
  await sidebar.getByRole('button', { name: /已归档/ }).click();
  await expect(
    page.getByRole('button', { name: 'linked.owner@gmail.com', exact: true }),
  ).toBeVisible();

  // 切回全部账号测试删除取消与确认
  await sidebar.getByRole('button', { name: /全部账号/ }).click();
  await expect(
    page.getByRole('button', {
      name: 'lifecycle.created@gmail.com',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '更多操作 lifecycle.created@gmail.com' })
    .click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(
    page.getByRole('button', {
      name: 'lifecycle.created@gmail.com',
      exact: true,
    }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: '更多操作 lifecycle.created@gmail.com' })
    .click();
  await page.getByRole('menuitem', { name: '删除' }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await expect(page.getByRole('button', { name: '恢复账号' })).toBeVisible();

  // 切到回收站恢复账号
  await page.keyboard.press('Escape');
  await sidebar.getByRole('button', { name: /回收站/ }).click();
  await expect(
    page.getByRole('button', {
      name: 'lifecycle.created@gmail.com',
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: '更多操作 lifecycle.created@gmail.com' })
    .click();
  await page.getByRole('menuitem', { name: '恢复' }).click();
  await page.getByRole('button', { name: '确认恢复' }).click();
  await expect(
    page.getByRole('dialog', { name: '账号详情' }).getByText('恢复成功。'),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await sidebar.getByRole('button', { name: /全部账号/ }).click();
  await expect(
    page.getByRole('button', {
      name: 'lifecycle.created@gmail.com',
      exact: true,
    }),
  ).toBeVisible();
});

test('row_version 并发冲突：编辑弹窗密码留空省略、409 禁用保存并重新加载最新版本恢复', async ({
  page,
}) => {
  const rowId = crypto.randomUUID();
  const backend = await installMockBackend(page, {
    initialState: 'authenticated',
    accounts: [
      {
        id: rowId,
        account_no: 'GM-000010',
        gmail_email: 'conflict.case@gmail.com',
        purpose: '旧用途',
        row_version: 1,
      },
    ],
  });

  let lastPatchBody: Record<string, unknown> | null = null;
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && req.url().includes(`/accounts/${rowId}`)) {
      lastPatchBody = req.postDataJSON() as Record<string, unknown>;
    }
  });

  await page.goto('/');
  await page
    .getByRole('button', { name: '更多操作 conflict.case@gmail.com' })
    .click();
  await page.getByRole('menuitem', { name: '编辑' }).click();

  const dialog = page.getByRole('dialog', { name: '编辑账号' });
  await expect(dialog.getByLabel(/Gmail 登录密码/)).toHaveValue('');

  // 模拟另一会话并发更新了同一条记录（row_version 1 -> 2）。
  backend.bumpVersion(rowId);

  await dialog.getByLabel('账号用途').fill('冲突尝试');
  await dialog.getByRole('button', { name: '保存账号' }).click();

  await expect.poll(() => lastPatchBody).not.toBeNull();
  expect(lastPatchBody).not.toHaveProperty('password');
  await expect(dialog.getByRole('button', { name: '保存账号' })).toBeDisabled();
  const reloadBtn = dialog.getByRole('button', {
    name: '重新加载最新版本（放弃当前编辑）',
  });
  await expect(reloadBtn).toBeVisible();
  expect(backend.stats.patchCalls).toBe(1);

  // 点击重新加载获取 v2 后解除禁用并成功保存。
  await reloadBtn.click();
  await expect(dialog.getByText(/版本 2/)).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存账号' })).toBeEnabled();
  await dialog.getByLabel('账号用途').fill('基于v2保存');
  await dialog.getByRole('button', { name: '保存账号' }).click();
  await expect(page.getByText('GM-000010 已保存。')).toBeVisible();
  expect(backend.accounts[0].row_version).toBe(3);
});

test('row_version 并发冲突：详情页编辑命中 409 禁用保存并支持重新加载恢复', async ({
  page,
}) => {
  const rowId = crypto.randomUUID();
  const backend = await installMockBackend(page, {
    initialState: 'authenticated',
    accounts: [
      {
        id: rowId,
        account_no: 'GM-000011',
        gmail_email: 'detail.conflict@gmail.com',
        purpose: '初始详情用途',
        row_version: 4,
      },
    ],
  });

  await page.goto(`/accounts/${rowId}`);
  await expect(
    page.getByRole('heading', { name: 'detail.conflict@gmail.com' }),
  ).toBeVisible();
  await page.getByRole('button', { name: '编辑' }).click();

  // 并发修改使服务端版本升至 v5。
  backend.bumpVersion(rowId);

  await page.getByLabel('用途').fill('陈旧版本提交');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByRole('alert')).toContainText('版本冲突');
  await expect(page.getByRole('button', { name: '保存修改' })).toBeDisabled();

  await page.getByRole('button', { name: '重新加载最新版本' }).click();
  await expect(page.getByLabel('账号概览').getByText('v5')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存修改' })).toBeEnabled();
  await page.getByLabel('用途').fill('重新加载后提交');
  await page.getByRole('button', { name: '保存修改' }).click();
  await expect(page.getByLabel('账号概览').getByText('v6')).toBeVisible();
});
