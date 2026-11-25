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
  last_login_at: '最后登录',
  created_at: '创建时间',
  updated_at: '更新时间',
};

export function Filters({
  params,
  change,
  tags,
}: {
  params: URLSearchParams;
  change: AccountLocationChange;
  tags: TagResponse[];
}) {
  const select = (
    key: string,
    label: string,
    values: Record<string, string>,
  ) => (
    <label className="flex flex-col gap-2 text-sm">
      {label}
      <NativeSelect
        aria-label={label}
        value={params.get(key) || ''}
        onChange={(e) => change({ [key]: e.target.value })}
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
      className="space-y-3 rounded-lg border bg-card p-4"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <form
          className="flex flex-col gap-2 text-sm sm:col-span-2"
          onSubmit={(e) => {
            e.preventDefault();
            change({
              search: String(new FormData(e.currentTarget).get('search') || ''),
            });
          }}
        >
          <label htmlFor="account-search">搜索编号、Gmail 或辅助邮箱</label>
          <div className="flex gap-2">
            <Input
              key={params.get('search') || ''}
              id="account-search"
              name="search"
              defaultValue={params.get('search') || ''}
              maxLength={254}
            />
            <Button variant="outline">搜索</Button>
          </div>
        </form>
        {select('status', '筛选状态', statusLabels)}
        {select('two_factor_status', '筛选二步验证', factorLabels)}
      </div>
      <div className="flex items-start gap-3">
        <details className="min-w-0 flex-1">
          <summary className="cursor-pointer py-2 text-sm">
            更多筛选与排序
            {['purpose', 'tag', 'archived', 'from', 'to', 'sort'].some((key) =>
              params.has(key),
            )
              ? '（有已设置条件）'
              : ''}
          </summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <form
              className="flex flex-col gap-2 text-sm"
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
              <div className="flex gap-2">
                <Input
                  id="filter-purpose"
                  name="purpose"
                  key={params.get('purpose') || ''}
                  defaultValue={params.get('purpose') || ''}
                  maxLength={100}
                />
                <Button variant="outline">应用</Button>
              </div>
            </form>
            {select(
              'tag',
              '筛选标签',
              Object.fromEntries(tags.map((t) => [t.id, t.name])),
            )}
            {select('archived', '归档条件', {
              false: '不含归档',
              true: '仅归档',
            })}
            <label className="flex flex-col gap-2 text-sm">
              注册开始日期
              <Input
                type="date"
                aria-label="注册开始日期"
                value={params.get('from') || ''}
                onChange={(e) => change({ from: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              注册结束日期（含当天）
              <Input
                type="date"
                aria-label="注册结束日期"
                value={params.get('to') || ''}
                onChange={(e) => change({ to: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-2 text-sm">
              排序
              <NativeSelect
                aria-label="排序"
                value={params.get('sort') || '-account_no'}
                onChange={(e) => change({ sort: e.target.value })}
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
        </details>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() =>
              change({ deleted: params.get('deleted') || '' }, true)
            }
          >
            重置筛选
          </Button>
          {params.has('recovery_email') && (
            <span className="break-all text-sm">
              辅助邮箱：{params.get('recovery_email')}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
