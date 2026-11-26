import type { AccountSummary } from '@/api/generated';
import {
  SYSTEM_FIELD_DEFINITIONS,
  type CommitSummaryCounts,
  type ConflictResolutionOption,
  type CsvColumnInfo,
  type FieldMappingState,
  type FileCheckItem,
  type FileValidationResult,
  type ImportStrategyOption,
  type ParsedCsvDataset,
  type PreviewRow,
  type RowFieldIssue,
  type SystemFieldKey,
  type ValidationCounts,
} from './types';

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
export const MAX_CSV_ROWS = 10_000;
export const MAX_CSV_COLUMNS = 256;

export const MASKED_PASSWORD_PLACEHOLDER = '••••••••••••';

export function indexToColumnLetter(index: number): string {
  let n = index;
  let result = '';
  while (n >= 0) {
    result = String.fromCharCode((n % 26) + 65) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

export function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

export function maskPassword(): string {
  return MASKED_PASSWORD_PLACEHOLDER;
}

export function maskPhone(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 7) return '*** ****';
  const prefix = value.startsWith('+')
    ? `${value.slice(0, Math.min(3, value.indexOf(' ') > 0 ? value.indexOf(' ') : 3))} `
    : '';
  const localDigits =
    value.startsWith('+86') && digits.length >= 11 ? digits.slice(2) : digits;
  const head = localDigits.slice(0, 3);
  const tail = localDigits.slice(-4);
  return `${prefix}${head} **** ${tail}`;
}

export function maskNotes(raw: string | null | undefined): string {
  return raw && raw.trim() ? '已掩码（敏感字段不回显）' : '—';
}

export function maskFieldSample(
  field: SystemFieldKey | null,
  raw: string,
): string {
  if (field === 'password') return maskPassword();
  if (field === 'phone') return maskPhone(raw);
  if (field === 'notes') return maskNotes(raw);
  const trimmed = raw.trim();
  return trimmed || '—';
}

/**
 * 标准 RFC-4180 CSV 解析器，支持 UTF-8 BOM、CRLF/LF/CR、双引号转义与引号内换行。
 */
export function parseCsvRecords(content: string): {
  records: string[][];
  unclosedQuote: boolean;
} {
  const text = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  const records: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
      if (text[i + 1] === '\n') i++;
    } else if (ch === '\n') {
      row.push(cell);
      records.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    records.push(row);
  }

  // 忽略文件末尾空行
  while (
    records.length > 0 &&
    records[records.length - 1].every((item) => item.trim() === '')
  ) {
    records.pop();
  }

  return { records, unclosedQuote: inQuotes };
}

/**
 * 检测可能触发电子表格公式执行的危险前缀（排除合法国际手机号如 +86 138...）。
 */
export function isFormulaInjectionRisk(cell: string): boolean {
  const trimmed = cell.replace(/^[ ]+/, '');
  if (!trimmed) return false;
  if (/^[\t\r=@]/.test(trimmed)) return true;
  if (/^[+-]/.test(trimmed)) {
    // 合法电话号码前缀如 +86 13800138000 或 +1-415-555-0100 不误报
    if (/^\+\d{1,3}[\s-]?\d[\d\s-]{5,}$/.test(trimmed)) return false;
    return true;
  }
  return false;
}

export function suggestSystemField(header: string): SystemFieldKey | null {
  const normalized = header
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (!normalized) return null;
  for (const def of SYSTEM_FIELD_DEFINITIONS) {
    if (
      def.key === normalized ||
      def.aliases.some((alias) => alias.toLowerCase() === normalized)
    ) {
      return def.key;
    }
  }
  return null;
}

export function buildAutoMapping(columns: CsvColumnInfo[]): FieldMappingState {
  const mapping: FieldMappingState = {};
  const usedCols = new Set<number>();

  for (const col of columns) {
    if (
      col.suggestedField &&
      mapping[col.suggestedField] === undefined &&
      !usedCols.has(col.index)
    ) {
      mapping[col.suggestedField] = col.index;
      usedCols.add(col.index);
    }
  }
  return mapping;
}

async function readFileAsBytes(file: File): Promise<Uint8Array | null> {
  if (typeof file.arrayBuffer === 'function') {
    const buffer = await file.arrayBuffer();
    return new Uint8Array(buffer);
  }
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result));
        } else {
          resolve(null);
        }
      };
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(file);
    });
  }
  return null;
}

export async function readAndParseCsvFile(
  file: File,
): Promise<ParsedCsvDataset> {
  const sizeBytes = file.size;
  const sizeLabel = formatFileSize(sizeBytes);

  let decodedText = '';
  let utf8Valid = true;
  let hasNul = false;

  const bytes = await readFileAsBytes(file);
  if (bytes) {
    hasNul = bytes.includes(0);
    try {
      decodedText = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      utf8Valid = false;
      decodedText = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    }
  } else if (typeof file.text === 'function') {
    decodedText = await file.text();
    hasNul = decodedText.includes('\u0000');
  }

  const { records, unclosedQuote } = parseCsvRecords(decodedText);
  const headerRow = records[0] ?? [];
  const dataRows = records.slice(1);
  const columnCount = headerRow.length;
  const rowCount = dataRows.length;

  const inconsistentRow = dataRows.findIndex(
    (cells) => cells.length !== columnCount,
  );
  const structureConsistent =
    !unclosedQuote && columnCount > 0 && inconsistentRow === -1;

  let formulaRiskCell: { row: number; col: number } | null = null;
  for (let r = 0; r < dataRows.length && !formulaRiskCell; r++) {
    for (let c = 0; c < dataRows[r].length; c++) {
      if (isFormulaInjectionRisk(dataRows[r][c])) {
        formulaRiskCell = { row: r + 1, col: c };
        break;
      }
    }
  }

  const sizeOk = sizeBytes > 0 && sizeBytes <= MAX_CSV_BYTES;
  const rowsOk = rowCount > 0 && rowCount <= MAX_CSV_ROWS;
  const colsOk = columnCount > 0 && columnCount <= MAX_CSV_COLUMNS;
  const encodingOk = utf8Valid && !hasNul;
  const formulaOk = formulaRiskCell === null;

  const checks: FileCheckItem[] = [
    {
      id: 'size',
      label: `文件大小 ${sizeLabel}（≤10 MB）`,
      status: sizeOk ? 'pass' : 'fail',
      detail:
        sizeBytes === 0
          ? '文件为空'
          : !sizeOk
            ? '超出 10 MB 大小限制'
            : undefined,
    },
    {
      id: 'rows',
      label: `数据行数 ${rowCount.toLocaleString('en-US')} 行（≤10,000 行）`,
      status: rowsOk ? 'pass' : 'fail',
      detail:
        rowCount === 0
          ? '未检测到有效数据行'
          : !rowsOk
            ? '超过单次 10,000 行上限，请拆分文件'
            : undefined,
    },
    {
      id: 'columns',
      label: `列数 ${columnCount} 列（≤256 列）`,
      status: colsOk ? 'pass' : 'fail',
      detail: !colsOk ? '列数超出允许范围（1–256 列）' : undefined,
    },
    {
      id: 'encoding',
      label: encodingOk ? '编码 UTF-8' : '编码异常（需 UTF-8）',
      status: encodingOk ? 'pass' : 'fail',
      detail: hasNul
        ? '检测到非法 NUL 字节'
        : !utf8Valid
          ? '请另存为 UTF-8 编码 CSV'
          : undefined,
    },
    {
      id: 'structure',
      label: structureConsistent ? '列结构一致' : '列结构不一致',
      status: structureConsistent ? 'pass' : 'fail',
      detail: unclosedQuote
        ? '检测到未闭合双引号'
        : inconsistentRow >= 0
          ? `第 ${inconsistentRow + 1} 行列数与表头不匹配`
          : undefined,
    },
    {
      id: 'formula',
      label: formulaOk ? '公式注入未检测到风险' : '检测到潜在公式注入字符',
      status: formulaOk ? 'pass' : 'warn',
      detail: formulaRiskCell
        ? `第 ${formulaRiskCell.row} 行 ${indexToColumnLetter(formulaRiskCell.col)} 列包含危险前缀`
        : undefined,
    },
  ];

  const passed = checks.every((item) => item.status !== 'fail');

  const columns: CsvColumnInfo[] = headerRow.map((rawHeader, index) => {
    const header = rawHeader.trim() || `column_${index + 1}`;
    const suggestedField = suggestSystemField(header);
    const firstNonEmpty =
      dataRows.find((r) => (r[index] ?? '').trim().length > 0)?.[index] ?? '';
    return {
      index,
      letter: indexToColumnLetter(index),
      header,
      sampleValue: maskFieldSample(suggestedField, firstNonEmpty),
      suggestedField,
    };
  });

  const validation: FileValidationResult = {
    passed,
    source: 'client',
    headline: passed ? '文件校验通过' : '文件初步校验未通过',
    checks,
  };

  return {
    meta: {
      name: file.name,
      sizeBytes,
      sizeLabel,
      rowCount,
      columnCount,
      encoding: encodingOk ? 'UTF-8' : '非 UTF-8',
      isSampleFixture: false,
      lastModified: file.lastModified,
    },
    columns,
    validation,
    rows: dataRows,
  };
}

const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

export function normalizeAccountStatus(raw: string): {
  value: AccountSummary['status'] | 'unknown';
  label: string;
  valid: boolean;
} {
  const key = raw.trim().toLowerCase();
  if (!key || key === 'normal' || key === 'active' || key === '正常') {
    return { value: 'normal', label: '正常', valid: true };
  }
  if (key === 'pending_verification' || key === 'pending' || key === '待验证') {
    return { value: 'pending_verification', label: '待验证', valid: true };
  }
  if (key === 'restricted' || key === 'risk' || key === '风险') {
    return { value: 'restricted', label: '风险', valid: true };
  }
  if (key === 'login_failed' || key === '登录异常') {
    return { value: 'login_failed', label: '风险', valid: true };
  }
  if (key === 'disabled' || key === '停用') {
    return { value: 'disabled', label: '停用', valid: true };
  }
  if (key === 'archived' || key === '已归档') {
    return { value: 'archived', label: '已归档', valid: true };
  }
  return { value: 'unknown', label: raw.trim(), valid: false };
}

export function normalizeTwoFactor(raw: string): {
  value: AccountSummary['two_factor_status'];
  label: string;
  valid: boolean;
} {
  const key = raw.trim().toLowerCase();
  if (!key || key === 'unknown' || key === '未知') {
    return { value: 'unknown', label: '未知', valid: true };
  }
  if (['true', '1', 'yes', 'enabled', 'on', '已启用'].includes(key)) {
    return { value: 'enabled', label: '已启用', valid: true };
  }
  if (['false', '0', 'no', 'disabled', 'off', '未启用'].includes(key)) {
    return { value: 'disabled', label: '未启用', valid: true };
  }
  return { value: 'unknown', label: raw.trim(), valid: false };
}

export function evaluateParsedRows({
  rawRows,
  mapping,
  strategy,
  conflictResolution,
  skipEmptyFields = false,
  existingEmails = new Set<string>(),
}: {
  rawRows: string[][];
  mapping: FieldMappingState;
  strategy: ImportStrategyOption;
  conflictResolution: ConflictResolutionOption;
  skipEmptyFields?: boolean;
  existingEmails?: Set<string>;
}): {
  rows: PreviewRow[];
  counts: ValidationCounts;
  summary: CommitSummaryCounts;
} {
  const gmailCol = mapping.gmail_email;
  const passwordCol = mapping.password;
  const recoveryCol = mapping.recovery_email;
  const phoneCol = mapping.phone;
  const statusCol = mapping.status;
  const twoFactorCol = mapping.two_factor_status;

  const seenEmails = new Set<string>();
  const rows: PreviewRow[] = [];
  const counts: ValidationCounts = {
    all: rawRows.length,
    valid: 0,
    warning: 0,
    error: 0,
  };
  const summary: CommitSummaryCounts = {
    total: rawRows.length,
    create: 0,
    update: 0,
    skip: 0,
    error: 0,
  };

  for (let i = 0; i < rawRows.length; i++) {
    const cells = rawRows[i];
    const rowNumber = i + 1;
    const issues: RowFieldIssue[] = [];

    const gmailRaw =
      gmailCol !== undefined ? (cells[gmailCol] ?? '').trim() : '';
    const passwordRaw =
      passwordCol !== undefined ? (cells[passwordCol] ?? '').trim() : '';
    const recoveryRaw =
      recoveryCol !== undefined ? (cells[recoveryCol] ?? '').trim() : '';
    const phoneRaw =
      phoneCol !== undefined ? (cells[phoneCol] ?? '').trim() : '';
    const statusRaw =
      statusCol !== undefined ? (cells[statusCol] ?? '').trim() : '';
    const twoFactorRaw =
      twoFactorCol !== undefined ? (cells[twoFactorCol] ?? '').trim() : '';

    if (gmailCol === undefined) {
      issues.push({
        field: 'gmail_email',
        fieldLabel: 'Gmail 地址',
        severity: 'error',
        reason: '未映射必填字段“Gmail 地址”',
        suggestion: '请在字段映射中选择对应的 CSV 列',
      });
    } else if (!gmailRaw || !EMAIL_REGEX.test(gmailRaw)) {
      issues.push({
        field: 'gmail_email',
        fieldLabel: 'Gmail 地址',
        columnLetter: indexToColumnLetter(gmailCol),
        severity: 'error',
        reason: gmailRaw ? 'Gmail 地址格式不正确' : 'Gmail 地址不能为空',
        suggestion: '请检查邮箱前缀与域名格式，例如 example@gmail.com',
      });
    }

    const normalizedEmail = gmailRaw.toLowerCase();
    const isFileDup = normalizedEmail !== '' && seenEmails.has(normalizedEmail);
    const isExisting =
      normalizedEmail !== '' && existingEmails.has(normalizedEmail);
    if (normalizedEmail) seenEmails.add(normalizedEmail);

    if (passwordCol === undefined) {
      issues.push({
        field: 'password',
        fieldLabel: '登录密码',
        severity: 'error',
        reason: '未映射必填字段“登录密码”',
        suggestion: '请在字段映射中选择对应的 CSV 列',
      });
    } else if (!passwordRaw && !isExisting) {
      issues.push({
        field: 'password',
        fieldLabel: '登录密码',
        columnLetter: indexToColumnLetter(passwordCol),
        severity: 'error',
        reason: '新增账号缺少登录密码',
        suggestion: '请补充密码值（导入后将自动 AES-256-GCM 加密保存）',
      });
    }

    if (recoveryRaw && !EMAIL_REGEX.test(recoveryRaw)) {
      issues.push({
        field: 'recovery_email',
        fieldLabel: '辅助邮箱',
        columnLetter:
          recoveryCol !== undefined
            ? indexToColumnLetter(recoveryCol)
            : undefined,
        severity: 'error',
        reason: '辅助邮箱格式不正确',
        suggestion: '请填写有效的外部恢复邮箱地址',
      });
    } else if (!recoveryRaw && !(isExisting && skipEmptyFields)) {
      issues.push({
        field: 'recovery_email',
        fieldLabel: '辅助邮箱',
        columnLetter:
          recoveryCol !== undefined
            ? indexToColumnLetter(recoveryCol)
            : undefined,
        severity: 'warning',
        reason: '缺少辅助邮箱',
        suggestion: '建议补充辅助邮箱以提升账号找回安全性',
      });
    }

    const parsedStatus = normalizeAccountStatus(statusRaw);
    if (!parsedStatus.valid) {
      issues.push({
        field: 'status',
        fieldLabel: '账号状态',
        columnLetter:
          statusCol !== undefined ? indexToColumnLetter(statusCol) : undefined,
        severity: 'error',
        reason: `无法识别的账号状态值`,
        suggestion:
          '支持 normal、pending_verification、restricted、disabled、archived',
      });
    }

    const parsed2fa = normalizeTwoFactor(twoFactorRaw);
    if (!parsed2fa.valid) {
      issues.push({
        field: 'two_factor_status',
        fieldLabel: '二步验证',
        columnLetter:
          twoFactorCol !== undefined
            ? indexToColumnLetter(twoFactorCol)
            : undefined,
        severity: 'error',
        reason: '二步验证字段值格式无效',
        suggestion: '支持 true/false、enabled/disabled/unknown',
      });
    } else if (parsed2fa.value === 'disabled') {
      issues.push({
        field: 'two_factor_status',
        fieldLabel: '二步验证',
        columnLetter:
          twoFactorCol !== undefined
            ? indexToColumnLetter(twoFactorCol)
            : undefined,
        severity: 'warning',
        reason: '二步验证未启用',
        suggestion: '导入后建议尽快为该账号启用 TOTP 二步验证',
      });
    }

    // 重复行按策略判定
    if (isFileDup || isExisting) {
      if (strategy === 'strict_new' || conflictResolution === 'reject_batch') {
        issues.push({
          field: 'gmail_email',
          fieldLabel: 'Gmail 地址',
          columnLetter:
            gmailCol !== undefined ? indexToColumnLetter(gmailCol) : undefined,
          severity: 'error',
          reason: isFileDup
            ? 'CSV 文件内存在重复 Gmail 地址'
            : '系统中已存在该 Gmail 地址',
          suggestion: '切换冲突处理策略为覆盖更新或跳过冲突，或移除重复行',
        });
      }
    }

    const hasError = issues.some((issue) => issue.severity === 'error');
    const hasWarning = issues.some((issue) => issue.severity === 'warning');

    let action: PreviewRow['action'] = 'create';
    if (hasError) {
      action = 'error';
      summary.error++;
    } else if (isFileDup) {
      action = 'skip';
      summary.skip++;
    } else if (isExisting) {
      if (
        strategy === 'insert_only' ||
        conflictResolution === 'keep_existing'
      ) {
        action = 'skip';
        summary.skip++;
      } else {
        action = 'update';
        summary.update++;
      }
    } else {
      action = 'create';
      summary.create++;
    }

    const status: PreviewRow['status'] = hasError
      ? 'error'
      : hasWarning
        ? 'warning'
        : 'valid';
    counts[status]++;

    const primaryIssue =
      issues.find((item) => item.severity === 'error') ?? issues[0];
    const validationMessage = primaryIssue
      ? primaryIssue.reason
      : action === 'update'
        ? '校验通过（覆盖更新）'
        : action === 'skip'
          ? '重复记录（将跳过）'
          : '校验通过';

    rows.push({
      rowNumber,
      status,
      action,
      gmailEmail: gmailRaw || '—',
      recoveryEmail: recoveryRaw || '—',
      phoneMasked: maskPhone(phoneRaw),
      accountStatus: parsedStatus.value,
      accountStatusLabel: parsedStatus.label,
      twoFactorStatus: parsed2fa.value,
      twoFactorLabel: parsed2fa.label,
      validationMessage,
      issues,
    });
  }

  return { rows, counts, summary };
}

/**
 * 安全的 CSV 单元格转义，并对潜在公式前缀加单引号保护。
 */
export function sanitizeCsvCell(raw: string): string {
  const value = raw ?? '';
  const guarded = isFormulaInjectionRisk(value) ? `'${value}` : value;
  if (/[",\r\n]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function buildPreviewExportCsv(rows: PreviewRow[]): string {
  const header = [
    '行号',
    '导入状态',
    '执行动作',
    'Gmail 地址',
    '辅助邮箱',
    '手机号（已脱敏）',
    '账号状态',
    '二步验证',
    '校验信息',
  ];
  const statusLabels: Record<PreviewRow['status'], string> = {
    valid: '有效',
    warning: '警告',
    error: '错误',
  };
  const actionLabels: Record<PreviewRow['action'], string> = {
    create: '新增',
    update: '更新',
    skip: '跳过',
    error: '错误',
  };

  const lines = [
    header.map(sanitizeCsvCell).join(','),
    ...rows.map((row) =>
      [
        String(row.rowNumber),
        statusLabels[row.status],
        actionLabels[row.action],
        row.gmailEmail,
        row.recoveryEmail,
        row.phoneMasked,
        row.accountStatusLabel,
        row.twoFactorLabel,
        row.validationMessage,
      ]
        .map(sanitizeCsvCell)
        .join(','),
    ),
  ];

  return `\uFEFF${lines.join('\r\n')}`;
}
