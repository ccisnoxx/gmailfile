import { AlertTriangle, Inbox, RefreshCw } from 'lucide-react';
import { GlassPanel } from '@/components/macos';
import { cn } from '@/lib/utils';
import type { CardStateMode } from './types';

export function SettingsCardShell({
  id,
  title,
  subtitle,
  icon,
  headerRight,
  state = 'ready',
  loadingText = '正在读取配置…',
  errorText = '数据加载失败，请手动重试。',
  emptyTitle = '暂无记录',
  emptyDescription = '当前没有可展示的配置项。',
  onRetry,
  className,
  children,
}: {
  id?: string;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  headerRight?: React.ReactNode;
  state?: CardStateMode;
  loadingText?: string;
  errorText?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  onRetry?: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <GlassPanel
      id={id}
      variant="strong"
      className={cn(
        'flex min-w-0 flex-col gap-4 rounded-[18px] p-[var(--detail-pad,20px)]',
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--table-divider)] pb-3.5">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon && (
            <span
              aria-hidden="true"
              className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]"
            >
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <h2 className="text-[18px] leading-snug font-semibold tracking-tight text-[var(--text-primary)]">
              {title}
            </h2>
            {subtitle && (
              <p className="mt-0.5 text-[12.5px] leading-5 text-[var(--text-secondary)]">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {headerRight && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {headerRight}
          </div>
        )}
      </div>

      {state === 'loading' ? (
        <div
          role="status"
          aria-busy="true"
          className="flex flex-col items-center justify-center gap-2.5 rounded-2xl border border-white/70 bg-white/40 px-4 py-7 text-center"
        >
          <span
            aria-hidden="true"
            className="macos-spinner size-6 rounded-full border-2 border-[#1677ff]/20 border-t-[var(--accent)]"
          />
          <p className="text-[13px] font-medium text-[var(--text-secondary)]">
            {loadingText}
          </p>
        </div>
      ) : state === 'error' ? (
        <div
          role="alert"
          className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-[#e45d5d]/28 bg-[#e45d5d]/[0.07] px-4 py-4 sm:flex-row sm:items-center"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle
              className="mt-0.5 size-4 shrink-0 text-[#c54646]"
              aria-hidden="true"
            />
            <div className="space-y-0.5">
              <p className="text-[13px] font-semibold text-[#a83838]">
                读取失败
              </p>
              <p className="text-[12.5px] leading-5 text-[#8f2e2e]/90">
                {errorText}
              </p>
            </div>
          </div>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl border border-[#e45d5d]/30 bg-white/75 px-3 text-[12.5px] font-medium text-[#b84040] transition-colors hover:bg-white"
            >
              <RefreshCw className="size-3.5" aria-hidden="true" />
              <span>重试</span>
            </button>
          )}
        </div>
      ) : state === 'empty' ? (
        <div className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border border-white/70 bg-white/38 px-4 py-7 text-center">
          <Inbox
            className="size-6 text-[var(--text-secondary)]/75"
            aria-hidden="true"
          />
          <p className="text-[13.5px] font-semibold text-[var(--text-primary)]">
            {emptyTitle}
          </p>
          <p className="max-w-xs text-[12.5px] leading-5 text-[var(--text-secondary)]">
            {emptyDescription}
          </p>
        </div>
      ) : (
        children
      )}
    </GlassPanel>
  );
}
