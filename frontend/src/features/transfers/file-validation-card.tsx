import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { FileValidationResult } from './types';

export function FileValidationCard({
  validation,
  className,
}: {
  validation: FileValidationResult;
  className?: string;
}) {
  return (
    <section
      data-slot="file-validation-card"
      aria-label="文件校验结果"
      className={cn(
        'rounded-2xl border border-white/82 bg-white/54 p-3.5 shadow-[0_4px_14px_rgba(45,86,138,0.05),inset_0_1px_0_rgba(255,255,255,0.88)]',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--table-divider)] pb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          {validation.passed ? (
            <CheckCircle2
              className="size-4 shrink-0 text-[var(--success)]"
              aria-hidden="true"
            />
          ) : (
            <XCircle
              className="size-4 shrink-0 text-[var(--danger)]"
              aria-hidden="true"
            />
          )}
          <h3 className="truncate text-[13px] font-semibold text-[var(--text-primary)]">
            {validation.headline}
          </h3>
        </div>
        <span className="shrink-0 rounded-full border border-[#b9d0ec]/65 bg-white/75 px-2 py-0.5 text-[10.5px] font-medium text-[var(--text-secondary)]">
          {validation.source === 'server' ? '服务端校验' : '客户端初检'}
        </span>
      </div>

      <ul className="mt-2.5 space-y-2">
        {validation.checks.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-2 text-[12px] leading-4.5 text-[var(--text-primary)]/90"
          >
            {item.status === 'pass' ? (
              <CheckCircle2
                className="mt-0.5 size-3.5 shrink-0 text-[var(--success)]"
                aria-hidden="true"
              />
            ) : item.status === 'warn' ? (
              <AlertTriangle
                className="mt-0.5 size-3.5 shrink-0 text-[var(--warning)]"
                aria-hidden="true"
              />
            ) : (
              <XCircle
                className="mt-0.5 size-3.5 shrink-0 text-[var(--danger)]"
                aria-hidden="true"
              />
            )}
            <div className="min-w-0 flex-1">
              <span className="block tabular-nums">{item.label}</span>
              {item.detail && (
                <span className="mt-0.5 block text-[11px] text-[var(--text-secondary)]">
                  {item.detail}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 border-t border-[var(--table-divider)] pt-2 text-[11px] leading-4 text-[var(--text-secondary)]">
        客户端仅做初步提示，服务端校验结果作为最终依据。
      </p>
    </section>
  );
}
