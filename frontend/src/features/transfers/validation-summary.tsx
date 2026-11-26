import { useId } from 'react';
import { Download } from 'lucide-react';
import { MacSwitch } from '@/components/macos';
import { cn } from '@/lib/utils';
import type { PreviewFilterStatus, ValidationCounts } from './types';

export function ValidationSummary({
  counts,
  activeFilter,
  anomaliesOnly,
  onFilterChange,
  onAnomaliesOnlyChange,
  onExportPreview,
  exportDisabled = false,
  exportLabel = '导出预览',
  className,
}: {
  counts: ValidationCounts;
  activeFilter: PreviewFilterStatus;
  anomaliesOnly: boolean;
  onFilterChange: (filter: PreviewFilterStatus) => void;
  onAnomaliesOnlyChange: (checked: boolean) => void;
  onExportPreview: () => void;
  exportDisabled?: boolean;
  exportLabel?: string;
  className?: string;
}) {
  const switchId = useId();

  const filters: readonly {
    key: PreviewFilterStatus;
    label: string;
    count: number;
    dotClass?: string;
    activeClass: string;
  }[] = [
    {
      key: 'all',
      label: '全部',
      count: counts.all,
      activeClass:
        'border-[var(--badge-blue-border)] bg-[var(--badge-blue-bg)] text-[var(--badge-blue-text)]',
    },
    {
      key: 'valid',
      label: '有效',
      count: counts.valid,
      dotClass: 'bg-[var(--success)]',
      activeClass:
        'border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]',
    },
    {
      key: 'warning',
      label: '警告',
      count: counts.warning,
      dotClass: 'bg-[var(--warning)]',
      activeClass:
        'border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)]',
    },
    {
      key: 'error',
      label: '错误',
      count: counts.error,
      dotClass: 'bg-[var(--danger)]',
      activeClass:
        'border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]',
    },
  ];

  return (
    <div
      data-slot="validation-summary"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3',
        className,
      )}
    >
      {/* 左侧状态筛选胶囊 */}
      <div
        role="group"
        aria-label="校验状态筛选"
        className="flex flex-wrap items-center gap-1.5"
      >
        {filters.map((item) => {
          const active = activeFilter === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => onFilterChange(item.key)}
              className={cn(
                'inline-flex h-8.5 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium transition-all duration-[180ms] ease-out',
                active
                  ? item.activeClass
                  : 'border-white/80 bg-white/58 text-[var(--text-primary)]/85 hover:bg-white/85',
              )}
            >
              {item.dotClass && (
                <span
                  aria-hidden="true"
                  className={cn('size-1.5 rounded-full', item.dotClass)}
                />
              )}
              <span>{item.label}</span>
              <span className="tabular-nums font-semibold">
                {item.count.toLocaleString('en-US')}
              </span>
            </button>
          );
        })}
      </div>

      {/* 右侧：仅显示异常开关 + 导出预览按钮 */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 rounded-full border border-white/80 bg-white/56 px-3 py-1.5">
          <label
            htmlFor={switchId}
            className="cursor-pointer text-[12.5px] font-medium text-[var(--text-primary)] select-none"
          >
            仅显示异常
          </label>
          <MacSwitch
            id={switchId}
            checked={anomaliesOnly}
            ariaLabel="仅显示异常"
            onCheckedChange={onAnomaliesOnlyChange}
          />
        </div>

        <button
          type="button"
          disabled={exportDisabled}
          onClick={onExportPreview}
          className="inline-flex h-8.5 items-center gap-1.5 rounded-xl border border-white/85 bg-white/74 px-3 text-[12.5px] font-medium text-[var(--text-primary)] shadow-[0_2px_8px_rgba(45,86,138,0.05),inset_0_1px_0_rgba(255,255,255,0.9)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-55"
        >
          <Download
            className="size-3.5 text-[var(--accent)]"
            aria-hidden="true"
          />
          <span>{exportLabel}</span>
        </button>
      </div>
    </div>
  );
}
