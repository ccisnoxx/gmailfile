import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Popover as PopoverPrimitive } from 'radix-ui';
import {
  AlertTriangle,
  ArrowUpRight,
  Copy,
  HelpCircle,
  Link2,
  Loader2,
  Mail,
  Search,
  Users,
  X,
} from 'lucide-react';
import {
  recoveryEmailAccounts,
  recoveryEmailsLinkInternal,
  recoveryEmailsList,
  type RecoveryEmailsListData,
} from '@/api/generated';
import { GlassPanel, StatusPill } from '@/components/macos';
import { Button } from '@/components/ui/button';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { localDate } from './constants';
import { Pagination } from './account-pagination';
import type { AccountLocationChange } from './query-state';

type RecoverySortKey = NonNullable<RecoveryEmailsListData['query']>['sort'];

const sortOptions: { value: RecoverySortKey; label: string }[] = [
  { value: '-account_count', label: '按关联账号数（多→少）' },
  { value: '-abnormal_count', label: '按异常账号数（多→少）' },
  { value: '-latest_registered_at', label: '按最近关联时间（新→旧）' },
  { value: 'email', label: '按辅助邮箱字母（A→Z）' },
];

export function RecoveryPage({
  params,
  change,
  csrfToken,
  onFailure,
  onCopy,
  onOpenAccountsFilter,
}: {
  params: URLSearchParams;
  change: AccountLocationChange;
  csrfToken?: string;
  onFailure: (e: unknown) => void;
  onCopy?: (value: string) => void;
  onOpenAccountsFilter?: (email: string) => void;
}) {
  const queryClient = useQueryClient();
  const rawPage = Number(params.get('recovery_page') || 1);
  const page = Number.isInteger(rawPage) && rawPage >= 1 ? rawPage : 1;
  const search = params.get('recovery_search') || '';
  const sort = (params.get('recovery_sort') ||
    '-account_count') as RecoverySortKey;
  const [inspectEmail, setInspectEmail] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkNotice, setLinkNotice] = useState('');

  const handleLinkAllInternal = async () => {
    if (!csrfToken || linkBusy) return;
    setLinkBusy(true);
    setLinkNotice('');
    try {
      const { data } = await recoveryEmailsLinkInternal({
        body: {},
        headers: { 'X-CSRF-Token': csrfToken },
        throwOnError: true,
      });
      setLinkNotice(
        data.linked_count > 0
          ? `已将 ${data.linked_count} 条匹配站内主账号的外部辅助邮箱自动转为站内强关联。`
          : '当前没有匹配站内主账号的外部辅助邮箱文本。',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['recovery-usage'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts'] }),
        queryClient.invalidateQueries({ queryKey: ['dashboard-insights'] }),
      ]);
    } catch (error) {
      setLinkNotice('归并站内辅助账号失败，请稍后重试。');
      onFailure(error);
    } finally {
      setLinkBusy(false);
    }
  };

  const usage = useQuery({
    queryKey: ['recovery-usage', page, search, sort],
    queryFn: async ({ signal }) =>
      (
        await recoveryEmailsList({
          query: {
            page,
            search: search || undefined,
            sort,
          },
          signal,
          throwOnError: true,
        })
      ).data,
  });

  const linkedAccounts = useQuery({
    queryKey: ['recovery-email-accounts', inspectEmail],
    enabled: Boolean(inspectEmail),
    queryFn: async ({ signal }) =>
      (
        await recoveryEmailAccounts({
          query: { email: inspectEmail!, page: 1, page_size: 20 },
          signal,
          throwOnError: true,
        })
      ).data,
  });

  useEffect(() => {
    if (usage.error) onFailure(usage.error);
  }, [usage.error, onFailure]);

  useEffect(() => {
    if (linkedAccounts.error) onFailure(linkedAccounts.error);
  }, [linkedAccounts.error, onFailure]);

  const navigateToAccounts = (email: string) => {
    if (onOpenAccountsFilter) {
      onOpenAccountsFilter(email);
    } else {
      change({ recovery_email: email }, true);
    }
  };

  const totalRecovery = usage.data?.total ?? 0;
  const totalAccounts =
    usage.data?.total_accounts ??
    usage.data?.items.reduce((acc, row) => acc + row.account_count, 0) ??
    0;
  const abnormalGroups =
    usage.data?.abnormal_recovery_emails ??
    usage.data?.items.filter((row) => row.abnormal_count > 0).length ??
    0;

  return (
    <section aria-label="辅助邮箱使用情况" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-[var(--text-primary)]">
              辅助邮箱使用情况
            </h1>
            <PopoverPrimitive.Root>
              <PopoverPrimitive.Trigger asChild>
                <button
                  type="button"
                  aria-label="查看辅助邮箱统计口径说明"
                  className="inline-flex size-6 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]"
                >
                  <HelpCircle className="size-4" aria-hidden="true" />
                </button>
              </PopoverPrimitive.Trigger>
              <PopoverPrimitive.Portal>
                <PopoverPrimitive.Content
                  align="start"
                  sideOffset={6}
                  className="macos-glass-modal z-50 max-w-sm rounded-2xl p-3.5 text-xs leading-5 text-[var(--text-primary)] outline-none"
                >
                  <p className="mb-1 font-semibold">统计口径说明</p>
                  <p className="text-[var(--text-secondary)]">
                    关联记录含归档、不含软删除；外部文本与站内关联按地址去首尾空格、小写合并（不折叠
                    Gmail 点号或 +
                    别名）。最近关联时间取子账号的注册时间，而非修改时间。
                  </p>
                </PopoverPrimitive.Content>
              </PopoverPrimitive.Portal>
            </PopoverPrimitive.Root>
          </div>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            统计每个辅助邮箱关联的账号规模与异常分布，快速排查集中风险
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {csrfToken && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={linkBusy}
              onClick={() => void handleLinkAllInternal()}
            >
              {linkBusy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Link2 className="size-3.5" aria-hidden="true" />
              )}
              <span>归并站内主号关联</span>
            </Button>
          )}
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-3 size-3.5 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="搜索辅助邮箱"
              placeholder="筛选辅助邮箱…"
              value={search}
              onChange={(e) =>
                change(
                  {
                    view: params.get('view') || '',
                    recovery_search: e.target.value,
                    recovery_sort: sort || '',
                    recovery_page: '1',
                  },
                  false,
                  true,
                )
              }
              maxLength={254}
              className="h-9 w-52 rounded-xl border border-white/80 bg-white/65 pr-3 pl-8 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            />
          </div>
          <NativeSelect
            aria-label="辅助邮箱排序方式"
            value={sort}
            onChange={(e) =>
              change({
                view: params.get('view') || '',
                recovery_search: search,
                recovery_sort: e.target.value,
                recovery_page: '1',
              })
            }
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {linkNotice && (
        <p
          role="status"
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-control)] px-3.5 py-2 text-xs text-[var(--text-primary)]"
        >
          {linkNotice}
        </p>
      )}

      {/* 顶部统计汇总卡片 */}
      <div className="grid gap-3 sm:grid-cols-3">
        <GlassPanel className="flex items-center gap-3 p-3.5">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <Mail className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs text-[var(--text-secondary)]">辅助邮箱总数</p>
            <p className="text-lg font-bold tabular-nums text-[var(--text-primary)]">
              {totalRecovery}
            </p>
          </div>
        </GlassPanel>
        <GlassPanel className="flex items-center gap-3 p-3.5">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--success-soft)] text-[var(--success-text)]">
            <Users className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs text-[var(--text-secondary)]">覆盖关联账号</p>
            <p className="text-lg font-bold tabular-nums text-[var(--text-primary)]">
              {totalAccounts}
            </p>
          </div>
        </GlassPanel>
        <GlassPanel className="flex items-center gap-3 p-3.5">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--warning-soft)] text-[var(--warning-text)]">
            <AlertTriangle className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs text-[var(--text-secondary)]">
              含异常关联邮箱
            </p>
            <p className="text-lg font-bold tabular-nums text-[var(--text-primary)]">
              {abnormalGroups}
            </p>
          </div>
        </GlassPanel>
      </div>

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
                ].map((title) => (
                  <TableHead key={title} className="whitespace-nowrap">
                    {title}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {usage.data?.items.map((row) => (
                <TableRow
                  key={row.email}
                  data-state={
                    inspectEmail === row.email ? 'selected' : undefined
                  }
                >
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-[var(--text-primary)]">
                        {row.email}
                      </span>
                      {onCopy && (
                        <button
                          type="button"
                          aria-label={`复制辅助邮箱 ${row.email}`}
                          onClick={() => onCopy(row.email)}
                          className="inline-flex size-6 items-center justify-center rounded-md text-[var(--text-secondary)] transition-colors hover:bg-white/80 hover:text-[var(--accent)]"
                        >
                          <Copy className="size-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="tabular-nums font-semibold">
                    {row.account_count}
                  </TableCell>
                  <TableCell className="tabular-nums text-[var(--success-text)]">
                    {row.normal_count}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {row.abnormal_count > 0 ? (
                      <span className="rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--danger)]">
                        {row.abnormal_count}
                      </span>
                    ) : (
                      <span className="text-[var(--text-secondary)]">0</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {localDate(row.latest_registered_at)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigateToAccounts(row.email)}
                      >
                        查看关联账号
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={inspectEmail === row.email}
                        aria-label={
                          inspectEmail === row.email
                            ? `收起 ${row.email} 关联账号预览`
                            : `快速预览 ${row.email} 关联账号`
                        }
                        onClick={() =>
                          setInspectEmail((prev) =>
                            prev === row.email ? null : row.email,
                          )
                        }
                      >
                        {inspectEmail === row.email ? '收起预览' : '快速预览'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!usage.data?.total && <p>暂无辅助邮箱关联</p>}

          {/* 快速下钻预览面板（调用 /api/v1/recovery-email-accounts?email=...，绝不含密码） */}
          {inspectEmail && (
            <GlassPanel
              variant="strong"
              className="space-y-3 p-4"
              aria-label={`辅助邮箱 ${inspectEmail} 关联账号预览`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    关联账号预览：{inspectEmail}
                  </h3>
                  <p className="text-xs text-[var(--text-secondary)]">
                    最多展示前 20
                    条关联记录，点击右侧可在主列表执行完整筛选与批量管理。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigateToAccounts(inspectEmail)}
                  >
                    在账号列表中打开
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="关闭关联账号预览"
                    onClick={() => setInspectEmail(null)}
                  >
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              {linkedAccounts.isPending ? (
                <p
                  role="status"
                  className="text-xs text-[var(--text-secondary)]"
                >
                  正在加载关联账号…
                </p>
              ) : linkedAccounts.isError ? (
                <div
                  role="alert"
                  className="flex flex-wrap items-center gap-2 text-xs text-[var(--danger-text)]"
                >
                  <span>加载关联账号失败，请重试。</span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void linkedAccounts.refetch()}
                  >
                    重试
                  </Button>
                </div>
              ) : (
                <ul className="divide-y divide-[var(--table-divider)] rounded-xl border border-[var(--border)] bg-white/45">
                  {linkedAccounts.data?.items.map((acc) => (
                    <li
                      key={acc.id}
                      className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
                    >
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[var(--text-secondary)]">
                          {acc.account_no}
                        </span>
                        <span className="font-medium text-[var(--text-primary)]">
                          {acc.gmail_email}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusPill status={acc.status} />
                        <span className="tabular-nums text-[var(--text-secondary)]">
                          {localDate(acc.registered_at)}
                        </span>
                      </div>
                    </li>
                  ))}
                  {!linkedAccounts.data?.items.length && (
                    <li className="px-3 py-2 text-xs text-[var(--text-secondary)]">
                      暂无匹配的关联账号。
                    </li>
                  )}
                </ul>
              )}
            </GlassPanel>
          )}

          <Pagination
            page={page}
            fixedSize
            page_size={usage.data?.page_size ?? 30}
            total={usage.data?.total || 0}
            change={(values) =>
              change({
                recovery_page: values.page || '1',
                recovery_search: search,
                recovery_sort: sort || '',
                view: params.get('view') || '',
              })
            }
          />
        </>
      )}
    </section>
  );
}
