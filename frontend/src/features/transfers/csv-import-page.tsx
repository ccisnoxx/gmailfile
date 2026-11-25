import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { QueryClientContext } from '@tanstack/react-query';
import {
  ArrowRight,
  Download,
  FileSpreadsheet,
  History,
  Layers,
  Upload,
} from 'lucide-react';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import type {
  AccountSummary,
  SessionResponse,
  TagResponse,
} from '@/api/generated';
import { Providers } from '@/app/providers';
import {
  DEFAULT_NAV_ALPHA,
  GlassPanel,
  LoadingState,
  persistNavAlpha,
  readDisplaySettings,
  readStoredNavAlpha,
  subscribeDisplaySettings,
  subscribeNavAlpha,
  type DisplaySettingsState,
} from '@/components/macos';
import { cn } from '@/lib/utils';
import { AtomicCommitPanel } from './atomic-commit-panel';
import { BatchOperationsPanel } from './batch-operations-panel';
import {
  createLiveCsvAdapter,
  createMockCsvAdapter,
  type MockCommitBehavior,
} from './csv-adapter';
import { CsvDropzone } from './csv-dropzone';
import {
  buildAutoMapping,
  buildPreviewExportCsv,
  evaluateParsedRows,
  readAndParseCsvFile,
} from './csv-parser';
import { CsvPreviewTable } from './csv-preview-table';
import {
  CsvWorkspaceShell,
  type TransferSidebarKey,
  type TransferTopNavKey,
} from './csv-workspace-shell';
import { FieldMappingTable } from './field-mapping-table';
import { FileValidationCard } from './file-validation-card';
import { ImportResultDialog } from './import-result-dialog';
import { ImportStepper } from './import-stepper';
import { ImportStrategyControls } from './import-strategy-controls';
import {
  DEFAULT_SAMPLE_COLUMNS,
  DEFAULT_SAMPLE_FILE_META,
  DEFAULT_SAMPLE_MAPPING,
  DEFAULT_SAMPLE_VALIDATION,
  DEFAULT_SIDEBAR_COUNTS,
  getSampleCommitSummary,
  getSampleExportPreviewRows,
  getSamplePreviewPage,
  getSampleValidationCounts,
  MOCK_IMPORT_HISTORY,
} from './mock-fixtures';
import { ExportDataDialog, ImportHistoryDialog } from './transfer-dialogs';
import {
  SYSTEM_FIELD_MAP,
  type BatchAccountItem,
  type CommitOutcome,
  type CommitSummaryCounts,
  type ConflictResolutionOption,
  type CsvColumnInfo,
  type FieldMappingState,
  type FileValidationResult,
  type ImportHistoryRecord,
  type ImportStep,
  type ImportStrategyOption,
  type ParsedCsvDataset,
  type PreviewFilterStatus,
  type PreviewRow,
  type SidebarCounts,
  type SystemFieldKey,
  type TransferSubTab,
  type UploadedFileMeta,
  type ValidationCounts,
} from './types';
import { UploadedFileCard } from './uploaded-file-card';
import { ValidationSummary } from './validation-summary';

export type CsvImportPageProps = {
  mode?: 'live' | 'mock';
  initialSubTab?: TransferSubTab;
  session?: SessionResponse;
  onFailure?: (error: unknown) => void;
  onLogout?: () => void;
  onNavigate?: (path: string) => void;
  /** 仅用于测试或演示模拟提交行为 */
  mockCommitBehavior?: MockCommitBehavior;
  mockCommitDelayMs?: number;
};

const EMPTY_COUNTS: ValidationCounts = {
  all: 0,
  valid: 0,
  warning: 0,
  error: 0,
};
const EMPTY_SUMMARY: CommitSummaryCounts = {
  total: 0,
  create: 0,
  update: 0,
  skip: 0,
  error: 0,
};

function triggerBlobDownload(blob: Blob, filename: string) {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CsvImportPage(props: CsvImportPageProps) {
  const existingClient = useContext(QueryClientContext);
  const inRouter = useInRouterContext();
  const body = inRouter ? (
    <RoutedCsvImportPage {...props} />
  ) : (
    <CsvImportPageBody {...props} />
  );
  if (!existingClient) {
    return <Providers>{body}</Providers>;
  }
  return body;
}

export function CsvImportPreviewPage(
  props: Omit<CsvImportPageProps, 'mode' | 'session'>,
) {
  return <CsvImportPage {...props} mode="mock" />;
}

function RoutedCsvImportPage(props: CsvImportPageProps) {
  const navigate = useNavigate();
  const handleNavigate = useCallback(
    (path: string) => {
      if (props.onNavigate) {
        props.onNavigate(path);
        return;
      }
      void navigate(path);
    },
    [navigate, props.onNavigate],
  );
  return <CsvImportPageBody {...props} onNavigate={handleNavigate} />;
}

function CsvImportPageBody({
  mode = 'mock',
  initialSubTab = 'import',
  session,
  onFailure,
  onLogout,
  onNavigate,
  mockCommitBehavior,
  mockCommitDelayMs,
}: CsvImportPageProps) {
  const isMock = mode === 'mock' || !session;

  // 共享界面透明度（默认 60%，写入 localStorage 与其他页面同步）
  const [navAlpha, setNavAlpha] = useState<number>(() =>
    readStoredNavAlpha(DEFAULT_NAV_ALPHA),
  );
  const [displaySettings, setDisplaySettings] = useState<DisplaySettingsState>(
    () => readDisplaySettings(),
  );

  useEffect(() => {
    const unsubAlpha = subscribeNavAlpha(setNavAlpha, DEFAULT_NAV_ALPHA);
    const unsubDisplay = subscribeDisplaySettings(setDisplaySettings);
    return () => {
      unsubAlpha();
      unsubDisplay();
    };
  }, []);

  const handleNavAlphaChange = useCallback((next: number) => {
    setNavAlpha(next);
    persistNavAlpha(next);
  }, []);

  const adapter = useMemo(
    () =>
      isMock
        ? createMockCsvAdapter({
            commitBehavior: mockCommitBehavior,
            commitDelayMs: mockCommitDelayMs,
          })
        : createLiveCsvAdapter({ session, onFailure }),
    [isMock, mockCommitBehavior, mockCommitDelayMs, onFailure, session],
  );

  // 顶部与子标签、全局搜索、侧边栏统计
  const [subTab, setSubTab] = useState<TransferSubTab>(initialSubTab);
  const [globalSearch, setGlobalSearch] = useState('');
  const [sidebarCounts, setSidebarCounts] = useState<SidebarCounts>(
    DEFAULT_SIDEBAR_COUNTS,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [historyRecords, setHistoryRecords] = useState<ImportHistoryRecord[]>(
    () => (isMock ? [...MOCK_IMPORT_HISTORY] : []),
  );
  const [toastMessage, setToastMessage] = useState('');

  // 批量操作工作区状态
  const [batchAccounts, setBatchAccounts] = useState<BatchAccountItem[]>([]);
  const [batchTags, setBatchTags] = useState<TagResponse[]>([]);
  const [batchBusy, setBatchBusy] = useState(false);

  // 四阶段 CSV 导入状态：mock 模式默认预载 gmail_accounts_20250115.csv 且处于第 2 步
  const [currentStep, setCurrentStep] = useState<ImportStep>(() =>
    isMock ? 2 : 1,
  );
  const [completedSteps, setCompletedSteps] = useState<ImportStep[]>(() =>
    isMock ? [1] : [],
  );

  const [fileMeta, setFileMeta] = useState<UploadedFileMeta | null>(() =>
    isMock ? DEFAULT_SAMPLE_FILE_META : null,
  );
  const [columns, setColumns] = useState<readonly CsvColumnInfo[]>(() =>
    isMock ? DEFAULT_SAMPLE_COLUMNS : [],
  );
  const [validation, setValidation] = useState<FileValidationResult | null>(
    () => (isMock ? DEFAULT_SAMPLE_VALIDATION : null),
  );
  const [mapping, setMapping] = useState<FieldMappingState>(() =>
    isMock ? { ...DEFAULT_SAMPLE_MAPPING } : {},
  );
  const [mappingWarning, setMappingWarning] = useState('');
  const [clientNotice, setClientNotice] = useState('');

  const [strategy, setStrategy] = useState<ImportStrategyOption>('upsert');
  const [conflictResolution, setConflictResolution] =
    useState<ConflictResolutionOption>('csv_overwrite');
  const [skipEmptyFields, setSkipEmptyFields] = useState(true);

  // 仅保存于内存中的真实 File 与解析结果（绝不写入 localStorage）
  const rawFileRef = useRef<File | null>(null);
  const [parsedDataset, setParsedDataset] = useState<ParsedCsvDataset | null>(
    null,
  );
  const [uploadedPreviewRows, setUploadedPreviewRows] = useState<PreviewRow[]>(
    [],
  );
  const [uploadedCounts, setUploadedCounts] =
    useState<ValidationCounts>(EMPTY_COUNTS);
  const [uploadedSummary, setUploadedSummary] =
    useState<CommitSummaryCounts>(EMPTY_SUMMARY);
  const [receiptId, setReceiptId] = useState<string | null>(() =>
    isMock ? 'rcpt_sample_prototype' : null,
  );
  const [needsRepreview, setNeedsRepreview] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);

  // 数据预览筛选、分页、勾选
  const [statusFilter, setStatusFilter] = useState<PreviewFilterStatus>('all');
  const [anomaliesOnly, setAnomaliesOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(
    () => new Set(),
  );

  // 确认提交与结果弹窗
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const generationRef = useRef(0);
  const [outcome, setOutcome] = useState<CommitOutcome | null>(null);
  const [resultDialogOpen, setResultDialogOpen] = useState(false);

  const uploadSectionRef = useRef<HTMLDivElement>(null);
  const mappingSectionRef = useRef<HTMLDivElement>(null);
  const previewSectionRef = useRef<HTMLDivElement>(null);
  const commitSectionRef = useRef<HTMLDivElement>(null);
  const subTabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const showToast = useCallback((text: string) => {
    setToastMessage(text);
    window.setTimeout(() => {
      setToastMessage((prev) => (prev === text ? '' : prev));
    }, 3400);
  }, []);

  // 初始化加载侧边栏计数、历史记录与批量操作数据
  useEffect(() => {
    let active = true;
    void adapter.loadSidebarCounts().then((counts) => {
      if (active) setSidebarCounts(counts);
    });
    void adapter.loadImportHistory().then((items) => {
      if (active) setHistoryRecords(items);
    });
    void adapter.loadBatchWorkspace().then(({ accounts, tags }) => {
      if (active) {
        setBatchAccounts(accounts);
        setBatchTags(tags);
      }
    });
    return () => {
      active = false;
    };
  }, [adapter]);

  // 清除所有文件与敏感状态（绝不保留在浏览器持久化存储中）
  const clearUploadedFile = useCallback((notice = '') => {
    generationRef.current++;
    rawFileRef.current = null;
    submittingRef.current = false;
    setSubmitting(false);
    setPreviewBusy(false);
    setFileMeta(null);
    setColumns([]);
    setValidation(null);
    setMapping({});
    setMappingWarning('');
    setParsedDataset(null);
    setUploadedPreviewRows([]);
    setUploadedCounts(EMPTY_COUNTS);
    setUploadedSummary(EMPTY_SUMMARY);
    setReceiptId(null);
    setNeedsRepreview(false);
    setConfirmed(false);
    setOutcome(null);
    setResultDialogOpen(false);
    setSelectedRows(new Set());
    setPage(1);
    setStatusFilter('all');
    setAnomaliesOnly(false);
    setCurrentStep(1);
    setCompletedSteps([]);
    setClientNotice(notice);
  }, []);

  // 安全保障：页面隐藏时自动清除内存中的真实敏感 CSV 文件
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && rawFileRef.current) {
        clearUploadedFile(
          '页面已切入后台，为保障凭据安全已清除内存中的 CSV 文件。',
        );
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      generationRef.current++;
      rawFileRef.current = null;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [clearUploadedFile]);

  const handleLoadSample = useCallback(() => {
    generationRef.current++;
    rawFileRef.current = null;
    setParsedDataset(null);
    setFileMeta(DEFAULT_SAMPLE_FILE_META);
    setColumns(DEFAULT_SAMPLE_COLUMNS);
    setValidation(DEFAULT_SAMPLE_VALIDATION);
    setMapping({ ...DEFAULT_SAMPLE_MAPPING });
    setMappingWarning('');
    setClientNotice('');
    setStrategy('upsert');
    setConflictResolution('csv_overwrite');
    setSkipEmptyFields(true);
    setReceiptId('rcpt_sample_prototype');
    setNeedsRepreview(false);
    setConfirmed(false);
    setOutcome(null);
    setSelectedRows(new Set());
    setStatusFilter('all');
    setAnomaliesOnly(false);
    setPage(1);
    setCurrentStep(2);
    setCompletedSteps([1]);
  }, []);

  // 运行服务端/适配器预览
  const runPreviewAnalysis = useCallback(
    async ({
      file,
      parsed,
      nextMapping,
      useCustomMapping,
      nextStrategy,
      nextConflict,
    }: {
      file: File;
      parsed: ParsedCsvDataset;
      nextMapping: FieldMappingState;
      useCustomMapping: boolean;
      nextStrategy: ImportStrategyOption;
      nextConflict: ConflictResolutionOption;
    }) => {
      const ticket = ++generationRef.current;
      setPreviewBusy(true);
      setClientNotice('');
      setOutcome(null);
      setConfirmed(false);
      try {
        const payload = await adapter.previewCsv({
          file,
          parsed,
          mapping: nextMapping,
          useCustomMapping,
          strategy: nextStrategy,
          conflictResolution: nextConflict,
        });
        if (ticket !== generationRef.current) return;
        setMapping(payload.mapping);
        setValidation(payload.validation);
        setUploadedPreviewRows(payload.rows);
        setUploadedCounts(payload.counts);
        setUploadedSummary(payload.summary);
        setReceiptId(payload.receiptId);
        setNeedsRepreview(false);
        setPage(1);
        setSelectedRows(new Set());
        setCurrentStep(2);
        setCompletedSteps([1]);
      } catch (error) {
        if (ticket !== generationRef.current) return;
        setReceiptId(null);
        const msg =
          error &&
          typeof error === 'object' &&
          'error' in error &&
          (error as { error?: { message?: string } }).error?.message
            ? (error as { error: { message: string } }).error.message
            : '服务端预览校验失败，请检查文件内容或网络连接后重试。';
        setClientNotice(msg);
        onFailure?.(error);
      } finally {
        if (ticket === generationRef.current) {
          setPreviewBusy(false);
        }
      }
    },
    [adapter, onFailure],
  );

  const handleFileSelected = useCallback(
    async (file: File) => {
      setClientNotice('');
      setMappingWarning('');
      const parsed = await readAndParseCsvFile(file);
      rawFileRef.current = file;
      setParsedDataset(parsed);
      setFileMeta(parsed.meta);
      setColumns(parsed.columns);
      setValidation(parsed.validation);
      const autoMap = buildAutoMapping(parsed.columns);
      setMapping(autoMap);
      setSelectedRows(new Set());
      setPage(1);
      setStatusFilter('all');
      setAnomaliesOnly(false);

      await runPreviewAnalysis({
        file,
        parsed,
        nextMapping: autoMap,
        useCustomMapping: false,
        nextStrategy: strategy,
        nextConflict: conflictResolution,
      });
    },
    [conflictResolution, runPreviewAnalysis, strategy],
  );

  // 策略与冲突联动
  const handleStrategyChange = useCallback(
    (next: ImportStrategyOption) => {
      setStrategy(next);
      const syncedConflict: ConflictResolutionOption =
        next === 'upsert'
          ? 'csv_overwrite'
          : next === 'insert_only'
            ? 'keep_existing'
            : 'reject_batch';
      setConflictResolution(syncedConflict);
      setConfirmed(false);
      setOutcome(null);
      setPage(1);

      if (parsedDataset && isMock) {
        const evaluated = evaluateParsedRows({
          rawRows: parsedDataset.rows,
          mapping,
          strategy: next,
          conflictResolution: syncedConflict,
        });
        setUploadedPreviewRows(evaluated.rows);
        setUploadedCounts(evaluated.counts);
        setUploadedSummary(evaluated.summary);
        setReceiptId(
          evaluated.summary.error === 0 && parsedDataset.validation.passed
            ? `rcpt_${Date.now().toString(36)}`
            : null,
        );
      } else if (!isMock && rawFileRef.current) {
        setReceiptId(null);
        setNeedsRepreview(true);
      }
    },
    [isMock, mapping, parsedDataset],
  );

  const handleConflictChange = useCallback(
    (next: ConflictResolutionOption) => {
      setConflictResolution(next);
      const syncedStrategy: ImportStrategyOption =
        next === 'csv_overwrite'
          ? 'upsert'
          : next === 'keep_existing'
            ? 'insert_only'
            : 'strict_new';
      setStrategy(syncedStrategy);
      setConfirmed(false);
      setOutcome(null);
      setPage(1);

      if (parsedDataset && isMock) {
        const evaluated = evaluateParsedRows({
          rawRows: parsedDataset.rows,
          mapping,
          strategy: syncedStrategy,
          conflictResolution: next,
        });
        setUploadedPreviewRows(evaluated.rows);
        setUploadedCounts(evaluated.counts);
        setUploadedSummary(evaluated.summary);
        setReceiptId(
          evaluated.summary.error === 0 && parsedDataset.validation.passed
            ? `rcpt_${Date.now().toString(36)}`
            : null,
        );
      } else if (!isMock && rawFileRef.current) {
        setReceiptId(null);
        setNeedsRepreview(true);
      }
    },
    [isMock, mapping, parsedDataset],
  );

  // 互斥字段映射变更
  const handleMappingChange = useCallback(
    (field: SystemFieldKey, colIndex: number | null) => {
      setMappingWarning('');

      if (colIndex !== null) {
        const conflictingEntry = (
          Object.entries(mapping) as [SystemFieldKey, number | undefined][]
        ).find(([otherKey, idx]) => otherKey !== field && idx === colIndex);

        if (conflictingEntry) {
          const [otherKey] = conflictingEntry;
          setMappingWarning(
            `不允许将同一 CSV 列映射到多个互斥字段：该列已分配给“${SYSTEM_FIELD_MAP[otherKey].label}”。`,
          );
          return;
        }
      }

      const nextMapping: FieldMappingState = { ...mapping };
      if (colIndex === null) {
        delete nextMapping[field];
      } else {
        nextMapping[field] = colIndex;
      }

      setMapping(nextMapping);
      setConfirmed(false);
      setOutcome(null);
      setPage(1);

      if (parsedDataset && isMock) {
        const evaluated = evaluateParsedRows({
          rawRows: parsedDataset.rows,
          mapping: nextMapping,
          strategy,
          conflictResolution,
        });
        setUploadedPreviewRows(evaluated.rows);
        setUploadedCounts(evaluated.counts);
        setUploadedSummary(evaluated.summary);
        setReceiptId(
          evaluated.summary.error === 0 && parsedDataset.validation.passed
            ? `rcpt_${Date.now().toString(36)}`
            : null,
        );
      } else if (!isMock && rawFileRef.current) {
        setReceiptId(null);
        setNeedsRepreview(true);
      }
    },
    [conflictResolution, isMock, mapping, parsedDataset, strategy],
  );

  const handleAutoMatch = useCallback(() => {
    const autoMap = buildAutoMapping([...columns]);
    setMapping(autoMap);
    setMappingWarning('');
    setConfirmed(false);
    setOutcome(null);
    if (parsedDataset && isMock) {
      const evaluated = evaluateParsedRows({
        rawRows: parsedDataset.rows,
        mapping: autoMap,
        strategy,
        conflictResolution,
      });
      setUploadedPreviewRows(evaluated.rows);
      setUploadedCounts(evaluated.counts);
      setUploadedSummary(evaluated.summary);
      setReceiptId(
        evaluated.summary.error === 0 && parsedDataset.validation.passed
          ? `rcpt_${Date.now().toString(36)}`
          : null,
      );
    } else if (!isMock && rawFileRef.current) {
      setReceiptId(null);
      setNeedsRepreview(true);
    }
    showToast('已按标准列名重新自动匹配字段。');
  }, [columns, conflictResolution, isMock, parsedDataset, showToast, strategy]);

  const handleRepreview = useCallback(() => {
    if (rawFileRef.current && parsedDataset) {
      void runPreviewAnalysis({
        file: rawFileRef.current,
        parsed: parsedDataset,
        nextMapping: mapping,
        useCustomMapping: true,
        nextStrategy: strategy,
        nextConflict: conflictResolution,
      });
      return;
    }
    // 预载示例文件重新预览
    if (fileMeta?.isSampleFixture) {
      setNeedsRepreview(false);
      setOutcome(null);
      setConfirmed(false);
      setReceiptId(`rcpt_sample_${Date.now().toString(36)}`);
      showToast('已按当前字段映射与策略重新校验预览。');
    }
  }, [
    conflictResolution,
    fileMeta?.isSampleFixture,
    mapping,
    parsedDataset,
    runPreviewAnalysis,
    showToast,
    strategy,
  ]);

  // 当前有效数据预览统计与当前页切片（5,246 行绝不一次性渲染）
  const isSampleMode = Boolean(fileMeta?.isSampleFixture);

  const activeCounts = useMemo<ValidationCounts>(() => {
    if (!fileMeta) return EMPTY_COUNTS;
    if (isSampleMode) return getSampleValidationCounts(mapping);
    return uploadedCounts;
  }, [fileMeta, isSampleMode, mapping, uploadedCounts]);

  const activeSummary = useMemo<CommitSummaryCounts>(() => {
    if (!fileMeta) return EMPTY_SUMMARY;
    if (isSampleMode) {
      return getSampleCommitSummary(mapping, strategy, conflictResolution);
    }
    return uploadedSummary;
  }, [
    conflictResolution,
    fileMeta,
    isSampleMode,
    mapping,
    strategy,
    uploadedSummary,
  ]);

  const { pageRows, totalFiltered } = useMemo(() => {
    if (!fileMeta) return { pageRows: [] as PreviewRow[], totalFiltered: 0 };

    const normalizedSearch = globalSearch.trim().toLowerCase();

    if (isSampleMode) {
      if (!normalizedSearch) {
        const sliced = getSamplePreviewPage({
          page,
          pageSize,
          filter: statusFilter,
          anomaliesOnly,
          mapping,
          strategy,
          conflictResolution,
        });
        return { pageRows: sliced.rows, totalFiltered: sliced.total };
      }
      // 搜索时在首批及所有异常样本中匹配
      const pool = getSampleExportPreviewRows(
        statusFilter,
        anomaliesOnly,
        mapping,
        strategy,
        conflictResolution,
        250,
      ).filter(
        (row) =>
          row.gmailEmail.toLowerCase().includes(normalizedSearch) ||
          row.recoveryEmail.toLowerCase().includes(normalizedSearch) ||
          row.validationMessage.toLowerCase().includes(normalizedSearch),
      );
      const start = (page - 1) * pageSize;
      return {
        pageRows: pool.slice(start, start + pageSize),
        totalFiltered: pool.length,
      };
    }

    const filtered = uploadedPreviewRows.filter((row) => {
      if (anomaliesOnly && row.status === 'valid') return false;
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (normalizedSearch) {
        return (
          row.gmailEmail.toLowerCase().includes(normalizedSearch) ||
          row.recoveryEmail.toLowerCase().includes(normalizedSearch) ||
          row.validationMessage.toLowerCase().includes(normalizedSearch)
        );
      }
      return true;
    });
    const start = (page - 1) * pageSize;
    return {
      pageRows: filtered.slice(start, start + pageSize),
      totalFiltered: filtered.length,
    };
  }, [
    anomaliesOnly,
    conflictResolution,
    fileMeta,
    globalSearch,
    isSampleMode,
    mapping,
    page,
    pageSize,
    statusFilter,
    strategy,
    uploadedPreviewRows,
  ]);

  // 行勾选操作
  const handleToggleRow = useCallback((rowNumber: number) => {
    setSelectedRows((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  }, []);

  const handleTogglePageAll = useCallback(
    (rowNumbers: number[], selectAll: boolean) => {
      setSelectedRows((prev) => {
        const next = new Set(prev);
        for (const num of rowNumbers) {
          if (selectAll) next.add(num);
          else next.delete(num);
        }
        return next;
      });
    },
    [],
  );

  // 导出预览（仅导出脱敏安全列，不含密码明文）
  const handleExportPreview = useCallback(() => {
    if (!fileMeta) return;
    const rowsToExport = isSampleMode
      ? getSampleExportPreviewRows(
          statusFilter,
          anomaliesOnly,
          mapping,
          strategy,
          conflictResolution,
          200,
        )
      : uploadedPreviewRows.filter((row) => {
          if (anomaliesOnly && row.status === 'valid') return false;
          if (statusFilter !== 'all' && row.status !== statusFilter)
            return false;
          return true;
        });

    const csvText = buildPreviewExportCsv(rowsToExport);
    const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8' });
    triggerBlobDownload(blob, `preview-${fileMeta.name}`);
    showToast(`已导出 ${rowsToExport.length} 条脱敏预览记录（不含密码明文）。`);
  }, [
    anomaliesOnly,
    conflictResolution,
    fileMeta,
    isSampleMode,
    mapping,
    showToast,
    statusFilter,
    strategy,
    uploadedPreviewRows,
  ]);

  // 导出非敏感账号 CSV
  const handleExportAccounts = useCallback(
    async (scope: 'all' | 'filtered') => {
      setExportBusy(true);
      try {
        const { blob, filename } = await adapter.exportAccountsCsv(scope);
        triggerBlobDownload(blob, filename);
        setExportOpen(false);
        showToast(`非敏感账号 CSV（${filename}）已开始下载。`);
      } catch (error) {
        showToast('导出失败，请检查会话状态或网络连接后重试。');
        onFailure?.(error);
      } finally {
        setExportBusy(false);
      }
    },
    [adapter, onFailure, showToast],
  );

  // 步骤跳转
  const canJumpToStep = useCallback(
    (step: ImportStep) => {
      if (step === 1) return true;
      return Boolean(fileMeta);
    },
    [fileMeta],
  );

  const handleSelectStep = useCallback((step: ImportStep) => {
    setCurrentStep(step);
    if (step === 1) {
      setCompletedSteps([]);
      uploadSectionRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'nearest',
      });
    } else if (step === 2) {
      setCompletedSteps([1]);
      mappingSectionRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'nearest',
      });
    } else if (step === 3) {
      setCompletedSteps([1, 2]);
      previewSectionRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'nearest',
      });
    } else {
      setCompletedSteps([1, 2, 3]);
      commitSectionRef.current?.scrollIntoView?.({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, []);

  const handlePrevStep = useCallback(() => {
    const prev: ImportStep = currentStep === 4 ? 3 : currentStep === 3 ? 2 : 1;
    handleSelectStep(prev);
  }, [currentStep, handleSelectStep]);

  const handleConfirmedChange = useCallback((checked: boolean) => {
    setConfirmed(checked);
    if (checked) {
      setCurrentStep(4);
      setCompletedSteps([1, 2, 3]);
    }
  }, []);

  // 原子事务提交（同步 ref 防重复提交 + 冲突重预览 + 断网结果未知）
  const handleStartImport = useCallback(async () => {
    if (
      submittingRef.current ||
      !fileMeta ||
      !receiptId ||
      activeSummary.error > 0 ||
      !confirmed ||
      needsRepreview
    ) {
      return;
    }
    const activeReceipt = receiptId;
    const ticket = generationRef.current;

    submittingRef.current = true;
    setSubmitting(true);
    setCurrentStep(4);
    setCompletedSteps([1, 2, 3]);
    setOutcome(null);

    try {
      const result = await adapter.commitCsv({
        file: rawFileRef.current,
        receiptId: activeReceipt,
        summary: activeSummary,
      });

      if (ticket !== generationRef.current) return;

      setOutcome(result);
      setResultDialogOpen(true);

      if (result.kind === 'committed') {
        setCompletedSteps([1, 2, 3, 4]);
        setReceiptId(null);
        setConfirmed(false);
        const latestHistory = await adapter.loadImportHistory();
        if (ticket === generationRef.current) {
          setHistoryRecords(latestHistory);
        }
      } else if (result.kind === 'conflict') {
        // 服务端返回冲突时必须重新预览
        setReceiptId(null);
        setNeedsRepreview(true);
        setConfirmed(false);
      } else {
        // 网络中断：结果未知，锁定本次凭据，不声称失败、不自动重试
        setReceiptId(null);
        setConfirmed(false);
      }
    } catch {
      if (ticket !== generationRef.current) return;
      const unknownOutcome: CommitOutcome = {
        kind: 'unknown',
        message: '结果未知，请刷新确认',
      };
      setOutcome(unknownOutcome);
      setResultDialogOpen(true);
      setReceiptId(null);
      setConfirmed(false);
    } finally {
      if (ticket === generationRef.current) {
        submittingRef.current = false;
        setSubmitting(false);
      }
    }
  }, [activeSummary, adapter, confirmed, fileMeta, needsRepreview, receiptId]);

  const handleRefreshAfterUnknown = useCallback(() => {
    void adapter.loadSidebarCounts().then(setSidebarCounts);
    void adapter.loadImportHistory().then(setHistoryRecords);
    setOutcome(null);
    setNeedsRepreview(true);
    showToast('已刷新统计与历史记录，请前往审计日志确认最终入库结果。');
  }, [adapter, showToast]);

  // 导航分发
  const navigateTo = useCallback(
    (livePath: string, previewPath: string) => {
      const target = isMock ? previewPath : livePath;
      if (onNavigate) {
        onNavigate(target);
      } else {
        showToast(`当前为独立预览组件，目标路由：${target}`);
      }
    },
    [isMock, onNavigate, showToast],
  );

  const handleOpenAuditLog = useCallback(() => {
    navigateTo('/settings/audit', '/preview/settings/audit');
  }, [navigateTo]);

  const handleSelectTopNav = useCallback(
    (key: TransferTopNavKey) => {
      if (key === 'transfer') {
        setSubTab('import');
      } else if (key === 'batch') {
        setSubTab('batch');
      } else if (key === 'dashboard' || key === 'accounts' || key === 'tags') {
        navigateTo('/accounts', '/preview/accounts');
      }
    },
    [navigateTo],
  );

  const handleSelectSidebarNav = useCallback(
    (key: TransferSidebarKey) => {
      if (key === 'transfer') {
        setSubTab('import');
      } else if (key === 'batch') {
        setSubTab('batch');
      } else if (key === 'accounts' || key === 'tags') {
        navigateTo('/accounts', '/preview/accounts');
      } else if (key === 'archived') {
        navigateTo('/accounts?archived=true', '/preview/accounts');
      } else if (key === 'trash') {
        navigateTo('/accounts?deleted=true', '/preview/accounts');
      } else if (key === 'audit') {
        handleOpenAuditLog();
      } else if (key === 'backup') {
        navigateTo('/settings/backup', '/preview/settings/backup');
      } else if (key === 'settings') {
        navigateTo('/settings/security', '/preview/settings/security');
      }
    },
    [handleOpenAuditLog, navigateTo],
  );

  const handleBatchStatus = useCallback(
    async (
      targets: { id: string; rowVersion: number }[],
      status: AccountSummary['status'],
    ) => {
      setBatchBusy(true);
      try {
        await adapter.applyBatchStatus(targets, status);
        const latest = await adapter.loadBatchWorkspace();
        setBatchAccounts(latest.accounts);
      } catch (error) {
        onFailure?.(error);
      } finally {
        setBatchBusy(false);
      }
    },
    [adapter, onFailure],
  );

  const handleBatchTags = useCallback(
    async (targets: { id: string; rowVersion: number }[], tagIds: string[]) => {
      setBatchBusy(true);
      try {
        await adapter.applyBatchTags(targets, tagIds);
        const latest = await adapter.loadBatchWorkspace();
        setBatchAccounts(latest.accounts);
      } catch (error) {
        onFailure?.(error);
      } finally {
        setBatchBusy(false);
      }
    },
    [adapter, onFailure],
  );

  const notifications = useMemo(
    () =>
      isMock
        ? [
            '最近一次 CSV 导入（1,248 条）已完成防篡改哈希链记录。',
            '上传限制：≤10 MB、≤10,000 行、≤256 列，所有敏感字段自动掩码。',
          ]
        : [
            '所有 CSV 导入提交均写入防篡改哈希链审计日志，支持单事务原子回滚。',
            '上传限制：≤10 MB、≤10,000 行、≤256 列，所有敏感字段自动掩码。',
          ],
    [isMock],
  );

  return (
    <CsvWorkspaceShell
      navAlpha={navAlpha}
      onNavAlphaChange={handleNavAlphaChange}
      displaySettings={displaySettings}
      activeSubTab={subTab}
      sidebarCounts={sidebarCounts}
      globalSearch={globalSearch}
      onGlobalSearchChange={(value) => {
        setGlobalSearch(value);
        setPage(1);
      }}
      notifications={notifications}
      onSelectTopNav={handleSelectTopNav}
      onSelectSidebarNav={handleSelectSidebarNav}
      onOpenSecurity={() =>
        navigateTo('/settings/security', '/preview/settings/security')
      }
      onOpenAuditLog={handleOpenAuditLog}
      onLogout={() => {
        clearUploadedFile();
        if (onLogout) onLogout();
        else showToast('已退出当前演示会话。');
      }}
    >
      {/* 四、页面标题区 + 右侧操作按钮 + 顶部子标签 */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-[var(--text-primary)]">
              CSV 导入 / 批量操作
            </h1>
            <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
              批量导入、更新或管理 Gmail
              账号，支持严格校验、字段映射与原子提交。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setHistoryOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/85 bg-white/68 px-3.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_2px_10px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-colors hover:bg-white"
            >
              <History
                className="size-4 text-[var(--text-secondary)]"
                aria-hidden="true"
              />
              <span>导入历史</span>
            </button>

            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/85 bg-white/68 px-3.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_2px_10px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] transition-colors hover:bg-white"
            >
              <Download
                className="size-4 text-[var(--accent)]"
                aria-hidden="true"
              />
              <span>导出数据</span>
            </button>
          </div>
        </div>

        {/* 顶部子标签（macOS segmented control） */}
        <div
          role="tablist"
          aria-label="数据处理子模块"
          className="inline-flex items-center gap-1 rounded-2xl border border-white/78 bg-white/46 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]"
        >
          {(
            [
              { key: 'import', label: 'CSV 导入', icon: Upload },
              { key: 'batch', label: '批量操作', icon: Layers },
            ] as const
          ).map(({ key, label, icon: Icon }, idx) => {
            const selected = subTab === key;
            return (
              <button
                key={key}
                ref={(el) => {
                  subTabRefs.current[idx] = el;
                }}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                onClick={() => setSubTab(key)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    const nextIdx = idx === 0 ? 1 : 0;
                    const nextKey = nextIdx === 0 ? 'import' : 'batch';
                    setSubTab(nextKey);
                    subTabRefs.current[nextIdx]?.focus();
                  } else if (event.key === 'Home') {
                    event.preventDefault();
                    setSubTab('import');
                    subTabRefs.current[0]?.focus();
                  } else if (event.key === 'End') {
                    event.preventDefault();
                    setSubTab('batch');
                    subTabRefs.current[1]?.focus();
                  }
                }}
                className={cn(
                  'inline-flex h-8.5 items-center gap-1.5 rounded-xl px-4 text-[13px] font-medium transition-all duration-[180ms] ease-out',
                  selected
                    ? 'border border-[#1677ff]/24 bg-white/92 font-semibold text-[#1158c7] shadow-[0_3px_10px_rgba(22,119,255,0.12),inset_0_1px_0_rgba(255,255,255,0.95)]'
                    : 'text-[var(--text-secondary)] hover:bg-white/55 hover:text-[var(--text-primary)]',
                )}
              >
                <Icon
                  className={cn(
                    'size-3.5',
                    selected
                      ? 'text-[var(--accent)]'
                      : 'text-[var(--text-secondary)]',
                  )}
                  aria-hidden="true"
                />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {subTab === 'batch' ? (
        <BatchOperationsPanel
          accounts={batchAccounts}
          tags={batchTags}
          searchQuery={globalSearch}
          busy={batchBusy}
          onApplyStatus={handleBatchStatus}
          onApplyTags={handleBatchTags}
        />
      ) : (
        <div className="space-y-4">
          {/* 五、四步流程指示器 */}
          <ImportStepper
            currentStep={currentStep}
            completedSteps={completedSteps}
            canJumpToStep={canJumpToStep}
            onSelectStep={handleSelectStep}
          />

          {/* 六 + 七、上方左右分栏：左侧 310px 上传与校验 + 右侧配置字段映射 */}
          <div className="flex flex-col items-start gap-4 xl:flex-row">
            {/* 左侧 310px：上传、已上传文件卡片与文件校验结果 */}
            <GlassPanel
              ref={uploadSectionRef}
              data-slot="upload-validation-column"
              className="w-full shrink-0 space-y-3.5 p-4 xl:w-[310px]"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[14.5px] font-semibold text-[var(--text-primary)]">
                  上传与校验文件
                </h2>
                <span className="text-[11px] text-[var(--text-secondary)]">
                  步骤 1
                </span>
              </div>

              <CsvDropzone
                onFileSelected={(file) => void handleFileSelected(file)}
                disabled={submitting || previewBusy}
                compact={Boolean(fileMeta)}
                onLoadSample={
                  isMock && !fileMeta ? handleLoadSample : undefined
                }
                clientNotice={clientNotice}
              />

              {fileMeta && (
                <UploadedFileCard
                  file={fileMeta}
                  disabled={submitting || previewBusy}
                  onRemove={() => clearUploadedFile()}
                />
              )}

              {validation && <FileValidationCard validation={validation} />}
            </GlassPanel>

            {/* 右侧：配置字段映射 */}
            <GlassPanel
              ref={mappingSectionRef}
              data-slot="field-mapping-section"
              className="w-full min-w-0 flex-1 space-y-3.5 p-4 sm:p-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                    配置字段映射
                  </h2>
                  <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                    设置导入策略、冲突规则与 CSV
                    列对应关系；密码与敏感字段始终掩码显示。
                  </p>
                </div>
                {fileMeta && (
                  <button
                    type="button"
                    onClick={() => handleSelectStep(3)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#1677ff]/22 bg-[#eaf3ff]/80 px-3 text-[12px] font-semibold text-[#1158c7] transition-colors hover:bg-[#dcebff]"
                  >
                    <span>进入数据预览</span>
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </button>
                )}
              </div>

              <ImportStrategyControls
                strategy={strategy}
                conflictResolution={conflictResolution}
                skipEmptyFields={skipEmptyFields}
                disabled={submitting || previewBusy || !fileMeta}
                onStrategyChange={handleStrategyChange}
                onConflictResolutionChange={handleConflictChange}
                onSkipEmptyFieldsChange={(checked) => {
                  setSkipEmptyFields(checked);
                  setConfirmed(false);
                }}
              />

              {fileMeta ? (
                <FieldMappingTable
                  columns={columns}
                  mapping={mapping}
                  disabled={submitting || previewBusy}
                  needsRepreview={needsRepreview}
                  repreviewBusy={previewBusy}
                  mappingWarning={mappingWarning}
                  onMappingChange={handleMappingChange}
                  onAutoMatch={handleAutoMatch}
                  onRepreview={handleRepreview}
                />
              ) : (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-[#b9d0ec]/80 bg-white/38 px-6 py-12 text-center">
                  <FileSpreadsheet
                    className="mb-2.5 size-8 text-[var(--accent)]/60"
                    aria-hidden="true"
                  />
                  <p className="text-[13.5px] font-medium text-[var(--text-primary)]">
                    请先在左侧上传 CSV 文件
                  </p>
                  <p className="mt-1 text-[12px] text-[var(--text-secondary)]">
                    上传并解析表头后，系统将自动匹配标准字段并展示掩码示例值。
                  </p>
                </div>
              )}
            </GlassPanel>
          </div>

          {/* 八、数据预览与校验结果 */}
          <GlassPanel
            ref={previewSectionRef}
            data-slot="data-preview-section"
            className="space-y-3.5 p-4 sm:p-5"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                  数据预览与校验结果
                </h2>
                <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
                  支持按状态筛选、仅看异常、展开错误字段明细与分页浏览；敏感值均已掩码处理。
                </p>
              </div>
              {fileMeta && (
                <button
                  type="button"
                  onClick={() => handleSelectStep(4)}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/85 bg-white/70 px-3 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-white"
                >
                  <span>前往确认导入</span>
                  <ArrowRight className="size-3.5 text-[var(--accent)]" />
                </button>
              )}
            </div>

            <ValidationSummary
              counts={activeCounts}
              activeFilter={statusFilter}
              anomaliesOnly={anomaliesOnly}
              onFilterChange={(next) => {
                setStatusFilter(next);
                setPage(1);
                if (fileMeta && currentStep < 3) {
                  setCurrentStep(3);
                  setCompletedSteps([1, 2]);
                }
              }}
              onAnomaliesOnlyChange={(checked) => {
                setAnomaliesOnly(checked);
                setPage(1);
              }}
              onExportPreview={handleExportPreview}
              exportDisabled={!fileMeta}
            />

            {previewBusy ? (
              <LoadingState
                title="正在校验 CSV 文件…"
                description="正在上传并执行服务端表头映射与逐行校验，请稍候…"
                className="border-white/75 bg-white/40 py-8 shadow-none"
              />
            ) : fileMeta ? (
              <CsvPreviewTable
                rows={pageRows}
                totalFiltered={totalFiltered}
                page={page}
                pageSize={pageSize}
                onPageChange={setPage}
                onPageSizeChange={(nextSize) => {
                  setPageSize(nextSize);
                  setPage(1);
                }}
                selectedRows={selectedRows}
                onToggleRow={handleToggleRow}
                onTogglePageAll={handleTogglePageAll}
              />
            ) : (
              <div className="rounded-2xl border border-dashed border-[#b9d0ec]/75 bg-white/36 px-6 py-10 text-center text-[13px] text-[var(--text-secondary)]">
                暂无预览数据。上传 CSV 文件后将按分页加载逐行校验结果。
              </div>
            )}
          </GlassPanel>

          {/* 九、确认导入区域 */}
          <div ref={commitSectionRef}>
            <AtomicCommitPanel
              hasFile={Boolean(fileMeta)}
              hasReceipt={Boolean(receiptId)}
              summary={activeSummary}
              confirmed={confirmed}
              submitting={submitting}
              needsRepreview={needsRepreview}
              outcome={outcome}
              onConfirmedChange={handleConfirmedChange}
              onPrevStep={handlePrevStep}
              onStartImport={() => void handleStartImport()}
              onRepreview={handleRepreview}
              onOpenAuditLog={handleOpenAuditLog}
              onRefreshState={handleRefreshAfterUnknown}
            />
          </div>
        </div>
      )}

      {/* 弹窗集合 */}
      <ImportResultDialog
        open={resultDialogOpen}
        outcome={outcome}
        onOpenChange={setResultDialogOpen}
        onOpenAuditLog={handleOpenAuditLog}
        onRepreview={handleRepreview}
        onRefreshState={handleRefreshAfterUnknown}
        onResetWorkflow={() => clearUploadedFile()}
      />

      <ImportHistoryDialog
        open={historyOpen}
        records={historyRecords}
        onOpenChange={setHistoryOpen}
        onOpenAuditLog={handleOpenAuditLog}
      />

      <ExportDataDialog
        open={exportOpen}
        busy={exportBusy}
        onOpenChange={setExportOpen}
        onConfirmExport={(scope) => void handleExportAccounts(scope)}
      />

      {/* 屏幕阅读器与轻量玻璃 Toast */}
      {toastMessage && (
        <div
          role="status"
          aria-live="polite"
          data-slot="transfer-toast"
          className="fixed right-6 bottom-6 z-[60] rounded-2xl border border-white/88 bg-[rgba(250,253,255,0.94)] px-4 py-2.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_16px_40px_rgba(32,68,118,0.2),inset_0_1px_0_rgba(255,255,255,0.95)] backdrop-blur-xl"
        >
          {toastMessage}
        </div>
      )}
    </CsvWorkspaceShell>
  );
}
