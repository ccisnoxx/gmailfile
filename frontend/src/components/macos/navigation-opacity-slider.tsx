import { useId } from 'react';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';

export const NAV_ALPHA_STORAGE_KEY = 'gm_nav_alpha';
export const NAV_ALPHA_SYNC_EVENT = 'gm:nav-alpha-change';
export const DEFAULT_NAV_ALPHA = 60;
export const SETTINGS_DEFAULT_NAV_ALPHA = 70;
export const DETAIL_DEFAULT_NAV_ALPHA = 72;
export const MIN_NAV_ALPHA = 35;
export const MAX_NAV_ALPHA = 90;

export function clampNavAlpha(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_NAV_ALPHA;
  return Math.min(MAX_NAV_ALPHA, Math.max(MIN_NAV_ALPHA, Math.round(value)));
}

export function readStoredNavAlpha(fallback = DEFAULT_NAV_ALPHA): number {
  try {
    const raw = window.localStorage.getItem(NAV_ALPHA_STORAGE_KEY);
    if (raw === null) return clampNavAlpha(fallback);
    return clampNavAlpha(Number(raw));
  } catch {
    return clampNavAlpha(fallback);
  }
}

export function persistNavAlpha(value: number): void {
  const clamped = clampNavAlpha(value);
  try {
    window.localStorage.setItem(NAV_ALPHA_STORAGE_KEY, String(clamped));
  } catch {
    /* 浏览器隐私模式可能禁用存储，静默降级为会话内生效。 */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<number>(NAV_ALPHA_SYNC_EVENT, { detail: clamped }),
    );
  }
}

export function subscribeNavAlpha(
  onUpdate: (value: number) => void,
  fallback = DEFAULT_NAV_ALPHA,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handleStorage = (event: StorageEvent) => {
    if (event.key === NAV_ALPHA_STORAGE_KEY) {
      onUpdate(readStoredNavAlpha(fallback));
    }
  };
  const handleSync = (event: Event) => {
    const detail = (event as CustomEvent<number>).detail;
    if (typeof detail === 'number') {
      onUpdate(clampNavAlpha(detail));
    }
  };
  window.addEventListener('storage', handleStorage);
  window.addEventListener(NAV_ALPHA_SYNC_EVENT, handleSync);
  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(NAV_ALPHA_SYNC_EVENT, handleSync);
  };
}

export function NavigationOpacitySlider({
  value,
  onChange,
  variant = 'toolbar',
  label,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  variant?: 'toolbar' | 'popover' | 'card' | 'sidebar';
  label?: string;
  className?: string;
}) {
  const id = useId();
  const clamped = clampNavAlpha(value);
  const progress =
    ((clamped - MIN_NAV_ALPHA) / (MAX_NAV_ALPHA - MIN_NAV_ALPHA)) * 100;
  const resolvedLabel =
    label ?? (variant === 'sidebar' ? '界面透明度' : '导航栏毛玻璃透明度');

  if (variant === 'sidebar') {
    return (
      <div
        data-slot="navigation-opacity-slider"
        className={cn(
          'rounded-2xl border border-white/75 bg-white/52 px-3 py-2.5 shadow-[0_6px_18px_rgba(45,86,138,0.06),inset_0_1px_0_rgba(255,255,255,0.85)]',
          className,
        )}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <label
            htmlFor={id}
            className="text-[11.5px] font-medium text-[var(--text-primary)]"
          >
            {resolvedLabel}
          </label>
          <span
            data-slot="nav-alpha-value"
            className="text-[11.5px] font-semibold tabular-nums text-[#1158c7]"
          >
            {clamped}%
          </span>
        </div>
        <input
          id={id}
          type="range"
          min={MIN_NAV_ALPHA}
          max={MAX_NAV_ALPHA}
          step={1}
          value={clamped}
          aria-label={resolvedLabel}
          aria-valuetext={`${clamped}%`}
          onChange={(e) => onChange(clampNavAlpha(Number(e.target.value)))}
          style={{
            background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${progress}%, rgba(148, 178, 214, 0.38) ${progress}%, rgba(148, 178, 214, 0.38) 100%)`,
          }}
          className="macos-slider w-full"
        />
      </div>
    );
  }

  if (variant === 'card') {
    return (
      <div
        data-slot="navigation-opacity-slider"
        className={cn('space-y-2.5', className)}
      >
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={id}
            className="text-[13.5px] font-medium text-[var(--text-primary)]"
          >
            {resolvedLabel}
          </label>
          <span
            data-slot="nav-alpha-value"
            className="rounded-full border border-[#1677ff]/20 bg-[var(--accent-soft)] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[#1158c7]"
          >
            {clamped}%
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[11px] tabular-nums text-[var(--text-secondary)]">
            {MIN_NAV_ALPHA}%
          </span>
          <input
            id={id}
            type="range"
            min={MIN_NAV_ALPHA}
            max={MAX_NAV_ALPHA}
            step={1}
            value={clamped}
            aria-label={resolvedLabel}
            aria-valuetext={`${clamped}%`}
            onChange={(e) => onChange(clampNavAlpha(Number(e.target.value)))}
            style={{
              background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${progress}%, rgba(148, 178, 214, 0.38) ${progress}%, rgba(148, 178, 214, 0.38) 100%)`,
            }}
            className="macos-slider flex-1"
          />
          <span className="text-[11px] tabular-nums text-[var(--text-secondary)]">
            {MAX_NAV_ALPHA}%
          </span>
        </div>
      </div>
    );
  }

  if (variant === 'popover') {
    return (
      <div
        data-slot="navigation-opacity-slider"
        className={cn('flex items-start gap-3', className)}
      >
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent-text)]"
        >
          <Layers className="size-4" />
        </span>
        <div className="min-w-0 flex-1 space-y-2.5">
          <label
            htmlFor={id}
            className="block text-[13px] leading-none font-medium text-[var(--text-primary)]"
          >
            {resolvedLabel}
          </label>
          <div className="flex items-center gap-3">
            <input
              id={id}
              type="range"
              min={MIN_NAV_ALPHA}
              max={MAX_NAV_ALPHA}
              step={1}
              value={clamped}
              aria-label={resolvedLabel}
              aria-valuetext={`${clamped}%`}
              onChange={(e) => onChange(clampNavAlpha(Number(e.target.value)))}
              style={{
                background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${progress}%, rgba(148, 178, 214, 0.38) ${progress}%, rgba(148, 178, 214, 0.38) 100%)`,
              }}
              className="macos-slider flex-1"
            />
            <span
              data-slot="nav-alpha-value"
              className="w-10 text-right text-[13px] font-semibold tabular-nums text-[var(--text-primary)]"
            >
              {clamped}%
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-slot="navigation-opacity-slider"
      className={cn(
        'flex flex-col justify-center gap-1 rounded-[14px] border border-white/75 bg-white/55 px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-md 2xl:px-3',
        className,
      )}
    >
      <label
        htmlFor={id}
        className="text-[11px] leading-none font-medium tracking-tight text-[var(--text-primary)]"
      >
        {resolvedLabel}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="range"
          min={MIN_NAV_ALPHA}
          max={MAX_NAV_ALPHA}
          step={1}
          value={clamped}
          aria-label={resolvedLabel}
          aria-valuetext={`${clamped}%`}
          onChange={(e) => onChange(clampNavAlpha(Number(e.target.value)))}
          style={{
            background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${progress}%, rgba(148, 178, 214, 0.38) ${progress}%, rgba(148, 178, 214, 0.38) 100%)`,
          }}
          className="macos-slider w-24 2xl:w-32"
        />
        <span
          data-slot="nav-alpha-value"
          className="w-8 text-right text-xs font-semibold tabular-nums text-[var(--text-primary)]"
        >
          {clamped}%
        </span>
      </div>
    </div>
  );
}
