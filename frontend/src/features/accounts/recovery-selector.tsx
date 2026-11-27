import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Search } from 'lucide-react';
import { accountsOptions } from '@/api/generated';
import type { AccountDetail, AccountOption } from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { statusLabels } from './constants';

export function RecoverySelector({
  account,
  value,
  onChange,
  onFailure,
}: {
  account?: AccountDetail;
  value: string;
  onChange: (id: string) => void;
  onFailure: (e: unknown) => void;
}) {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [choice, setChoice] = useState<{
    id: string;
    gmail_email: string;
  } | null>(
    account?.recovery_account_id && account.recovery_email
      ? {
          id: account.recovery_account_id,
          gmail_email: account.recovery_email,
        }
      : null,
  );
  const options = useQuery({
    queryKey: ['account-options', search, page, account?.id],
    queryFn: async ({ signal }) =>
      (
        await accountsOptions({
          query: { search, page, exclude_id: account?.id },
          signal,
          throwOnError: true,
        })
      ).data,
  });
  useEffect(() => {
    if (options.error) onFailure(options.error);
  }, [options.error, onFailure]);

  const items: AccountOption[] = options.data?.items ?? [];
  const selectedOption = items.find((item) => item.id === value);
  const selectedRisky =
    selectedOption &&
    ['restricted', 'login_failed', 'disabled'].includes(
      selectedOption.status ?? 'normal',
    );
  const selectedConcentrated =
    selectedOption && (selectedOption.linked_recovery_count ?? 0) >= 3;

  return (
    <div
      data-slot="recovery-combobox"
      className="space-y-2 rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] p-2.5"
    >
      <div className="relative flex items-center">
        <Search
          className="pointer-events-none absolute left-2.5 size-3.5 text-[var(--text-secondary)]"
          aria-hidden="true"
        />
        <Input
          aria-label="搜索辅助账号"
          placeholder="搜索候选账号编号或邮箱…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="h-8 pl-8 text-xs"
        />
      </div>

      <NativeSelect
        id="recovery-account"
        required
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          const next = items.find((a) => a.id === e.target.value);
          if (next) setChoice({ id: next.id, gmail_email: next.gmail_email });
        }}
        className="text-xs"
      >
        <option value="">请选择账号</option>
        {choice && !items.some((a) => a.id === choice.id) && (
          <option value={choice.id}>
            {choice.gmail_email}（当前关联，可保留）
          </option>
        )}
        {items.map((a) => {
          const loadSuffix =
            (a.linked_recovery_count ?? 0) > 0
              ? ` · 已绑 ${a.linked_recovery_count} 个`
              : '';
          const statusText =
            a.status && a.status !== 'normal'
              ? ` · ${statusLabels[a.status]}`
              : '';
          return (
            <option key={a.id} value={a.id}>
              {a.account_no} · {a.gmail_email}
              {loadSuffix}
              {statusText}
            </option>
          );
        })}
      </NativeSelect>

      {/* 快速点选候选列表（实时直观查看集中度与状态） */}
      {items.length > 0 && (
        <div
          role="list"
          aria-label="候选辅助账号负载速览"
          className="macos-thin-scrollbar max-h-32 space-y-1 overflow-y-auto pt-0.5"
        >
          {items.slice(0, 6).map((item) => {
            const active = item.id === value;
            const linkedCnt = item.linked_recovery_count ?? 0;
            const status = item.status ?? 'normal';
            const risky = ['restricted', 'login_failed', 'disabled'].includes(
              status,
            );
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onChange(item.id);
                  setChoice({ id: item.id, gmail_email: item.gmail_email });
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left text-[11.5px] transition-colors',
                  active
                    ? 'bg-[var(--accent-soft)] font-semibold text-[var(--accent-text)]'
                    : 'text-[var(--text-primary)] hover:bg-[var(--surface-control-hover)]',
                )}
              >
                <span className="flex min-w-0 items-center gap-1.5 truncate">
                  <span className="shrink-0 font-mono text-[10.5px] text-[var(--text-secondary)]">
                    {item.account_no}
                  </span>
                  <span className="truncate">{item.gmail_email}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5 text-[10.5px] tabular-nums">
                  {risky && (
                    <span className="rounded bg-[var(--badge-red-bg)] px-1.5 py-0.5 text-[var(--badge-red-text)]">
                      {statusLabels[status]}
                    </span>
                  )}
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5',
                      linkedCnt >= 3
                        ? 'bg-[var(--badge-orange-bg)] font-semibold text-[var(--badge-orange-text)]'
                        : 'bg-white/70 text-[var(--text-secondary)]',
                    )}
                  >
                    已绑 {linkedCnt}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {selectedOption && (selectedRisky || selectedConcentrated) && (
        <p className="flex items-center gap-1.5 rounded-lg bg-[var(--badge-orange-bg)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--badge-orange-text)]">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            {selectedRisky
              ? `该辅助账号当前处于「${statusLabels[selectedOption.status!]}」状态，可能影响找回验证。`
              : `该辅助账号已绑定 ${selectedOption.linked_recovery_count} 个子账号，建议分散绑定降低连带风险。`}
          </span>
        </p>
      )}
      {selectedOption && !selectedRisky && !selectedConcentrated && (
        <p className="flex items-center gap-1 text-[11px] text-[var(--success-text)]">
          <CheckCircle2 className="size-3 shrink-0" aria-hidden="true" />
          <span>
            状态正常 · 当前关联 {selectedOption.linked_recovery_count ?? 0}{' '}
            个子账号
          </span>
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--table-divider)] pt-1.5 text-xs text-[var(--text-secondary)]">
        <span>
          {options.isPending
            ? '正在加载…'
            : `共 ${options.data?.total ?? 0} 个可选账号 · 第 ${page} 页`}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page <= 1 || options.isFetching}
            onClick={() => setPage(page - 1)}
          >
            上一组账号
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={
              options.isFetching ||
              !options.data ||
              page * options.data.page_size >= options.data.total
            }
            onClick={() => setPage(page + 1)}
          >
            下一组账号
          </Button>
        </div>
      </div>
      {options.isError && (
        <p role="alert" className="text-xs text-[var(--danger-text)]">
          辅助账号加载失败。
          <Button
            type="button"
            variant="ghost"
            onClick={() => void options.refetch()}
          >
            重试加载辅助账号
          </Button>
        </p>
      )}
    </div>
  );
}
