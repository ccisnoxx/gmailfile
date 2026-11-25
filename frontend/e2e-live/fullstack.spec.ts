import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { MonotonicTotpGenerator } from './totp';

const ADMIN_PASSWORD = process.env.LIVE_E2E_ADMIN_PASSWORD || '';

test.describe
  .serial('Wave 2 真实前后端全栈 E2E（FastAPI + PostgreSQL + 生产构建前端，零 API 桩）', () => {
  let context: BrowserContext;
  let peerContext: BrowserContext;
  let page: Page;
  let totp: MonotonicTotpGenerator;
  let baseAccountId = '';
  let linkedAccountId = '';
  const linkedPassword = 'LiveLinkedSecret!2026#99';
  const pageErrors: string[] = [];

  test.beforeAll(async ({ browser }) => {
    if (!ADMIN_PASSWORD) {
      throw new Error(
        '缺少 LIVE_E2E_ADMIN_PASSWORD，请通过 scripts/run-live-e2e.py 运行真实全栈 E2E。',
      );
    }
    context = await browser.newContext({
      permissions: ['clipboard-read', 'clipboard-write'],
      acceptDownloads: true,
    });
    peerContext = await browser.newContext();
    page = await context.newPage();
    page.on('pageerror', (err) => pageErrors.push(err.message));
  });

  test.afterAll(async () => {
    await peerContext?.close();
    await context?.close();
  });

  test('TC-P0-011：首次登录 -> 真实 TOTP 绑定 -> 恢复码 -> 账号 CRUD -> 双标签乐观锁 409', async () => {
    // 1. 生产构建下 /preview/* 必须返回 404（绝不暴露未认证预览页）
    await page.goto('/preview/accounts');
    await expect(
      page.getByRole('heading', { name: '页面不存在' }),
    ).toBeVisible();

    // 2. 匿名登录 -> 进入 mfa_pending 受限态
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: '管理员登录' }),
    ).toBeVisible();

    const anonApi = await page.evaluate(async () => {
      const res = await fetch('/api/v1/accounts');
      return res.status;
    });
    expect(anonApi).toBe(401);

    await page.getByLabel('管理员密码', { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(
      page.getByRole('button', { name: '开始绑定验证器' }),
    ).toBeVisible();

    // 校验真实 Cookie 安全属性（HttpOnly + SameSite=Strict）以及未绑 TOTP 访问业务接口返 403
    const cookies = await context.cookies();
    const sessionCookie = cookies.find(
      (c) => c.name === '__Host-gm_session' || c.name === 'gm_dev_session',
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Strict');

    const pendingApi = await page.evaluate(async () => {
      const res = await fetch('/api/v1/accounts');
      return { status: res.status, body: await res.json() };
    });
    expect(pendingApi.status).toBe(403);
    expect(pendingApi.body.error.code).toBe('MFA_REQUIRED');

    // 3. 启动真实 TOTP 绑定，读取服务端颁发的真实 Base32 Secret
    await page.getByRole('button', { name: '开始绑定验证器' }).click();
    await expect(page.getByAltText('验证器绑定二维码')).toBeVisible();
    const secret = await page.getByLabel('手工 Secret').inputValue();
    expect(secret.length).toBeGreaterThanOrEqual(16);
    totp = new MonotonicTotpGenerator(secret);

    // 错误验证码拦截（会触发真实后端 1 秒指数退避，等待退避窗口结束后再提交有效码）
    await page.getByLabel('验证器验证码').fill('000000');
    await page.getByRole('button', { name: '确认绑定' }).click();
    await expect(page.getByRole('alert')).toContainText(
      '验证失败或暂时受限，请稍后重试',
    );
    await page.waitForTimeout(1200);

    // 真实 RFC 6238 TOTP 确认绑定，获得 10 个一次性恢复码
    await page.getByLabel('验证器验证码').fill(await totp.nextCode());
    await page.getByRole('button', { name: '确认绑定' }).click();
    const codesList = page.getByRole('list', { name: '一次性恢复码' });
    await expect(codesList).toBeVisible();
    await expect(codesList.getByRole('listitem')).toHaveCount(10);

    // 确认离线保存并进入账号工作区（全新空库展示空态与“账号管理”标题）
    await page.getByLabel('我已离线保存恢复码').check();
    await page.getByRole('button', { name: '完成并清除展示' }).click();
    await expect(page.getByRole('heading', { name: '账号管理' })).toBeVisible();

    // 4. 新建基础账号 A（live.base@gmail.com）
    await page.getByRole('button', { name: '新建账号' }).first().click();
    const dlg1 = page.getByRole('dialog', { name: '新建账号' });
    await dlg1.getByLabel('Gmail 地址').fill('live.base@gmail.com');
    await dlg1.getByLabel('Gmail 登录密码').fill('LiveBaseSecret!2026#88');
    await dlg1
      .getByLabel('辅助邮箱', { exact: true })
      .fill('base.recovery@example.test');
    await dlg1.getByRole('button', { name: '保存账号' }).click();
    await expect(
      page.getByRole('button', { name: 'live.base@gmail.com', exact: true }),
    ).toBeVisible();

    // 5. 新建关联账号 B（live.linked@gmail.com，recovery_account_id -> A）
    await page.getByRole('button', { name: '新建账号' }).first().click();
    const dlg2 = page.getByRole('dialog', { name: '新建账号' });
    await dlg2.getByLabel('Gmail 地址').fill('live.linked@gmail.com');
    await dlg2.getByLabel('Gmail 登录密码').fill(linkedPassword);
    await dlg2.getByLabel('辅助邮箱方式').selectOption('account');
    const recSelect = dlg2.locator('#recovery-account');
    await expect(recSelect.locator('option')).toHaveCount(2);
    const optionValue = await recSelect
      .locator('option')
      .nth(1)
      .getAttribute('value');
    expect(optionValue).toBeTruthy();
    baseAccountId = optionValue!;
    await recSelect.selectOption(baseAccountId);
    await dlg2.getByRole('button', { name: '保存账号' }).click();
    await expect(
      page.getByRole('button', {
        name: 'live.linked@gmail.com',
        exact: true,
      }),
    ).toBeVisible();

    // 6. 打开关联账号 B 详情页，并在第二个真实标签页并发编辑触发真实 409 ROW_VERSION_CONFLICT
    await page
      .getByRole('button', { name: 'live.linked@gmail.com', exact: true })
      .click();
    await expect(page).toHaveURL(/\/accounts\/[0-9a-f-]+$/);
    linkedAccountId = page.url().split('/').pop()!;
    await expect(
      page.getByRole('heading', { name: 'live.linked@gmail.com' }),
    ).toBeVisible();

    // Tab 1 进入编辑态（持有 v1）
    await page.getByRole('button', { name: '编辑' }).click();
    await page.getByLabel('用途').fill('Tab1 过期并发编辑');

    // 使用独立会话（第二设备 peerContext）登录并先保存同一账号至 v2，制造真实跨会话并发冲突（不影响 Tab 1 CSRF）
    const peerPage = await peerContext.newPage();
    peerPage.on('pageerror', (err) => pageErrors.push(err.message));
    await peerPage.goto('/');
    await peerPage
      .getByLabel('管理员密码', { exact: true })
      .fill(ADMIN_PASSWORD);
    await peerPage
      .getByLabel('TOTP 验证码', { exact: true })
      .fill(await totp.nextCode());
    await peerPage.getByRole('button', { name: '登录', exact: true }).click();
    await expect(
      peerPage.getByRole('heading', { name: '账号管理' }),
    ).toBeVisible();

    await peerPage.goto(`/accounts/${linkedAccountId}`);
    await expect(
      peerPage.getByRole('heading', { name: 'live.linked@gmail.com' }),
    ).toBeVisible();
    await peerPage.getByRole('button', { name: '编辑' }).click();
    await peerPage.getByLabel('用途').fill('Peer 会话先行提交 v2');
    await peerPage.getByRole('button', { name: '保存修改' }).click();
    await expect(peerPage.getByLabel('账号概览').getByText('v2')).toBeVisible();
    await peerPage.close();

    // Tab 1 提交旧版本 v1 -> 真实后端返回 409，前端禁用保存，重载 v2 后再次编辑保存至 v3
    await page.getByRole('button', { name: '保存修改' }).click();
    await expect(page.getByText(/版本冲突/)).toBeVisible();
    await expect(page.getByRole('button', { name: '保存修改' })).toBeDisabled();

    await page.getByRole('button', { name: '重新加载最新版本' }).click();
    await expect(page.getByLabel('账号概览').getByText('v2')).toBeVisible();

    await page.getByRole('button', { name: '编辑' }).click();
    await page.getByLabel('用途').fill('重载后提交 v3');
    await page.getByRole('button', { name: '保存修改' }).click();
    await expect(page.getByLabel('账号概览').getByText('v3')).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test('TC-P0-012：Step-Up TOTP 密码查看/复制、零存储落盘、后台隐藏即时清除与真实审计入库', async () => {
    await page.goto(`/accounts/${linkedAccountId}`);
    await expect(
      page.getByRole('heading', { name: 'live.linked@gmail.com' }),
    ).toBeVisible();

    // 1. 未经 Step-Up MFA 重验点击“显示密码” -> 真实后端返 403 REAUTH_REQUIRED，弹出重验表单
    await page.getByRole('button', { name: '显示密码' }).click();
    await expect(page.getByLabel('当前管理员密码')).toBeVisible();
    await expect(page.getByLabel('TOTP 验证码')).toBeVisible();

    // 2. 提交当前管理员密码 + 实时 TOTP 完成 Step-Up，再点击“显示密码”查看真实 AES-256-GCM 解密明文
    await page.getByLabel('当前管理员密码').fill(ADMIN_PASSWORD);
    await page.getByLabel('TOTP 验证码').fill(await totp.nextCode());
    await page.getByRole('button', { name: '重新验证' }).click();
    await expect(
      page.getByText('重新验证成功，请再次选择显示或复制。'),
    ).toBeVisible();

    await page.getByRole('button', { name: '显示密码' }).click();
    await expect(page.getByLabel('登录密码')).toHaveText(linkedPassword);

    // 3. 点击“复制密码”写入真实审计事件 password_copied
    const copyEventPromise = page.waitForResponse(
      (resp) =>
        resp
          .url()
          .endsWith(`/accounts/${linkedAccountId}/copy-password-event`) &&
        resp.request().method() === 'POST',
    );
    await page.getByRole('button', { name: '复制密码' }).click();
    const copyResp = await copyEventPromise;
    expect(copyResp.status()).toBe(200);

    // 4. 明文密码与管理员密码绝不落入 localStorage / sessionStorage
    const storageDump = await page.evaluate(
      () => JSON.stringify(localStorage) + JSON.stringify(sessionStorage),
    );
    expect(storageDump).not.toContain(linkedPassword);
    expect(storageDump).not.toContain(ADMIN_PASSWORD);

    // 5. 模拟标签页切后台（visibilitychange -> hidden）：明文立即从 DOM 清除恢复掩码
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(page.getByLabel('登录密码')).not.toHaveText(linkedPassword);
    await expect(page.locator('body')).not.toContainText(linkedPassword);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: false,
      });
    });

    // 6. 查询真实 PostgreSQL 审计日志，确认 password_revealed 与 password_copied 均已入链
    const audits = await page.evaluate(async () => {
      const res = await fetch('/api/v1/audit-events?page=1&page_size=50');
      return (await res.json()) as {
        items: Array<{
          seq: number;
          event_hash: string;
          event_type: string;
          account_id: string | null;
        }>;
      };
    });
    const revealed = audits.items.find(
      (e) =>
        e.event_type === 'password_revealed' &&
        e.account_id === linkedAccountId,
    );
    const copied = audits.items.find(
      (e) =>
        e.event_type === 'password_copied' && e.account_id === linkedAccountId,
    );
    expect(revealed).toBeDefined();
    expect(copied).toBeDefined();
    expect(revealed!.event_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(copied!.event_hash).toMatch(/^[0-9a-f]{64}$/);

    expect(pageErrors).toEqual([]);
  });

  test('TC-P0-013：真实 CSV 两阶段导入（并发 409 回滚 -> 重预览 -> 原子提交）+ 流式导出 + 审计链校验', async () => {
    const csvSecret = 'LiveCsvRowSecret!2026#77';
    const csvFile = {
      name: 'live_wave2_batch.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(
        [
          'gmail_email,password,recovery_email,status,two_factor_status,purpose',
          `csv.live.new@gmail.com,${csvSecret},csv.new.bak@example.test,normal,enabled,"=SUM(1,2)"`,
          `live.base@gmail.com,${csvSecret}2,base.recovery@example.test,normal,enabled,"=HYPERLINK(""https://example.test"")"`,
        ].join('\r\n'),
        'utf-8',
      ),
    };

    await page.goto('/transfers/csv');
    await expect(
      page.getByRole('heading', { level: 1, name: 'CSV 导入 / 批量操作' }),
    ).toBeVisible();

    // 1. 上传真实 CSV（默认策略为 upsert -> strategy=update），校验服务端返回 200 且有效 receipt_id
    const previewRespPromise = page.waitForResponse(
      (resp) =>
        resp.url().includes('/api/v1/imports/csv/preview') &&
        resp.request().method() === 'POST',
    );
    await page.getByLabel('选择 CSV 文件').setInputFiles(csvFile);
    const previewResp = await previewRespPromise;
    expect(previewResp.status()).toBe(200);
    const previewJson = (await previewResp.json()) as {
      receipt_id: string | null;
      errors: unknown[];
    };
    expect(previewJson.receipt_id).toBeTruthy();
    expect(previewJson.errors).toEqual([]);
    await expect(
      page.getByText('csv.live.new@gmail.com').first(),
    ).toBeVisible();
    await expect(page.locator('body')).not.toContainText(csvSecret);

    // 2. 在提交前通过独立会话 peerContext 并发修改 live.base@gmail.com（推进 row_version），制造真实 409 冲突
    const page2 = await peerContext.newPage();
    await page2.goto(`/accounts/${baseAccountId}`);
    await expect(
      page2.getByRole('heading', { name: 'live.base@gmail.com' }),
    ).toBeVisible();
    await page2.getByRole('button', { name: '编辑' }).click();
    await page2.getByLabel('用途').fill('CSV 提交前并发修改');
    await page2.getByRole('button', { name: '保存修改' }).click();
    await expect(page2.getByLabel('账号概览').getByText('v2')).toBeVisible();
    await page2.close();

    // 3. 首次提交必须被真实后端 409 拒绝并整批回滚（csv.live.new@gmail.com 绝不可落盘）
    const confirmBox = page.getByLabel(
      '我已确认数据无误，并知悉该操作将以事务方式原子提交',
    );
    await confirmBox.check();
    await page.getByRole('button', { name: '开始导入' }).click();
    const conflictDialog = page.getByRole('dialog');
    await expect(
      conflictDialog.getByText('服务端返回冲突，需要重新预览'),
    ).toBeVisible();

    const afterRollback = await page.evaluate(async () => {
      const res = await fetch('/api/v1/accounts?search=csv.live.new');
      return (await res.json()) as { total: number };
    });
    expect(afterRollback.total).toBe(0);

    // 4. 点击“重新预览”获取基于最新 row_version 的新 receipt，随后原子提交成功
    await conflictDialog.getByRole('button', { name: '重新预览' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await confirmBox.check();
    await page.getByRole('button', { name: '开始导入' }).click();
    await expect(
      page.getByRole('dialog').getByText('CSV 原子导入成功'),
    ).toBeVisible();
    await page.keyboard.press('Escape');

    // 5. 执行真实流式 CSV 导出并校验文件内容：UTF-8 BOM、公式前置单引号、零敏感列
    await page.getByRole('button', { name: '导出数据' }).click();
    const exportDialog = page.getByRole('dialog', {
      name: '导出非敏感 CSV 数据',
    });
    await expect(exportDialog).toBeVisible();
    const downloadPromise = page.waitForEvent('download');
    await exportDialog.getByRole('button', { name: '下载 CSV' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    const downloadPath = await download.path();
    expect(downloadPath).toBeTruthy();
    const rawBytes = await readFile(downloadPath!);
    expect(rawBytes[0]).toBe(0xef);
    expect(rawBytes[1]).toBe(0xbb);
    expect(rawBytes[2]).toBe(0xbf);

    const exportedText = rawBytes.subarray(3).toString('utf-8');
    const [headerLine, ...dataLines] = exportedText.trim().split(/\r?\n/);
    const headerCols = headerLine.split(',');
    expect(headerCols).toContain('gmail_email');
    for (const forbidden of ['password', 'phone', 'notes']) {
      expect(headerCols).not.toContain(forbidden);
    }
    expect(
      headerCols.some(
        (col) => col.includes('ciphertext') || col.includes('nonce'),
      ),
    ).toBe(false);
    const joinedBody = dataLines.join('\n');
    expect(joinedBody).toContain('csv.live.new@gmail.com');
    expect(joinedBody).toContain("'=SUM(1,2)");
    expect(joinedBody).toContain("'=HYPERLINK(");
    expect(joinedBody).not.toContain(csvSecret);
    expect(joinedBody).not.toContain(linkedPassword);

    // 6. 校验真实 PostgreSQL 0004 审计哈希链完整性 API 与设置页审计视图
    const integrity = await page.evaluate(async () => {
      const res = await fetch('/api/v1/audit-events/integrity');
      return {
        status: res.status,
        body: (await res.json()) as {
          valid: boolean;
          total_events: number;
          latest_seq: number;
          latest_hash: string;
        },
      };
    });
    expect(integrity.status).toBe(200);
    expect(integrity.body.valid).toBe(true);
    expect(integrity.body.total_events).toBeGreaterThanOrEqual(8);
    expect(integrity.body.total_events).toBe(integrity.body.latest_seq);
    expect(integrity.body.latest_hash).toMatch(/^[0-9a-f]{64}$/);

    await page.goto('/settings/audit');
    await expect(page.getByText('审计哈希链完整无篡改')).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test('TC-P1-006：同会话多标签页刷新轮换 CSRF，旧标签写请求立返 403 CSRF_INVALID 且不自动重放', async () => {
    await page.goto(`/accounts/${baseAccountId}`);
    await expect(
      page.getByRole('heading', { name: 'live.base@gmail.com' }),
    ).toBeVisible();

    // 同会话打开第二标签页访问首页 -> 触发真实 GET /api/v1/auth/session 轮换当前会话的 CSRF Token
    const tabB = await context.newPage();
    await tabB.goto('/');
    await expect(tabB.getByRole('heading', { name: '账号管理' })).toBeVisible();
    await tabB.close();

    // 旧标签页仍持有轮换前 CSRF：交互触发的写请求（/auth/activity 或 /mark-logged-in）必须命中真实后端 403 CSRF_INVALID 并清空工作区
    const csrfRejectedPromise = page.waitForResponse(
      (resp) =>
        resp.request().method() === 'POST' &&
        resp.status() === 403 &&
        (resp.url().endsWith('/api/v1/auth/activity') ||
          resp.url().endsWith(`/accounts/${baseAccountId}/mark-logged-in`)),
    );
    await page.getByRole('button', { name: '更多', exact: true }).click();
    const alreadyRejected = await Promise.race([
      csrfRejectedPromise.then(() => true),
      page.waitForTimeout(400).then(() => false),
    ]);
    if (!alreadyRejected) {
      await page
        .getByRole('menuitem', { name: '标记今天已登录' })
        .click({ timeout: 5_000 });
    }
    const rejectedResp = await csrfRejectedPromise;
    expect(rejectedResp.status()).toBe(403);

    // 前端仅在解析到 403 CSRF_INVALID 时展示该提示并清空工作区（绝不自动重放）
    await expect(
      page.getByText('页面校验已失效。请刷新页面后重试，操作未自动重放。'),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'live.base@gmail.com' }),
    ).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });
});
