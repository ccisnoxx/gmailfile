import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Mail,
  PauseCircle,
} from 'lucide-react';
import { StatCard, type SidebarSectionKey } from '@/components/macos';

export type AccountStatsData = {
  all: number;
  normal: number;
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
  return (
    <section
      aria-label="账号全局统计"
      className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-5"
    >
      <StatCard
        icon={<Mail className="size-[18px]" aria-hidden="true" />}
        title="全部账号"
        value={stats.all}
        tone="blue"
        active={activeSection === 'all'}
        onClick={onSelectSection ? () => onSelectSection('all') : undefined}
      />
      <StatCard
        icon={<CheckCircle2 className="size-[18px]" aria-hidden="true" />}
        title="正常账号"
        value={stats.normal}
        trend={
          stats.addedThisMonth > 0
            ? `↑ +${stats.addedThisMonth} 本月`
            : undefined
        }
        tone="green"
        active={activeSection === 'normal'}
        onClick={onSelectSection ? () => onSelectSection('normal') : undefined}
      />
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
