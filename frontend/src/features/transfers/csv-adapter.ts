import {
  accountsBatchStatus,
  accountsBatchTags,
  accountsList,
  auditsList,
  csvCommit,
  csvExport,
  csvPreview,
  dashboardSummary,
  tagsList,
  type AccountQuery,
  type AccountSummary,
  type CsvCommit,
  type CsvIssue,
  type CsvPreview,
  type ErrorResponse,
  type SessionResponse,
  type TagResponse,
} from '@/api/generated';
import {
  evaluateParsedRows,
  indexToColumnLetter,
  sanitizeCsvCell,
} from './csv-parser';
import {
  createMockBatchAccounts,
  DEFAULT_SIDEBAR_COUNTS,
  MOCK_IMPORT_HISTORY,
} from './mock-fixtures';
import {
  SYSTEM_FIELD_MAP,
  toApiStrategy,
  type BatchAccountItem,
  type CommitOutcome,
  type CommitSummaryCounts,
  type ConflictResolutionOption,
  type FieldMappingState,
  type FileValidationResult,
  type ImportHistoryRecord,
  type ImportStrategyOption,
  type ParsedCsvDataset,
  type PreviewRow,
  type RowFieldIssue,
  type SidebarCounts,
  type SystemFieldKey,
  type ValidationCounts,
} from './types';

export type ServerPreviewPayload = {
  receiptId: string | null;
  expiresAt: string | null;
  mapping: FieldMappingState;
  rows: PreviewRow[];
  counts: ValidationCounts;
  summary: CommitSummaryCounts;
  validation: FileValidationResult;
  serverIssues: CsvIssue[];
};

export type MockCommitBehavior = 'success' | 'conflict' | 'network_unknown';

export type CsvTransferAdapter = {
  mode: 'live' | 'mock';
  previewCsv: (args: {
    file: File;
    parsed: ParsedCsvDataset;
    mapping: FieldMappingState;
    useCustomMapping: boolean;
    strategy: ImportStrategyOption;
    conflictResolution: ConflictResolutionOption;
  }) => Promise<ServerPreviewPayload>;
  commitCsv: (args: {
    file: File | null;
    receiptId: string;
    summary: CommitSummaryCounts;
  }) => Promise<CommitOutcome>;
  exportAccountsCsv: (
    scope: 'all' | 'filtered',
    filters?: AccountQuery,
  ) => Promise<{
    blob: Blob;
    filename: string;
  }>;
  loadSidebarCounts: () => Promise<SidebarCounts>;
  loadImportHistory: () => Promise<ImportHistoryRecord[]>;
  loadBatchWorkspace: () => Promise<{
    accounts: BatchAccountItem[];
    tags: TagResponse[];
  }>;
  applyBatchStatus: (
    accounts: { id: string; rowVersion: number }[],
    status: AccountSummary['status'],
  ) => Promise<{ updatedCount: number }>;
  applyBatchTags: (
    accounts: { id: string; rowVersion: number }[],
    tagIds: string[],
  ) => Promise<{ updatedCount: number }>;
};

const KNOWN_MOCK_EXISTING_EMAILS = new Set([
  'dev+001@gmail.com',
  'ops.monitor@gmail.com',
  'example.existing@gmail.com',
]);

function mergeServerPreviewWithClientRows(
  server: CsvPreview,
  parsed: ParsedCsvDataset,
  mapping: FieldMappingState,
  strategy: ImportStrategyOption,
  conflictResolution: ConflictResolutionOption,
): ServerPreviewPayload {
  const clientEval = evaluateParsedRows({
    rawRows: parsed.rows,
    mapping,
    strategy,
    conflictResolution,
  });

  // 服务端按逻辑行号计数：表头为第 1 行，数据行从第 2 行开始
  const serverRowAction = new Map<
    number,
    CsvPreview['rows'][number]['action']
  >();
  for (const row of server.rows) {
    serverRowAction.set(row.row - 1, row.action);
  }

  const serverErrorsByRow = new Map<number, CsvIssue[]>();
  const fileLevelErrors: CsvIssue[] = [];
  for (const issue of server.errors) {
    if (issue.row <= 1 || issue.field === 'file') {
      fileLevelErrors.push(issue);
    } else {
      const dataRowNum = issue.row - 1;
      const list = serverErrorsByRow.get(dataRowNum) ?? [];
      list.push(issue);
      serverErrorsByRow.set(dataRowNum, list);
    }
  }

  const mergedCounts: ValidationCounts = {
    all: clientEval.rows.length,
    valid: 0,
    warning: 0,
    error: 0,
  };
  const mergedSummary: CommitSummaryCounts = {
    total: server.rows.length || clientEval.rows.length,
    create: 0,
    update: 0,
    skip: 0,
    error: 0,
  };

  const mergedRows: PreviewRow[] = clientEval.rows.map((row) => {
    const serverAction = serverRowAction.get(row.rowNumber) ?? row.action;
    const rowServerIssues = serverErrorsByRow.get(row.rowNumber) ?? [];

    const convertedServerIssues: RowFieldIssue[] = rowServerIssues.map(
      (issue) => {
        const key = issue.field as SystemFieldKey;
        const fieldDef = SYSTEM_FIELD_MAP[key];
        const colIdx = fieldDef ? mapping[key] : undefined;
        return {
          field: issue.field,
          fieldLabel: fieldDef?.label ?? issue.field,
          columnLetter:
            colIdx !== undefined ? indexToColumnLetter(colIdx) : undefined,
          severity: 'error',
          reason: issue.reason,
        };
      },
    );

    const warningsOnly = row.issues.filter((i) => i.severity === 'warning');
    const combinedIssues =
      convertedServerIssues.length > 0
        ? [...convertedServerIssues, ...warningsOnly]
        : serverAction === 'error'
          ? row.issues
          : warningsOnly;

    const hasError =
      serverAction === 'error' ||
      combinedIssues.some((i) => i.severity === 'error');
    const hasWarning = combinedIssues.some((i) => i.severity === 'warning');

    const status: PreviewRow['status'] = hasError
      ? 'error'
      : hasWarning
        ? 'warning'
        : 'valid';
    mergedCounts[status]++;

    if (hasError) mergedSummary.error++;
    else if (serverAction === 'update') mergedSummary.update++;
    else if (serverAction === 'skip') mergedSummary.skip++;
    else mergedSummary.create++;

    const primary =
      combinedIssues.find((i) => i.severity === 'error') ?? combinedIssues[0];
    return {
      ...row,
      status,
      action: hasError ? 'error' : serverAction,
      issues: combinedIssues,
      validationMessage: primary
        ? primary.reason
        : serverAction === 'update'
          ? '校验通过（更新）'
          : serverAction === 'skip'
            ? '重复记录（跳过）'
            : '校验通过',
    };
  });

  // 文件级服务端错误（服务端结果作为最终依据）
  const nextChecks = [...parsed.validation.checks];
  if (fileLevelErrors.length > 0) {
    nextChecks.push(
      ...fileLevelErrors.map((err, idx) => ({
        id: `server-file-${idx}`,
        label: `服务端校验：${err.reason}`,
        status: 'fail' as const,
      })),
    );
  }

  const serverMapping: FieldMappingState = {};
  for (const [k, v] of Object.entries(server.mapping)) {
    if (k in SYSTEM_FIELD_MAP && typeof v === 'number') {
      serverMapping[k as SystemFieldKey] = v;
    }
  }

  const passed =
    fileLevelErrors.length === 0 &&
    nextChecks.every((item) => item.status !== 'fail');

  return {
    receiptId: server.receipt_id,
    expiresAt: server.expires_at,
    mapping: Object.keys(serverMapping).length > 0 ? serverMapping : mapping,
    rows: mergedRows,
    counts: mergedCounts,
    summary: mergedSummary,
    validation: {
      passed,
      source: 'server',
      headline: passed ? '文件校验通过' : '服务端文件校验未通过',
      checks: nextChecks,
    },
    serverIssues: server.errors,
  };
}

export function createLiveCsvAdapter({
  session,
  onFailure,
}: {
  session: SessionResponse;
  onFailure?: (error: unknown) => void;
}): CsvTransferAdapter {
  const csrfHeaders = () => ({ 'X-CSRF-Token': session.csrf_token });

  return {
    mode: 'live',
    async previewCsv({
      file,
      parsed,
      mapping,
      useCustomMapping,
      strategy,
      conflictResolution,
    }) {
      const apiStrategy = toApiStrategy(strategy, conflictResolution);
      const numericMapping: Record<string, number> = {};
      for (const [key, value] of Object.entries(mapping)) {
        if (typeof value === 'number') numericMapping[key] = value;
      }

      const payload =
        typeof file.arrayBuffer === 'function'
          ? await file.arrayBuffer()
          : file;

      const result = await csvPreview({
        body: payload as Blob | File,
        query: {
          options: JSON.stringify({
            strategy: apiStrategy,
            ...(useCustomMapping ? { mapping: numericMapping } : {}),
          }),
        },
        headers: csrfHeaders(),
        throwOnError: true,
      });

      const resolvedMapping: FieldMappingState = useCustomMapping
        ? mapping
        : (result.data.mapping as FieldMappingState);

      return mergeServerPreviewWithClientRows(
        result.data,
        parsed,
        resolvedMapping,
        strategy,
        conflictResolution,
      );
    },

    async commitCsv({ file, receiptId }) {
      if (!file) {
        return {
          kind: 'conflict',
          message: '原文件已不在内存中，请重新选择文件并预览校验。',
          issues: [],
        };
      }
      try {
        const payload =
          typeof file.arrayBuffer === 'function'
            ? await file.arrayBuffer()
            : file;
        const result = await csvCommit({
          body: payload as Blob | File,
          query: { receipt_id: receiptId },
          headers: csrfHeaders(),
        });

        if (result.data?.status === 'committed') {
          return {
            kind: 'committed',
            batchId: receiptId.slice(0, 12),
            committedAt: new Date().toISOString(),
            created: result.data.created ?? 0,
            updated: result.data.updated ?? 0,
            skipped: result.data.skipped ?? 0,
          };
        }

        const errBody = result.error as
          Partial<CsvCommit> | Partial<ErrorResponse> | undefined;

        if (errBody && 'status' in errBody && errBody.status === 'rejected') {
          return {
            kind: 'conflict',
            message:
              '服务端检测到数据并发冲突或校验失效，整批事务已回滚，请重新预览后再确认导入。',
            issues: errBody.errors ?? [],
          };
        }

        if (
          errBody &&
          'error' in errBody &&
          errBody.error &&
          !['INTERNAL_ERROR', 'DECRYPTION_FAILED'].includes(errBody.error.code)
        ) {
          onFailure?.(errBody);
          return {
            kind: 'conflict',
            message: `${errBody.error.message}，请重新预览后再试。`,
            issues: [],
          };
        }

        onFailure?.(errBody);
        return {
          kind: 'unknown',
          message: '结果未知，请刷新确认',
        };
      } catch (error) {
        onFailure?.(error);
        return {
          kind: 'unknown',
          message: '结果未知，请刷新确认',
        };
      }
    },

    async exportAccountsCsv(scope, filters) {
      const result = await csvExport({
        body:
          scope === 'all'
            ? { scope: 'all' }
            : { scope: 'filtered', filters: filters ?? ({} as AccountQuery) },
        headers: csrfHeaders(),
        parseAs: 'blob',
        throwOnError: true,
      });
      const filename =
        /filename="([^"]+)"/.exec(
          result.response.headers.get('Content-Disposition') || '',
        )?.[1] || 'gmail-accounts.csv';
      return { blob: result.data, filename };
    },

    async loadSidebarCounts() {
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const [summaryRes, tagsRes, archivedRes, trashRes] = await Promise.all([
          dashboardSummary({ query: { timezone: tz }, throwOnError: true }),
          tagsList({ throwOnError: true }),
          accountsList({
            query: { archived: true, page: 1, page_size: 1 },
            throwOnError: true,
          }),
          accountsList({
            query: { deleted: true, page: 1, page_size: 1 },
            throwOnError: true,
          }),
        ]);
        return {
          accounts: summaryRes.data.total,
          tags: tagsRes.data.length,
          archived: archivedRes.data.total,
          trash: trashRes.data.total,
        };
      } catch {
        return { accounts: 0, tags: 0, archived: 0, trash: 0 };
      }
    },

    async loadImportHistory() {
      try {
        const res = await auditsList({
          query: { page: 1, page_size: 20 },
          throwOnError: true,
        });
        return res.data.items
          .filter(
            (item) =>
              item.event_type.includes('import') ||
              item.event_type.includes('csv'),
          )
          .map((item) => ({
            id: item.id,
            fileName: item.operation ?? 'CSV 批量导入',
            executedAt: item.created_at,
            strategyLabel: item.event_type,
            created: 0,
            updated: 0,
            skipped: 0,
            status: 'committed' as const,
            operator: 'admin',
          }));
      } catch {
        return [];
      }
    },

    async loadBatchWorkspace() {
      const [accountsRes, tagsRes] = await Promise.all([
        accountsList({ query: { page: 1, page_size: 30 }, throwOnError: true }),
        tagsList({ throwOnError: true }),
      ]);
      return {
        accounts: accountsRes.data.items.map((item) => ({
          id: item.id,
          accountNo: item.account_no,
          gmailEmail: item.gmail_email,
          recoveryEmail: item.recovery_email,
          status: item.status,
          twoFactorStatus: item.two_factor_status,
          tags: item.tags.map((t) => t.name),
          rowVersion: item.row_version,
          updatedAt: item.updated_at,
        })),
        tags: tagsRes.data,
      };
    },

    async applyBatchStatus(accounts, status) {
      const res = await accountsBatchStatus({
        body: {
          accounts: accounts.map((a) => ({
            id: a.id,
            row_version: a.rowVersion,
          })),
          status,
        },
        headers: csrfHeaders(),
        throwOnError: true,
      });
      return { updatedCount: res.data.updated_ids.length };
    },

    async applyBatchTags(accounts, tagIds) {
      const res = await accountsBatchTags({
        body: {
          accounts: accounts.map((a) => ({
            id: a.id,
            row_version: a.rowVersion,
          })),
          tag_ids: tagIds,
        },
        headers: csrfHeaders(),
        throwOnError: true,
      });
      return { updatedCount: res.data.updated_ids.length };
    },
  };
}

export function createMockCsvAdapter(options?: {
  commitBehavior?: MockCommitBehavior;
  commitDelayMs?: number;
}): CsvTransferAdapter {
  const delayMs = options?.commitDelayMs ?? 120;
  const historyStore: ImportHistoryRecord[] = [...MOCK_IMPORT_HISTORY];
  const mockTags: TagResponse[] = [
    { id: 'tag-dev', name: '开发环境', created_at: '2025-01-01T00:00:00Z' },
    { id: 'tag-long', name: '长期保留', created_at: '2025-01-01T00:00:00Z' },
    { id: 'tag-qa', name: '测试池', created_at: '2025-01-01T00:00:00Z' },
    { id: 'tag-ops', name: '运维监控', created_at: '2025-01-01T00:00:00Z' },
    { id: 'tag-review', name: '需核查', created_at: '2025-01-01T00:00:00Z' },
  ];
  let mockAccounts = createMockBatchAccounts();

  return {
    mode: 'mock',
    async previewCsv({ parsed, mapping, strategy, conflictResolution }) {
      const evaluated = evaluateParsedRows({
        rawRows: parsed.rows,
        mapping,
        strategy,
        conflictResolution,
        existingEmails: KNOWN_MOCK_EXISTING_EMAILS,
      });

      const hasErrors =
        evaluated.summary.error > 0 || !parsed.validation.passed;
      return {
        receiptId: hasErrors ? null : `rcpt_${Date.now().toString(36)}`,
        expiresAt: hasErrors
          ? null
          : new Date(Date.now() + 10 * 60_000).toISOString(),
        mapping,
        rows: evaluated.rows,
        counts: evaluated.counts,
        summary: evaluated.summary,
        validation: {
          ...parsed.validation,
          source: 'server',
          headline: parsed.validation.passed
            ? '文件校验通过'
            : '文件校验未通过',
        },
        serverIssues: evaluated.rows
          .filter((r) => r.status === 'error')
          .flatMap((r) =>
            r.issues
              .filter((i) => i.severity === 'error')
              .map((i) => ({
                row: r.rowNumber + 1,
                field: i.field as CsvIssue['field'],
                reason: i.reason,
              })),
          ),
      };
    },

    async commitCsv({ receiptId, summary }) {
      if (delayMs > 0) {
        await new Promise((resolve) => window.setTimeout(resolve, delayMs));
      }

      const behavior = options?.commitBehavior ?? 'success';
      if (behavior === 'network_unknown') {
        return {
          kind: 'unknown',
          message: '结果未知，请刷新确认',
        };
      }
      if (behavior === 'conflict') {
        return {
          kind: 'conflict',
          message:
            '服务端返回并发版本冲突（row_version 已变化），整批未提交，请重新预览确认。',
          issues: [
            {
              row: 5,
              field: 'row_version',
              reason: '预览后账号 dev+001@gmail.com 已被其他操作更新',
            },
          ],
        };
      }

      const committedAt = new Date().toISOString();
      const batchId = `TX-${receiptId.slice(-6).toUpperCase()}`;
      historyStore.unshift({
        id: batchId,
        fileName: '最近上传 CSV 批次',
        executedAt: committedAt.replace('T', ' ').slice(0, 19),
        strategyLabel: '原子事务提交',
        created: summary.create,
        updated: summary.update,
        skipped: summary.skip,
        status: 'committed',
        operator: 'admin',
      });

      return {
        kind: 'committed',
        batchId,
        committedAt,
        created: summary.create,
        updated: summary.update,
        skipped: summary.skip,
      };
    },

    async exportAccountsCsv() {
      const header = [
        '账号编号',
        'Gmail 地址',
        '辅助邮箱',
        '状态',
        '二步验证',
        '标签',
      ];
      const lines = [
        header.map(sanitizeCsvCell).join(','),
        ...mockAccounts.map((acc) =>
          [
            acc.accountNo,
            acc.gmailEmail,
            acc.recoveryEmail,
            acc.status,
            acc.twoFactorStatus,
            acc.tags.join('|'),
          ]
            .map(sanitizeCsvCell)
            .join(','),
        ),
      ];
      const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], {
        type: 'text/csv;charset=utf-8',
      });
      return {
        blob,
        filename: `gmail-accounts-export-${new Date().toISOString().slice(0, 10)}.csv`,
      };
    },

    async loadSidebarCounts() {
      return DEFAULT_SIDEBAR_COUNTS;
    },

    async loadImportHistory() {
      return [...historyStore];
    },

    async loadBatchWorkspace() {
      return {
        accounts: [...mockAccounts],
        tags: [...mockTags],
      };
    },

    async applyBatchStatus(accounts, status) {
      const ids = new Set(accounts.map((a) => a.id));
      mockAccounts = mockAccounts.map((item) =>
        ids.has(item.id)
          ? { ...item, status, rowVersion: item.rowVersion + 1 }
          : item,
      );
      return { updatedCount: ids.size };
    },

    async applyBatchTags(accounts, tagIds) {
      const ids = new Set(accounts.map((a) => a.id));
      const tagNames = mockTags
        .filter((t) => tagIds.includes(t.id))
        .map((t) => t.name);
      mockAccounts = mockAccounts.map((item) =>
        ids.has(item.id)
          ? { ...item, tags: tagNames, rowVersion: item.rowVersion + 1 }
          : item,
      );
      return { updatedCount: ids.size };
    },
  };
}
