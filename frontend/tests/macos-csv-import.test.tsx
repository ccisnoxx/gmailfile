import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CsvPreview, SessionResponse } from '@/api/generated';
import {
  DEFAULT_NAV_ALPHA,
  NAV_ALPHA_STORAGE_KEY,
  persistNavAlpha,
} from '@/components/macos';
import {
  AtomicCommitPanel,
  CsvDropzone,
  CsvImportPage,
  CsvImportPreviewPage,
  CsvPreviewTable,
  FieldMappingTable,
  FileValidationCard,
  ImportResultDialog,
  ImportStepper,
  ImportStrategyControls,
  MASKED_PASSWORD_PLACEHOLDER,
  UploadedFileCard,
  ValidationSummary,
  type CsvImportPageProps,
} from '@/features/transfers';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const makeSession = (
  overrides: Partial<SessionResponse> = {},
): SessionResponse => ({
  state: 'authenticated',
  idle_timeout_seconds: 900,
  server_time: new Date().toISOString(),
  csrf_token: 'csrf-csv-import-token-001',
  expires_at: new Date(Date.now() + 43_200_000).toISOString(),
  idle_expires_at: new Date(Date.now() + 900_000).toISOString(),
  reauthenticated_until: null,
  mfa_reauthenticated_until: null,
  step_up_totp_required: true,
  ...overrides,
});

function renderPreviewRouter(
  initialPath = '/transfers/csv',
  extraProps: Omit<CsvImportPageProps, 'mode' | 'session'> = {},
) {
  const router = createMemoryRouter(
    [
      {
        path: '/transfers/csv',
        element: <CsvImportPreviewPage {...extraProps} />,
      },
      {
        path: '/imports/csv',
        element: <CsvImportPreviewPage {...extraProps} />,
      },
      {
        path: '/preview/transfers/csv',
        element: <CsvImportPreviewPage {...extraProps} />,
      },
      {
        path: '/preview/imports/csv',
        element: <CsvImportPreviewPage {...extraProps} />,
      },
      {
        path: '/preview/settings/audit',
        element: <div>审计日志目标页</div>,
      },
      {
        path: '/preview/accounts',
        element: <div>账号管理目标页</div>,
      },
    ],
    { initialEntries: [initialPath] },
  );
  return {
    router,
    ...render(<RouterProvider router={router} />),
  };
}

function makeCleanCsvFile(
  name = 'clean_accounts.csv',
  secretPassword = 'UltraSecretPassword!9876',
) {
  const content = [
    'gmail,password,recovery_email,phone,status,totp_enabled',
    `alpha.clean@gmail.com,${secretPassword},alpha.bak@outlook.com,+86 13812345678,normal,true`,
    `beta.clean@gmail.com,${secretPassword}2,beta.bak@proton.me,+86 13987654321,normal,true`,
  ].join('\r\n');
  return new File([content], name, { type: 'text/csv' });
}

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    value: false,
  });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('CSV 导入 / 批量操作页面（macOS 淡蓝亚克力四阶段工作流）', () => {
  it('导出全部 11 个必需拆分组件并完整渲染外层菜单栏、双导航、默认原型态与四步指示器', () => {
    expect(CsvImportPage).toBeTypeOf('function');
    expect(ImportStepper).toBeTypeOf('function');
    expect(CsvDropzone).toBeTypeOf('function');
    expect(UploadedFileCard).toBeTypeOf('function');
    expect(FileValidationCard).toBeTypeOf('function');
    expect(FieldMappingTable).toBeTypeOf('function');
    expect(ImportStrategyControls).toBeTypeOf('function');
    expect(CsvPreviewTable).toBeTypeOf('function');
    expect(ValidationSummary).toBeTypeOf('function');
    expect(AtomicCommitPanel).toBeTypeOf('function');
    expect(ImportResultDialog).toBeTypeOf('function');

    const { container } = renderPreviewRouter('/transfers/csv');

    // 一、顶部 24px 装饰性 macOS 菜单栏
    const menuBar = container.querySelector('[data-slot="macos-menu-bar"]');
    expect(menuBar).toBeInTheDocument();
    expect(menuBar).toHaveTextContent('Gmail 账号管理');
    for (const label of ['文件', '编辑', '查看', '窗口', '帮助']) {
      expect(menuBar).toHaveTextContent(label);
    }

    // 二、顶部应用导航
    const toolbar = container.querySelector(
      '[data-slot="transfer-app-toolbar"]',
    );
    expect(toolbar).toBeInTheDocument();
    expect(toolbar).toHaveTextContent('Gmail 账号管理系统');
    expect(toolbar).toHaveTextContent('私有部署 · 单管理员模式');
    const topNav = screen.getByRole('navigation', { name: '应用主导航' });
    for (const label of [
      '控制台',
      'Gmail 账号',
      '标签管理',
      '导入 / 导出',
      '批量操作',
    ]) {
      expect(
        within(topNav).getByRole('button', { name: label }),
      ).toBeInTheDocument();
    }
    expect(
      within(topNav).getByRole('button', { name: '导入 / 导出' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(screen.getByLabelText('全局搜索')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '通知' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '管理员菜单' }),
    ).toBeInTheDocument();

    // 三、左侧分组导航 + 统计数 + 底部状态、版本 v1.2.0 与 60% 透明度滑块
    const sidebar = container.querySelector(
      '[data-slot="transfer-sidebar"]',
    ) as HTMLElement;
    expect(sidebar).toBeInTheDocument();
    expect(within(sidebar).getByText('12,548')).toBeInTheDocument();
    expect(within(sidebar).getByText('36')).toBeInTheDocument();
    expect(within(sidebar).getByText('1,203')).toBeInTheDocument();
    expect(within(sidebar).getByText('87')).toBeInTheDocument();
    expect(
      within(sidebar).getByRole('button', { name: '导入 / 导出（CSV）' }),
    ).toHaveAttribute('aria-current', 'page');
    expect(within(sidebar).getByText('系统运行正常')).toBeInTheDocument();
    expect(within(sidebar).getByText('版本 v1.2.0')).toBeInTheDocument();
    const opacitySlider = within(sidebar).getByRole('slider', {
      name: '界面透明度',
    }) as HTMLInputElement;
    expect(opacitySlider.value).toBe(String(DEFAULT_NAV_ALPHA));

    // 四、页面标题区、右侧按钮与顶部子标签
    expect(
      screen.getByRole('heading', { level: 1, name: 'CSV 导入 / 批量操作' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        '批量导入、更新或管理 Gmail 账号，支持严格校验、字段映射与原子提交。',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '导入历史' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '导出数据' }),
    ).toBeInTheDocument();
    const subTabs = screen.getByRole('tablist', { name: '数据处理子模块' });
    expect(
      within(subTabs).getByRole('tab', { name: 'CSV 导入', selected: true }),
    ).toBeInTheDocument();
    expect(
      within(subTabs).getByRole('tab', { name: '批量操作', selected: false }),
    ).toBeInTheDocument();

    // 五、四步流程指示器默认处于第 2～3 步之间：第 1 步完成，第 2 步高亮，第 3/4 步未完成
    const stepper = container.querySelector('[data-slot="import-stepper"]')!;
    expect(stepper.querySelector('[data-step="1"]')).toHaveAttribute(
      'data-state',
      'completed',
    );
    expect(stepper.querySelector('[data-step="2"]')).toHaveAttribute(
      'data-state',
      'active',
    );
    expect(stepper.querySelector('[data-step="3"]')).toHaveAttribute(
      'data-state',
      'pending',
    );
    expect(stepper.querySelector('[data-step="4"]')).toHaveAttribute(
      'data-state',
      'pending',
    );
    expect(
      within(stepper as HTMLElement).getByRole('button', { name: /配置映射/ }),
    ).toHaveAttribute('aria-current', 'step');

    // 六、上传文件信息与全部 6 项文件校验
    const fileCard = container.querySelector(
      '[data-slot="uploaded-file-card"]',
    )!;
    expect(fileCard).toHaveTextContent('gmail_accounts_20250115.csv');
    expect(fileCard).toHaveTextContent('1.8 MB');
    expect(fileCard).toHaveTextContent('5,246 行');
    expect(fileCard).toHaveTextContent('UTF-8');

    const validationCard = container.querySelector(
      '[data-slot="file-validation-card"]',
    )!;
    for (const checkText of [
      '文件校验通过',
      '文件大小 1.8 MB（≤10 MB）',
      '数据行数 5,246 行（≤10,000 行）',
      '列数 12 列（≤256 列）',
      '编码 UTF-8',
      '列结构一致',
      '公式注入未检测到风险',
    ]) {
      expect(validationCard).toHaveTextContent(checkText);
    }
  });

  it('校验字段映射互斥约束、必填项校验、密码永久掩码与移除文件恢复初始态', async () => {
    const user = userEvent.setup();
    const { container } = renderPreviewRouter('/imports/csv');

    // 策略默认值
    const strategySelect = screen.getByLabelText(
      '导入策略',
    ) as HTMLSelectElement;
    const conflictSelect = screen.getByLabelText(
      '冲突处理',
    ) as HTMLSelectElement;
    const skipEmptyBox = screen.getByLabelText(
      '跳过空值字段（不覆盖原有数据）',
    ) as HTMLInputElement;
    expect(strategySelect.value).toBe('upsert');
    expect(conflictSelect.value).toBe('csv_overwrite');
    expect(skipEmptyBox.checked).toBe(true);

    // 密码示例永远掩码显示
    const pwdSample = container.querySelector(
      '[data-slot="password-sample-masked"]',
    );
    expect(pwdSample).toHaveTextContent(MASKED_PASSWORD_PLACEHOLDER);

    // 互斥列禁用验证：A: gmail 已分配给 Gmail 地址，因此在“辅助邮箱”下拉中应被禁用
    const recoverySelect = screen.getByLabelText(
      '辅助邮箱对应的 CSV 列',
    ) as HTMLSelectElement;
    const colAOption = Array.from(recoverySelect.options).find(
      (opt) => opt.value === '0',
    )!;
    expect(colAOption.disabled).toBe(true);

    // 程序化强行提交冲突列时同样被拦截并提示互斥冲突
    fireEvent.change(recoverySelect, { target: { value: '0' } });
    expect(
      screen.getByText(/不允许将同一 CSV 列映射到多个互斥字段/),
    ).toBeInTheDocument();
    expect(recoverySelect.value).toBe('2');

    // 取消必填字段映射时呈现“必填项未映射”
    const gmailSelect = screen.getByLabelText(
      'Gmail 地址对应的 CSV 列',
    ) as HTMLSelectElement;
    await user.selectOptions(gmailSelect, '');
    expect(screen.getByText('必填项未映射')).toBeInTheDocument();

    // 点击“移除文件”后恢复初始状态（第 1 步、无已上传卡片与校验卡片）
    await user.click(screen.getByRole('button', { name: '移除文件' }));
    expect(
      container.querySelector('[data-slot="uploaded-file-card"]'),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="file-validation-card"]'),
    ).not.toBeInTheDocument();
    expect(container.querySelector('[data-step="1"]')).toHaveAttribute(
      'data-state',
      'active',
    );
  });

  it('预览表仅分页渲染当前页、支持状态筛选、仅看异常、展开错误行与手机号掩码', async () => {
    const user = userEvent.setup();
    const { container } = renderPreviewRouter('/transfers/csv');

    // 顶部筛选数量统计
    const summaryBar = container.querySelector(
      '[data-slot="validation-summary"]',
    ) as HTMLElement;
    expect(summaryBar).toHaveTextContent('全部');
    expect(summaryBar).toHaveTextContent('5,246');
    expect(summaryBar).toHaveTextContent('有效');
    expect(summaryBar).toHaveTextContent('5,201');
    expect(summaryBar).toHaveTextContent('警告');
    expect(summaryBar).toHaveTextContent('37');
    expect(summaryBar).toHaveTextContent('错误');
    expect(summaryBar).toHaveTextContent('8');

    // 仅渲染当前页 10 条（绝不一次性渲染全部 5,246 条）
    const previewTable = container.querySelector(
      '[data-slot="csv-preview-table"]',
    ) as HTMLElement;
    expect(previewTable.querySelectorAll('tbody tr')).toHaveLength(10);

    // 前 5 条示例行内容与敏感字段掩码
    expect(previewTable).toHaveTextContent('example@gmail.com');
    expect(previewTable).toHaveTextContent('test.account@gmail.com');
    expect(previewTable).toHaveTextContent('缺少辅助邮箱');
    expect(previewTable).toHaveTextContent('invalid-email');
    expect(previewTable).toHaveTextContent('Gmail 地址格式不正确');
    expect(previewTable).toHaveTextContent('dev+001@gmail.com');
    expect(previewTable).toHaveTextContent('user002@gmail.com');
    expect(previewTable).toHaveTextContent('二步验证未启用');
    const maskedPhones = previewTable.querySelectorAll(
      '[data-slot="preview-phone-masked"]',
    );
    expect(maskedPhones.length).toBe(10);
    expect(maskedPhones[0]).toHaveTextContent('****');

    // 展开第 3 行错误行查看详细字段问题
    await user.click(
      screen.getByRole('button', { name: '展开第 3 行详细问题' }),
    );
    const detailRow = previewTable.querySelector(
      '[data-slot="preview-row-detail"]',
    );
    expect(detailRow).toBeInTheDocument();
    expect(detailRow).toHaveTextContent('第 3 行字段校验明细');
    expect(detailRow).toHaveTextContent('A 列');

    // 点击“错误 8”筛选，仅显示 8 条错误记录
    await user.click(within(summaryBar).getByRole('button', { name: /错误/ }));
    expect(
      previewTable.querySelectorAll('tbody tr[data-row-status="error"]'),
    ).toHaveLength(8);

    // 切换回“全部”并打开“仅显示异常”开关（37 + 8 = 45 条）
    await user.click(within(summaryBar).getByRole('button', { name: /全部/ }));
    await user.click(screen.getByRole('switch', { name: '仅显示异常' }));
    expect(previewTable).toHaveTextContent('共 45 条');

    // 翻页与修改每页数量
    await user.selectOptions(screen.getByLabelText('每页显示数量'), '20');
    expect(
      previewTable.querySelectorAll('tbody tr[data-row-status]'),
    ).toHaveLength(20);
    await user.click(screen.getByRole('button', { name: '下一页' }));
    expect(previewTable).toHaveTextContent('第 2 / 3 页');
  });

  it('存在错误或未勾选确认时禁用开始导入；上传无错 CSV 后防重复提交、不泄露敏感值且不写 localStorage', async () => {
    const user = userEvent.setup();
    const secret = 'SuperPrivatePwd#2026';
    const { container } = renderPreviewRouter('/transfers/csv', {
      mockCommitBehavior: 'success',
      mockCommitDelayMs: 80,
    });

    // 默认预载存在 8 条错误：即使勾选确认，“开始导入”依然禁用
    const commitCheckbox = screen.getByLabelText(
      '我已确认数据无误，并知悉该操作将以事务方式原子提交',
    );
    const startBtn = screen.getByRole('button', { name: '开始导入' });
    expect(startBtn).toBeDisabled();
    await user.click(commitCheckbox);
    expect(startBtn).toBeDisabled();

    // 拒绝非 CSV 文件（通过拖放触发，不破坏原生 FileList）
    const dropzone = screen.getByRole('button', {
      name: '拖拽 CSV 文件到此处，或按回车选择文件',
    });
    fireEvent.drop(dropzone, {
      dataTransfer: {
        files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })],
      },
    });
    expect(
      screen.getByText('仅支持上传 text/csv（.csv）格式文件。'),
    ).toBeInTheDocument();

    // 上传无错真实 CSV 文件（含真实密码与手机号）
    const fileInput = screen.getByLabelText(
      '选择 CSV 文件',
    ) as HTMLInputElement;
    const cleanFile = makeCleanCsvFile('valid_batch.csv', secret);
    await user.upload(fileInput, cleanFile);

    await screen.findByText('valid_batch.csv');
    const previewTable = container.querySelector(
      '[data-slot="csv-preview-table"]',
    ) as HTMLElement;
    expect(
      within(previewTable).getByText('alpha.clean@gmail.com'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="password-sample-masked"]'),
    ).toHaveTextContent(MASKED_PASSWORD_PLACEHOLDER);

    // 密码原文绝不出现在 DOM 或浏览器持久化存储中
    expect(screen.queryByText(new RegExp(secret))).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    // 未勾选确认时仍禁用
    expect(screen.getByRole('button', { name: '开始导入' })).toBeDisabled();

    // 勾选确认后启用“开始导入”，快速双击只执行一次提交并展示进度与成功结果弹窗
    await user.click(commitCheckbox);
    const enabledStart = screen.getByRole('button', { name: '开始导入' });
    expect(enabledStart).toBeEnabled();

    await user.dblClick(enabledStart);
    expect(await screen.findByText('CSV 原子导入成功')).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('2')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: '查看审计日志' }),
    ).toBeInTheDocument();
  });

  it('Live 模式对接真实生成 API：支持服务端冲突重预览与网络中断显示“结果未知，请刷新确认”且绝不重试', async () => {
    const user = userEvent.setup();
    const session = makeSession();
    let commitMode: 'conflict' | 'network_drop' = 'conflict';
    const previewResponse: CsvPreview = {
      receipt_id: 'rcpt-live-0001',
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      mapping: {
        gmail_email: 0,
        password: 1,
        recovery_email: 2,
        phone: 3,
        status: 4,
        two_factor_status: 5,
      },
      strategy: 'update',
      columns: [
        { index: 0, suggested_field: 'gmail_email' },
        { index: 1, suggested_field: 'password' },
        { index: 2, suggested_field: 'recovery_email' },
        { index: 3, suggested_field: 'phone' },
        { index: 4, suggested_field: 'status' },
        { index: 5, suggested_field: 'two_factor_status' },
      ],
      rows: [
        { row: 2, action: 'create' },
        { row: 3, action: 'create' },
      ],
      errors: [],
    };

    const fetchMock = vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname;
      if (path === '/api/v1/dashboard/summary') {
        return json({
          total: 100,
          normal: 90,
          pending_verification: 5,
          abnormal: 5,
          added_this_month: 10,
          unverified_over_30_days: 2,
          timezone: 'UTC',
          month_from: '2026-11-01',
          month_to: '2026-12-01',
        });
      }
      if (path === '/api/v1/tags') return json([]);
      if (path === '/api/v1/accounts') {
        return json({
          items: [],
          total: 0,
          page: 1,
          page_size: 30,
          max_page_size: 100,
        });
      }
      if (path === '/api/v1/audit-events') {
        return json({
          items: [],
          total: 0,
          page: 1,
          page_size: 20,
          event_types: [],
        });
      }
      if (path === '/api/v1/imports/csv/preview') {
        expect(req.headers.get('X-CSRF-Token')).toBe(session.csrf_token);
        return json(previewResponse);
      }
      if (path === '/api/v1/imports/csv/commit') {
        expect(req.headers.get('X-CSRF-Token')).toBe(session.csrf_token);
        if (commitMode === 'conflict') {
          return json(
            {
              status: 'rejected',
              created: 0,
              updated: 0,
              skipped: 0,
              errors: [
                {
                  row: 2,
                  field: 'row_version',
                  reason: '预览后记录已被其他会话修改',
                },
              ],
            },
            409,
          );
        }
        throw new TypeError('network connection dropped');
      }
      return json({});
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<CsvImportPage mode="live" session={session} />);

    // 上传真实 CSV 触发服务端预览
    const fileInput = screen.getByLabelText(
      '选择 CSV 文件',
    ) as HTMLInputElement;
    await user.upload(fileInput, makeCleanCsvFile('live_sync.csv'));
    await screen.findByText('live_sync.csv');

    // 1) 模拟服务端 HTTP 409 冲突：弹出冲突提示并要求重新预览
    const checkbox = screen.getByLabelText(
      '我已确认数据无误，并知悉该操作将以事务方式原子提交',
    );
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: '开始导入' }));

    await screen.findByText('服务端返回冲突，需要重新预览');
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(
        /第 2 行 · row_version：预览后记录已被其他会话修改/,
      ),
    ).toBeInTheDocument();

    // 点击“重新预览”重新获取确认凭据
    await user.click(within(dialog).getByRole('button', { name: '重新预览' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );

    // 2) 模拟网络中断：显示“结果未知，请刷新确认”，不声称失败、不自动重试
    commitMode = 'network_drop';
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: '开始导入' }));

    await waitFor(() =>
      expect(
        screen.getAllByText('结果未知，请刷新确认').length,
      ).toBeGreaterThan(0),
    );
    const commitCalls = fetchMock.mock.calls.filter(([r]) =>
      new URL(r.url).pathname.endsWith('/imports/csv/commit'),
    );
    expect(commitCalls).toHaveLength(2); // 第 1 次 409 + 第 2 次断网，绝无自动重试
    expect(screen.queryByText(/导入失败，已全部回滚/)).not.toBeInTheDocument();

    // 隐藏页面时立即清除内存中的 CSV 文件
    await act(async () => {
      Object.defineProperty(document, 'hidden', {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.queryByText('live_sync.csv')).not.toBeInTheDocument();
  });

  it('界面透明度滑块跨页面同步 localStorage，支持拖放、批量操作子标签与审计日志跳转', async () => {
    const user = userEvent.setup();
    const { router } = renderPreviewRouter('/transfers/csv');

    // 调整左侧栏界面透明度滑块并写入 localStorage
    const slider = screen.getByRole('slider', {
      name: '界面透明度',
    }) as HTMLInputElement;
    fireEvent.change(slider, { target: { value: '75' } });
    expect(window.localStorage.getItem(NAV_ALPHA_STORAGE_KEY)).toBe('75');
    expect(slider.value).toBe('75');

    // 外部页面变更透明度时通过共享事件实时同步
    await act(async () => {
      persistNavAlpha(48);
    });
    expect(slider.value).toBe('48');

    // 拖放 CSV 文件支持
    const dropzone = screen.getByRole('button', {
      name: '拖拽 CSV 文件到此处，或按回车选择文件',
    });
    const dropped = makeCleanCsvFile('dropped_batch.csv');
    fireEvent.drop(dropzone, {
      dataTransfer: { files: [dropped] },
    });
    await screen.findByText('dropped_batch.csv');

    // 切换至“批量操作”子标签并执行批量状态调整
    await user.click(screen.getByRole('tab', { name: '批量操作' }));
    expect(screen.getByText('账号批量操作台')).toBeInTheDocument();
    await user.click(screen.getByLabelText('选择账号 example@gmail.com'));
    await user.click(screen.getByRole('button', { name: '应用状态' }));
    await screen.findByText(/已原子更新 1 个账号的状态/);

    // 切换回 CSV 导入并点击审计日志入口跳转
    await user.click(screen.getByRole('tab', { name: 'CSV 导入' }));
    await user.click(screen.getByRole('button', { name: '审计日志入口' }));
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/preview/settings/audit'),
    );
  });
});
