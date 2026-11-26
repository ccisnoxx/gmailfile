import * as React from 'react';
import { cn } from '@/lib/utils';

type StatTone = 'blue' | 'green' | 'orange' | 'slate';

const iconToneClasses: Record<StatTone, string> = {
  blue: 'bg-[var(--badge-blue-bg)] text-[var(--badge-blue-text)] border-[var(--badge-blue-border)]',
  green:
    'bg-[var(--badge-green-bg)] text-[var(--badge-green-text)] border-[var(--badge-green-border)]',
  orange:
    'bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)] border-[var(--badge-orange-border)]',
  slate:
    'bg-[var(--badge-gray-bg)] text-[var(--badge-gray-text)] border-[var(--badge-gray-border)]',
};

const trendToneClasses: Record<StatTone, string> = {
  blue: 'text-[var(--badge-blue-text)]',
  green: 'text-[var(--badge-green-text)]',
  orange: 'text-[var(--badge-orange-text)]',
  slate: 'text-[var(--badge-gray-text)]',
};

export function StatCard({
  icon,
  title,
  value,
  trend,
  tone = 'blue',
  active = false,
  onClick,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  value: number | string;
  trend?: string;
  tone?: StatTone;
  active?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const content = (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          'inline-flex size-10 shrink-0 items-center justify-center rounded-xl border',
          iconToneClasses[tone],
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-[var(--text-secondary)]">
          {title}
        </p>
        <div className="mt-1 flex flex-wrap items-baseline gap-2">
          <span className="text-[24px] leading-none font-bold tracking-tight tabular-nums text-[var(--text-primary)]">
            {value}
          </span>
          {trend && (
            <span
              className={cn(
                'text-[11px] font-medium whitespace-nowrap',
                trendToneClasses[tone],
              )}
            >
              {trend}
            </span>
          )}
        </div>
      </div>
    </div>
  );

  const sharedClasses = cn(
    'macos-glass-panel macos-glass-interactive w-full px-3.5 py-3 text-left',
    active &&
      'border-[var(--accent)]/45 bg-[var(--surface-selected)] shadow-[0_10px_28px_rgba(22,119,255,0.12)]',
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        data-slot="stat-card"
        aria-pressed={active}
        onClick={onClick}
        className={sharedClasses}
      >
        {content}
      </button>
    );
  }

  return (
    <div data-slot="stat-card" className={sharedClasses}>
      {content}
    </div>
  );
}
