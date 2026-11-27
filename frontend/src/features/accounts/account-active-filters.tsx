import { X } from 'lucide-react';
import type { RegisteredAppResponse, TagResponse } from '@/api/generated';
import { cn } from '@/lib/utils';
import { appStatusLabels, factorLabels, statusLabels } from './constants';
import type { AccountLocationChange } from './query-state';

const SORT_FIELD_LABELS: Record<string, string> = {
  account_no: '账号编号',
  registered_at: '注册时间',
  last_verified_at: '最后验证',
  last_login_at: '最后活动',
  created_at: '创建时间',
  updated_at: '更新时间',
};

function formatSortLabel(rawSort: string): string {
  const desc = rawSort.startsWith('-');
  const field = desc ? rawSort.slice(1) : rawSort;
  const label = SORT_FIELD_LABELS[field] ?? field;
  return `${label} ${desc ? '↓' : '↑'}`;
}

type FilterChip = {
  id: string;
  label: string;
  removeLabel: string;
  tone: 'blue' | 'orange' | 'red' | 'green' | 'slate';
  onRemove: () => void;
};

const TONE_CLASS: Record<FilterChip['tone'], string> = {
  blue: 'border-[var(--badge-blue-border)] bg-[var(--badge-blue-bg)] text-[var(--badge-blue-text)]',
  orange:
    'border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)]',
  red: 'border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] text-[var(--badge-red-text)]',
  green:
    'border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] text-[var(--badge-green-text)]',
  slate:
    'border-[var(--surface-control-border)] bg-[var(--surface-control)] text-[var(--text-primary)]',
};

export function AccountActiveFilters({
  params,
  tags,
  apps = [],
  change,
  onClearAll,
}: {
  params: URLSearchParams;
  tags: TagResponse[];
  apps?: RegisteredAppResponse[];
  change: AccountLocationChange;
  onClearAll?: () => void;
}) {
  const chips: FilterChip[] = [];

  const search = params.get('search');
  if (search) {
    chips.push({
      id: 'search',
      label: `搜索：${search}`,
      removeLabel: '移除搜索条件',
      tone: 'blue',
      onRemove: () => change({ search: '' }, false, true),
    });
  }

  const status = params.get('status');
  if (status) {
    const label = statusLabels[status as keyof typeof statusLabels] ?? status;
    chips.push({
      id: 'status',
      label: `状态：${label}`,
      removeLabel: '移除状态条件',
      tone: 'blue',
      onRemove: () => change({ status: '' }),
    });
  }

  const multiStatuses = (params.get('statuses') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (multiStatuses.length > 0) {
    chips.push({
      id: 'statuses',
      label: `状态：${multiStatuses
        .map((s) => statusLabels[s as keyof typeof statusLabels] ?? s)
        .join(' / ')}`,
      removeLabel: '移除多状态条件',
      tone: 'orange',
      onRemove: () => change({ statuses: '' }),
    });
  }

  const twoFa = params.get('two_factor_status');
  if (twoFa) {
    const label = factorLabels[twoFa as keyof typeof factorLabels] ?? twoFa;
    chips.push({
      id: 'two_factor_status',
      label: `2FA：${label}`,
      removeLabel: '移除二步验证条件',
      tone: twoFa === 'enabled' ? 'green' : 'orange',
      onRemove: () => change({ two_factor_status: '' }),
    });
  }

  const tagId = params.get('tag');
  if (tagId) {
    const tagName = tags.find((t) => t.id === tagId)?.name ?? tagId;
    chips.push({
      id: 'tag',
      label: `标签：${tagName}`,
      removeLabel: '移除标签条件',
      tone: 'blue',
      onRemove: () => change({ tag: '' }),
    });
  }

  const archived = params.get('archived');
  if (archived === 'true' || archived === 'false') {
    chips.push({
      id: 'archived',
      label: `归档：${archived === 'true' ? '仅归档' : '不含归档'}`,
      removeLabel: '移除归档条件',
      tone: 'slate',
      onRemove: () => change({ archived: '' }),
    });
  }

  const appId = params.get('app_id');
  if (appId) {
    const appName = apps.find((a) => a.id === appId)?.name ?? appId;
    chips.push({
      id: 'app_id',
      label: `已注册应用：${appName}`,
      removeLabel: '移除应用条件',
      tone: 'blue',
      onRemove: () => change({ app_id: '', app_status: '' }),
    });
  }

  const appStatus = params.get('app_status');
  if (appStatus) {
    const label =
      appStatusLabels[appStatus as keyof typeof appStatusLabels] ?? appStatus;
    chips.push({
      id: 'app_status',
      label: `应用状态：${label}`,
      removeLabel: '移除应用状态条件',
      tone: appStatus === 'active' ? 'green' : 'red',
      onRemove: () => change({ app_status: '' }),
    });
  }

  const multiAppStatuses = (params.get('app_statuses') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (multiAppStatuses.length > 0) {
    chips.push({
      id: 'app_statuses',
      label: `应用状态：${multiAppStatuses
        .map((s) => appStatusLabels[s as keyof typeof appStatusLabels] ?? s)
        .join(' / ')}`,
      removeLabel: '移除多应用状态条件',
      tone: 'red',
      onRemove: () => change({ app_statuses: '' }),
    });
  }

  const excludeAppId = params.get('exclude_app_id');
  if (excludeAppId) {
    const appName =
      apps.find((a) => a.id === excludeAppId)?.name ?? excludeAppId;
    chips.push({
      id: 'exclude_app_id',
      label: `未注册应用：${appName}`,
      removeLabel: '移除未注册应用条件',
      tone: 'green',
      onRemove: () => change({ exclude_app_id: '' }),
    });
  }

  const purpose = params.get('purpose');
  if (purpose) {
    chips.push({
      id: 'purpose',
      label: `用途：${purpose}`,
      removeLabel: '移除用途条件',
      tone: 'slate',
      onRemove: () => change({ purpose: '' }),
    });
  }

  const fromDate = params.get('from');
  const toDate = params.get('to');
  if (fromDate || toDate) {
    const rangeLabel =
      fromDate && toDate
        ? `${fromDate} ~ ${toDate}`
        : fromDate
          ? `${fromDate} 起`
          : `截至 ${toDate}`;
    chips.push({
      id: 'date_range',
      label: `注册时间：${rangeLabel}`,
      removeLabel: '移除注册时间条件',
      tone: 'slate',
      onRemove: () => change({ from: '', to: '' }),
    });
  }

  const recoveryEmail = params.get('recovery_email');
  if (recoveryEmail) {
    chips.push({
      id: 'recovery_email',
      label: `辅助邮箱：${recoveryEmail}`,
      removeLabel: '移除辅助邮箱条件',
      tone: 'blue',
      onRemove: () => change({ recovery_email: '' }),
    });
  }

  const hasRecovery = params.get('has_recovery_email');
  if (hasRecovery === 'true' || hasRecovery === 'false') {
    chips.push({
      id: 'has_recovery_email',
      label: `辅助邮箱：${hasRecovery === 'false' ? '未设置' : '已配置'}`,
      removeLabel: '移除辅助邮箱配置条件',
      tone: hasRecovery === 'false' ? 'orange' : 'green',
      onRemove: () => change({ has_recovery_email: '' }),
    });
  }

  const unverifiedDays = params.get('unverified_over_days');
  if (unverifiedDays) {
    chips.push({
      id: 'unverified_over_days',
      label: `超过 ${unverifiedDays} 天未验证`,
      removeLabel: '移除未验证天数条件',
      tone: 'orange',
      onRemove: () => change({ unverified_over_days: '' }),
    });
  }

  const inactiveLoginDays = params.get('inactive_login_over_days');
  if (inactiveLoginDays) {
    chips.push({
      id: 'inactive_login_over_days',
      label: `超过 ${inactiveLoginDays} 天未登录`,
      removeLabel: '移除未登录天数条件',
      tone: 'orange',
      onRemove: () => change({ inactive_login_over_days: '' }),
    });
  }

  const passwordStaleDays = params.get('password_stale_over_days');
  if (passwordStaleDays) {
    chips.push({
      id: 'password_stale_over_days',
      label: `超过 ${passwordStaleDays} 天未改密`,
      removeLabel: '移除密码轮换天数条件',
      tone: 'orange',
      onRemove: () => change({ password_stale_over_days: '' }),
    });
  }

  const missingMeta = params.get('missing_metadata');
  if (missingMeta) {
    const labelMap: Record<string, string> = {
      no_purpose: '缺少用途',
      no_tags: '缺少标签',
      no_purpose_or_tags: '缺少用途或标签',
    };
    chips.push({
      id: 'missing_metadata',
      label: `资料缺失：${labelMap[missingMeta] ?? missingMeta}`,
      removeLabel: '移除资料缺失条件',
      tone: 'slate',
      onRemove: () => change({ missing_metadata: '' }),
    });
  }

  const conflictCheck = params.get('conflict_check');
  if (conflictCheck === 'inactive_with_active_apps') {
    chips.push({
      id: 'conflict_check',
      label: '质量冲突：停用/归档含活跃应用',
      removeLabel: '移除质量冲突条件',
      tone: 'red',
      onRemove: () => change({ conflict_check: '' }),
    });
  }

  const upstreamRisk = params.get('upstream_recovery_risk');
  if (upstreamRisk === 'true' || upstreamRisk === 'false') {
    chips.push({
      id: 'upstream_recovery_risk',
      label:
        upstreamRisk === 'true'
          ? '连带风险：上游辅助账号异常'
          : '连带风险：上游辅助账号正常',
      removeLabel: '移除上游辅助账号风险条件',
      tone: upstreamRisk === 'true' ? 'red' : 'green',
      onRemove: () => change({ upstream_recovery_risk: '' }),
    });
  }

  const sort = params.get('sort');
  if (sort && sort !== '-account_no') {
    chips.push({
      id: 'sort',
      label: `排序：${formatSortLabel(sort)}`,
      removeLabel: '恢复默认排序',
      tone: 'slate',
      onRemove: () => change({ sort: '' }),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div
      role="region"
      aria-label="当前生效筛选条件"
      data-slot="active-filters-bar"
      className="flex flex-wrap items-center gap-2"
    >
      {chips.map((chip) => (
        <span
          key={chip.id}
          className={cn(
            'inline-flex min-h-7 items-center gap-1 rounded-full border py-0.5 pr-1 pl-2.5 text-xs font-medium',
            TONE_CLASS[chip.tone],
          )}
        >
          <span className="max-w-[220px] truncate">{chip.label}</span>
          <button
            type="button"
            aria-label={chip.removeLabel}
            onClick={chip.onRemove}
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-black/10"
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={() => {
          if (onClearAll) {
            onClearAll();
          } else {
            change({ deleted: params.get('deleted') || '' }, true);
          }
        }}
        className="inline-flex min-h-7 items-center rounded-full px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]"
      >
        清空全部
      </button>
    </div>
  );
}
