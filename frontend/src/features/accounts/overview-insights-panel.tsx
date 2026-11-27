import { useMemo } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  Clock,
  Database,
  FileWarning,
  KeyRound,
  Link2,
  MailCheck,
  MailWarning,
  ShieldAlert,
  ShieldCheck,
  Tag,
  UserX,
} from 'lucide-react';
import type {
  AccountSummary,
  DashboardInsightsResponse,
} from '@/api/generated';
import { GlassPanel } from '@/components/macos';
import { cn } from '@/lib/utils';
import type { AccountStatsData } from './account-summary';

type RecoveryBarRow = {
  email: string;
  account_count: number;
  abnormal_count: number;
};

type RiskTodoCard = {
  id: string;
  title: string;
  count: number;
  hint: string;
  severity: 'danger' | 'warning' | 'info' | 'ok';
  icon: typeof ShieldAlert;
  query: Record<string, string>;
};

const BACKUP_STATE_LABELS: Record<
  DashboardInsightsResponse['backup_state'],
  { label: string; tone: 'ok' | 'warning' | 'danger' | 'neutral' }
> = {
  success: { label: '备份正常', tone: 'ok' },
  running: { label: '正在备份', tone: 'neutral' },
  stale: { label: '备份已过期（>36h）', tone: 'warning' },
  failed: { label: '最近备份失败', tone: 'danger' },
  never_run: { label: '尚未执行首次备份', tone: 'warning' },
  unconfigured: { label: '未配置主机备份状态文件', tone: 'neutral' },
};

const OFFSITE_LABELS: Record<
  NonNullable<DashboardInsightsResponse['backup_offsite']>,
  string
> = {
  success: '已同步异地',
  pending: '异地同步中',
  failed: '异地同步失败',
  unconfigured: '未配置异地目标',
};

function formatShortTimestamp(value?: string | null): string {
  if (!value) return '尚未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '尚未记录';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function normalizeEmailLocal(value: string): string {
  const cleaned = value.trim().toLowerCase();
  const atIdx = cleaned.lastIndexOf('@');
  if (atIdx <= 0) return cleaned;
  const rawLocal = cleaned.slice(0, atIdx);
  const rawDomain = cleaned.slice(atIdx + 1);
  if (rawDomain === 'gmail.com' || rawDomain === 'googlemail.com') {
    const base = rawLocal.split('+', 1)[0].replace(/\./g, '');
    return `${base}@gmail.com`;
  }
  return cleaned;
}

function computeLocalFallbackMetrics(
  items: AccountSummary[],
  stats: AccountStatsData,
) {
  const now = Date.now();
  const dayMs = 86_400_000;
  let disabled2fa = 0;
  let unverified30 = 0;
  let inactiveLogin90 = 0;
  let passwordStale180 = 0;
  let noRecovery = 0;
  let appRisk = 0;
  let noPurpose = 0;
  let noTags = 0;
  let inactiveWithActiveApps = 0;

  const internalMap = new Map<string, AccountSummary>();
  for (const acc of items) {
    if (!acc.deleted_at) {
      internalMap.set(normalizeEmailLocal(acc.gmail_email), acc);
    }
  }
  const externalDupMap = new Map<
    string,
    {
      email: string;
      account_count: number;
      matched_account_id: string;
      matched_account_no: string;
    }
  >();

  for (const item of items) {
    if (item.deleted_at) continue;
    const isArchived = item.status === 'archived';
    const regTs = Date.parse(item.registered_at);
    const verTs = Date.parse(item.last_verified_at ?? item.registered_at);
    const loginTs = Date.parse(item.last_login_at ?? item.registered_at);
    const pwdTs = Date.parse(item.password_changed_at ?? item.registered_at);

    if (!isArchived) {
      if (item.two_factor_status === 'disabled') disabled2fa += 1;
      if (Number.isFinite(verTs) && now - verTs > 30 * dayMs) unverified30 += 1;
      if (Number.isFinite(loginTs) && now - loginTs > 90 * dayMs) {
        inactiveLogin90 += 1;
      }
      if (
        Number.isFinite(pwdTs || regTs) &&
        now - (pwdTs || regTs) > 180 * dayMs
      ) {
        passwordStale180 += 1;
      }
      if (!item.recovery_email && !item.recovery_account_id) noRecovery += 1;
      if (!item.purpose || !item.purpose.trim()) noPurpose += 1;
      if (item.tags.length === 0) noTags += 1;
    }

    const apps = item.apps ?? [];
    if (apps.some((a) => a.status === 'restricted' || a.status === 'banned')) {
      appRisk += 1;
    }
    if (
      ['restricted', 'login_failed', 'disabled', 'archived'].includes(
        item.status,
      ) &&
      apps.some((a) => a.status === 'active')
    ) {
      inactiveWithActiveApps += 1;
    }

    if (item.recovery_email_external && item.recovery_email_external.trim()) {
      const extRaw = item.recovery_email_external.trim().toLowerCase();
      const matched = internalMap.get(normalizeEmailLocal(extRaw));
      if (matched) {
        const prev = externalDupMap.get(extRaw);
        externalDupMap.set(extRaw, {
          email: extRaw,
          account_count: (prev?.account_count ?? 0) + 1,
          matched_account_id: matched.id,
          matched_account_no: matched.account_no,
        });
      }
    }
  }

  return {
    disabled_2fa_count: disabled2fa,
    pending_verification_count: stats.pending ?? 0,
    risk_status_count: stats.risk,
    unverified_over_30_days: unverified30,
    inactive_login_over_90_days: inactiveLogin90,
    password_stale_over_180_days: passwordStale180,
    no_recovery_email_count: noRecovery,
    app_risk_account_count: appRisk,
    no_purpose_count: noPurpose,
    no_tags_count: noTags,
    inactive_with_active_apps_count: inactiveWithActiveApps,
    external_recovery_matches_internal: [...externalDupMap.values()].slice(
      0,
      5,
    ),
  };
}

export function OverviewInsightsPanel({
  stats,
  items,
  insights,
  recoveryBars,
  liveAnalytics = false,
  onDrillDown,
  onOpenRecoveryUsage,
  onOpenBackup,
  onOpenAudit,
}: {
  stats: AccountStatsData;
  items: AccountSummary[];
  insights?: DashboardInsightsResponse;
  recoveryBars: RecoveryBarRow[];
  liveAnalytics?: boolean;
  onDrillDown?: (query: Record<string, string>) => void;
  onOpenRecoveryUsage?: () => void;
  onOpenBackup?: () => void;
  onOpenAudit?: () => void;
}) {
  const localMetrics = useMemo(
    () => computeLocalFallbackMetrics(items, stats),
    [items, stats],
  );

  const m = insights ?? localMetrics;
  const concentratedList =
    insights?.concentrated_recovery_emails ??
    recoveryBars.filter(
      (entry) => entry.account_count >= 3 || entry.abnormal_count > 0,
    );
  const topConcentrated = concentratedList[0];

  const riskCards: RiskTodoCard[] = [
    {
      id: 'no-2fa',
      title: '未开启 2FA',
      count: m.disabled_2fa_count,
      hint: '建议补充 TOTP 或 Passkey',
      severity: m.disabled_2fa_count > 0 ? 'warning' : 'ok',
      icon: ShieldAlert,
      query: { two_factor_status: 'disabled' },
    },
    {
      id: 'risk-status',
      title: '受限 / 无法登录',
      count: m.risk_status_count,
      hint: '优先排查异常账号状态',
      severity: m.risk_status_count > 0 ? 'danger' : 'ok',
      icon: AlertTriangle,
      query: { statuses: 'restricted,login_failed' },
    },
    {
      id: 'pending',
      title: '待验证账号',
      count: m.pending_verification_count,
      hint: '人工核验后更新状态',
      severity: m.pending_verification_count > 0 ? 'info' : 'ok',
      icon: Clock,
      query: { status: 'pending_verification' },
    },
    {
      id: 'unverified-30d',
      title: '30 天未验证',
      count: m.unverified_over_30_days,
      hint: '长期未核验活跃账号',
      severity: m.unverified_over_30_days > 0 ? 'warning' : 'ok',
      icon: Clock,
      query: { unverified_over_days: '30' },
    },
    {
      id: 'no-recovery',
      title: '无辅助邮箱',
      count: m.no_recovery_email_count,
      hint: '缺少找回兜底邮箱',
      severity: m.no_recovery_email_count > 0 ? 'warning' : 'ok',
      icon: MailWarning,
      query: { has_recovery_email: 'false', archived: 'false' },
    },
    {
      id: 'app-risk',
      title: '关联应用异常',
      count: m.app_risk_account_count,
      hint: '含受限或已封禁应用',
      severity: m.app_risk_account_count > 0 ? 'danger' : 'ok',
      icon: ShieldAlert,
      query: { app_statuses: 'restricted,banned' },
    },
    {
      id: 'inactive-90d',
      title: '90 天未登录',
      count: m.inactive_login_over_90_days,
      hint: '检查闲置或失活风险',
      severity: m.inactive_login_over_90_days > 0 ? 'info' : 'ok',
      icon: UserX,
      query: { inactive_login_over_days: '90' },
    },
    {
      id: 'pwd-stale-180d',
      title: '180 天未改密',
      count: m.password_stale_over_180_days,
      hint: '评估凭据密码轮换计划',
      severity: m.password_stale_over_180_days > 0 ? 'info' : 'ok',
      icon: KeyRound,
      query: { password_stale_over_days: '180' },
    },
  ];

  const activeRiskBucketCount =
    riskCards.filter((card) => card.count > 0).length +
    (topConcentrated ? 1 : 0);

  const externalMatches = m.external_recovery_matches_internal ?? [];
  const qualityIssueTotal =
    m.no_purpose_count +
    m.no_tags_count +
    m.inactive_with_active_apps_count +
    externalMatches.length;

  const backupMeta = insights
    ? BACKUP_STATE_LABELS[insights.backup_state]
    : null;
  const recentAuthFailures = insights?.recent_auth_failures_7d ?? 0;
  const backupOffsite = insights?.backup_offsite ?? 'unconfigured';

  return (
    <>
      {/* 1. 风险待办中心 */}
      <GlassPanel
        variant="strong"
        aria-label="风险待办"
        data-slot="overview-risk-todos"
        className="p-4 lg:col-span-3"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[14.5px] font-semibold text-[var(--text-primary)]">
              风险待办中心
            </h2>
            <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
              基于已存储字段组合可执行风险视图，点击任意项直接下钻至对应筛选列表
            </p>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium tabular-nums',
              activeRiskBucketCount > 0
                ? 'border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)]'
                : 'border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]',
            )}
          >
            {activeRiskBucketCount > 0
              ? `${activeRiskBucketCount} 类待关注项`
              : '当前无高风险待办'}
          </span>
        </div>

        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {riskCards.map((card) => {
            const Icon = card.icon;
            const iconColor =
              card.severity === 'danger'
                ? 'text-[var(--danger)]'
                : card.severity === 'warning'
                  ? 'text-[var(--warning)]'
                  : card.severity === 'info'
                    ? 'text-[var(--accent)]'
                    : 'text-[var(--success)]';
            return (
              <button
                key={card.id}
                type="button"
                disabled={!onDrillDown}
                onClick={() => onDrillDown?.(card.query)}
                className="flex min-h-14 items-center justify-between gap-2.5 rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-3.5 py-2.5 text-left transition-colors hover:border-[var(--accent)]/35 hover:bg-[var(--surface-control-hover)] disabled:cursor-default"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Icon
                    className={cn('size-4 shrink-0', iconColor)}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                      {card.title}
                    </p>
                    <p className="truncate text-[11px] tabular-nums text-[var(--text-secondary)]">
                      {card.count} 个账号 · {card.hint}
                    </p>
                  </div>
                </div>
                <ArrowUpRight
                  className="size-3.5 shrink-0 text-[var(--text-secondary)]"
                  aria-hidden="true"
                />
              </button>
            );
          })}

          <button
            type="button"
            disabled={!onDrillDown && !onOpenRecoveryUsage}
            onClick={() => {
              if (topConcentrated && onDrillDown) {
                onDrillDown({ recovery_email: topConcentrated.email });
              } else {
                onOpenRecoveryUsage?.();
              }
            }}
            className="flex min-h-14 items-center justify-between gap-2.5 rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-3.5 py-2.5 text-left transition-colors hover:border-[var(--accent)]/35 hover:bg-[var(--surface-control-hover)] disabled:cursor-default sm:col-span-2 lg:col-span-3 xl:col-span-4"
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <MailCheck
                className={cn(
                  'size-4 shrink-0',
                  topConcentrated
                    ? 'text-[var(--warning)]'
                    : 'text-[var(--accent)]',
                )}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="truncate text-xs font-semibold text-[var(--text-primary)]">
                  {topConcentrated ? '高集中辅助邮箱警示' : '辅助邮箱分布排查'}
                </p>
                <p className="truncate text-[11px] tabular-nums text-[var(--text-secondary)]">
                  {topConcentrated
                    ? `${topConcentrated.email} 已关联 ${topConcentrated.account_count} 个账号${topConcentrated.abnormal_count > 0 ? `（含异常 ${topConcentrated.abnormal_count} 个）` : ''}，建议评估单点恢复风险`
                    : '当前无单地址高集中绑定，点击查看全部辅助邮箱统计'}
                </p>
              </div>
            </div>
            <ArrowUpRight
              className="size-3.5 shrink-0 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
          </button>
        </div>
      </GlassPanel>

      {/* 2. 数据质量体检与运维健康速览 */}
      <GlassPanel
        variant="strong"
        aria-label="数据质量与运维健康"
        data-slot="overview-quality-panel"
        className="p-4 lg:col-span-3"
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {/* 左侧 2 列：数据质量只读体检 */}
          <div className="space-y-3 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-[14.5px] font-semibold text-[var(--text-primary)]">
                  数据质量只读体检
                </h2>
                <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
                  巡检元数据缺失、状态与应用关系矛盾及重复外部辅助邮箱
                </p>
              </div>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11.5px] font-medium tabular-nums',
                  qualityIssueTotal > 0
                    ? 'border-[var(--badge-blue-border)] bg-[var(--badge-blue-bg)] text-[var(--badge-blue-text)]'
                    : 'border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]',
                )}
              >
                {qualityIssueTotal > 0
                  ? `发现 ${qualityIssueTotal} 处可整理项`
                  : '元数据完整一致'}
              </span>
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <button
                type="button"
                disabled={!onDrillDown}
                onClick={() =>
                  onDrillDown?.({
                    missing_metadata: 'no_purpose',
                    archived: 'false',
                  })
                }
                className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-3 py-2 text-left transition-colors hover:border-[var(--accent)]/35 hover:bg-[var(--surface-control-hover)] disabled:cursor-default"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <FileWarning
                    className="size-4 shrink-0 text-[var(--text-secondary)]"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[var(--text-primary)]">
                      缺少用途说明
                    </p>
                    <p className="text-[11px] tabular-nums text-[var(--text-secondary)]">
                      {m.no_purpose_count} 个账号
                    </p>
                  </div>
                </div>
                <ArrowUpRight
                  className="size-3.5 shrink-0 text-[var(--text-secondary)]"
                  aria-hidden="true"
                />
              </button>

              <button
                type="button"
                disabled={!onDrillDown}
                onClick={() =>
                  onDrillDown?.({
                    missing_metadata: 'no_tags',
                    archived: 'false',
                  })
                }
                className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-3 py-2 text-left transition-colors hover:border-[var(--accent)]/35 hover:bg-[var(--surface-control-hover)] disabled:cursor-default"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Tag
                    className="size-4 shrink-0 text-[var(--text-secondary)]"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[var(--text-primary)]">
                      缺少分类标签
                    </p>
                    <p className="text-[11px] tabular-nums text-[var(--text-secondary)]">
                      {m.no_tags_count} 个账号
                    </p>
                  </div>
                </div>
                <ArrowUpRight
                  className="size-3.5 shrink-0 text-[var(--text-secondary)]"
                  aria-hidden="true"
                />
              </button>

              <button
                type="button"
                disabled={!onDrillDown}
                onClick={() =>
                  onDrillDown?.({ conflict_check: 'inactive_with_active_apps' })
                }
                className="flex min-h-12 items-center justify-between gap-2 rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-3 py-2 text-left transition-colors hover:border-[var(--accent)]/35 hover:bg-[var(--surface-control-hover)] disabled:cursor-default"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <Link2
                    className={cn(
                      'size-4 shrink-0',
                      m.inactive_with_active_apps_count > 0
                        ? 'text-[var(--danger)]'
                        : 'text-[var(--success)]',
                    )}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-[var(--text-primary)]">
                      状态与应用矛盾
                    </p>
                    <p className="text-[11px] tabular-nums text-[var(--text-secondary)]">
                      {m.inactive_with_active_apps_count} 个账号
                    </p>
                  </div>
                </div>
                <ArrowUpRight
                  className="size-3.5 shrink-0 text-[var(--text-secondary)]"
                  aria-hidden="true"
                />
              </button>
            </div>

            {externalMatches.length > 0 ? (
              <div className="rounded-xl border border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)] px-3 py-2.5 text-xs">
                <p className="font-semibold text-[var(--badge-orange-text)]">
                  外部辅助邮箱与站内账号重复（建议改为关联站内账号）
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {externalMatches.map((dup) => (
                    <button
                      key={dup.email}
                      type="button"
                      disabled={!onDrillDown}
                      onClick={() =>
                        onDrillDown?.({ recovery_email: dup.email })
                      }
                      className="inline-flex min-h-6 items-center gap-1 rounded-full border border-[var(--badge-orange-border)] bg-white/80 px-2.5 py-0.5 text-[11.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-white"
                    >
                      <span className="truncate">{dup.email}</span>
                      <span className="font-mono text-[10.5px] text-[var(--text-secondary)]">
                        → {dup.matched_account_no} · {dup.account_count} 个
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <p className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
                <CheckCircle2
                  className="size-3.5 shrink-0 text-[var(--success)]"
                  aria-hidden="true"
                />
                <span>未发现外部辅助邮箱文本与站内 Gmail 主账号重复。</span>
              </p>
            )}
          </div>

          {/* 右侧 1 列：备份与安全运维信号 */}
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] p-3.5">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--text-primary)]">
                  <Database
                    className="size-3.5 text-[var(--accent)]"
                    aria-hidden="true"
                  />
                  <span>备份与安全运维</span>
                </span>
                {backupMeta && (
                  <span
                    className={cn(
                      'rounded-full border px-2 py-0.5 text-[10.5px] font-medium',
                      backupMeta.tone === 'ok'
                        ? 'border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]'
                        : backupMeta.tone === 'danger'
                          ? 'border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]'
                          : backupMeta.tone === 'warning'
                            ? 'border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)]'
                            : 'border-[var(--surface-control-border)] bg-white/70 text-[var(--text-secondary)]',
                    )}
                  >
                    {backupMeta.label}
                  </span>
                )}
              </div>

              {insights ? (
                <dl className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-[var(--text-secondary)]">
                      最近成功备份
                    </dt>
                    <dd className="font-medium tabular-nums text-[var(--text-primary)]">
                      {formatShortTimestamp(insights.backup_last_success_at)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-[var(--text-secondary)]">异地副本</dt>
                    <dd className="font-medium text-[var(--text-primary)]">
                      {OFFSITE_LABELS[backupOffsite]}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <dt className="text-[var(--text-secondary)]">
                      近 7 天认证失败
                    </dt>
                    <dd
                      className={cn(
                        'font-semibold tabular-nums',
                        recentAuthFailures > 0
                          ? 'text-[var(--warning)]'
                          : 'text-[var(--success-text)]',
                      )}
                    >
                      {recentAuthFailures} 次
                    </dd>
                  </div>
                  <p className="pt-1 text-[11px] leading-4 text-[var(--text-secondary)]">
                    备份存在不代表可直接恢复，请定期执行主机离线恢复演练校验解密完整性。
                  </p>
                </dl>
              ) : (
                <p className="text-xs leading-5 text-[var(--text-secondary)]">
                  {liveAnalytics
                    ? '正在读取服务端备份与安全审计状态…'
                    : '实时部署模式下展示主机备份状态、异地副本与近 7 天认证失败统计。'}
                </p>
              )}
            </div>

            {(onOpenBackup || onOpenAudit) && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {onOpenBackup && (
                  <button
                    type="button"
                    onClick={onOpenBackup}
                    className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-white/80 bg-white/75 px-2.5 py-1 text-[11.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-white"
                  >
                    <ShieldCheck
                      className="size-3 text-[var(--accent)]"
                      aria-hidden="true"
                    />
                    <span>备份与恢复</span>
                  </button>
                )}
                {onOpenAudit && (
                  <button
                    type="button"
                    onClick={onOpenAudit}
                    className="inline-flex min-h-7 items-center gap-1 rounded-lg border border-white/80 bg-white/75 px-2.5 py-1 text-[11.5px] font-medium text-[var(--text-primary)] transition-colors hover:bg-white"
                  >
                    <span>审计日志</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </GlassPanel>
    </>
  );
}
