import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { AccountPage } from '@/api/generated';
import { cn } from '@/lib/utils';
import type { AccountLocationChange } from './query-state';

function visiblePages(current: number, totalPages: number): (number | '...')[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, '...', totalPages];
  }
  if (current >= totalPages - 3) {
    return [
      1,
      '...',
      totalPages - 4,
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages,
    ];
  }
  return [1, '...', current - 1, current, current + 1, '...', totalPages];
}

export function Pagination({
  page,
  page_size,
  total,
  selectedCount = 0,
  change,
  busy = false,
  fixedSize = false,
  max_page_size = 100,
}: Pick<AccountPage, 'page' | 'page_size' | 'total'> & {
  selectedCount?: number;
  change: AccountLocationChange;
  busy?: boolean;
  fixedSize?: boolean;
  max_page_size?: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / page_size));
  const pages = visiblePages(page, totalPages);
  const sizeOptions = [...new Set([page_size, 20, 30, 50, 100])]
    .filter((n) => n <= max_page_size)
    .sort((a, b) => a - b);

  return (
    <nav
      aria-label="分页"
      className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-secondary)]"
    >
      <div className="flex items-center gap-3">
        <span aria-live="polite" className="tabular-nums">
          已选择{' '}
          <strong className="font-semibold text-[var(--text-primary)]">
            {selectedCount}
          </strong>{' '}
          项，共{' '}
          <strong className="font-semibold text-[var(--text-primary)]">
            {total}
          </strong>{' '}
          项
        </span>
        <span className="hidden text-[11px] text-[var(--text-secondary)]/80 sm:inline">
          共 {total} 条 · 第 {page} / {totalPages} 页
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {!fixedSize && (
          <label className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <span>每页</span>
            <select
              aria-label="每页条数"
              value={page_size}
              onChange={(e) => change({ page_size: e.target.value })}
              className="h-7 rounded-lg border border-white/80 bg-white/75 px-2 text-xs font-medium text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            >
              {sizeOptions.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="上一页"
            disabled={busy || page <= 1}
            onClick={() => change({ page: String(page - 1) })}
            className="inline-flex size-7 items-center justify-center rounded-lg border border-white/80 bg-white/70 text-[var(--text-primary)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ChevronLeft className="size-3.5" aria-hidden="true" />
          </button>

          {pages.map((entry, index) =>
            entry === '...' ? (
              <span
                key={`ellipsis-${index}`}
                className="inline-flex size-7 items-center justify-center text-[var(--text-secondary)]"
              >
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                aria-current={entry === page ? 'page' : undefined}
                disabled={busy}
                onClick={() => change({ page: String(entry) })}
                className={cn(
                  'inline-flex h-7 min-w-7 items-center justify-center rounded-lg px-2 text-xs font-medium tabular-nums transition-all duration-[160ms] ease-out',
                  entry === page
                    ? 'bg-[var(--accent)] text-white shadow-[0_4px_12px_rgba(22,119,255,0.28)]'
                    : 'text-[var(--text-primary)] hover:bg-white/75',
                )}
              >
                {entry}
              </button>
            ),
          )}

          <button
            type="button"
            aria-label="下一页"
            disabled={busy || page >= totalPages}
            onClick={() => change({ page: String(page + 1) })}
            className="inline-flex size-7 items-center justify-center rounded-lg border border-white/80 bg-white/70 text-[var(--text-primary)] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
          >
            <ChevronRight className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </nav>
  );
}
