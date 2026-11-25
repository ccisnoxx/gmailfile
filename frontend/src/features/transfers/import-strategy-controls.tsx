import { useId } from 'react';
import { cn } from '@/lib/utils';
import type { ConflictResolutionOption, ImportStrategyOption } from './types';

export function ImportStrategyControls({
  strategy,
  conflictResolution,
  skipEmptyFields,
  disabled = false,
  onStrategyChange,
  onConflictResolutionChange,
  onSkipEmptyFieldsChange,
  className,
}: {
  strategy: ImportStrategyOption;
  conflictResolution: ConflictResolutionOption;
  skipEmptyFields: boolean;
  disabled?: boolean;
  onStrategyChange: (next: ImportStrategyOption) => void;
  onConflictResolutionChange: (next: ConflictResolutionOption) => void;
  onSkipEmptyFieldsChange: (checked: boolean) => void;
  className?: string;
}) {
  const strategyId = useId();
  const conflictId = useId();
  const skipEmptyId = useId();

  return (
    <div
      data-slot="import-strategy-controls"
      className={cn(
        'flex flex-wrap items-end gap-3 rounded-2xl border border-white/80 bg-white/46 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]',
        className,
      )}
    >
      <div className="min-w-[168px] flex-1 space-y-1">
        <label
          htmlFor={strategyId}
          className="block text-[11.5px] font-medium text-[var(--text-secondary)]"
        >
          导入策略
        </label>
        <select
          id={strategyId}
          value={strategy}
          disabled={disabled}
          onChange={(e) =>
            onStrategyChange(e.target.value as ImportStrategyOption)
          }
          className="h-9 w-full rounded-xl border border-[#b9d0ec]/80 bg-white/85 px-3 text-[13px] font-medium text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-colors focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="upsert">新增或更新</option>
          <option value="insert_only">仅新增（跳过已有）</option>
          <option value="strict_new">仅新增（重复拒绝整批）</option>
        </select>
      </div>

      <div className="min-w-[196px] flex-1 space-y-1">
        <label
          htmlFor={conflictId}
          className="block text-[11.5px] font-medium text-[var(--text-secondary)]"
        >
          冲突处理
        </label>
        <select
          id={conflictId}
          value={conflictResolution}
          disabled={disabled}
          onChange={(e) =>
            onConflictResolutionChange(
              e.target.value as ConflictResolutionOption,
            )
          }
          className="h-9 w-full rounded-xl border border-[#b9d0ec]/80 bg-white/85 px-3 text-[13px] font-medium text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] transition-colors focus:border-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
        >
          <option value="csv_overwrite">以 CSV 为准（覆盖更新）</option>
          <option value="keep_existing">保留现有数据（跳过冲突）</option>
          <option value="reject_batch">冲突时拒绝整批</option>
        </select>
      </div>

      <div className="flex min-h-9 items-center">
        <label
          htmlFor={skipEmptyId}
          className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/75 bg-white/62 px-3 py-2 text-[12.5px] font-medium text-[var(--text-primary)] select-none transition-colors hover:bg-white/85"
        >
          <input
            id={skipEmptyId}
            type="checkbox"
            checked={skipEmptyFields}
            disabled={disabled}
            onChange={(e) => onSkipEmptyFieldsChange(e.target.checked)}
            className="size-4 rounded border-[#9bb8dc] accent-[var(--accent)]"
          />
          <span>跳过空值字段（不覆盖原有数据）</span>
        </label>
      </div>
    </div>
  );
}
