import type {
  AccountSummary,
  CsvIssue,
  CsvOptions,
  CsvRow,
} from '@/api/generated';

export type ImportStep = 1 | 2 | 3 | 4;

export type TransferSubTab = 'import' | 'batch';

export type ImportStrategyOption = 'upsert' | 'insert_only' | 'strict_new';

export type ConflictResolutionOption =
  'csv_overwrite' | 'keep_existing' | 'reject_batch';

export type SystemFieldKey =
  | 'gmail_email'
  | 'password'
  | 'recovery_email'
  | 'phone'
  | 'status'
  | 'two_factor_status'
  | 'account_no'
  | 'registered_at'
  | 'recovery_account'
  | 'purpose'
  | 'tags'
  | 'last_login_at'
  | 'notes';

export type SystemFieldDefinition = {
  key: SystemFieldKey;
  label: string;
  required: boolean;
  sensitive: boolean;
  primary: boolean;
  aliases: readonly string[];
  description: string;
};

export const SYSTEM_FIELD_DEFINITIONS: readonly SystemFieldDefinition[] = [
  {
    key: 'gmail_email',
    label: 'Gmail 地址',
    required: true,
    sensitive: false,
    primary: true,
    aliases: ['gmail', 'gmail_email', 'email', 'mail', 'gmail地址', '邮箱'],
    description: '唯一主账号地址（自动规范化校验）',
  },
  {
    key: 'password',
    label: '登录密码',
    required: true,
    sensitive: true,
    primary: true,
    aliases: ['password', 'pwd', 'pass', 'login_password', '登录密码', '密码'],
    description: 'AES-256-GCM 独立加密入库，界面始终掩码',
  },
  {
    key: 'recovery_email',
    label: '辅助邮箱',
    required: false,
    sensitive: false,
    primary: true,
    aliases: ['recovery_email', 'backup_email', 'recovery', '辅助邮箱'],
    description: '外部辅助恢复邮箱',
  },
  {
    key: 'phone',
    label: '手机号',
    required: false,
    sensitive: true,
    primary: true,
    aliases: ['phone', 'mobile', 'tel', 'phone_number', '手机号'],
    description: '绑定手机号，预览表格自动脱敏',
  },
  {
    key: 'status',
    label: '账号状态',
    required: false,
    sensitive: false,
    primary: true,
    aliases: ['status', 'account_status', 'state', '账号状态', '状态'],
    description: 'normal / pending_verification / restricted / disabled 等',
  },
  {
    key: 'two_factor_status',
    label: '二步验证',
    required: false,
    sensitive: false,
    primary: true,
    aliases: [
      'totp_enabled',
      'two_factor_status',
      '2fa',
      'totp',
      'mfa',
      '二步验证',
    ],
    description: '启用 / 未启用 / 未知',
  },
  {
    key: 'account_no',
    label: '账号编号',
    required: false,
    sensitive: false,
    primary: false,
    aliases: ['account_no', 'no', 'id', '账号编号'],
    description: '留空自动生成 GM 编号',
  },
  {
    key: 'registered_at',
    label: '注册时间',
    required: false,
    sensitive: false,
    primary: false,
    aliases: ['registered_at', 'created_at', '注册时间'],
    description: 'ISO 8601 带时区时间戳',
  },
  {
    key: 'recovery_account',
    label: '关联已有账号',
    required: false,
    sensitive: false,
    primary: false,
    aliases: ['recovery_account', 'linked_recovery', '关联已有账号'],
    description: '已有 GM 编号或已存在的 Gmail 地址',
  },
  {
    key: 'purpose',
    label: '账号用途',
    required: false,
    sensitive: false,
    primary: false,
    aliases: ['purpose', 'usage', '用途'],
    description: '业务或环境用途说明',
  },
  {
    key: 'tags',
    label: '标签列表',
    required: false,
    sensitive: false,
    primary: false,
    aliases: ['tags', 'tag', '标签'],
    description: '使用 | 分隔多个标签',
  },
  {
    key: 'last_login_at',
    label: '最后登录时间',
    required: false,
    sensitive: false,
    primary: false,
    aliases: ['last_login_at', 'last_login', '最后登录'],
    description: 'ISO 8601 时间戳',
  },
  {
    key: 'notes',
    label: '备注信息',
    required: false,
    sensitive: true,
    primary: false,
    aliases: ['notes', 'note', 'remark', '备注'],
    description: '加密备注，界面不回显明文',
  },
] as const;

export const SYSTEM_FIELD_MAP: Record<SystemFieldKey, SystemFieldDefinition> =
  Object.fromEntries(
    SYSTEM_FIELD_DEFINITIONS.map((def) => [def.key, def]),
  ) as Record<SystemFieldKey, SystemFieldDefinition>;

export type FieldMappingState = Partial<Record<SystemFieldKey, number>>;

export type CsvColumnInfo = {
  index: number;
  letter: string;
  header: string;
  sampleValue: string;
  suggestedField: SystemFieldKey | null;
};

export type UploadedFileMeta = {
  name: string;
  sizeBytes: number;
  sizeLabel: string;
  rowCount: number;
  columnCount: number;
  encoding: string;
  isSampleFixture: boolean;
  lastModified?: number;
};

export type FileCheckItem = {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail?: string;
};

export type FileValidationResult = {
  passed: boolean;
  source: 'client' | 'server';
  headline: string;
  checks: FileCheckItem[];
};

export type RowValidationStatus = 'valid' | 'warning' | 'error';

export type PreviewFilterStatus = 'all' | RowValidationStatus;

export type RowFieldIssue = {
  field: string;
  fieldLabel: string;
  columnLetter?: string;
  severity: 'warning' | 'error';
  reason: string;
  suggestion?: string;
};

export type PreviewRow = {
  rowNumber: number;
  status: RowValidationStatus;
  action: CsvRow['action'];
  gmailEmail: string;
  recoveryEmail: string;
  phoneMasked: string;
  accountStatus: AccountSummary['status'] | 'unknown';
  accountStatusLabel: string;
  twoFactorStatus: AccountSummary['two_factor_status'];
  twoFactorLabel: string;
  validationMessage: string;
  issues: RowFieldIssue[];
};

export type ValidationCounts = {
  all: number;
  valid: number;
  warning: number;
  error: number;
};

export type CommitSummaryCounts = {
  total: number;
  create: number;
  update: number;
  skip: number;
  error: number;
};

export type CommitOutcome =
  | {
      kind: 'committed';
      batchId: string;
      committedAt: string;
      created: number;
      updated: number;
      skipped: number;
    }
  | {
      kind: 'conflict';
      message: string;
      issues: CsvIssue[];
    }
  | {
      kind: 'unknown';
      message: string;
    };

export type ImportHistoryRecord = {
  id: string;
  fileName: string;
  executedAt: string;
  strategyLabel: string;
  created: number;
  updated: number;
  skipped: number;
  status: 'committed' | 'rejected';
  operator: string;
};

export type BatchAccountItem = {
  id: string;
  accountNo: string;
  gmailEmail: string;
  recoveryEmail: string;
  status: AccountSummary['status'];
  twoFactorStatus: AccountSummary['two_factor_status'];
  tags: string[];
  rowVersion: number;
  updatedAt: string;
};

export type SidebarCounts = {
  accounts: number;
  tags: number;
  archived: number;
  trash: number;
};

export type ParsedCsvDataset = {
  meta: UploadedFileMeta;
  columns: CsvColumnInfo[];
  validation: FileValidationResult;
  /** 仅保存在组件内存中，绝不写入 localStorage / sessionStorage */
  rows: string[][];
};

export function toApiStrategy(
  strategy: ImportStrategyOption,
  conflict: ConflictResolutionOption,
): NonNullable<CsvOptions['strategy']> {
  if (strategy === 'strict_new' || conflict === 'reject_batch') return 'error';
  if (strategy === 'insert_only' || conflict === 'keep_existing') return 'skip';
  return 'update';
}
