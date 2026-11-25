import { Archive, PauseCircle } from 'lucide-react';
import type { AccountSummary } from '@/api/generated';
import { cn } from '@/lib/utils';

type StatusValue = AccountSummary['status'] | 'risk';

const statusConfig: Record<
  StatusValue,
  {
    label: string;
    className: string;
    kind: 'dot-green' | 'dot-orange' | 'dot-amber' | 'archive' | 'disabled';
  }
> = {
  normal: {
    label: '正常',
    className: 'bg-[#e7f8ef] text-[#116b3b] border-[#2fbf71]/25',
    kind: 'dot-green',
  },
  restricted: {
    label: '风险',
    className: 'bg-[#fef3df] text-[#8a5000] border-[#f5a623]/30',
    kind: 'dot-orange',
  },
  login_failed: {
    label: '风险',
    className: 'bg-[#fef3df] text-[#8a5000] border-[#f5a623]/30',
    kind: 'dot-orange',
  },
  risk: {
    label: '风险',
    className: 'bg-[#fef3df] text-[#8a5000] border-[#f5a623]/30',
    kind: 'dot-orange',
  },
  pending_verification: {
    label: '待验证',
    className: 'bg-[#fff7e6] text-[#8a5000] border-[#f5a623]/25',
    kind: 'dot-amber',
  },
  archived: {
    label: '已归档',
    className: 'bg-[#eef2f6] text-[#526074] border-[#98a2b3]/25',
    kind: 'archive',
  },
  disabled: {
    label: '停用',
    className: 'bg-[#eef2f6] text-[#526074] border-[#98a2b3]/25',
    kind: 'disabled',
  },
};

export function StatusPill({
  status,
  className,
}: {
  status: StatusValue;
  className?: string;
}) {
  const item = statusConfig[status] ?? statusConfig.disabled;
  return (
    <span
      data-slot="status-pill"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        item.className,
        className,
      )}
    >
      {item.kind === 'dot-green' && (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-[var(--success)]"
        />
      )}
      {item.kind === 'dot-orange' && (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-[var(--warning)]"
        />
      )}
      {item.kind === 'dot-amber' && (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-[#e5a229]"
        />
      )}
      {item.kind === 'archive' && (
        <Archive className="size-3 shrink-0" aria-hidden="true" />
      )}
      {item.kind === 'disabled' && (
        <PauseCircle className="size-3 shrink-0" aria-hidden="true" />
      )}
      <span>{item.label}</span>
    </span>
  );
}
