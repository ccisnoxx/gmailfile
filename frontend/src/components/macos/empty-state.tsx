import { Plus, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

export function EmptyState({
  title = '暂无账号',
  description = '还没有创建任何 Gmail 账号，点击下方按钮开始添加。',
  onCreate,
  onImportCsv,
  createLabel = '新建账号',
  role,
  className,
}: {
  title?: string;
  description?: string;
  onCreate?: () => void;
  onImportCsv?: () => void;
  createLabel?: string;
  role?: 'alert' | 'status';
  className?: string;
}) {
  return (
    <div
      data-slot="empty-state"
      role={role}
      className={cn(
        'macos-glass-panel flex flex-col items-center justify-center px-6 py-9 text-center',
        className,
      )}
    >
      {/* 简洁的淡蓝半透明打开盒子矢量图标 */}
      <svg
        viewBox="0 0 88 76"
        fill="none"
        aria-hidden="true"
        className="mb-3 h-16 w-20"
      >
        <ellipse
          cx="44"
          cy="68"
          rx="28"
          ry="4.5"
          fill="#6BA4E8"
          fillOpacity="0.18"
        />
        <path
          d="M21 29L44 21L67 29V57L44 65L21 57V29Z"
          fill="#EAF3FF"
          stroke="#9FC4F0"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M44 37V65"
          stroke="#9FC4F0"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M21 29L44 37L67 29"
          stroke="#9FC4F0"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M21 29L10 21L33 13L44 21L21 29Z"
          fill="#FFFFFF"
          fillOpacity="0.82"
          stroke="#9FC4F0"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
        <path
          d="M67 29L78 21L55 13L44 21L67 29Z"
          fill="#DCEEFF"
          fillOpacity="0.9"
          stroke="#9FC4F0"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>

      <h3 className="text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">
        {title}
      </h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-5 text-[var(--text-secondary)]">
        {description}
      </p>

      {(onCreate || onImportCsv) && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
          {onCreate && (
            <button
              type="button"
              onClick={onCreate}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-white shadow-[0_6px_16px_rgba(22,119,255,0.26)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-[var(--accent-hover)]"
            >
              <Plus className="size-4" aria-hidden="true" />
              <span>{createLabel}</span>
            </button>
          )}
          {onImportCsv && (
            <button
              type="button"
              onClick={onImportCsv}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/80 bg-white/70 px-4 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_4px_12px_rgba(45,86,138,0.06)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/90"
            >
              <Upload className="size-3.5" aria-hidden="true" />
              <span>导入 CSV</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
