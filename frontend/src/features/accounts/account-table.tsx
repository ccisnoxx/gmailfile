import { Copy } from 'lucide-react';
import type { AccountSummary } from '@/api/generated';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  accountColumnLabels,
  factorLabels,
  localDate,
  statusLabels,
  type AccountAction,
  type AccountColumnKey,
} from './constants';

export function ColumnToggle({
  columns,
  onToggle,
}: {
  columns: Record<AccountColumnKey, boolean>;
  onToggle: (key: AccountColumnKey, checked: boolean) => void;
}) {
  return (
    <details className="rounded-lg border bg-card p-3">
      <summary className="cursor-pointer text-sm">显示列</summary>
      <div className="mt-3 flex flex-wrap gap-4">
        {(
          Object.entries(accountColumnLabels) as [AccountColumnKey, string][]
        ).map(([key, label]) => (
          <label key={key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={columns[key]}
              onChange={(e) => onToggle(key, e.target.checked)}
            />
            {label}
          </label>
        ))}
      </div>
    </details>
  );
}

export function AccountTable({
  items,
  total,
  isPending,
  isError,
  deleted,
  busy,
  columns,
  selected,
  onToggleAll,
  onToggleOne,
  onOpen,
  onCopy,
  onMarkVerified,
}: {
  items: AccountSummary[];
  total: number;
  isPending: boolean;
  isError: boolean;
  deleted: boolean;
  busy: boolean;
  columns: Record<AccountColumnKey, boolean>;
  selected: Record<string, boolean>;
  onToggleAll: (checked: boolean) => void;
  onToggleOne: (id: string, checked: boolean) => void;
  onOpen: (
    account: AccountSummary,
    edit?: boolean,
    action?: AccountAction,
  ) => void;
  onCopy: (value: string) => void;
  onMarkVerified: (account: AccountSummary) => void;
}) {
  if (isPending) {
    return (
      <div role="status" aria-busy="true">
        <p className="mb-3 text-sm">正在加载账号…</p>
        <div aria-hidden="true" className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div key={n} className="h-12 animate-pulse rounded bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>账号加载失败</EmptyTitle>
          <EmptyDescription>检查连接后，点击刷新列表重试。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  if (!items.length) {
    return (
      <Empty className="min-h-64 border">
        <EmptyHeader>
          <EmptyTitle>
            {total > 0
              ? '这一页没有记录，请返回第一页'
              : deleted
                ? '没有匹配的已删除账号'
                : '没有匹配的账号'}
          </EmptyTitle>
          <EmptyDescription>
            {deleted
              ? '删除的账号会出现在这里。'
              : '点击“新增账号”，填写邮箱、密码与辅助邮箱。'}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <Table aria-label={deleted ? '已删除账号列表' : '账号列表'}>
        <TableHeader>
          <TableRow>
            {!deleted && (
              <TableHead>
                <input
                  type="checkbox"
                  aria-label="选择当前页全部账号"
                  checked={
                    items.length > 0 && items.every((a) => selected[a.id])
                  }
                  onChange={(e) => onToggleAll(e.target.checked)}
                />
              </TableHead>
            )}
            <TableHead>编号 / Gmail 邮箱</TableHead>
            {(
              Object.entries(accountColumnLabels) as [
                AccountColumnKey,
                string,
              ][]
            )
              .filter(([key]) => columns[key])
              .map(([key, label]) => (
                <TableHead key={key}>{label}</TableHead>
              ))}
            <TableHead className="sticky right-0 z-10 bg-card">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((a) => (
            <TableRow
              key={a.id}
              className="cursor-pointer"
              onClick={(e) => {
                if (
                  !(e.target as HTMLElement).closest(
                    'button,input,a,summary,details',
                  )
                )
                  onOpen(a);
              }}
            >
              {!deleted && (
                <TableCell>
                  <input
                    type="checkbox"
                    aria-label={`选择 ${a.account_no}`}
                    checked={!!selected[a.id]}
                    onChange={(e) => onToggleOne(a.id, e.target.checked)}
                  />
                </TableCell>
              )}
              <TableCell>
                <p className="mb-1 text-xs text-muted-foreground">
                  {a.account_no}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    className="text-left font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2"
                    onClick={() => onOpen(a)}
                  >
                    {a.gmail_email}
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`复制邮箱 ${a.gmail_email}`}
                    onClick={() => onCopy(a.gmail_email)}
                  >
                    <Copy />
                  </Button>
                </div>
              </TableCell>
              <TableCell hidden={!columns.registered}>
                {localDate(a.registered_at)}
              </TableCell>
              <TableCell hidden={!columns.recovery}>
                <div className="flex items-center gap-2">
                  <span className="max-w-52 truncate" title={a.recovery_email}>
                    {a.recovery_email}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`复制辅助邮箱 ${a.recovery_email}`}
                    onClick={() => onCopy(a.recovery_email)}
                  >
                    <Copy />
                  </Button>
                </div>
              </TableCell>
              <TableCell hidden={!columns.status}>
                <Badge
                  variant={a.status === 'normal' ? 'default' : 'secondary'}
                >
                  {statusLabels[a.status]}
                </Badge>
              </TableCell>
              <TableCell hidden={!columns.factor}>
                {factorLabels[a.two_factor_status]}
              </TableCell>
              <TableCell hidden={!columns.purpose}>
                <p>{a.purpose || '—'}</p>
              </TableCell>
              <TableCell hidden={!columns.tags}>
                <div className="flex max-w-52 flex-wrap gap-1">
                  {a.tags.slice(0, 3).map((t) => (
                    <Badge variant="outline" key={t.id}>
                      {t.name}
                    </Badge>
                  ))}
                  {a.tags.length > 3 && (
                    <details>
                      <summary>另 {a.tags.length - 3} 个标签</summary>
                      {a.tags.slice(3).map((t) => (
                        <p key={t.id}>{t.name}</p>
                      ))}
                    </details>
                  )}
                </div>
              </TableCell>
              <TableCell hidden={!columns.verified}>
                {localDate(a.last_verified_at)}
                {!deleted && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`标记 ${a.account_no} 今天已验证`}
                    disabled={busy}
                    onClick={() => onMarkVerified(a)}
                  >
                    标记今天
                  </Button>
                )}
              </TableCell>
              <TableCell hidden={!columns.updated}>
                {localDate(a.updated_at)}
              </TableCell>
              <TableCell className="sticky right-0 z-10 bg-card shadow-[-4px_0_6px_-4px_#0002]">
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => onOpen(a)}>
                    详情
                  </Button>
                  {!deleted && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onOpen(a, true)}
                    >
                      编辑
                    </Button>
                  )}
                  {!deleted && a.status !== 'archived' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onOpen(a, false, 'archive')}
                    >
                      归档
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
