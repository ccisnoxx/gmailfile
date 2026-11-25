import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditsList } from '@/api/generated';
import type { AuditsListData } from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { dateBoundary } from '@/features/accounts/query-state';
import { localDate } from '@/lib/format';
import {
  failureText,
  OperationsPager,
  type OperationsPanelProps,
} from './shared';

type AuditQuery = NonNullable<AuditsListData['query']>;

export function AuditPanel(props: OperationsPanelProps) {
  const [params, setParams] = useState<AuditQuery>({ page: 1, page_size: 30 });
  const query = useQuery({
    queryKey: ['audits', params],
    queryFn: async ({ signal }) =>
      (await auditsList({ query: params, signal, throwOnError: true })).data,
  });

  useEffect(() => {
    if (query.error) props.onFailure(query.error);
  }, [query.error, props.onFailure]);

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">审计日志</h2>
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          setParams({
            page: 1,
            page_size: 30,
            event_type: String(d.get('event')) || undefined,
            account_id: String(d.get('account')) || undefined,
            session_id: String(d.get('session')) || undefined,
            created_from: dateBoundary(String(d.get('from'))),
            created_to: dateBoundary(String(d.get('to')), true),
          });
        }}
      >
        <label className="space-y-1 text-sm">
          事件
          <NativeSelect name="event">
            <option value="">全部事件</option>
            {query.data?.event_types.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </NativeSelect>
        </label>
        <label className="space-y-1 text-sm">
          账号 ID
          <Input name="account" placeholder="可选 UUID" />
        </label>
        <label className="space-y-1 text-sm">
          Session ID
          <Input name="session" placeholder="可选 UUID" />
        </label>
        <label className="space-y-1 text-sm">
          开始日期（本地）
          <Input name="from" type="date" />
        </label>
        <label className="space-y-1 text-sm">
          结束日期（含本地整日）
          <Input name="to" type="date" />
        </label>
        <Button className="self-end">筛选日志</Button>
      </form>
      {query.error ? (
        <p role="alert">{failureText(query.error)}</p>
      ) : !query.data ? (
        <p>正在读取…</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>事件 / 操作</TableHead>
                <TableHead>账号 ID</TableHead>
                <TableHead>Session ID</TableHead>
                <TableHead>来源 IP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{localDate(e.created_at)}</TableCell>
                  <TableCell>
                    {e.event_type}
                    <br />
                    <span className="text-muted-foreground">
                      {e.operation || '—'}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.account_id || '—'}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {e.session_id || '—'}
                  </TableCell>
                  <TableCell>{e.ip_address || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {query.data.total === 0 && <p>没有匹配的审计记录。</p>}
          <OperationsPager
            page={params.page || 1}
            total={query.data.total}
            size={30}
            change={(page) => setParams({ ...params, page })}
          />
        </>
      )}
    </div>
  );
}
