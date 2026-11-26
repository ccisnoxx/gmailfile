import * as React from 'react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export function IconTooltip({
  label,
  children,
  side = 'bottom',
  align = 'center',
  disabled = false,
  className,
}: {
  label: string;
  children: React.ReactNode;
  side?: 'top' | 'bottom';
  align?: 'center' | 'start' | 'end';
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  useEffect(() => clearTimer, []);

  useEffect(() => {
    if (disabled) {
      clearTimer();
      setOpen(false);
    }
  }, [disabled]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearTimer();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const showWithDelay = () => {
    if (disabled) return;
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      setOpen(true);
      timerRef.current = null;
    }, 90);
  };

  const hideNow = () => {
    clearTimer();
    setOpen(false);
  };

  const visible = open && !disabled;

  const positionClass =
    side === 'top'
      ? align === 'end'
        ? 'bottom-full right-0 mb-2'
        : align === 'start'
          ? 'bottom-full left-0 mb-2'
          : 'bottom-full left-1/2 mb-2 -translate-x-1/2'
      : align === 'end'
        ? 'top-full right-0 mt-2'
        : align === 'start'
          ? 'top-full left-0 mt-2'
          : 'top-full left-1/2 mt-2 -translate-x-1/2';

  const arrowClass =
    side === 'top'
      ? align === 'end'
        ? '-bottom-1 right-3.5'
        : align === 'start'
          ? '-bottom-1 left-3.5'
          : '-bottom-1 left-1/2 -translate-x-1/2'
      : align === 'end'
        ? '-top-1 right-3.5'
        : align === 'start'
          ? '-top-1 left-3.5'
          : '-top-1 left-1/2 -translate-x-1/2';

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={showWithDelay}
      onMouseLeave={hideNow}
      onMouseDown={hideNow}
      onFocus={(e) => {
        if (!disabled && e.target.matches(':focus-visible')) {
          clearTimer();
          setOpen(true);
        }
      }}
      onBlur={hideNow}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          data-slot="icon-tooltip"
          className={cn(
            'macos-tooltip pointer-events-none absolute z-50 inline-flex items-center rounded-lg px-2.5 py-1 text-[12px] leading-tight font-medium whitespace-nowrap select-none',
            positionClass,
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'macos-tooltip-arrow pointer-events-none absolute size-2 rotate-45',
              arrowClass,
            )}
          />
          <span className="relative z-10">{label}</span>
        </span>
      )}
    </span>
  );
}
