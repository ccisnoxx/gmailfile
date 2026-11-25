import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { dashboardSummary } from '@/api/generated';
import { Button } from '@/components/ui/button';

const summaryLabels = {
  total: '账号总数',
  normal: '正常',
  pending_verification: '待验证',
  abnormal: '异常',
  added_this_month: '本月新增',
  unverified_over_30_days: '超过 30 天未验证',
} as const;

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
  }, [summary.error, onFailure]);

  return (
    <section aria-label="账号全局统计" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Object.entries(summaryLabels).map(([key, label]) => (
          <div key={key} className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-3xl font-semibold tabular-nums">
              {summary.data
                ? summary.data[key as keyof typeof summaryLabels]
                : '—'}
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
