import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Clock,
  Mail,
  PauseCircle,
} from 'lucide-react';
import { StatCard, type SidebarSectionKey } from '@/components/macos';

export type AccountStatsData = {
  all: number;
  normal: number;
  pending?: number;
  addedThisMonth: number;
  risk: number;
  disabled: number;
  archived: number;
};

export function Summary({
  stats,
  activeSection,
  onSelectSection,
}: {
  stats: AccountStatsData;
  activeSection?: SidebarSectionKey | null;
  onSelectSection?: (section: SidebarSectionKey) => void;
}) {
  const showPending = stats.pending !== undefined;
  return (
    <section
      aria-label="账号全局统计"
      className={
        showPending
          ? 'grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-6'
          : 'grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-5'
      }
    >
      <StatCard
        icon={<Mail className="size-[18px]" aria-hidden="true" />}
        title="全部账号"
        value={stats.all}
        trend={
          stats.addedThisMonth > 0
            ? `↑ +${stats.addedThisMonth} 本月`
            : undefined
        }
        tone="blue"
        active={activeSection === 'all'}
        onClick={onSelectSection ? () => onSelectSection('all') : undefined}
      />
      <StatCard
        icon={<CheckCircle2 className="size-[18px]" aria-hidden="true" />}
        title="正常账号"
        value={stats.normal}
        tone="green"
        active={activeSection === 'normal'}
        onClick={onSelectSection ? () => onSelectSection('normal') : undefined}
      />
      {showPending && (
        <StatCard
          icon={<Clock className="size-[18px]" aria-hidden="true" />}
          title="待验证"
          value={stats.pending ?? 0}
          tone="blue"
          active={activeSection === 'pending'}
          onClick={
            onSelectSection ? () => onSelectSection('pending') : undefined
          }
        />
      )}
      <StatCard
        icon={<AlertTriangle className="size-[18px]" aria-hidden="true" />}
        title="风险账号"
        value={stats.risk}
        tone="orange"
        active={activeSection === 'risk'}
        onClick={onSelectSection ? () => onSelectSection('risk') : undefined}
      />
      <StatCard
        icon={<PauseCircle className="size-[18px]" aria-hidden="true" />}
        title="停用账号"
        value={stats.disabled}
        tone="slate"
        active={activeSection === 'disabled'}
        onClick={
          onSelectSection ? () => onSelectSection('disabled') : undefined
        }
      />
      <StatCard
        icon={<Archive className="size-[18px]" aria-hidden="true" />}
        title="已归档"
        value={stats.archived}
        tone="slate"
        active={activeSection === 'archived'}
        onClick={
          onSelectSection ? () => onSelectSection('archived') : undefined
        }
      />
    </section>
  );
}

export function AccountStatusStrip({
  stats,
  activeSection,
  onSelectSection,
}: {
  stats: AccountStatsData;
  activeSection?: SidebarSectionKey | null;
  onSelectSection?: (section: SidebarSectionKey) => void;
}) {
  const showPending = stats.pending !== undefined;
  const items: Array<{
    key: SidebarSectionKey;
    label: string;
    count: number;
    dotClass: string;
  }> = [
    {
      key: 'all',
      label: '全部账号',
      count: stats.all,
      dotClass: 'bg-[var(--accent)]',
    },
    {
      key: 'normal',
      label: '正常账号',
      count: stats.normal,
      dotClass: 'bg-[var(--success)]',
    },
    ...(showPending
      ? [
          {
            key: 'pending' as const,
            label: '待验证',
            count: stats.pending ?? 0,
            dotClass: 'bg-[#f5a623]',
          },
        ]
      : []),
    {
      key: 'risk',
      label: '风险账号',
      count: stats.risk,
      dotClass: 'bg-[var(--warning)]',
    },
    {
      key: 'disabled',
      label: '停用账号',
      count: stats.disabled,
      dotClass: 'bg-[#98a2b3]',
    },
    {
      key: 'archived',
      label: '已归档',
      count: stats.archived,
      dotClass: 'border border-[#8492a6] bg-transparent',
    },
  ];

  return (
    <section
      aria-label="账号全局统计"
      data-slot="account-status-strip"
      className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-2.5 py-1.5"
    >
      <div
        className="flex flex-wrap items-center gap-1"
        role="group"
        aria-label="按状态快速切换"
      >
        {items.map((item) => {
          const active = activeSection === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-pressed={active}
              onClick={() => onSelectSection?.(item.key)}
              className={
                active
                  ? 'inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-[var(--accent)]/30 bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-text)] transition-colors'
                  : 'inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-transparent px-2.5 py-1 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]'
              }
            >
              <span
                aria-hidden="true"
                className={`size-1.5 shrink-0 rounded-full ${item.dotClass}`}
              />
              <span>{item.label}</span>
              <span className="tabular-nums opacity-85">{item.count}</span>
            </button>
          );
        })}
      </div>
      {stats.addedThisMonth > 0 && (
        <span className="px-2 text-[11.5px] font-medium tabular-nums text-[var(--success-text)]">
          本月新增 +{stats.addedThisMonth}
        </span>
      )}
    </section>
  );
}
