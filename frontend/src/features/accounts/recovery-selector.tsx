import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { accountsOptions } from '@/api/generated';
import type { AccountDetail } from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';

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
    account?.recovery_account_id
      ? { id: account.recovery_account_id, gmail_email: account.recovery_email }
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
  }, [options.error]);
  return (
    <div className="space-y-2">
      <Input
        aria-label="搜索辅助账号"
        placeholder="按编号或邮箱搜索全部可选账号"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <NativeSelect
        id="recovery-account"
        required
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          const next = options.data?.items.find((a) => a.id === e.target.value);
          if (next) setChoice(next);
        }}
      >
        <option value="">请选择账号</option>
        {choice && !options.data?.items.some((a) => a.id === choice.id) && (
          <option value={choice.id}>
            {choice.gmail_email}（当前关联，可保留）
          </option>
        )}
        {options.data?.items.map((a) => (
          <option key={a.id} value={a.id}>
            {a.account_no} · {a.gmail_email}
          </option>
        ))}
      </NativeSelect>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span>
          {options.isPending
            ? '正在加载…'
            : `共 ${options.data?.total ?? 0} 个可选账号 · 第 ${page} 页`}
        </span>
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
      {options.isError && (
        <p role="alert">
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
