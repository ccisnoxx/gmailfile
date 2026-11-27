import { ArrowRight, FileSpreadsheet } from 'lucide-react';
import { GlassPanel, LoadingState } from '@/components/macos';
import { AtomicCommitPanel } from './atomic-commit-panel';
import { CsvDropzone } from './csv-dropzone';
import { CsvPreviewTable } from './csv-preview-table';
import { FieldMappingTable } from './field-mapping-table';
import { FileValidationCard } from './file-validation-card';
import { ImportStepper } from './import-stepper';
import { ImportStrategyControls } from './import-strategy-controls';
import { UploadedFileCard } from './uploaded-file-card';
import type { CsvImportController } from './use-csv-import-controller';
import { ValidationSummary } from './validation-summary';

export function CsvImportWorkflowView({ ctrl }: { ctrl: CsvImportController }) {
  return (
    <div
      role="tabpanel"
      id="transfer-tabpanel-import"
      aria-labelledby="transfer-tab-import"
      className="space-y-4"
    >
      {/* 五、四步流程指示器 */}
      <ImportStepper
        currentStep={ctrl.currentStep}
        completedSteps={ctrl.completedSteps}
        canJumpToStep={ctrl.canJumpToStep}
        onSelectStep={ctrl.handleSelectStep}
      />

      {/* 六 + 七、上方左右分栏：左侧 310px 上传与校验 + 右侧配置字段映射 */}
      <div className="flex flex-col items-start gap-4 xl:flex-row">
        {/* 左侧 310px：上传、已上传文件卡片与文件校验结果 */}
        <GlassPanel
          ref={ctrl.uploadSectionRef}
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
            onFileSelected={(file) => void ctrl.handleFileSelected(file)}
            disabled={ctrl.submitting || ctrl.previewBusy}
            compact={Boolean(ctrl.fileMeta)}
            onLoadSample={
              ctrl.isMock && !ctrl.fileMeta ? ctrl.handleLoadSample : undefined
            }
            clientNotice={ctrl.clientNotice}
          />

          {ctrl.fileMeta && (
            <UploadedFileCard
              file={ctrl.fileMeta}
              disabled={ctrl.submitting || ctrl.previewBusy}
              onRemove={() => ctrl.clearUploadedFile()}
            />
          )}

          {ctrl.validation && (
            <FileValidationCard validation={ctrl.validation} />
          )}
        </GlassPanel>

        {/* 右侧：配置字段映射 */}
        <GlassPanel
          ref={ctrl.mappingSectionRef}
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
            {ctrl.fileMeta && (
              <button
                type="button"
                onClick={() => ctrl.handleSelectStep(3)}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[#1677ff]/22 bg-[#eaf3ff]/80 px-3 text-[12px] font-semibold text-[#1158c7] transition-colors hover:bg-[#dcebff]"
              >
                <span>进入数据预览</span>
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <ImportStrategyControls
            strategy={ctrl.strategy}
            conflictResolution={ctrl.conflictResolution}
            skipEmptyFields={ctrl.skipEmptyFields}
            disabled={ctrl.submitting || ctrl.previewBusy || !ctrl.fileMeta}
            onStrategyChange={ctrl.handleStrategyChange}
            onConflictResolutionChange={ctrl.handleConflictChange}
            onSkipEmptyFieldsChange={ctrl.handleSkipEmptyFieldsChange}
          />

          {ctrl.fileMeta ? (
            <FieldMappingTable
              columns={ctrl.columns}
              mapping={ctrl.mapping}
              disabled={ctrl.submitting || ctrl.previewBusy}
              needsRepreview={ctrl.needsRepreview}
              repreviewBusy={ctrl.previewBusy}
              mappingWarning={ctrl.mappingWarning}
              onMappingChange={ctrl.handleMappingChange}
              onAutoMatch={ctrl.handleAutoMatch}
              onRepreview={ctrl.handleRepreview}
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
        ref={ctrl.previewSectionRef}
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
          {ctrl.fileMeta && (
            <button
              type="button"
              onClick={() => ctrl.handleSelectStep(4)}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/85 bg-white/70 px-3 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-white"
            >
              <span>前往确认导入</span>
              <ArrowRight className="size-3.5 text-[var(--accent)]" />
            </button>
          )}
        </div>

        <ValidationSummary
          counts={ctrl.activeCounts}
          activeFilter={ctrl.statusFilter}
          anomaliesOnly={ctrl.anomaliesOnly}
          onFilterChange={(next) => {
            ctrl.setStatusFilter(next);
            ctrl.setPage(1);
            if (ctrl.fileMeta && ctrl.currentStep < 3) {
              ctrl.setCurrentStep(3);
              ctrl.setCompletedSteps([1, 2]);
            }
          }}
          onAnomaliesOnlyChange={(checked) => {
            ctrl.setAnomaliesOnly(checked);
            ctrl.setPage(1);
          }}
          onExportPreview={ctrl.handleExportPreview}
          exportDisabled={!ctrl.fileMeta}
          exportLabel={
            ctrl.selectedRows.size > 0
              ? `导出所选预览 (${ctrl.selectedRows.size})`
              : '导出预览'
          }
        />

        {ctrl.previewBusy ? (
          <LoadingState
            title="正在校验 CSV 文件…"
            description="正在上传并执行服务端表头映射与逐行校验，请稍候…"
            className="border-white/75 bg-white/40 py-8 shadow-none"
          />
        ) : ctrl.fileMeta ? (
          <CsvPreviewTable
            rows={ctrl.pageRows}
            totalFiltered={ctrl.totalFiltered}
            page={ctrl.page}
            pageSize={ctrl.pageSize}
            onPageChange={ctrl.setPage}
            onPageSizeChange={(nextSize) => {
              ctrl.setPageSize(nextSize);
              ctrl.setPage(1);
            }}
            selectedRows={ctrl.selectedRows}
            onToggleRow={ctrl.handleToggleRow}
            onTogglePageAll={ctrl.handleTogglePageAll}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-[#b9d0ec]/75 bg-white/36 px-6 py-10 text-center text-[13px] text-[var(--text-secondary)]">
            暂无预览数据。上传 CSV 文件后将按分页加载逐行校验结果。
          </div>
        )}
      </GlassPanel>

      {/* 九、确认导入区域 */}
      <div ref={ctrl.commitSectionRef}>
        <AtomicCommitPanel
          hasFile={Boolean(ctrl.fileMeta)}
          hasReceipt={Boolean(ctrl.receiptId)}
          summary={ctrl.activeSummary}
          confirmed={ctrl.confirmed}
          submitting={ctrl.submitting}
          needsRepreview={ctrl.needsRepreview}
          outcome={ctrl.outcome}
          onConfirmedChange={ctrl.handleConfirmedChange}
          onPrevStep={ctrl.handlePrevStep}
          onStartImport={() => void ctrl.handleStartImport()}
          onRepreview={ctrl.handleRepreview}
          onOpenAuditLog={ctrl.handleOpenAuditLog}
          onRefreshState={ctrl.handleRefreshAfterUnknown}
        />
      </div>
    </div>
  );
}
