import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { recoveryEmailsList } from '@/api/generated';
import { Button } from '@/components/ui/button';
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

export function RecoveryPage({
  params,
  change,
  onFailure,
}: {
  params: URLSearchParams;
  change: AccountLocationChange;
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
  }, [usage.error, onFailure]);

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
                ].map((title) => (
                  <TableHead key={title}>{title}</TableHead>
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
