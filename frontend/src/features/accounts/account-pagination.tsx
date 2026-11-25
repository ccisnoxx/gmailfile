import type { AccountPage } from '@/api/generated';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import type { AccountLocationChange } from './query-state';

export function Pagination({
  page,
  page_size,
  total,
  change,
  busy = false,
  fixedSize = false,
  max_page_size = 100,
}: Pick<AccountPage, 'page' | 'page_size' | 'total'> & {
  change: AccountLocationChange;
  busy?: boolean;
  fixedSize?: boolean;
  max_page_size?: number;
}) {
  const totalPages = Math.max(1, Math.ceil(total / page_size));
  return (
    <nav
      aria-label="分页"
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <span aria-live="polite">
        共 {total} 条 · 第 {page} / {totalPages} 页
      </span>
      <div className="flex items-center gap-2">
        {!fixedSize && (
          <label>
            每页
            <NativeSelect
              aria-label="每页条数"
              value={page_size}
              onChange={(e) => change({ page_size: e.target.value })}
            >
              {[...new Set([page_size, 30, 50, 100])]
                .filter((n) => n <= max_page_size)
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </NativeSelect>
          </label>
        )}
        {page > totalPages && (
          <Button variant="outline" onClick={() => change({ page: '1' })}>
            回到第一页
          </Button>
        )}
        <Button
          variant="outline"
          disabled={busy || page <= 1}
          onClick={() => change({ page: String(page - 1) })}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          disabled={busy || page * page_size >= total}
          onClick={() => change({ page: String(page + 1) })}
        >
          下一页
        </Button>
      </div>
    </nav>
  );
}
