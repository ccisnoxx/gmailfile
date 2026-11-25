import { Copy, Layers } from 'lucide-react';
import type { AccountDetail } from '@/api/generated';
import { GlassPanel } from '@/components/macos';
import { cn } from '@/lib/utils';
import { formatDetailDateTime } from './detail-mock-fixtures';

export function AccountOverviewCard({
  account,
  updateSource = '管理员（本地控制台）',
  onCopyId,
  className,
}: {
  account: AccountDetail;
  updateSource?: string;
  onCopyId: (id: string) => void;
  className?: string;
}) {
  return (
    <GlassPanel
      variant="strong"
      data-slot="account-overview-card"
      aria-label="账号概览"
      className={cn('rounded-[18px] p-[var(--detail-pad,20px)]', className)}
    >
      <div className="mb-3.5 flex items-center gap-2">
        <Layers className="size-4 text-[var(--accent)]" aria-hidden="true" />
        <h2 className="text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          账号概览
        </h2>
      </div>

      <dl className="divide-y divide-[var(--table-divider)] text-[13px]">
        <div className="flex items-center justify-between gap-3 py-2.5 first:pt-0">
          <dt className="shrink-0 text-[var(--text-secondary)]">记录 ID</dt>
          <dd className="flex min-w-0 items-center gap-1.5">
            <span
              className="truncate font-mono text-[12.5px] font-medium text-[var(--text-primary)]"
              title={account.id}
            >
              {account.id}
            </span>
            <button
              type="button"
              aria-label="复制记录 ID"
              title="复制记录 ID"
              onClick={() => onCopyId(account.id)}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-white/80 hover:text-[var(--accent)]"
            >
              <Copy className="size-3.5" aria-hidden="true" />
            </button>
          </dd>
        </div>

        <div className="flex items-center justify-between gap-3 py-2.5">
          <dt className="shrink-0 text-[var(--text-secondary)]">当前版本</dt>
          <dd>
            <span
              data-slot="account-version-pill"
              className="inline-flex items-center rounded-full border border-[#14b8a6]/28 bg-[#e6f7f2] px-2.5 py-0.5 text-xs font-semibold tabular-nums text-[#0f8a6c]"
            >
              v{account.row_version}
            </span>
          </dd>
        </div>

        <div className="flex items-center justify-between gap-3 py-2.5">
          <dt className="shrink-0 text-[var(--text-secondary)]">创建时间</dt>
          <dd className="text-right font-medium tabular-nums text-[var(--text-primary)]">
            {formatDetailDateTime(account.created_at, true)}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-3 py-2.5">
          <dt className="shrink-0 text-[var(--text-secondary)]">最后更新</dt>
          <dd className="text-right font-medium tabular-nums text-[var(--text-primary)]">
            {formatDetailDateTime(account.updated_at, true)}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-3 pt-2.5 pb-0">
          <dt className="shrink-0 text-[var(--text-secondary)]">更新来源</dt>
          <dd className="text-right font-medium text-[var(--text-primary)]">
            {updateSource}
          </dd>
        </div>
      </dl>
    </GlassPanel>
  );
}
