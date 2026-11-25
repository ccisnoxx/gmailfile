import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { useState, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  accountsBatchStatus,
  accountsBatchTags,
  dashboardSummary,
  recoveryEmailsList,
} from '@/api/generated';
import type {
  AccountPage,
  AccountSummary,
  SessionResponse,
  TagResponse,
  ErrorResponse,
} from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { statusLabels, factorLabels, localDate } from './account-form';
import { useAccountLocation } from './query-state';
import { useEffect } from 'react';

type Change = ReturnType<typeof useAccountLocation>['change'];
export function Summary({
  onFailure,
}: {
  onFailure: (error: unknown) => void;
}) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const summary = useQuery({
    queryKey: ['summary', timezone],
    queryFn: async ({ signal }) =>
      (
        await dashboardSummary({
          query: { timezone },
          signal,
          throwOnError: true,
        })
      ).data,
  });
  useEffect(() => {
    if (summary.error) onFailure(summary.error);
  }, [summary.error]);
  const labels = {
    total: '账号总数',
    normal: '正常',
    pending_verification: '待验证',
    abnormal: '异常',
    added_this_month: '本月新增',
    unverified_over_30_days: '超过 30 天未验证',
  } as const;
  return (
    <section aria-label="账号全局统计" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Object.entries(labels).map(([key, label]) => (
          <div key={key} className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {summary.data ? summary.data[key as keyof typeof labels] : '—'}
            </p>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-start gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>全局统计 · 不随筛选变化</span>
        <details>
          <summary className="cursor-pointer">统计口径</summary>
          <p className="mt-2 max-w-4xl leading-6">
            总数含归档、不含删除。异常：受限、无法登录、已停用。本月按注册时间（
            {timezone}）；超过 30 天未验证不含归档，从未验证按注册时间计算。
          </p>
        </details>
      </div>
      {summary.isError && (
        <p role="alert">
          统计加载失败。
          <Button variant="ghost" onClick={() => void summary.refetch()}>
            重试统计
          </Button>
        </p>
      )}
    </section>
  );
}
export function Filters({
  params,
  change,
  tags,
}: {
  params: URLSearchParams;
  change: Change;
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
                {Object.entries({
                  account_no: '账号编号',
                  registered_at: '注册时间',
                  last_verified_at: '最后验证',
                  last_login_at: '最后登录',
                  created_at: '创建时间',
                  updated_at: '更新时间',
                }).flatMap(([key, label]) => [
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
export function Pagination({
  page,
  page_size,
  total,
  change,
  busy = false,
  fixedSize = false,
  max_page_size = 100,
}: Pick<AccountPage, 'page' | 'page_size' | 'total'> & {
  change: Change;
  busy?: boolean;
  fixedSize?: boolean;
  max_page_size?: number;
}) {
  return (
    <nav
      aria-label="分页"
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <span aria-live="polite">
        共 {total} 条 · 第 {page} / {Math.max(1, Math.ceil(total / page_size))}{' '}
        页
      </span>
      <div className="flex items-center gap-2">
        {!fixedSize && (
          <label>
            每页
            <NativeSelect
              aria-label="每页条数"
              value={page_size}
              onChange={(e) => change({ page_size: e.target.value })}
            >
              {[...new Set([page_size, 30, 50, 100])]
                .filter((n) => n <= max_page_size)
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </NativeSelect>
          </label>
        )}
        {page > Math.max(1, Math.ceil(total / page_size)) && (
          <Button variant="outline" onClick={() => change({ page: '1' })}>
            回到第一页
          </Button>
        )}
        <Button
          variant="outline"
          disabled={busy || page <= 1}
          onClick={() => change({ page: String(page - 1) })}
        >
          上一页
        </Button>
        <Button
          variant="outline"
          disabled={busy || page * page_size >= total}
          onClick={() => change({ page: String(page + 1) })}
        >
          下一页
        </Button>
      </div>
    </nav>
  );
}
export function BatchBar({
  selected,
  tags,
  session,
  complete,
  onFailure,
}: {
  selected: AccountSummary[];
  tags: TagResponse[];
  session: SessionResponse;
  complete: () => Promise<void>;
  onFailure: (e: unknown) => void;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<AccountSummary['status']>('normal');
  const [tag, setTag] = useState('');
  const [confirmation, setConfirmation] = useState<'status' | 'tags' | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  async function submit() {
    setBusy(true);
    setMessage('');
    const base = {
      accounts: selected.map((a) => ({ id: a.id, row_version: a.row_version })),
    };
    const options = {
      headers: { 'X-CSRF-Token': session.csrf_token },
      throwOnError: true as const,
    };
    try {
      if (confirmation === 'status')
        await accountsBatchStatus({ ...options, body: { ...base, status } });
      else
        await accountsBatchTags({
          ...options,
          body: { ...base, tag_ids: [tag] },
        });
      setConfirmation(null);
      await complete();
    } catch (e) {
      const error = e as ErrorResponse;
      const target = error.error?.details?.account_id;
      const row = target
        ? selected.find((a) => a.id === target)
        : error.error?.details?.account_index !== undefined
          ? selected[Number(error.error.details.account_index)]
          : undefined;
      const rejected = [
        'ROW_VERSION_CONFLICT',
        'ACCOUNT_DELETED',
        'ACCOUNT_NOT_FOUND',
        'TAG_INVALID',
        'VALIDATION_ERROR',
        'AUTH_REQUIRED',
        'MFA_REQUIRED',
        'CSRF_INVALID',
      ].includes(error.error?.code);
      setMessage(
        rejected
          ? `整批未提交${row ? '（' + row.account_no + '）' : ''}：${error.error.message}。请刷新并重新选择，不会自动重放。`
          : '提交结果未知。请刷新确认，不会自动重放。',
      );
      setFailed(true);
      onFailure(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      aria-label="批量操作"
      className="flex min-w-0 flex-1 flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3"
    >
      <p className="text-sm">已选当前页 {selected.length} 条（不跨页）</p>
      <NativeSelect
        aria-label="批量目标状态"
        value={status}
        onChange={(e) => setStatus(e.target.value as typeof status)}
      >
        {Object.entries(statusLabels).map(([v, label]) => (
          <option value={v} key={v}>
            {label}
          </option>
        ))}
      </NativeSelect>
      <Button
        variant="outline"
        disabled={!selected.length || busy || failed}
        onClick={() => {
          returnFocus.current = document.activeElement as HTMLElement;
          setConfirmation('status');
        }}
      >
        批量修改状态
      </Button>
      <NativeSelect
        aria-label="批量添加标签"
        value={tag}
        onChange={(e) => setTag(e.target.value)}
      >
        <option value="">请选择标签</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </NativeSelect>
      <Button
        variant="outline"
        disabled={!selected.length || !tag || busy || failed}
        onClick={() => {
          returnFocus.current = document.activeElement as HTMLElement;
          setConfirmation('tags');
        }}
      >
        添加到所选账号
      </Button>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量操作</AlertDialogTitle>
            <AlertDialogDescription>
              对当前页选中的 {selected.length} 条
              {confirmation === 'status'
                ? `修改为“${statusLabels[status]}”`
                : '追加标签（保留原标签）'}
              。整批成功或整批回滚，不包含其他页面的账号。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消批量操作</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || failed}
              onClick={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              确认整批提交
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {message && !confirmation && (
        <p role="alert" className="w-full text-sm text-destructive">
          {message}
        </p>
      )}
    </section>
  );
}
export function RecoveryPage({
  params,
  change,
  onFailure,
}: {
  params: URLSearchParams;
  change: Change;
  onFailure: (e: unknown) => void;
}) {
  const page = Number(params.get('recovery_page') || 1);
  const usage = useQuery({
    queryKey: ['recovery-usage', page],
    queryFn: async ({ signal }) =>
      (
        await recoveryEmailsList({
          query: { page },
          signal,
          throwOnError: true,
        })
      ).data,
  });
  useEffect(() => {
    if (usage.error) onFailure(usage.error);
  }, [usage.error]);
  return (
    <section aria-label="辅助邮箱使用情况" className="min-w-0 space-y-4">
      <h2 className="text-xl font-semibold">辅助邮箱使用情况</h2>
      <p className="text-sm text-muted-foreground">
        关联记录含归档、不含删除；文本和系统关联按地址去首尾空格、小写后合并（不合并
        Gmail 点号或 +
        别名）。最近关联按注册时间，不是修改时间；已删除辅助账号的引用保留。
      </p>
      {usage.isPending ? (
        <p role="status">正在加载辅助邮箱…</p>
      ) : usage.isError ? (
        <p role="alert">
          辅助邮箱加载失败。
          <Button onClick={() => void usage.refetch()}>重试</Button>
        </p>
      ) : (
        <>
          <Table aria-label="辅助邮箱统计">
            <TableHeader>
              <TableRow>
                {[
                  '辅助邮箱',
                  '关联账号数',
                  '正常数',
                  '异常数',
                  '最近关联时间',
                  '操作',
                ].map((t) => (
                  <TableHead key={t}>{t}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.data?.items.map((row) => (
                <TableRow key={row.email}>
                  <TableCell>{row.email}</TableCell>
                  <TableCell>{row.account_count}</TableCell>
                  <TableCell>{row.normal_count}</TableCell>
                  <TableCell>{row.abnormal_count}</TableCell>
                  <TableCell>{localDate(row.latest_registered_at)}</TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      onClick={() =>
                        change({ recovery_email: row.email }, true)
                      }
                    >
                      查看关联账号
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!usage.data?.total && <p>暂无辅助邮箱关联</p>}
          <Pagination
            page={page}
            fixedSize
            page_size={usage.data?.page_size ?? 30}
            total={usage.data?.total || 0}
            change={(values) =>
              change({ recovery_page: values.page || '1', view: 'recovery' })
            }
          />
        </>
      )}
    </section>
  );
}
