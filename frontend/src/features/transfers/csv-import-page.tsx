import { lazy, Suspense, useCallback, useContext, useRef } from 'react';
import { createPortal } from 'react-dom';
import { QueryClientContext } from '@tanstack/react-query';
import { Download, History, Layers, Upload } from 'lucide-react';
import { useInRouterContext, useLocation, useNavigate } from 'react-router-dom';
import { Providers } from '@/app/providers';
import { cn } from '@/lib/utils';
import { BatchOperationsPanel } from './batch-operations-panel';
import { CsvImportWorkflowView } from './csv-import-workflow-view';
import { CsvWorkspaceShell } from './csv-workspace-shell';
import { DataExportPanel } from './encrypted-export-panel';
import { ImportResultDialog } from './import-result-dialog';
import { ExportDataDialog, ImportHistoryDialog } from './transfer-dialogs';
import type { TransferSubTab } from './types';
import {
  parseSubTabFromSearch,
  useCsvImportController,
  type CsvImportPageProps,
} from './use-csv-import-controller';

export type { CsvImportPageProps } from './use-csv-import-controller';

const LazyCsvReauthDialog = lazy(() => import('./csv-reauth-dialog'));

const SUB_TABS: readonly {
  key: TransferSubTab;
  label: string;
  icon: typeof Upload;
}[] = [
  { key: 'import', label: 'CSV 导入', icon: Upload },
  { key: 'batch', label: '批量操作', icon: Layers },
  { key: 'export', label: '数据导出', icon: Download },
];

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
  const location = useLocation();
  const tabFromUrl = parseSubTabFromSearch(location.search);
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
  return (
    <CsvImportPageBody
      {...props}
      initialSubTab={tabFromUrl ?? props.initialSubTab}
      urlTab={tabFromUrl}
      onNavigate={handleNavigate}
    />
  );
}

function CsvImportPageBody(
  props: CsvImportPageProps & { urlTab?: TransferSubTab | null },
) {
  const ctrl = useCsvImportController(props);
  const subTabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <CsvWorkspaceShell
      navAlpha={ctrl.navAlpha}
      onNavAlphaChange={ctrl.handleNavAlphaChange}
      displaySettings={ctrl.displaySettings}
      onDisplaySettingsChange={ctrl.handleDisplaySettingsChange}
      activeSubTab={ctrl.subTab}
      sidebarCounts={ctrl.sidebarCounts}
      primarySidebarCounts={!ctrl.isMock ? ctrl.liveSidebar.counts : undefined}
      sidebarTags={!ctrl.isMock ? ctrl.liveSidebar.tags : undefined}
      systemStatus={ctrl.systemStatus}
      globalSearch={ctrl.globalSearch}
      onGlobalSearchChange={(value) => {
        ctrl.setGlobalSearch(value);
        ctrl.setPage(1);
      }}
      notifications={ctrl.notifications}
      onSelectTopNav={ctrl.handleSelectTopNav}
      onSelectSidebarNav={ctrl.handleSelectSidebarNav}
      onSelectAccountSection={ctrl.handleSelectAccountSection}
      onSelectTag={ctrl.handleSelectTag}
      onOpenSecurity={() =>
        ctrl.navigateToDestination({ kind: 'settings', section: 'security' })
      }
      onOpenAuditLog={ctrl.handleOpenAuditLog}
      onOpenRecoveryUsage={() =>
        ctrl.navigateToDestination({ kind: 'recovery-emails' })
      }
      onLogout={() => {
        ctrl.clearUploadedFile();
        if (props.onLogout) props.onLogout();
        else ctrl.showToast('已退出当前演示会话。');
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
              批量导入、更新、导出或管理 Gmail
              账号，支持严格校验、字段映射、加密导出与原子提交。
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => ctrl.setHistoryOpen(true)}
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
              onClick={() => ctrl.setExportOpen(true)}
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
          className="inline-flex flex-wrap items-center gap-1 rounded-2xl border border-white/78 bg-white/46 p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.82)]"
        >
          {SUB_TABS.map(({ key, label, icon: Icon }, idx) => {
            const selected = ctrl.subTab === key;
            return (
              <button
                key={key}
                id={`transfer-tab-${key}`}
                ref={(el) => {
                  subTabRefs.current[idx] = el;
                }}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`transfer-tabpanel-${key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => ctrl.setSubTab(key)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                    event.preventDefault();
                    const step = event.key === 'ArrowRight' ? 1 : -1;
                    const nextIdx =
                      (idx + step + SUB_TABS.length) % SUB_TABS.length;
                    ctrl.setSubTab(SUB_TABS[nextIdx].key);
                    subTabRefs.current[nextIdx]?.focus();
                  } else if (event.key === 'Home') {
                    event.preventDefault();
                    ctrl.setSubTab(SUB_TABS[0].key);
                    subTabRefs.current[0]?.focus();
                  } else if (event.key === 'End') {
                    event.preventDefault();
                    const last = SUB_TABS.length - 1;
                    ctrl.setSubTab(SUB_TABS[last].key);
                    subTabRefs.current[last]?.focus();
                  }
                }}
                className={cn(
                  'inline-flex h-8.5 items-center gap-1.5 rounded-xl px-4 text-[13px] font-medium transition-all duration-[180ms] ease-out',
                  selected
                    ? 'border border-[var(--badge-blue-border)] bg-[var(--surface-selected)] font-semibold text-[var(--accent-text)] shadow-[0_3px_10px_rgba(22,119,255,0.12)]'
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

      {ctrl.subTab === 'batch' ? (
        <div
          role="tabpanel"
          id="transfer-tabpanel-batch"
          aria-labelledby="transfer-tab-batch"
        >
          <BatchOperationsPanel
            accounts={ctrl.batchAccounts}
            totalAccounts={ctrl.batchTotal}
            tags={ctrl.batchTags}
            searchQuery={ctrl.globalSearch}
            onSearchQueryChange={ctrl.setGlobalSearch}
            busy={ctrl.batchBusy}
            onApplyStatus={ctrl.handleBatchStatus}
            onApplyTags={ctrl.handleBatchTags}
          />
        </div>
      ) : ctrl.subTab === 'export' ? (
        <div
          role="tabpanel"
          id="transfer-tabpanel-export"
          aria-labelledby="transfer-tab-export"
        >
          <DataExportPanel
            mode={ctrl.isMock ? 'mock' : 'live'}
            session={ctrl.liveSession}
            exportBusy={ctrl.exportBusy}
            onSession={ctrl.handleSessionUpdate}
            onFailure={props.onFailure}
            onExportCsv={ctrl.handleExportAccounts}
            onToast={ctrl.showToast}
          />
        </div>
      ) : (
        <CsvImportWorkflowView ctrl={ctrl} />
      )}

      {/* 弹窗集合 */}
      <ImportResultDialog
        open={ctrl.resultDialogOpen}
        outcome={ctrl.outcome}
        onOpenChange={ctrl.setResultDialogOpen}
        onOpenAuditLog={ctrl.handleOpenAuditLog}
        onRepreview={ctrl.handleRepreview}
        onRefreshState={ctrl.handleRefreshAfterUnknown}
        onResetWorkflow={() => ctrl.clearUploadedFile()}
      />

      <ImportHistoryDialog
        open={ctrl.historyOpen}
        records={ctrl.historyRecords}
        onOpenChange={ctrl.setHistoryOpen}
        onOpenAuditLog={ctrl.handleOpenAuditLog}
      />

      <ExportDataDialog
        open={ctrl.exportOpen}
        busy={ctrl.exportBusy}
        onOpenChange={ctrl.setExportOpen}
        onConfirmExport={(scope) => void ctrl.handleExportAccounts(scope)}
      />

      {/* 页内高风险二次验证弹窗（按需懒加载，保留已上传 CSV 文件不丢失） */}
      {!ctrl.isMock && ctrl.liveSession && ctrl.reauthPending !== null && (
        <Suspense fallback={null}>
          <LazyCsvReauthDialog
            open={ctrl.reauthPending !== null}
            session={ctrl.liveSession}
            onOpenChange={(open) => {
              if (!open) ctrl.setReauthPending(null);
            }}
            onSessionUpdate={ctrl.handleSessionUpdate}
            onVerified={() => {
              const pending = ctrl.reauthPending;
              ctrl.setReauthPending(null);
              if (pending) ctrl.setPendingResume(pending);
            }}
          />
        </Suspense>
      )}

      {/* 屏幕阅读器与轻量玻璃 Toast（Portal 渲染于 body，z-[70] 置于弹窗之上） */}
      {ctrl.toastMessage &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            data-slot="transfer-toast"
            className="pointer-events-none fixed right-6 bottom-6 z-[70] rounded-2xl border border-[var(--modal-border)] bg-[var(--surface-toast)] px-4 py-2.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_16px_40px_rgba(15,30,58,0.28)] backdrop-blur-xl"
          >
            {ctrl.toastMessage}
          </div>,
          document.body,
        )}
    </CsvWorkspaceShell>
  );
}
