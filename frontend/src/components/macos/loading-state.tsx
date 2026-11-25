import { cn } from '@/lib/utils';

export function LoadingState({
  title = '正在加载账号列表…',
  description = '正在从数据库获取账号数据，请稍候…',
  className,
}: {
  title?: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      data-slot="loading-state"
      role="status"
      aria-busy="true"
      className={cn(
        'macos-glass-panel flex flex-col items-center justify-center px-6 py-9 text-center',
        className,
      )}
    >
      <div className="relative mb-4 size-12" aria-hidden="true">
        <svg viewBox="0 0 48 48" className="macos-spinner size-12">
          <circle
            cx="24"
            cy="24"
            r="18"
            fill="none"
            stroke="rgba(22, 119, 255, 0.16)"
            strokeWidth="3.2"
          />
          <path
            d="M24 6 A18 18 0 0 1 42 24"
            fill="none"
            stroke="#1677FF"
            strokeWidth="3.2"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <h3 className="text-[16px] font-semibold tracking-tight text-[var(--text-primary)]">
        {title}
      </h3>
      <p className="mt-1.5 max-w-sm text-[13px] leading-5 text-[var(--text-secondary)]">
        {description}
      </p>
    </div>
  );
}
