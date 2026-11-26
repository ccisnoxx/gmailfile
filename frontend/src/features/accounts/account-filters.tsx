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

export function Filters({
  params,
  change,
  tags,
  apps = [],
  onOpenRecoveryUsage,
  onOpenAppsUsage,
}: {
  params: URLSearchParams;
  change: AccountLocationChange;
  tags: TagResponse[];
  apps?: RegisteredAppResponse[];
  onOpenRecoveryUsage?: () => void;
  onOpenAppsUsage?: () => void;
}) {
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
  const multiStatuses = (params.get('statuses') || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return (
    <section
      aria-label="查询条件"
      className="macos-glass-panel space-y-3.5 p-4"
    >
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {select('status', '筛选状态', statusLabels, { statuses: '' })}
        {select('two_factor_status', '筛选二步验证', factorLabels)}
        {select(
          'tag',
          '筛选标签',
          Object.fromEntries(tags.map((t) => [t.id, t.name])),
        )}
        {select('archived', '归档条件', {
          false: '不含归档',
          true: '仅归档',
        })}
      </div>

      {apps.length > 0 && (
        <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
          {select(
            'app_id',
            '已注册应用',
            Object.fromEntries(apps.map((a) => [a.id, a.name])),
            { exclude_app_id: '' },
          )}
          {select('app_status', '应用账号状态', appStatusLabels)}
          {select(
            'exclude_app_id',
            '未注册应用（筛干净号）',
            Object.fromEntries(apps.map((a) => [a.id, a.name])),
            { app_id: '', app_status: '' },
          )}
        </div>
      )}

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <form
          className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]"
          onSubmit={(e) => {
            e.preventDefault();
            change({
              purpose: String(
                new FormData(e.currentTarget).get('purpose') || '',
              ),
            });
          }}
        >
          <label htmlFor="filter-purpose">筛选用途（精确匹配）</label>
          <div className="flex gap-1.5">
            <Input
              id="filter-purpose"
              name="purpose"
              key={params.get('purpose') || ''}
              defaultValue={params.get('purpose') || ''}
              maxLength={100}
              className="h-9 rounded-xl border-white/80 bg-white/75 text-[13px]"
            />
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--table-divider)] pt-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-secondary)]">
          {multiStatuses.length > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--badge-orange-bg)] px-2.5 py-1 font-medium text-[var(--badge-orange-text)]">
              <span>
                多状态筛选：
                {multiStatuses
                  .map((s) => statusLabels[s as keyof typeof statusLabels] ?? s)
                  .join(' / ')}
              </span>
              <button
                type="button"
                aria-label="清除多状态筛选"
                onClick={() => change({ statuses: '' })}
                className="rounded px-1 text-[11px] hover:bg-black/10"
              >
                ×
              </button>
            </span>
          )}
          {params.has('app_id') && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-2.5 py-1 font-medium text-[var(--accent-text)]">
              <span>
                已注册应用：
                {apps.find((a) => a.id === params.get('app_id'))?.name ??
                  params.get('app_id')}
              </span>
              <button
                type="button"
                aria-label="清除应用筛选"
                onClick={() => change({ app_id: '' })}
                className="rounded px-1 text-[11px] hover:bg-black/10"
              >
                ×
              </button>
            </span>
          )}
          {params.has('app_status') && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--badge-red-bg)] px-2.5 py-1 font-medium text-[var(--badge-red-text)]">
              <span>
                应用状态：
                {appStatusLabels[
                  params.get('app_status') as keyof typeof appStatusLabels
                ] ?? params.get('app_status')}
              </span>
              <button
                type="button"
                aria-label="清除应用状态筛选"
                onClick={() => change({ app_status: '' })}
                className="rounded px-1 text-[11px] hover:bg-black/10"
              >
                ×
              </button>
            </span>
          )}
          {params.has('exclude_app_id') && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--badge-green-bg)] px-2.5 py-1 font-medium text-[var(--badge-green-text)]">
              <span>
                未注册：
                {apps.find((a) => a.id === params.get('exclude_app_id'))
                  ?.name ?? params.get('exclude_app_id')}
              </span>
              <button
                type="button"
                aria-label="清除未注册应用筛选"
                onClick={() => change({ exclude_app_id: '' })}
                className="rounded px-1 text-[11px] hover:bg-black/10"
              >
                ×
              </button>
            </span>
          )}
          {params.has('recovery_email') && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-2.5 py-1 font-medium text-[var(--accent-text)]">
              <span>辅助邮箱：{params.get('recovery_email')}</span>
              <button
                type="button"
                aria-label="清除辅助邮箱筛选"
                onClick={() => change({ recovery_email: '' })}
                className="rounded px-1 text-[11px] hover:bg-black/10"
              >
                ×
              </button>
            </span>
          )}
          {onOpenAppsUsage && (
            <button
              type="button"
              onClick={onOpenAppsUsage}
              className="rounded-xl border border-white/80 bg-white/70 px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-white"
            >
              已注册应用统计
            </button>
          )}
          {onOpenRecoveryUsage && (
            <button
              type="button"
              onClick={onOpenRecoveryUsage}
              className="rounded-xl border border-white/80 bg-white/70 px-3 py-1.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-white"
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
