import { useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import type { RegisteredAppResponse, TagResponse } from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { appStatusLabels, factorLabels, statusLabels } from './constants';
import type { AccountLocationChange } from './query-state';

const sortFields = {
  account_no: '账号编号',
  registered_at: '注册时间',
  last_verified_at: '最后验证',
  last_login_at: '最后活动',
  created_at: '创建时间',
  updated_at: '更新时间',
};

const ADVANCED_FILTER_KEYS = [
  'app_status',
  'app_statuses',
  'exclude_app_id',
  'archived',
  'purpose',
  'from',
  'to',
  'recovery_email',
  'has_recovery_email',
  'unverified_over_days',
  'inactive_login_over_days',
  'password_stale_over_days',
  'missing_metadata',
  'conflict_check',
] as const;

export function Filters({
  params,
  change,
  tags,
  apps = [],
  purposeSuggestions = [],
  onOpenRecoveryUsage,
  onOpenAppsUsage,
}: {
  params: URLSearchParams;
  change: AccountLocationChange;
  tags: TagResponse[];
  apps?: RegisteredAppResponse[];
  purposeSuggestions?: string[];
  onOpenRecoveryUsage?: () => void;
  onOpenAppsUsage?: () => void;
}) {
  const activeAdvancedCount =
    ADVANCED_FILTER_KEYS.filter((key) => params.has(key)).length +
    (params.get('sort') && params.get('sort') !== '-account_no' ? 1 : 0);
  const [advancedOpen, setAdvancedOpen] = useState(
    () => activeAdvancedCount > 0,
  );

  const select = (
    key: string,
    label: string,
    values: Record<string, string>,
    extraClear?: Record<string, string>,
  ) => (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
      <span>{label}</span>
      <NativeSelect
        aria-label={label}
        value={params.get(key) || ''}
        onChange={(e) =>
          change({ ...(extraClear ?? {}), [key]: e.target.value })
        }
        className="h-9 rounded-xl border-white/80 bg-white/75 text-[13px] text-[var(--text-primary)]"
      >
        <option value="">全部</option>
        {params.get(key) && !(params.get(key)! in values) && (
          <option value={params.get(key)!}>不可用的筛选值（请重置）</option>
        )}
        {Object.entries(values).map(([value, text]) => (
          <option key={value} value={value}>
            {text}
          </option>
        ))}
      </NativeSelect>
    </label>
  );

  const fromDate = params.get('from') || '';
  const toDate = params.get('to') || '';

  return (
    <section
      aria-label="查询条件"
      className="macos-glass-panel space-y-3.5 p-4"
    >
      {/* 常用筛选（高频四维：状态、二步验证、标签、已注册应用） */}
      <div
        className={
          apps.length > 0
            ? 'grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4'
            : 'grid gap-3.5 sm:grid-cols-3'
        }
      >
        {select('status', '筛选状态', statusLabels, { statuses: '' })}
        {select('two_factor_status', '筛选二步验证', factorLabels)}
        {select(
          'tag',
          '筛选标签',
          Object.fromEntries(tags.map((t) => [t.id, t.name])),
        )}
        {apps.length > 0 &&
          select(
            'app_id',
            '已注册应用',
            Object.fromEntries(apps.map((a) => [a.id, a.name])),
            { exclude_app_id: '' },
          )}
      </div>

      {/* 高级筛选（应用状态、未注册应用、归档、用途、注册日期、排序） */}
      {advancedOpen && (
        <div
          data-slot="advanced-filters-section"
          className="space-y-3.5 border-t border-[var(--table-divider)] pt-3.5"
        >
          <div
            className={
              apps.length > 0
                ? 'grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3'
                : 'grid gap-3.5 sm:grid-cols-2'
            }
          >
            {apps.length > 0 &&
              select('app_status', '应用账号状态', appStatusLabels)}
            {apps.length > 0 &&
              select(
                'exclude_app_id',
                '未注册应用（筛干净号）',
                Object.fromEntries(apps.map((a) => [a.id, a.name])),
                { app_id: '', app_status: '' },
              )}
            {select('archived', '归档条件', {
              false: '不含归档',
              true: '仅归档',
            })}
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {select('has_recovery_email', '辅助邮箱配置', {
              false: '未设置辅助邮箱',
              true: '已配置辅助邮箱',
            })}
            {select('unverified_over_days', '核验过期周期', {
              '30': '超过 30 天未验证',
              '60': '超过 60 天未验证',
              '90': '超过 90 天未验证',
            })}
            {select('missing_metadata', '资料完整度体检', {
              no_purpose_or_tags: '缺少用途或标签',
              no_purpose: '仅缺少用途',
              no_tags: '仅缺少标签',
            })}
            {select('conflict_check', '关系冲突检查', {
              inactive_with_active_apps: '异常/归档仍挂活跃应用',
            })}
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <form
              className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]"
              onSubmit={(e) => {
                e.preventDefault();
                change({
                  purpose: String(
                    new FormData(e.currentTarget).get('purpose') || '',
                  ).trim(),
                });
              }}
            >
              <label htmlFor="filter-purpose">筛选用途（精确匹配）</label>
              <div className="flex gap-1.5">
                <Input
                  id="filter-purpose"
                  name="purpose"
                  list="account-filter-purpose-options"
                  placeholder={
                    purposeSuggestions.length > 0
                      ? '选择已有用途或输入关键词'
                      : '输入完整用途名称'
                  }
                  key={params.get('purpose') || ''}
                  defaultValue={params.get('purpose') || ''}
                  maxLength={100}
                  className="h-9 rounded-xl border-white/80 bg-white/75 text-[13px]"
                />
                {purposeSuggestions.length > 0 && (
                  <datalist id="account-filter-purpose-options">
                    {purposeSuggestions.map((item) => (
                      <option key={item} value={item} />
                    ))}
                  </datalist>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl border-white/80 bg-white/75"
                >
                  应用
                </Button>
              </div>
            </form>

            <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
              <span>注册开始日期</span>
              <Input
                type="date"
                aria-label="注册开始日期"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => change({ from: e.target.value })}
                className="h-9 rounded-xl border-white/80 bg-white/75 text-[13px]"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
              <span>注册结束日期（含当天）</span>
              <Input
                type="date"
                aria-label="注册结束日期"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => change({ to: e.target.value })}
                className="h-9 rounded-xl border-white/80 bg-white/75 text-[13px]"
              />
            </label>

            <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
              <span>排序</span>
              <NativeSelect
                aria-label="排序"
                value={params.get('sort') || '-account_no'}
                onChange={(e) => change({ sort: e.target.value })}
                className="h-9 rounded-xl border-white/80 bg-white/75 text-[13px] text-[var(--text-primary)]"
              >
                {Object.entries(sortFields).flatMap(([key, label]) => [
                  <option key={'-' + key} value={'-' + key}>
                    {label} ↓
                  </option>,
                  <option key={key} value={key}>
                    {label} ↑
                  </option>,
                ])}
              </NativeSelect>
            </label>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--table-divider)] pt-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
          <button
            type="button"
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((open) => !open)}
            className="inline-flex min-h-8 items-center gap-1.5 rounded-xl border border-white/80 bg-white/70 px-3 py-1 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-white"
          >
            <SlidersHorizontal className="size-3.5" aria-hidden="true" />
            <span>高级筛选</span>
            {activeAdvancedCount > 0 && (
              <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-semibold text-[var(--primary-foreground)]">
                {activeAdvancedCount}
              </span>
            )}
            {advancedOpen ? (
              <ChevronUp className="size-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden="true" />
            )}
          </button>
          {onOpenAppsUsage && (
            <button
              type="button"
              onClick={onOpenAppsUsage}
              className="inline-flex min-h-8 items-center rounded-xl border border-white/80 bg-white/70 px-3 py-1 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-white"
            >
              已注册应用统计
            </button>
          )}
          {onOpenRecoveryUsage && (
            <button
              type="button"
              onClick={onOpenRecoveryUsage}
              className="inline-flex min-h-8 items-center rounded-xl border border-white/80 bg-white/70 px-3 py-1 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-white"
            >
              辅助邮箱使用情况
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 rounded-xl border-white/80 bg-white/75 text-xs"
          onClick={() => change({ deleted: params.get('deleted') || '' }, true)}
        >
          重置筛选
        </Button>
      </div>
    </section>
  );
}
