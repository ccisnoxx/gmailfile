import * as React from 'react';
import { cn } from '@/lib/utils';

type StatTone = 'blue' | 'green' | 'orange' | 'slate';

const iconToneClasses: Record<StatTone, string> = {
  blue: 'bg-[#eaf3ff] text-[#1677ff]',
  green: 'bg-[#e7f8ef] text-[#2fbf71]',
  orange: 'bg-[#fef3df] text-[#f5a623]',
  slate: 'bg-[#eef2f7] text-[#667085]',
};

const trendToneClasses: Record<StatTone, string> = {
  blue: 'text-[#0f62df]',
  green: 'text-[#116b3b]',
  orange: 'text-[#8a5000]',
  slate: 'text-[#526074]',
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
          'inline-flex size-10 shrink-0 items-center justify-center rounded-xl border border-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]',
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
          <span className="text-[26px] leading-none font-bold tracking-tight tabular-nums text-[var(--text-primary)]">
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
    'macos-glass-panel macos-glass-interactive w-full px-4 py-3.5 text-left',
    active &&
      'border-[#1677ff]/35 bg-white/78 shadow-[0_10px_28px_rgba(22,119,255,0.12)]',
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        data-slot="stat-card"
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
