import type { AccountSummary } from '@/api/generated';
import { GlassPanel, TagPill } from '@/components/macos';
import type { AccountStatsData } from './account-summary';

export function AccountsChartView({
  stats,
  items,
  onOpenRecoveryUsage,
}: {
  stats: AccountStatsData;
  items: AccountSummary[];
  onOpenRecoveryUsage?: () => void;
}) {
  const total = Math.max(1, stats.all);
  const statusBars = [
    {
      label: '正常账号',
      count: stats.normal,
      color: 'bg-[var(--success)]',
    },
    {
      label: '风险账号',
      count: stats.risk,
      color: 'bg-[var(--warning)]',
    },
    {
      label: '停用账号',
      count: stats.disabled,
      color: 'bg-[#7c8798]',
    },
    {
      label: '已归档',
      count: stats.archived,
      color: 'bg-[#98a2b3]',
    },
  ];

  const enabled2fa = items.filter(
    (item) => item.two_factor_status === 'enabled',
  ).length;
  const totalVisible = Math.max(1, items.length);
  const twoFaRatio = Math.round((enabled2fa / totalVisible) * 100);
  const circumference = 2 * Math.PI * 42;
  const strokeOffset = circumference * (1 - twoFaRatio / 100);

  const tagFrequency = new Map<string, number>();
  for (const account of items) {
    for (const tag of account.tags) {
      tagFrequency.set(tag.name, (tagFrequency.get(tag.name) ?? 0) + 1);
    }
  }
  const tagEntries = [...tagFrequency.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <section
      aria-label="账号数据图表视图"
      data-slot="accounts-chart-view"
      className="grid gap-4 lg:grid-cols-3"
    >
      <GlassPanel variant="strong" className="p-5 lg:col-span-2">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              账号状态分布
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              按全局统计口径展示正常、风险、停用与已归档占比
            </p>
          </div>
          {onOpenRecoveryUsage && (
            <button
              type="button"
              onClick={onOpenRecoveryUsage}
              className="rounded-xl border border-white/80 bg-white/70 px-3 py-1.5 text-xs font-medium text-[var(--accent)] transition-colors hover:bg-white"
            >
              辅助邮箱使用情况
            </button>
          )}
        </div>
        <div className="space-y-4">
          {statusBars.map((bar) => {
            const pct = Math.round((bar.count / total) * 100);
            return (
              <div key={bar.label} className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-[var(--text-primary)]">
                    {bar.label}
                  </span>
                  <span className="tabular-nums text-[var(--text-secondary)]">
                    {bar.count} ({pct}%)
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[#dce9f9]">
                  <div
                    className={`h-full rounded-full transition-all duration-[200ms] ease-out ${bar.color}`}
                    style={{ width: `${Math.min(100, pct)}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </GlassPanel>

      <GlassPanel
        variant="strong"
        className="flex flex-col justify-between p-5"
      >
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
            双重验证 (2FA) 覆盖率
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            当前列表样本启用情况
          </p>
        </div>
        <div className="my-5 flex items-center justify-center">
          <div className="relative flex size-28 items-center justify-center">
            <svg viewBox="0 0 100 100" className="size-28 -rotate-90">
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="rgba(22, 119, 255, 0.14)"
                strokeWidth="9"
              />
              <circle
                cx="50"
                cy="50"
                r="42"
                fill="none"
                stroke="var(--success)"
                strokeWidth="9"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeOffset}
              />
            </svg>
            <div className="absolute text-center">
              <p className="text-xl font-bold tabular-nums text-[var(--text-primary)]">
                {twoFaRatio}%
              </p>
              <p className="text-[11px] text-[var(--text-secondary)]">已启用</p>
            </div>
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">
            高频标签
          </p>
          <div className="flex flex-wrap gap-1.5">
            {tagEntries.length > 0 ? (
              tagEntries.map(([name, count]) => (
                <TagPill key={name} name={`${name} · ${count}`} />
              ))
            ) : (
              <span className="text-xs text-[var(--text-secondary)]">
                暂无标签分布数据
              </span>
            )}
          </div>
        </div>
      </GlassPanel>
    </section>
  );
}
