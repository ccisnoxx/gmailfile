import type { TagResponse } from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { factorLabels, statusLabels } from './constants';
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
  onOpenRecoveryUsage,
}: {
  params: URLSearchParams;
  change: AccountLocationChange;
  tags: TagResponse[];
  onOpenRecoveryUsage?: () => void;
}) {
  const select = (
    key: string,
    label: string,
    values: Record<string, string>,
  ) => (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
      <span>{label}</span>
      <NativeSelect
        aria-label={label}
        value={params.get(key) || ''}
        onChange={(e) => change({ [key]: e.target.value })}
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

  return (
    <section
      aria-label="查询条件"
      className="macos-glass-panel space-y-3.5 p-4"
    >
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        {select('status', '筛选状态', statusLabels)}
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
            value={params.get('from') || ''}
            onChange={(e) => change({ from: e.target.value })}
            className="h-9 rounded-xl border-white/80 bg-white/75 text-[13px]"
          />
        </label>

        <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
          <span>注册结束日期（含当天）</span>
          <Input
            type="date"
            aria-label="注册结束日期"
            value={params.get('to') || ''}
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
          {params.has('recovery_email') && (
            <span className="rounded-lg bg-[var(--accent-soft)] px-2.5 py-1 font-medium text-[var(--accent)]">
              辅助邮箱：{params.get('recovery_email')}
            </span>
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
