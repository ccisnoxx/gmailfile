import { MASKED_PASSWORD_PLACEHOLDER } from './csv-parser';
import type {
  BatchAccountItem,
  CommitSummaryCounts,
  ConflictResolutionOption,
  CsvColumnInfo,
  FieldMappingState,
  FileValidationResult,
  ImportHistoryRecord,
  ImportStrategyOption,
  PreviewFilterStatus,
  PreviewRow,
  RowFieldIssue,
  SidebarCounts,
  UploadedFileMeta,
  ValidationCounts,
} from './types';

export const DEFAULT_SIDEBAR_COUNTS: SidebarCounts = {
  accounts: 12_548,
  tags: 36,
  archived: 1_203,
  trash: 87,
};

export const SAMPLE_TOTAL_ROWS = 5_246;
export const SAMPLE_VALID_COUNT = 5_201;
export const SAMPLE_WARNING_COUNT = 37;
export const SAMPLE_ERROR_COUNT = 8;

export const SAMPLE_CREATE_COUNT = 4_892;
export const SAMPLE_UPDATE_COUNT = 317;
export const SAMPLE_SKIP_COUNT = 29;

export const DEFAULT_SAMPLE_FILE_META: UploadedFileMeta = {
  name: 'gmail_accounts_20250115.csv',
  sizeBytes: 1_887_437,
  sizeLabel: '1.8 MB',
  rowCount: SAMPLE_TOTAL_ROWS,
  columnCount: 12,
  encoding: 'UTF-8',
  isSampleFixture: true,
};

export const DEFAULT_SAMPLE_COLUMNS: readonly CsvColumnInfo[] = [
  {
    index: 0,
    letter: 'A',
    header: 'gmail',
    sampleValue: 'example@gmail.com',
    suggestedField: 'gmail_email',
  },
  {
    index: 1,
    letter: 'B',
    header: 'password',
    sampleValue: MASKED_PASSWORD_PLACEHOLDER,
    suggestedField: 'password',
  },
  {
    index: 2,
    letter: 'C',
    header: 'recovery_email',
    sampleValue: 'backup.example@outlook.com',
    suggestedField: 'recovery_email',
  },
  {
    index: 3,
    letter: 'D',
    header: 'phone',
    sampleValue: '+86 138 **** 1024',
    suggestedField: 'phone',
  },
  {
    index: 4,
    letter: 'E',
    header: 'status',
    sampleValue: 'normal（正常）',
    suggestedField: 'status',
  },
  {
    index: 5,
    letter: 'F',
    header: 'totp_enabled',
    sampleValue: 'true（已启用）',
    suggestedField: 'two_factor_status',
  },
  {
    index: 6,
    letter: 'G',
    header: 'account_no',
    sampleValue: 'GM-004892',
    suggestedField: 'account_no',
  },
  {
    index: 7,
    letter: 'H',
    header: 'registered_at',
    sampleValue: '2025-01-12T08:30:00Z',
    suggestedField: 'registered_at',
  },
  {
    index: 8,
    letter: 'I',
    header: 'purpose',
    sampleValue: '研发测试与工具',
    suggestedField: 'purpose',
  },
  {
    index: 9,
    letter: 'J',
    header: 'tags',
    sampleValue: '开发环境|长期保留',
    suggestedField: 'tags',
  },
  {
    index: 10,
    letter: 'K',
    header: 'last_login_at',
    sampleValue: '2025-01-14T16:20:00Z',
    suggestedField: 'last_login_at',
  },
  {
    index: 11,
    letter: 'L',
    header: 'notes',
    sampleValue: '已掩码（敏感字段不回显）',
    suggestedField: 'notes',
  },
] as const;

export const DEFAULT_SAMPLE_MAPPING: FieldMappingState = {
  gmail_email: 0,
  password: 1,
  recovery_email: 2,
  phone: 3,
  status: 4,
  two_factor_status: 5,
};

export const DEFAULT_SAMPLE_VALIDATION: FileValidationResult = {
  passed: true,
  source: 'server',
  headline: '文件校验通过',
  checks: [
    { id: 'size', label: '文件大小 1.8 MB（≤10 MB）', status: 'pass' },
    { id: 'rows', label: '数据行数 5,246 行（≤10,000 行）', status: 'pass' },
    { id: 'columns', label: '列数 12 列（≤256 列）', status: 'pass' },
    { id: 'encoding', label: '编码 UTF-8', status: 'pass' },
    { id: 'structure', label: '列结构一致', status: 'pass' },
    { id: 'formula', label: '公式注入未检测到风险', status: 'pass' },
  ],
};

// 8 条精确错误行号（含规范中的第 3 行 invalid-email）
const ERROR_ROW_NUMBERS = [3, 18, 42, 109, 256, 814, 2105, 4988] as const;

// 37 条精确警告行号（含规范中的第 2 行与第 5 行）
const WARNING_ROW_NUMBERS: readonly number[] = [
  2, 5, 11, 19, 27, 36, 48, 63, 79, 95, 118, 142, 169, 204, 241, 289, 340, 412,
  503, 617, 745, 888, 1024, 1210, 1435, 1690, 1940, 2230, 2518, 2840, 3195,
  3540, 3890, 4215, 4560, 4820, 5112,
];

const ERROR_ROW_SET = new Set<number>(ERROR_ROW_NUMBERS);
const WARNING_ROW_SET = new Set<number>(WARNING_ROW_NUMBERS);

const ERROR_DETAILS: Record<
  number,
  {
    gmailEmail: string;
    recoveryEmail: string;
    phoneMasked: string;
    accountStatus: PreviewRow['accountStatus'];
    accountStatusLabel: string;
    twoFactorStatus: PreviewRow['twoFactorStatus'];
    twoFactorLabel: string;
    validationMessage: string;
    issues: RowFieldIssue[];
  }
> = {
  3: {
    gmailEmail: 'invalid-email',
    recoveryEmail: 'ops.backup@company.io',
    phoneMasked: '+86 137 **** 3096',
    accountStatus: 'normal',
    accountStatusLabel: '正常',
    twoFactorStatus: 'enabled',
    twoFactorLabel: '已启用',
    validationMessage: 'Gmail 地址格式不正确',
    issues: [
      {
        field: 'gmail_email',
        fieldLabel: 'Gmail 地址',
        columnLetter: 'A',
        severity: 'error',
        reason: 'Gmail 地址格式不正确，缺少合法域名后缀（@gmail.com）',
        suggestion: '修正为标准邮箱地址，例如 invalid.email@gmail.com',
      },
    ],
  },
  18: {
    gmailEmail: 'empty.pwd.user@gmail.com',
    recoveryEmail: 'sec.recovery@outlook.com',
    phoneMasked: '+86 139 **** 1842',
    accountStatus: 'pending_verification',
    accountStatusLabel: '待验证',
    twoFactorStatus: 'disabled',
    twoFactorLabel: '未启用',
    validationMessage: '新增账号缺少必填登录密码',
    issues: [
      {
        field: 'password',
        fieldLabel: '登录密码',
        columnLetter: 'B',
        severity: 'error',
        reason: '新增账号必须提供非空登录密码（密文入库，不回显明文）',
        suggestion: '在 CSV 第 18 行 B 列补充登录密码后重新上传',
      },
    ],
  },
  42: {
    gmailEmail: 'qa.pipeline42@gmail.com',
    recoveryEmail: 'not-a-valid-recovery',
    phoneMasked: '+86 138 **** 4208',
    accountStatus: 'normal',
    accountStatusLabel: '正常',
    twoFactorStatus: 'enabled',
    twoFactorLabel: '已启用',
    validationMessage: '辅助邮箱格式不正确',
    issues: [
      {
        field: 'recovery_email',
        fieldLabel: '辅助邮箱',
        columnLetter: 'C',
        severity: 'error',
        reason: '辅助邮箱字段未通过 RFC 邮箱格式校验',
        suggestion: '修改为有效的外部恢复邮箱，或留空交由后续补录',
      },
    ],
  },
  109: {
    gmailEmail: 'service.bot109@gmail.com',
    recoveryEmail: 'bot.backup@proton.me',
    phoneMasked: '+86 135 **** 1094',
    accountStatus: 'unknown',
    accountStatusLabel: 'suspended_x',
    twoFactorStatus: 'enabled',
    twoFactorLabel: '已启用',
    validationMessage: '账号状态值不在允许枚举内',
    issues: [
      {
        field: 'status',
        fieldLabel: '账号状态',
        columnLetter: 'E',
        severity: 'error',
        reason:
          '状态码不受支持，仅允许 normal / pending_verification / restricted / disabled / archived',
        suggestion: '将状态调整为 disabled 或 restricted',
      },
    ],
  },
  256: {
    gmailEmail: 'deleted.archive@gmail.com',
    recoveryEmail: 'archive.ops@icloud.com',
    phoneMasked: '+86 136 **** 2561',
    accountStatus: 'archived',
    accountStatusLabel: '已归档',
    twoFactorStatus: 'enabled',
    twoFactorLabel: '已启用',
    validationMessage: '目标账号处于回收站，禁止通过导入覆盖',
    issues: [
      {
        field: 'gmail_email',
        fieldLabel: 'Gmail 地址',
        columnLetter: 'A',
        severity: 'error',
        reason: '数据库中该邮箱已被软删除，导入策略不允许隐式恢复',
        suggestion: '请先在回收站中手动恢复该账号，或从 CSV 移除此行',
      },
    ],
  },
  814: {
    gmailEmail: 'bad..dots814@gmail.com',
    recoveryEmail: 'team.recovery@outlook.com',
    phoneMasked: '+86 138 **** 8140',
    accountStatus: 'normal',
    accountStatusLabel: '正常',
    twoFactorStatus: 'enabled',
    twoFactorLabel: '已启用',
    validationMessage: 'Gmail 地址包含连续点号',
    issues: [
      {
        field: 'gmail_email',
        fieldLabel: 'Gmail 地址',
        columnLetter: 'A',
        severity: 'error',
        reason: '邮箱本地部分不允许出现连续点号（..）',
        suggestion: '核对原始账号拼写并修正',
      },
    ],
  },
  2105: {
    gmailEmail: 'build.runner2105@gmail.com',
    recoveryEmail: 'ci.recovery@fastmail.com',
    phoneMasked: '+86 137 **** 2105',
    accountStatus: 'normal',
    accountStatusLabel: '正常',
    twoFactorStatus: 'unknown',
    twoFactorLabel: 'maybe',
    validationMessage: '二步验证状态值格式无效',
    issues: [
      {
        field: 'two_factor_status',
        fieldLabel: '二步验证',
        columnLetter: 'F',
        severity: 'error',
        reason: '无法解析二步验证布尔/枚举值',
        suggestion: '请使用 true / false 或 enabled / disabled / unknown',
      },
    ],
  },
  4988: {
    gmailEmail: 'legacy.sync4988@gmail.com',
    recoveryEmail: 'legacy.bak@outlook.com',
    phoneMasked: '+86 139 **** 4988',
    accountStatus: 'restricted',
    accountStatusLabel: '风险',
    twoFactorStatus: 'enabled',
    twoFactorLabel: '已启用',
    validationMessage: '账号编号与现有 Gmail 地址不匹配',
    issues: [
      {
        field: 'account_no',
        fieldLabel: '账号编号',
        columnLetter: 'G',
        severity: 'error',
        reason: '指定 GM 编号归属另一账号，无法执行覆盖更新',
        suggestion: '留空 account_no 或填写与该 Gmail 对应的准确编号',
      },
    ],
  },
};

function buildSampleRowByNumber(
  rowNumber: number,
  strategy: ImportStrategyOption,
  conflictResolution: ConflictResolutionOption,
  missingRequiredFields: string[],
): PreviewRow {
  // 缺失必填映射时，所有行标注映射错误
  if (missingRequiredFields.length > 0) {
    return {
      rowNumber,
      status: 'error',
      action: 'error',
      gmailEmail:
        rowNumber === 1
          ? 'example@gmail.com'
          : `account.${rowNumber}@gmail.com`,
      recoveryEmail: 'backup@outlook.com',
      phoneMasked: `+86 138 **** ${String(1000 + (rowNumber % 9000))}`,
      accountStatus: 'normal',
      accountStatusLabel: '正常',
      twoFactorStatus: 'enabled',
      twoFactorLabel: '已启用',
      validationMessage: `缺少必填字段映射：${missingRequiredFields.join('、')}`,
      issues: missingRequiredFields.map((label) => ({
        field: label === 'Gmail 地址' ? 'gmail_email' : 'password',
        fieldLabel: label,
        severity: 'error',
        reason: `尚未为必填系统字段“${label}”配置对应的 CSV 列`,
        suggestion: '请在上方字段映射表中选择对应的 CSV 列',
      })),
    };
  }

  // 固定前 5 条展示规范示例
  if (rowNumber === 1) {
    return {
      rowNumber: 1,
      status: 'valid',
      action: 'create',
      gmailEmail: 'example@gmail.com',
      recoveryEmail: 'backup.example@outlook.com',
      phoneMasked: '+86 138 **** 1024',
      accountStatus: 'normal',
      accountStatusLabel: '正常',
      twoFactorStatus: 'enabled',
      twoFactorLabel: '已启用',
      validationMessage: '校验通过（新增）',
      issues: [],
    };
  }
  if (rowNumber === 2) {
    return {
      rowNumber: 2,
      status: 'warning',
      action: 'create',
      gmailEmail: 'test.account@gmail.com',
      recoveryEmail: '—',
      phoneMasked: '+86 139 **** 2048',
      accountStatus: 'pending_verification',
      accountStatusLabel: '待验证',
      twoFactorStatus: 'enabled',
      twoFactorLabel: '已启用',
      validationMessage: '缺少辅助邮箱',
      issues: [
        {
          field: 'recovery_email',
          fieldLabel: '辅助邮箱',
          columnLetter: 'C',
          severity: 'warning',
          reason: '缺少辅助邮箱，导入后账号安全等级将降级',
          suggestion: '建议在 CSV 中补充外部辅助邮箱，或在导入后统一维护',
        },
      ],
    };
  }
  if (rowNumber === 4) {
    const isSkip =
      strategy === 'insert_only' || conflictResolution === 'keep_existing';
    return {
      rowNumber: 4,
      status: 'valid',
      action: isSkip ? 'skip' : 'update',
      gmailEmail: 'dev+001@gmail.com',
      recoveryEmail: 'dev.recovery@proton.me',
      phoneMasked: '+86 136 **** 4012',
      accountStatus: 'normal',
      accountStatusLabel: '正常',
      twoFactorStatus: 'enabled',
      twoFactorLabel: '已启用',
      validationMessage: isSkip
        ? '校验通过（保留现有并跳过）'
        : '校验通过（覆盖更新）',
      issues: [],
    };
  }
  if (rowNumber === 5) {
    return {
      rowNumber: 5,
      status: 'warning',
      action: 'create',
      gmailEmail: 'user002@gmail.com',
      recoveryEmail: 'user002.bak@icloud.com',
      phoneMasked: '+86 135 **** 5120',
      accountStatus: 'normal',
      accountStatusLabel: '正常',
      twoFactorStatus: 'disabled',
      twoFactorLabel: '未启用',
      validationMessage: '二步验证未启用',
      issues: [
        {
          field: 'two_factor_status',
          fieldLabel: '二步验证',
          columnLetter: 'F',
          severity: 'warning',
          reason: '二步验证未启用，存在较高凭据泄露风险',
          suggestion: '导入完成后建议尽快启用 TOTP 验证器',
        },
      ],
    };
  }

  // 错误行
  if (ERROR_ROW_SET.has(rowNumber)) {
    const detail = ERROR_DETAILS[rowNumber];
    return {
      rowNumber,
      status: 'error',
      action: 'error',
      ...detail,
    };
  }

  // 其余 35 条警告行
  if (WARNING_ROW_SET.has(rowNumber)) {
    const idx = WARNING_ROW_NUMBERS.indexOf(rowNumber);
    const missingRecovery = idx % 2 === 0;
    const pad = String(rowNumber).padStart(4, '0');
    return {
      rowNumber,
      status: 'warning',
      action: 'create',
      gmailEmail: `ops.user${pad}@gmail.com`,
      recoveryEmail: missingRecovery ? '—' : `ops.bak${pad}@outlook.com`,
      phoneMasked: `+86 13${3 + (rowNumber % 6)} **** ${pad}`,
      accountStatus: missingRecovery ? 'pending_verification' : 'normal',
      accountStatusLabel: missingRecovery ? '待验证' : '正常',
      twoFactorStatus: missingRecovery ? 'enabled' : 'disabled',
      twoFactorLabel: missingRecovery ? '已启用' : '未启用',
      validationMessage: missingRecovery ? '缺少辅助邮箱' : '二步验证未启用',
      issues: [
        missingRecovery
          ? {
              field: 'recovery_email',
              fieldLabel: '辅助邮箱',
              columnLetter: 'C',
              severity: 'warning',
              reason: '缺少辅助邮箱，可能影响异常登录恢复',
              suggestion: '建议补充外部恢复邮箱地址',
            }
          : {
              field: 'two_factor_status',
              fieldLabel: '二步验证',
              columnLetter: 'F',
              severity: 'warning',
              reason: '二步验证未启用',
              suggestion: '导入后建议尽快为该账号绑定 TOTP',
            },
      ],
    };
  }

  // 正常有效行（按需确定性生成，绝不一次性渲染全部 5,246 行）
  const pad = String(rowNumber).padStart(4, '0');
  const domains = ['outlook.com', 'proton.me', 'icloud.com', 'fastmail.com'];
  const prefixes = ['dev', 'team', 'cloud', 'qa', 'ops', 'studio', 'data'];
  const prefix = prefixes[rowNumber % prefixes.length];
  const domain = domains[rowNumber % domains.length];
  const isUpdateSlot = rowNumber % 16 === 0;
  const isSkipSlot = !isUpdateSlot && rowNumber % 179 === 0;

  let action: PreviewRow['action'] = 'create';
  let validationMessage = '校验通过（新增）';
  if (isSkipSlot) {
    action = 'skip';
    validationMessage = '文件内重复地址（将跳过）';
  } else if (isUpdateSlot) {
    if (strategy === 'insert_only' || conflictResolution === 'keep_existing') {
      action = 'skip';
      validationMessage = '已有账号（将跳过）';
    } else {
      action = 'update';
      validationMessage = '校验通过（覆盖更新）';
    }
  }

  return {
    rowNumber,
    status: 'valid',
    action,
    gmailEmail: `${prefix}.acct${pad}@gmail.com`,
    recoveryEmail: `${prefix}.rec${pad}@${domain}`,
    phoneMasked: `+86 13${3 + (rowNumber % 6)} **** ${pad}`,
    accountStatus: rowNumber % 19 === 0 ? 'pending_verification' : 'normal',
    accountStatusLabel: rowNumber % 19 === 0 ? '待验证' : '正常',
    twoFactorStatus: 'enabled',
    twoFactorLabel: '已启用',
    validationMessage,
    issues: [],
  };
}

export function getSampleValidationCounts(
  mapping: FieldMappingState,
): ValidationCounts {
  const missingRequired =
    mapping.gmail_email === undefined || mapping.password === undefined;
  if (missingRequired) {
    return {
      all: SAMPLE_TOTAL_ROWS,
      valid: 0,
      warning: 0,
      error: SAMPLE_TOTAL_ROWS,
    };
  }
  return {
    all: SAMPLE_TOTAL_ROWS,
    valid: SAMPLE_VALID_COUNT,
    warning: SAMPLE_WARNING_COUNT,
    error: SAMPLE_ERROR_COUNT,
  };
}

export function getSampleCommitSummary(
  mapping: FieldMappingState,
  strategy: ImportStrategyOption,
  conflictResolution: ConflictResolutionOption,
): CommitSummaryCounts {
  const missingRequired =
    mapping.gmail_email === undefined || mapping.password === undefined;
  if (missingRequired) {
    return {
      total: SAMPLE_TOTAL_ROWS,
      create: 0,
      update: 0,
      skip: 0,
      error: SAMPLE_TOTAL_ROWS,
    };
  }
  if (strategy === 'strict_new' || conflictResolution === 'reject_batch') {
    return {
      total: SAMPLE_TOTAL_ROWS,
      create: SAMPLE_CREATE_COUNT,
      update: 0,
      skip: 0,
      error: SAMPLE_ERROR_COUNT + SAMPLE_UPDATE_COUNT + SAMPLE_SKIP_COUNT,
    };
  }
  if (strategy === 'insert_only' || conflictResolution === 'keep_existing') {
    return {
      total: SAMPLE_TOTAL_ROWS,
      create: SAMPLE_CREATE_COUNT,
      update: 0,
      skip: SAMPLE_UPDATE_COUNT + SAMPLE_SKIP_COUNT,
      error: SAMPLE_ERROR_COUNT,
    };
  }
  return {
    total: SAMPLE_TOTAL_ROWS,
    create: SAMPLE_CREATE_COUNT,
    update: SAMPLE_UPDATE_COUNT,
    skip: SAMPLE_SKIP_COUNT,
    error: SAMPLE_ERROR_COUNT,
  };
}

function getFilteredSampleRowNumbers(
  filter: PreviewFilterStatus,
  anomaliesOnly: boolean,
  missingRequired: boolean,
): number[] | 'all' | 'valid' {
  if (missingRequired) {
    if (filter === 'valid' || filter === 'warning') return [];
    return 'all';
  }
  if (anomaliesOnly) {
    if (filter === 'valid') return [];
    if (filter === 'warning') return [...WARNING_ROW_NUMBERS];
    if (filter === 'error') return [...ERROR_ROW_NUMBERS];
    return [...WARNING_ROW_NUMBERS, ...ERROR_ROW_NUMBERS].sort((a, b) => a - b);
  }
  if (filter === 'warning') return [...WARNING_ROW_NUMBERS];
  if (filter === 'error') return [...ERROR_ROW_NUMBERS];
  if (filter === 'valid') return 'valid';
  return 'all';
}

export function getSamplePreviewPage({
  page,
  pageSize,
  filter,
  anomaliesOnly,
  mapping,
  strategy,
  conflictResolution,
}: {
  page: number;
  pageSize: number;
  filter: PreviewFilterStatus;
  anomaliesOnly: boolean;
  mapping: FieldMappingState;
  strategy: ImportStrategyOption;
  conflictResolution: ConflictResolutionOption;
}): { rows: PreviewRow[]; total: number } {
  const missingRequiredFields: string[] = [];
  if (mapping.gmail_email === undefined)
    missingRequiredFields.push('Gmail 地址');
  if (mapping.password === undefined) missingRequiredFields.push('登录密码');
  const missingRequired = missingRequiredFields.length > 0;

  const target = getFilteredSampleRowNumbers(
    filter,
    anomaliesOnly,
    missingRequired,
  );
  const safePage = Math.max(1, page);
  const startOffset = (safePage - 1) * pageSize;

  if (Array.isArray(target)) {
    const slice = target.slice(startOffset, startOffset + pageSize);
    return {
      total: target.length,
      rows: slice.map((rowNum) =>
        buildSampleRowByNumber(
          rowNum,
          strategy,
          conflictResolution,
          missingRequiredFields,
        ),
      ),
    };
  }

  if (target === 'all') {
    const startRow = startOffset + 1;
    const endRow = Math.min(SAMPLE_TOTAL_ROWS, startOffset + pageSize);
    const rows: PreviewRow[] = [];
    for (let r = startRow; r <= endRow; r++) {
      rows.push(
        buildSampleRowByNumber(
          r,
          strategy,
          conflictResolution,
          missingRequiredFields,
        ),
      );
    }
    return { total: SAMPLE_TOTAL_ROWS, rows };
  }

  // target === 'valid'：按需跳过异常行生成当前页切片
  const rows: PreviewRow[] = [];
  let seenValid = 0;
  for (let r = 1; r <= SAMPLE_TOTAL_ROWS && rows.length < pageSize; r++) {
    if (ERROR_ROW_SET.has(r) || WARNING_ROW_SET.has(r)) continue;
    if (seenValid >= startOffset) {
      rows.push(
        buildSampleRowByNumber(
          r,
          strategy,
          conflictResolution,
          missingRequiredFields,
        ),
      );
    }
    seenValid++;
  }
  return { total: SAMPLE_VALID_COUNT, rows };
}

export function getSampleExportPreviewRows(
  filter: PreviewFilterStatus,
  anomaliesOnly: boolean,
  mapping: FieldMappingState,
  strategy: ImportStrategyOption,
  conflictResolution: ConflictResolutionOption,
  limit = 200,
): PreviewRow[] {
  return getSamplePreviewPage({
    page: 1,
    pageSize: limit,
    filter,
    anomaliesOnly,
    mapping,
    strategy,
    conflictResolution,
  }).rows;
}

export const MOCK_IMPORT_HISTORY: ImportHistoryRecord[] = [
  {
    id: 'imp-20250114-2205',
    fileName: 'gmail_batch_q1_sync.csv',
    executedAt: '2025-01-14 22:05:18',
    strategyLabel: '新增或更新 · 以 CSV 为准',
    created: 1_248,
    updated: 86,
    skipped: 12,
    status: 'committed',
    operator: 'admin',
  },
  {
    id: 'imp-20250110-1640',
    fileName: 'dev_environment_pool.csv',
    executedAt: '2025-01-10 16:40:09',
    strategyLabel: '仅新增 · 跳过冲突',
    created: 340,
    updated: 0,
    skipped: 19,
    status: 'committed',
    operator: 'admin',
  },
  {
    id: 'imp-20250106-0912',
    fileName: 'legacy_accounts_migration.csv',
    executedAt: '2025-01-06 09:12:44',
    strategyLabel: '新增或更新 · 冲突拒绝',
    created: 0,
    updated: 0,
    skipped: 0,
    status: 'rejected',
    operator: 'admin',
  },
];

export function createMockBatchAccounts(): BatchAccountItem[] {
  return [
    {
      id: 'acc-batch-01',
      accountNo: 'GM-012548',
      gmailEmail: 'example@gmail.com',
      recoveryEmail: 'backup.example@outlook.com',
      status: 'normal',
      twoFactorStatus: 'enabled',
      tags: ['开发环境', '长期保留'],
      rowVersion: 5,
      updatedAt: '2025-01-15 09:20',
    },
    {
      id: 'acc-batch-02',
      accountNo: 'GM-012547',
      gmailEmail: 'test.account@gmail.com',
      recoveryEmail: 'qa.recovery@proton.me',
      status: 'pending_verification',
      twoFactorStatus: 'enabled',
      tags: ['测试池'],
      rowVersion: 3,
      updatedAt: '2025-01-15 08:45',
    },
    {
      id: 'acc-batch-03',
      accountNo: 'GM-012546',
      gmailEmail: 'dev+001@gmail.com',
      recoveryEmail: 'dev.recovery@proton.me',
      status: 'normal',
      twoFactorStatus: 'enabled',
      tags: ['开发环境', '工具账号'],
      rowVersion: 7,
      updatedAt: '2025-01-14 19:12',
    },
    {
      id: 'acc-batch-04',
      accountNo: 'GM-012545',
      gmailEmail: 'user002@gmail.com',
      recoveryEmail: 'user002.bak@icloud.com',
      status: 'restricted',
      twoFactorStatus: 'disabled',
      tags: ['需核查'],
      rowVersion: 2,
      updatedAt: '2025-01-14 15:30',
    },
    {
      id: 'acc-batch-05',
      accountNo: 'GM-012544',
      gmailEmail: 'ops.monitor@gmail.com',
      recoveryEmail: 'sec.team@outlook.com',
      status: 'normal',
      twoFactorStatus: 'enabled',
      tags: ['运维监控', '长期保留'],
      rowVersion: 9,
      updatedAt: '2025-01-13 21:08',
    },
    {
      id: 'acc-batch-06',
      accountNo: 'GM-012543',
      gmailEmail: 'sandbox.alpha@gmail.com',
      recoveryEmail: 'sandbox.bak@fastmail.com',
      status: 'disabled',
      twoFactorStatus: 'disabled',
      tags: ['测试池'],
      rowVersion: 4,
      updatedAt: '2025-01-12 11:50',
    },
  ];
}
