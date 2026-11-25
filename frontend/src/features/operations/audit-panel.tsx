import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { auditsIntegrity, auditsList } from '@/api/generated';
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
  const integrity = useQuery({
    queryKey: ['audits-integrity'],
    queryFn: async ({ signal }) =>
      (await auditsIntegrity({ signal, throwOnError: true })).data,
  });

  useEffect(() => {
    if (query.error) props.onFailure(query.error);
  }, [query.error, props.onFailure]);

  useEffect(() => {
    if (integrity.error) props.onFailure(integrity.error);
  }, [integrity.error, props.onFailure]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">审计日志</h2>
        <Button
          variant="outline"
          size="sm"
          disabled={integrity.isFetching}
          onClick={() => void integrity.refetch()}
        >
          {integrity.isFetching ? '正在校验…' : '校验哈希链'}
        </Button>
      </div>
      {integrity.data && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-4 py-3 text-sm"
        >
          <div className="flex items-center gap-2 font-medium">
            {integrity.data.valid ? (
              <>
                <ShieldCheck className="size-4 text-primary" />
                <span>防篡改哈希链校验通过</span>
              </>
            ) : (
              <>
                <ShieldAlert className="size-4 text-destructive" />
                <span>
                  检测到审计链异常
                  {integrity.data.broken_seq != null
                    ? `（序号 #${integrity.data.broken_seq}）`
                    : ''}
                </span>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            <span>共 {integrity.data.total_events} 条</span>
            <span>
              最新序号：
              {integrity.data.latest_seq != null
                ? `#${integrity.data.latest_seq}`
                : '—'}
            </span>
            <span className="font-mono">
              链尾摘要：
              {integrity.data.latest_hash
                ? integrity.data.latest_hash.slice(0, 16)
                : '—'}
            </span>
            <span>在线保留策略：{integrity.data.retention_days} 天</span>
          </div>
        </div>
      )}
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
                <TableHead>序号</TableHead>
                <TableHead>时间</TableHead>
                <TableHead>事件 / 操作</TableHead>
                <TableHead>账号 ID</TableHead>
                <TableHead>Session ID</TableHead>
                <TableHead>来源 IP</TableHead>
                <TableHead>链哈希</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="font-mono text-xs">#{e.seq}</TableCell>
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
                  <TableCell className="font-mono text-xs" title={e.event_hash}>
                    {e.event_hash.slice(0, 12)}
                  </TableCell>
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
