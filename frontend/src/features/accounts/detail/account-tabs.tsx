import { Database, History, KeyRound, Link2, User } from 'lucide-react';
import { GlassPanel } from '@/components/macos';
import { cn } from '@/lib/utils';

export type AccountDetailTabKey =
  'basic' | 'credentials' | 'contacts' | 'audit' | 'backups';

const tabItems: readonly {
  key: AccountDetailTabKey;
  label: string;
  icon: typeof User;
}[] = [
  { key: 'basic', label: '基本信息', icon: User },
  { key: 'credentials', label: '安全凭据', icon: KeyRound },
  { key: 'contacts', label: '关联账号与联系方式', icon: Link2 },
  { key: 'audit', label: '审计与活动', icon: History },
  { key: 'backups', label: '备份版本', icon: Database },
];

export function AccountTabs({
  activeTab,
  onChange,
  className,
}: {
  activeTab: AccountDetailTabKey;
  onChange: (tab: AccountDetailTabKey) => void;
  className?: string;
}) {
  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      const next = tabItems[(index + 1) % tabItems.length];
      onChange(next.key);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      const prev = tabItems[(index - 1 + tabItems.length) % tabItems.length];
      onChange(prev.key);
    }
  };

  return (
    <GlassPanel
      variant="strong"
      data-slot="account-tabs"
      className={cn('rounded-[16px] px-2 pt-1.5', className)}
    >
      <div
        role="tablist"
        aria-label="账号详情分区"
        className="macos-thin-scrollbar flex items-center gap-1 overflow-x-auto"
      >
        {tabItems.map(({ key, label, icon: Icon }, index) => {
          const active = activeTab === key;
          return (
            <button
              key={key}
              id={`account-tab-${key}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`account-tabpanel-${key}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(key)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={cn(
                'relative inline-flex h-10 shrink-0 items-center gap-2 rounded-t-xl px-3.5 text-[13px] whitespace-nowrap transition-all duration-[180ms] ease-out',
                active
                  ? 'bg-[#1677ff]/[0.08] font-semibold text-[var(--accent)]'
                  : 'font-medium text-[var(--text-secondary)] hover:bg-white/50 hover:text-[var(--text-primary)]',
              )}
            >
              <Icon
                className={cn(
                  'size-4 shrink-0',
                  active
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--text-secondary)]',
                )}
                aria-hidden="true"
              />
              <span>{label}</span>
              {active && (
                <span
                  aria-hidden="true"
                  className="absolute right-2.5 bottom-0 left-2.5 h-[2.5px] rounded-full bg-[var(--accent)]"
                />
              )}
            </button>
          );
        })}
      </div>
    </GlassPanel>
  );
}
