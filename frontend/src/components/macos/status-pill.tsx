import { Archive, PauseCircle } from 'lucide-react';
import type { AccountSummary } from '@/api/generated';
import { cn } from '@/lib/utils';

type StatusValue = AccountSummary['status'] | 'risk';

const statusConfig: Record<
  StatusValue,
  {
    label: string;
    className: string;
    kind:
      | 'dot-green'
      | 'dot-orange'
      | 'dot-red'
      | 'dot-amber'
      | 'archive'
      | 'disabled';
  }
> = {
  normal: {
    label: '正常',
    className:
      'bg-[var(--badge-green-bg)] text-[var(--badge-green-text)] border-[var(--badge-green-border)]',
    kind: 'dot-green',
  },
  restricted: {
    label: '受限',
    className:
      'bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)] border-[var(--badge-orange-border)]',
    kind: 'dot-orange',
  },
  login_failed: {
    label: '无法登录',
    className:
      'bg-[var(--badge-red-bg)] text-[var(--badge-red-text)] border-[var(--badge-red-border)]',
    kind: 'dot-red',
  },
  risk: {
    label: '风险',
    className:
      'bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)] border-[var(--badge-orange-border)]',
    kind: 'dot-orange',
  },
  pending_verification: {
    label: '待验证',
    className:
      'bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)] border-[var(--badge-orange-border)]',
    kind: 'dot-amber',
  },
  archived: {
    label: '已归档',
    className:
      'bg-[var(--badge-gray-bg)] text-[var(--badge-gray-text)] border-[var(--badge-gray-border)]',
    kind: 'archive',
  },
  disabled: {
    label: '停用',
    className:
      'bg-[var(--badge-gray-bg)] text-[var(--badge-gray-text)] border-[var(--badge-gray-border)]',
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
      {item.kind === 'dot-red' && (
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-[var(--danger)]"
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
