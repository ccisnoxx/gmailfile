import { useContext, useMemo, useState } from 'react';
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  dashboardInsights,
  dashboardRecoveryEmailUsage,
  dashboardRegistrationTrend,
  dashboardStatusDistribution,
  type AccountSummary,
  type DashboardInsightsResponse,
  type DashboardRecoveryUsageResponse,
  type RegistrationTrendResponse,
  type StatusDistributionResponse,
} from '@/api/generated';
import {
  GlassPanel,
  TagPill,
  type SidebarSectionKey,
} from '@/components/macos';
import { Summary, type AccountStatsData } from './account-summary';
import { factorLabels, statusLabels } from './constants';
import { OverviewInsightsPanel } from './overview-insights-panel';

const STATUS_COLORS: Record<string, string> = {
  normal: 'var(--success)',
  pending_verification: 'var(--accent)',
  restricted: 'var(--warning)',
  login_failed: 'var(--danger)',
  disabled: '#7c8798',
  archived: '#98a2b3',
};

const FACTOR_COLORS: Record<string, string> = {
  enabled: 'var(--success)',
  disabled: 'var(--warning)',
  unknown: '#98a2b3',
};

function monthRangeQuery(fullMonth: string): Record<string, string> | null {
  const match = /^(\d{4})-(\d{2})$/.exec(fullMonth);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const lastDay = new Date(year, month, 0).getDate();
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}

type AccountsChartViewProps = {
  stats: AccountStatsData;
  items: AccountSummary[];
  insights?: DashboardInsightsResponse;
  csrfToken?: string;
  liveAnalytics?: boolean;
  timezone?: string;
  activeSection?: SidebarSectionKey | null;
  onSelectSection?: (section: SidebarSectionKey) => void;
  onDrillDown?: (query: Record<string, string>) => void;
  onOpenRecoveryUsage?: () => void;
  onOpenBackup?: () => void;
  onOpenAudit?: () => void;
};

export function AccountsChartView(props: AccountsChartViewProps) {
  const queryClient = useContext(QueryClientContext);
  if (props.liveAnalytics && queryClient) {
    return <LiveAccountsChartView {...props} />;
  }
  return <AccountsChartBody {...props} />;
}

function LiveAccountsChartView(props: AccountsChartViewProps) {
  const { timezone = 'UTC' } = props;
  const [trendMonths, setTrendMonths] = useState<6 | 12>(12);

  const trendQuery = useQuery({
    queryKey: ['dashboard-registration-trend', timezone, trendMonths],
    queryFn: async ({ signal }) =>
      (
        await dashboardRegistrationTrend({
          query: { timezone, months: trendMonths },
          signal,
          throwOnError: true,
        })
      ).data,
  });

  const distributionQuery = useQuery({
    queryKey: ['dashboard-status-distribution'],
    queryFn: async ({ signal }) =>
      (await dashboardStatusDistribution({ signal, throwOnError: true })).data,
  });

  const recoveryChartQuery = useQuery({
    queryKey: ['dashboard-recovery-email-usage'],
    queryFn: async ({ signal }) =>
      (
        await dashboardRecoveryEmailUsage({
          query: { limit: 6 },
          signal,
          throwOnError: true,
        })
      ).data,
  });

  const insightsQuery = useQuery({
    queryKey: ['dashboard-insights'],
    queryFn: async ({ signal }) =>
      (await dashboardInsights({ signal, throwOnError: true })).data,
  });

  const analyticsError =
    trendQuery.isError ||
    distributionQuery.isError ||
    recoveryChartQuery.isError ||
    insightsQuery.isError;
  const analyticsPending =
    trendQuery.isPending ||
    distributionQuery.isPending ||
    recoveryChartQuery.isPending ||
    insightsQuery.isPending;

  return (
    <AccountsChartBody
      {...props}
      insights={props.insights ?? insightsQuery.data}
      trendMonths={trendMonths}
      onTrendMonthsChange={setTrendMonths}
      trendDataResp={trendQuery.data}
      distributionResp={distributionQuery.data}
      recoveryResp={recoveryChartQuery.data}
      analyticsPending={analyticsPending}
      analyticsError={analyticsError}
      onRetryAnalytics={() => {
        void Promise.all([
          trendQuery.refetch(),
          distributionQuery.refetch(),
          recoveryChartQuery.refetch(),
          insightsQuery.refetch(),
        ]);
      }}
    />
  );
}

function AccountsChartBody({
  stats,
  items,
  insights,
  csrfToken,
  liveAnalytics = false,
  timezone = 'UTC',
  activeSection,
  onSelectSection,
  onDrillDown,
  onOpenRecoveryUsage,
  onOpenBackup,
  onOpenAudit,
  trendMonths = 12,
  onTrendMonthsChange,
  trendDataResp,
  distributionResp,
  recoveryResp,
  analyticsPending = false,
  analyticsError = false,
  onRetryAnalytics,
}: AccountsChartViewProps & {
  trendMonths?: 6 | 12;
  onTrendMonthsChange?: (m: 6 | 12) => void;
  trendDataResp?: RegistrationTrendResponse;
  distributionResp?: StatusDistributionResponse;
  recoveryResp?: DashboardRecoveryUsageResponse;
  analyticsPending?: boolean;
  analyticsError?: boolean;
  onRetryAnalytics?: () => void;
}) {
  // 状态分布（优先全库聚合接口，演示模式回退 stats）
  const statusData = useMemo(() => {
    if (distributionResp) {
      return distributionResp.statuses.map((entry) => ({
        key: entry.status,
        label: statusLabels[entry.status] ?? entry.status,
        count: entry.count,
        fill: STATUS_COLORS[entry.status] ?? 'var(--accent)',
      }));
    }
    return [
      {
        key: 'normal',
        label: '正常',
        count: stats.normal,
        fill: STATUS_COLORS.normal,
      },
      ...(stats.pending !== undefined
        ? [
            {
              key: 'pending_verification',
              label: '待验证',
              count: stats.pending,
              fill: STATUS_COLORS.pending_verification,
            },
          ]
        : []),
      {
        key: 'restricted',
        label: '异常 / 风险',
        count: stats.risk,
        fill: STATUS_COLORS.restricted,
      },
      {
        key: 'disabled',
        label: '已停用',
        count: stats.disabled,
        fill: STATUS_COLORS.disabled,
      },
      {
        key: 'archived',
        label: '已归档',
        count: stats.archived,
        fill: STATUS_COLORS.archived,
      },
    ];
  }, [distributionResp, stats]);

  // 2FA 分布（优先全库聚合接口）
  const twoFactorData = useMemo(() => {
    if (distributionResp) {
      return distributionResp.two_factor.map((entry) => ({
        key: entry.two_factor_status,
        label: factorLabels[entry.two_factor_status] ?? entry.two_factor_status,
        count: entry.count,
        fill: FACTOR_COLORS[entry.two_factor_status] ?? '#98a2b3',
      }));
    }
    const counts = { enabled: 0, disabled: 0, unknown: 0 };
    for (const item of items) {
      counts[item.two_factor_status] =
        (counts[item.two_factor_status] ?? 0) + 1;
    }
    return (['enabled', 'disabled', 'unknown'] as const).map((k) => ({
      key: k,
      label: factorLabels[k],
      count: counts[k],
      fill: FACTOR_COLORS[k],
    }));
  }, [distributionResp, items]);

  const twoFaDenominator = distributionResp
    ? distributionResp.total
    : items.length;
  const enabled2faCount =
    twoFactorData.find((entry) => entry.key === 'enabled')?.count ?? 0;
  const twoFaRatio =
    twoFaDenominator > 0
      ? Math.round((enabled2faCount / twoFaDenominator) * 100)
      : 0;

  // 注册趋势数据（优先全库聚合接口，演示模式按样本月份构造）
  const trendData = useMemo(() => {
    if (trendDataResp) {
      return trendDataResp.items.map((pt) => ({
        month: pt.month.slice(2),
        fullMonth: pt.month,
        count: pt.count,
        cumulative: pt.cumulative,
      }));
    }
    const bucket = new Map<string, number>();
    for (const item of items) {
      const m = item.registered_at.slice(0, 7);
      bucket.set(m, (bucket.get(m) ?? 0) + 1);
    }
    const sorted = [...bucket.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    let running = 0;
    return sorted.map(([m, c]) => {
      running += c;
      return { month: m.slice(2), fullMonth: m, count: c, cumulative: running };
    });
  }, [trendDataResp, items]);

  // 高频标签
  const topTags = useMemo(() => {
    if (distributionResp) {
      return distributionResp.top_tags;
    }
    const freq = new Map<string, number>();
    for (const account of items) {
      for (const tag of account.tags) {
        freq.set(tag.name, (freq.get(tag.name) ?? 0) + 1);
      }
    }
    return [...freq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ id: name, name, count }));
  }, [distributionResp, items]);

  // 辅助邮箱 Top 分布
  const recoveryBars = useMemo(() => {
    if (recoveryResp) {
      return recoveryResp.items.map((item) => ({
        email: item.email,
        account_count: item.account_count,
        abnormal_count: item.abnormal_count,
      }));
    }
    const map = new Map<string, number>();
    for (const item of items) {
      if (item.recovery_email) {
        map.set(item.recovery_email, (map.get(item.recovery_email) ?? 0) + 1);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([email, count]) => ({
        email,
        account_count: count,
        abnormal_count: 0,
      }));
  }, [recoveryResp, items]);

  const recentActiveMonths = trendData
    .filter((pt) => pt.count > 0)
    .slice(-3)
    .reverse();

  const drillDownStatus = (statusKey: string) => {
    if (!onDrillDown) return;
    if (statusKey === 'archived') {
      onDrillDown({ archived: 'true' });
      return;
    }
    onDrillDown({ status: statusKey });
  };

  return (
    <section
      aria-label="账号数据图表视图"
      data-slot="accounts-chart-view"
      className="grid gap-4 lg:grid-cols-3"
    >
      <div className="lg:col-span-3">
        <Summary
          stats={stats}
          activeSection={activeSection}
          onSelectSection={onSelectSection}
        />
      </div>

      <OverviewInsightsPanel
        stats={stats}
        items={items}
        insights={insights}
        csrfToken={csrfToken}
        recoveryBars={recoveryBars}
        liveAnalytics={liveAnalytics}
        onDrillDown={onDrillDown}
        onOpenRecoveryUsage={onOpenRecoveryUsage}
        onOpenBackup={onOpenBackup}
        onOpenAudit={onOpenAudit}
      />

      {analyticsError && onRetryAnalytics && (
        <div
          role="alert"
          className="macos-glass-panel flex flex-wrap items-center justify-between gap-2 border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-4 py-2.5 text-xs text-[var(--badge-red-text)] lg:col-span-3"
        >
          <span>部分全局分析数据加载失败，当前已回退本地样本统计。</span>
          <button
            type="button"
            onClick={onRetryAnalytics}
            className="rounded-lg border border-current px-2.5 py-1 font-medium transition-opacity hover:opacity-80"
          >
            重试加载
          </button>
        </div>
      )}
      {analyticsPending && liveAnalytics && !analyticsError && (
        <p
          role="status"
          className="text-xs text-[var(--text-secondary)] lg:col-span-3"
        >
          正在同步全局分析图表数据…
        </p>
      )}
      {/* 1. 注册趋势面积图 */}
      <GlassPanel variant="strong" className="p-5 lg:col-span-2">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              账号注册趋势
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              {liveAnalytics
                ? `全局未删除账号近 ${trendMonths} 个月按月新增走势（${timezone}）`
                : '当前展示样本注册趋势'}
            </p>
          </div>
          {liveAnalytics && onTrendMonthsChange && (
            <div
              role="group"
              aria-label="趋势时间范围"
              className="inline-flex rounded-xl border border-[var(--border)] bg-white/55 p-0.5 text-xs"
            >
              {([6, 12] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  aria-pressed={trendMonths === m}
                  onClick={() => onTrendMonthsChange(m)}
                  className={
                    trendMonths === m
                      ? 'rounded-[9px] bg-[var(--accent)] px-2.5 py-1 font-medium text-[var(--primary-foreground)]'
                      : 'rounded-[9px] px-2.5 py-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }
                >
                  近 {m} 月
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="h-[220px] w-full min-w-0">
          {trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220} minWidth={220}>
              <AreaChart
                data={trendData}
                margin={{ top: 8, right: 12, left: -18, bottom: 0 }}
                onClick={(state) => {
                  const fullMonth =
                    typeof state?.activeLabel === 'string'
                      ? trendData.find((d) => d.month === state.activeLabel)
                          ?.fullMonth
                      : undefined;
                  if (!fullMonth || !onDrillDown) return;
                  const range = monthRangeQuery(fullMonth);
                  if (range) onDrillDown(range);
                }}
              >
                <defs>
                  <linearGradient id="gmTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="5%"
                      stopColor="var(--accent)"
                      stopOpacity={0.35}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--accent)"
                      stopOpacity={0.02}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--table-divider)"
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--modal-bg)',
                    borderColor: 'var(--border)',
                    borderRadius: '12px',
                    color: 'var(--text-primary)',
                    fontSize: '12px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="count"
                  name="当月新增"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  fill="url(#gmTrendFill)"
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <p className="py-12 text-center text-xs text-[var(--text-secondary)]">
              暂无注册趋势数据
            </p>
          )}
        </div>
        {onDrillDown && recentActiveMonths.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-[var(--text-secondary)]">按月下钻：</span>
            {recentActiveMonths.map((pt) => {
              const range = monthRangeQuery(pt.fullMonth);
              if (!range) return null;
              return (
                <button
                  key={pt.fullMonth}
                  type="button"
                  onClick={() => onDrillDown(range)}
                  className="inline-flex min-h-6 items-center gap-1 rounded-full border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-2.5 py-0.5 text-[11.5px] font-medium tabular-nums text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)]"
                >
                  <span>{pt.fullMonth}</span>
                  <span className="text-[var(--text-secondary)]">
                    ({pt.count})
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </GlassPanel>

      {/* 2. 全局 2FA 覆盖率环图 + 高频标签 */}
      <GlassPanel
        variant="strong"
        className="flex flex-col justify-between p-5"
      >
        <div>
          <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
            双重验证 (2FA) 覆盖率
          </h2>
          <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
            {liveAnalytics
              ? '点击任意分组下钻查看对应 2FA 状态账号'
              : '当前列表样本启用情况'}
          </p>
        </div>

        <div className="relative my-2 flex h-[170px] items-center justify-center">
          <ResponsiveContainer width="100%" height={170} minWidth={160}>
            <PieChart>
              <Pie
                data={twoFactorData}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={68}
                paddingAngle={2}
                isAnimationActive={false}
                onClick={(entry) => {
                  const key = (entry as { key?: string })?.key;
                  if (key && onDrillDown) {
                    onDrillDown({ two_factor_status: key });
                  }
                }}
              >
                {twoFactorData.map((entry) => (
                  <Cell
                    key={entry.key}
                    fill={entry.fill}
                    className={onDrillDown ? 'cursor-pointer' : undefined}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--modal-bg)',
                  borderColor: 'var(--border)',
                  borderRadius: '12px',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute text-center">
            <p className="text-xl font-bold tabular-nums text-[var(--text-primary)]">
              {twoFaRatio}%
            </p>
            <p className="text-[11px] text-[var(--text-secondary)]">已启用</p>
          </div>
        </div>

        <div
          role="group"
          aria-label="按二步验证状态下钻"
          className="mb-3 grid grid-cols-3 gap-1 text-center text-xs"
        >
          {twoFactorData.map((item) => (
            <button
              key={item.key}
              type="button"
              disabled={!onDrillDown}
              aria-label={`筛选 2FA ${item.label}：${item.count}`}
              onClick={() => onDrillDown?.({ two_factor_status: item.key })}
              className="rounded-lg bg-[var(--muted)] px-1.5 py-1.5 transition-colors hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)] disabled:cursor-default"
            >
              <span className="block text-[10.5px] text-[var(--text-secondary)]">
                {item.label}
              </span>
              <span className="font-semibold tabular-nums text-[var(--text-primary)]">
                {item.count}
              </span>
            </button>
          ))}
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-[var(--text-secondary)]">
            高频标签
          </p>
          <div className="flex flex-wrap gap-1.5">
            {topTags.length > 0 ? (
              topTags.map((tag) =>
                onDrillDown ? (
                  <button
                    key={tag.id}
                    type="button"
                    aria-label={`筛选标签 ${tag.name}`}
                    onClick={() => onDrillDown({ tag: tag.id })}
                    className="inline-flex min-h-6 items-center rounded-full transition-opacity hover:opacity-85"
                  >
                    <TagPill name={`${tag.name} · ${tag.count}`} />
                  </button>
                ) : (
                  <TagPill key={tag.id} name={`${tag.name} · ${tag.count}`} />
                ),
              )
            ) : (
              <span className="text-xs text-[var(--text-secondary)]">
                暂无标签分布数据
              </span>
            )}
          </div>
        </div>
      </GlassPanel>

      {/* 3. 全局账号状态分布柱状图 */}
      <GlassPanel variant="strong" className="p-5 lg:col-span-2">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              账号状态分布
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              按全局统计口径展示各状态数量，点击柱条或下方标签可下钻至列表
            </p>
          </div>
        </div>
        <div className="h-[220px] w-full min-w-0">
          <ResponsiveContainer width="100%" height={220} minWidth={220}>
            <BarChart
              data={statusData}
              margin={{ top: 8, right: 12, left: -18, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--table-divider)"
              />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: 'var(--text-secondary)' }}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'var(--modal-bg)',
                  borderColor: 'var(--border)',
                  borderRadius: '12px',
                  color: 'var(--text-primary)',
                  fontSize: '12px',
                }}
              />
              <Bar
                dataKey="count"
                name="账号数量"
                radius={[8, 8, 0, 0]}
                isAnimationActive={false}
                onClick={(entry) => {
                  const key = (entry as { key?: string })?.key;
                  if (key) drillDownStatus(key);
                }}
              >
                {statusData.map((entry) => (
                  <Cell
                    key={entry.key}
                    fill={entry.fill}
                    className={onDrillDown ? 'cursor-pointer' : undefined}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        {/* 无障碍文字摘要 + 键盘下钻入口 */}
        <ul
          aria-label="状态分布快捷下钻"
          className="mt-3 flex flex-wrap gap-1.5 text-xs text-[var(--text-secondary)]"
        >
          {statusData.map((entry) => (
            <li key={entry.key}>
              {onDrillDown ? (
                <button
                  type="button"
                  onClick={() => drillDownStatus(entry.key)}
                  className="inline-flex min-h-6 items-center gap-1 rounded-full border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-2.5 py-0.5 tabular-nums text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)]"
                >
                  {entry.label}：{entry.count}
                </button>
              ) : (
                <span className="tabular-nums">
                  {entry.label}：{entry.count}
                </span>
              )}
            </li>
          ))}
        </ul>
      </GlassPanel>

      {/* 4. 辅助邮箱 Top 集中度 */}
      <GlassPanel variant="strong" className="p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
              辅助邮箱集中度 Top
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              点击辅助邮箱条目直接查看关联账号
            </p>
          </div>
          {onOpenRecoveryUsage && (
            <button
              type="button"
              onClick={onOpenRecoveryUsage}
              className="text-xs font-medium text-[var(--accent)] hover:underline"
            >
              查看全部
            </button>
          )}
        </div>
        {recoveryBars.length > 0 ? (
          <div className="space-y-2">
            {recoveryBars.map((row) => {
              const maxCount = Math.max(1, recoveryBars[0]?.account_count ?? 1);
              const pct = Math.round((row.account_count / maxCount) * 100);
              return (
                <button
                  key={row.email}
                  type="button"
                  disabled={!onDrillDown}
                  aria-label={`筛选辅助邮箱 ${row.email}，关联 ${row.account_count} 个账号`}
                  onClick={() => onDrillDown?.({ recovery_email: row.email })}
                  className="block w-full space-y-1 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-control-hover)] disabled:cursor-default"
                >
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span
                      className="truncate font-medium text-[var(--text-primary)]"
                      title={row.email}
                    >
                      {row.email}
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--text-secondary)]">
                      {row.account_count} 个
                      {row.abnormal_count > 0
                        ? `（异常 ${row.abnormal_count}）`
                        : ''}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[var(--muted)]">
                    <div
                      className="h-full rounded-full bg-[var(--accent)]"
                      style={{ width: `${Math.max(6, pct)}%` }}
                    />
                  </div>
                </button>
              );
            })}
            {recoveryResp && recoveryResp.others_count > 0 && (
              <p className="pt-1 text-xs text-[var(--text-secondary)]">
                其余辅助邮箱共关联 {recoveryResp.others_count} 个账号。
              </p>
            )}
          </div>
        ) : (
          <p className="py-10 text-center text-xs text-[var(--text-secondary)]">
            暂无辅助邮箱分布数据
          </p>
        )}
      </GlassPanel>
    </section>
  );
}
