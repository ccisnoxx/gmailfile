import { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Lock,
  RefreshCw,
  Wand2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { maskFieldSample, MASKED_PASSWORD_PLACEHOLDER } from './csv-parser';
import {
  SYSTEM_FIELD_DEFINITIONS,
  type CsvColumnInfo,
  type FieldMappingState,
  type SystemFieldDefinition,
  type SystemFieldKey,
} from './types';

export function FieldMappingTable({
  columns,
  mapping,
  disabled = false,
  needsRepreview = false,
  repreviewBusy = false,
  mappingWarning,
  onMappingChange,
  onAutoMatch,
  onRepreview,
  className,
}: {
  columns: readonly CsvColumnInfo[];
  mapping: FieldMappingState;
  disabled?: boolean;
  needsRepreview?: boolean;
  repreviewBusy?: boolean;
  mappingWarning?: string;
  onMappingChange: (field: SystemFieldKey, columnIndex: number | null) => void;
  onAutoMatch?: () => void;
  onRepreview?: () => void;
  className?: string;
}) {
  const [showOptional, setShowOptional] = useState(false);

  const visibleFields = useMemo<readonly SystemFieldDefinition[]>(
    () =>
      showOptional
        ? SYSTEM_FIELD_DEFINITIONS
        : SYSTEM_FIELD_DEFINITIONS.filter((f) => f.primary),
    [showOptional],
  );

  const optionalCount = useMemo(
    () => SYSTEM_FIELD_DEFINITIONS.filter((f) => !f.primary).length,
    [],
  );

  // 记录每一列已被分配给哪个系统字段，防止一列映射到多个互斥字段
  const assignedByCol = useMemo(() => {
    const map = new Map<number, SystemFieldDefinition>();
    for (const def of SYSTEM_FIELD_DEFINITIONS) {
      const colIdx = mapping[def.key];
      if (typeof colIdx === 'number') {
        map.set(colIdx, def);
      }
    }
    return map;
  }, [mapping]);

  // 统计同一列是否被意外重复分配
  const duplicateColumns = useMemo(() => {
    const counts = new Map<number, number>();
    for (const val of Object.values(mapping)) {
      if (typeof val === 'number') {
        counts.set(val, (counts.get(val) ?? 0) + 1);
      }
    }
    return new Set(
      Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([idx]) => idx),
    );
  }, [mapping]);

  return (
    <div data-slot="field-mapping-table" className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[var(--text-secondary)]">
            已自动匹配{' '}
            <strong className="font-semibold tabular-nums text-[var(--text-primary)]">
              {
                Object.values(mapping).filter((v) => typeof v === 'number')
                  .length
              }
            </strong>{' '}
            / {SYSTEM_FIELD_DEFINITIONS.length} 个系统字段，同一 CSV
            列不可重复映射
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {onAutoMatch && (
            <button
              type="button"
              disabled={disabled || columns.length === 0}
              onClick={onAutoMatch}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-white/85 bg-white/70 px-2.5 text-[12px] font-medium text-[var(--text-primary)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-55"
            >
              <Wand2
                className="size-3.5 text-[var(--accent)]"
                aria-hidden="true"
              />
              <span>自动匹配</span>
            </button>
          )}
          {onRepreview && needsRepreview && (
            <button
              type="button"
              disabled={disabled || repreviewBusy}
              onClick={onRepreview}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--badge-blue-border)] bg-[var(--badge-blue-bg)] px-3 text-[12px] font-semibold text-[var(--badge-blue-text)] transition-colors hover:brightness-95 disabled:opacity-55"
            >
              <RefreshCw
                className={cn('size-3.5', repreviewBusy && 'macos-spinner')}
                aria-hidden="true"
              />
              <span>{repreviewBusy ? '重新校验中…' : '重新预览校验'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowOptional((prev) => !prev)}
            aria-expanded={showOptional}
            className="inline-flex h-8 items-center gap-1 rounded-xl border border-white/85 bg-white/65 px-2.5 text-[12px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-white hover:text-[var(--text-primary)]"
          >
            <span>
              {showOptional
                ? '收起可选字段'
                : `展开更多字段（+${optionalCount}）`}
            </span>
            {showOptional ? (
              <ChevronUp className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {mappingWarning && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-xl border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-3 py-2 text-[12px] text-[var(--badge-red-text)]"
        >
          <AlertCircle className="size-4 shrink-0 text-[var(--danger)]" />
          <span>{mappingWarning}</span>
        </div>
      )}

      <div
        role="region"
        aria-label="字段映射对照表"
        tabIndex={0}
        className="macos-thin-scrollbar overflow-x-auto rounded-2xl border border-white/82 bg-white/56 shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
      >
        <table className="w-full min-w-[540px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-[var(--table-divider)] bg-white/55 text-[11.5px] font-semibold text-[var(--text-secondary)]">
              <th scope="col" className="px-3.5 py-2.5">
                系统字段
              </th>
              <th scope="col" className="px-3.5 py-2.5">
                对应的 CSV 列
              </th>
              <th scope="col" className="px-3.5 py-2.5">
                示例值
              </th>
              <th scope="col" className="px-3.5 py-2.5 text-right">
                校验结果
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--table-divider)]">
            {visibleFields.map((field) => {
              const selectedColIdx = mapping[field.key];
              const selectedCol =
                typeof selectedColIdx === 'number'
                  ? columns.find((col) => col.index === selectedColIdx)
                  : undefined;

              const isDuplicate =
                typeof selectedColIdx === 'number' &&
                duplicateColumns.has(selectedColIdx);
              const isMissingRequired = field.required && !selectedCol;

              // 密码示例永远掩码显示
              const sampleDisplay = selectedCol
                ? field.key === 'password'
                  ? MASKED_PASSWORD_PLACEHOLDER
                  : maskFieldSample(field.key, selectedCol.sampleValue)
                : '—';

              return (
                <tr
                  key={field.key}
                  className="transition-colors hover:bg-white/55"
                >
                  <td className="px-3.5 py-2.5 align-middle">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-[var(--text-primary)]">
                        {field.label}
                      </span>
                      {field.required && (
                        <span
                          aria-label="必填"
                          title="必填字段"
                          className="font-semibold text-[var(--danger)]"
                        >
                          *
                        </span>
                      )}
                      {field.sensitive && (
                        <span
                          title="敏感字段始终掩码显示"
                          className="inline-flex items-center gap-0.5 rounded-md border border-[var(--badge-blue-border)] bg-[var(--badge-blue-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--badge-blue-text)]"
                        >
                          <Lock className="size-2.5" aria-hidden="true" />
                          掩码
                        </span>
                      )}
                    </div>
                  </td>

                  <td className="px-3.5 py-2.5 align-middle">
                    <select
                      aria-label={`${field.label}对应的 CSV 列`}
                      disabled={disabled || columns.length === 0}
                      value={
                        typeof selectedColIdx === 'number'
                          ? String(selectedColIdx)
                          : ''
                      }
                      onChange={(event) => {
                        const raw = event.target.value;
                        onMappingChange(
                          field.key,
                          raw === '' ? null : Number(raw),
                        );
                      }}
                      className={cn(
                        'h-8.5 w-full min-w-[156px] rounded-xl border px-2.5 text-[12.5px] font-medium text-[var(--text-primary)] transition-colors focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60',
                        isMissingRequired || isDuplicate
                          ? 'border-[var(--badge-red-border)] bg-[var(--badge-red-bg)]'
                          : 'border-[#b9d0ec]/80 bg-white/88',
                      )}
                    >
                      <option value="">不导入此字段</option>
                      {columns.map((col) => {
                        const owner = assignedByCol.get(col.index);
                        const ownedByOther =
                          Boolean(owner) && owner!.key !== field.key;
                        return (
                          <option
                            key={col.index}
                            value={String(col.index)}
                            disabled={ownedByOther}
                          >
                            {col.letter}: {col.header}
                            {ownedByOther ? `（已映射至 ${owner!.label}）` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </td>

                  <td className="max-w-[200px] px-3.5 py-2.5 align-middle">
                    <span
                      data-slot={
                        field.key === 'password'
                          ? 'password-sample-masked'
                          : 'field-sample-value'
                      }
                      className={cn(
                        'block truncate font-mono text-[12px]',
                        field.sensitive
                          ? 'tracking-wider text-[var(--text-secondary)]'
                          : 'text-[var(--text-primary)]/90',
                      )}
                    >
                      {sampleDisplay}
                    </span>
                  </td>

                  <td className="px-3.5 py-2.5 text-right align-middle whitespace-nowrap">
                    {isDuplicate ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--danger-text)]">
                        <AlertCircle className="size-3.5 text-[var(--danger)]" />
                        列映射冲突
                      </span>
                    ) : isMissingRequired ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--danger-text)]">
                        <AlertCircle className="size-3.5 text-[var(--danger)]" />
                        必填项未映射
                      </span>
                    ) : selectedCol ? (
                      <span className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--success-text)]">
                        <CheckCircle2
                          className="size-3.5 text-[var(--success)]"
                          aria-hidden="true"
                        />
                        {field.sensitive ? '已匹配 · 已掩码' : '已匹配'}
                      </span>
                    ) : (
                      <span className="text-[12px] text-[var(--text-secondary)]">
                        未映射（可选）
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
