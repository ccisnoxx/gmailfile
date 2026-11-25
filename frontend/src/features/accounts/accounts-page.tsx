import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Archive,
  Copy,
  Mail,
  Plus,
  ShieldCheck,
  Tag,
  Trash2,
} from 'lucide-react';
import type {
  AccountCreateWritable,
  AccountDetail,
  AccountSummary,
  ErrorResponse,
  SessionResponse,
  TagResponse,
} from '@/api/generated';
import {
  accountsArchive,
  accountsCreate,
  accountsDelete,
  accountsDetail,
  accountsList,
  accountsMarkLoggedIn,
  accountsMarkVerified,
  accountsPatch,
  accountsRestore,
  tagsCreate,
  tagsDelete,
  tagsList,
  tagsPatch,
} from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AccountForm,
  statusLabels,
  factorLabels,
  localDate,
} from './account-form';
import { PasswordControl } from './password-control';
import { useAccountLocation, accountQuery } from './query-state';
import {
  Summary,
  Filters,
  Pagination,
  BatchBar,
  RecoveryPage,
} from './management';

type Action = 'archive' | 'delete' | 'restore' | 'verified' | 'logged-in';
const actionLabels: Record<Action, string> = {
  archive: '归档',
  delete: '删除',
  restore: '恢复',
  verified: '今天已验证',
  'logged-in': '今天已登录',
};

export function AccountsPage({
  session,
  onSession,
  onFailure,
  onSecurity,
  onLogout,
}: {
  session: SessionResponse;
  onSession: (value: SessionResponse) => void;
  onFailure: (error: unknown) => void;
  onSecurity: () => void;
  onLogout: () => void;
}) {
  const queryClient = useQueryClient();
  const { params, change, search } = useAccountLocation();
  const query = accountQuery(params);
  const deleted = query.deleted === true;
  const recoveryView = params.get('view') === 'recovery';
  const setDeleted = (value: boolean) =>
    change({ deleted: value ? 'true' : '', view: '' }, true);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [columns, setColumns] = useState<Record<string, boolean>>({
    registered: true,
    recovery: true,
    status: true,
    factor: true,
    purpose: true,
    tags: true,
    verified: true,
    updated: false,
  });
  const [detail, setDetail] = useState<AccountDetail | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [form, setForm] = useState<'new' | 'edit' | null>(null);
  const [confirm, setConfirm] = useState<Action | null>(null);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagTarget, setTagTarget] = useState<TagResponse | null>(null);
  const [tagName, setTagName] = useState('');
  const [tagDelete, setTagDelete] = useState<TagResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [secretEpoch, setSecretEpoch] = useState(0);
  const generation = useRef(0);
  const returnFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    returnFocus.current?.focus();
  };
  const headers = { 'X-CSRF-Token': session.csrf_token };
  const list = useQuery({
    queryKey: ['accounts', query],
    queryFn: async ({ signal }) =>
      (await accountsList({ query, signal, throwOnError: true })).data,
    enabled: !recoveryView,
  });
  const tags = useQuery({
    queryKey: ['tags'],
    queryFn: async ({ signal }) =>
      (await tagsList({ signal, throwOnError: true })).data,
  });
  useEffect(() => {
    if (list.error) fail(list.error);
  }, [list.error]);
  useEffect(() => {
    if (tags.error) fail(tags.error);
  }, [tags.error]);
  useEffect(
    () => () => {
      generation.current++;
      queryClient.removeQueries({ queryKey: ['accounts'] });
      queryClient.removeQueries({ queryKey: ['tags'] });
      queryClient.removeQueries({ queryKey: ['summary'] });
      queryClient.removeQueries({ queryKey: ['recovery-usage'] });
      queryClient.removeQueries({ queryKey: ['account-options'] });
    },
    [queryClient],
  );
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        generation.current++;
        setDrawer(false);
        setForm(null);
        setDetail(null);
        setSecretEpoch((n) => n + 1);
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);

  function fail(error: unknown) {
    const code = (error as Partial<ErrorResponse>)?.error?.code;
    if (code === 'ROW_VERSION_CONFLICT') {
      setConflict(true);
      setNotice(
        '账号已被其他页面修改。当前内容未覆盖服务器，请重新加载最新版本后再编辑。',
      );
    } else
      setNotice(
        (error as Partial<ErrorResponse>)?.error?.message ??
          '无法连接服务，请稍后手动重试。',
      );
    if (['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(code ?? ''))
      onFailure(error);
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setNotice('');
    const ticket = generation.current;
    try {
      await action();
    } catch (error) {
      if (ticket === generation.current) fail(error);
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  async function refresh() {
    setSelected({});
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['summary'] }),
      queryClient.invalidateQueries({ queryKey: ['recovery-usage'] }),
      queryClient.invalidateQueries({ queryKey: ['account-options'] }),
      queryClient.invalidateQueries({ queryKey: ['accounts'] }),
      queryClient.invalidateQueries({ queryKey: ['tags'] }),
    ]);
  }
  async function open(account: AccountSummary, edit = false, action?: Action) {
    if (
      document.activeElement instanceof HTMLElement &&
      !document.activeElement.closest('[role="dialog"]')
    )
      returnFocus.current = document.activeElement;
    const ticket = ++generation.current;
    setDetail(null);
    setForm(null);
    setConflict(false);
    setNotice('');
    setDrawer(!edit);
    setBusy(true);
    try {
      const { data } = await accountsDetail({
        path: { account_id: account.id },
        throwOnError: true,
      });
      if (ticket === generation.current && !document.hidden) {
        setDetail(data);
        if (edit) setForm('edit');
        if (action) setConfirm(action);
      }
    } catch (error) {
      if (ticket === generation.current) fail(error);
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  function close() {
    generation.current++;
    setBusy(false);
    setDrawer(false);
    setForm(null);
    setDetail(null);
    setConflict(false);
    setSecretEpoch((n) => n + 1);
  }
  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice('邮箱已复制。');
    } catch {
      setNotice('浏览器不允许复制，请手动选择邮箱复制。');
    }
  }
  async function save(body: AccountCreateWritable) {
    const ticket = generation.current;
    await run(async () => {
      let data: AccountDetail;
      if (form === 'edit' && detail) {
        const patch = { ...body, row_version: detail.row_version };
        if (!body.password) Reflect.deleteProperty(patch, 'password');
        data = (
          await accountsPatch({
            path: { account_id: detail.id },
            body: patch,
            headers,
            throwOnError: true,
          })
        ).data;
      } else
        data = (await accountsCreate({ body, headers, throwOnError: true }))
          .data;
      if (ticket !== generation.current || document.hidden) {
        await refresh();
        return;
      }
      close();
      setNotice(`${data.account_no} 已保存。`);
      await refresh();
    });
  }
  async function act(action: Action) {
    if (!detail) return;
    const ticket = generation.current;
    await run(async () => {
      const fn = {
        archive: accountsArchive,
        delete: accountsDelete,
        restore: accountsRestore,
        verified: accountsMarkVerified,
        'logged-in': accountsMarkLoggedIn,
      }[action];
      const { data } = await fn({
        path: { account_id: detail.id },
        body: { row_version: detail.row_version },
        headers,
        throwOnError: true,
      });
      await refresh();
      if (ticket !== generation.current || document.hidden) return;
      setConfirm(null);
      setDetail(data);
      setSecretEpoch((n) => n + 1);
      setNotice(`${actionLabels[action]}成功。`);
    });
  }
  const all = list.data?.items ?? [];
  useEffect(() => {
    close();
    setSelected({});
  }, [search]);
  useEffect(() => {
    setSelected({});
  }, [list.dataUpdatedAt]);
  const columnLabels = {
    registered: '注册时间',
    recovery: '辅助邮箱',
    status: '状态',
    factor: '二步验证',
    purpose: '用途',
    tags: '标签',
    verified: '最后验证',
    updated: '更新时间',
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-6 py-5 lg:px-10">
          <div className="flex items-center gap-3 font-semibold">
            <Mail className="size-5 text-primary" aria-hidden="true" />
            Gmail 账号管理
          </div>
          <nav aria-label="工作区" className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                close();
                onSecurity();
              }}
            >
              <ShieldCheck data-icon="inline-start" />
              安全设置
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                close();
                onLogout();
              }}
            >
              退出
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto flex min-w-0 max-w-[1500px] flex-col gap-4 px-6 py-6 lg:px-10">
        <Summary onFailure={fail} />
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {deleted ? '已删除账号' : '账号管理'}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {deleted
                ? '邮箱唯一性和关联仍然保留，可逐条恢复。'
                : '维护账号资料与使用状态。密码仅在单独验证后按需显示。'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                returnFocus.current = document.activeElement as HTMLElement;
                setTagOpen(true);
              }}
            >
              <Tag data-icon="inline-start" />
              管理标签
            </Button>
            {!deleted && (
              <Button
                onClick={() => {
                  close();
                  returnFocus.current = document.activeElement as HTMLElement;
                  setForm('new');
                }}
              >
                <Plus data-icon="inline-start" />
                新增账号
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <nav aria-label="账号记录" className="flex flex-wrap gap-2">
            <Button
              variant={!deleted && !recoveryView ? 'secondary' : 'ghost'}
              aria-pressed={!deleted && !recoveryView}
              onClick={() => {
                close();
                setDeleted(false);
              }}
            >
              全部账号
            </Button>
            <Button
              variant={deleted ? 'secondary' : 'ghost'}
              aria-pressed={deleted}
              onClick={() => {
                close();
                setDeleted(true);
              }}
            >
              <Trash2 data-icon="inline-start" />
              已删除记录
            </Button>
            <Button
              variant={recoveryView ? 'secondary' : 'ghost'}
              aria-pressed={recoveryView}
              onClick={() => change({ view: 'recovery' }, true)}
            >
              辅助邮箱使用情况
            </Button>
          </nav>
          <Button variant="ghost" onClick={() => void refresh()}>
            刷新列表
          </Button>
        </div>
        {notice && (
          <Alert variant={conflict ? 'destructive' : 'default'} role="status">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {recoveryView ? (
          <RecoveryPage params={params} change={change} onFailure={fail} />
        ) : (
          <>
            <Filters params={params} change={change} tags={tags.data ?? []} />
            <div className="flex flex-wrap items-start gap-3">
              <details className="rounded-lg border bg-card p-3">
                <summary className="cursor-pointer text-sm">显示列</summary>
                <div className="mt-3 flex flex-wrap gap-4">
                  {Object.entries(columnLabels).map(([key, label]) => (
                    <label
                      key={key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={columns[key]}
                        onChange={(e) =>
                          setColumns({ ...columns, [key]: e.target.checked })
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </details>
              {!deleted && (
                <BatchBar
                  key={search + ':' + list.dataUpdatedAt}
                  selected={all.filter((a) => selected[a.id])}
                  tags={tags.data ?? []}
                  session={session}
                  complete={async () => {
                    await refresh();
                    setNotice('整批操作已提交。');
                  }}
                  onFailure={(error) => {
                    const code = (error as ErrorResponse)?.error?.code;
                    if (
                      [
                        'AUTH_REQUIRED',
                        'MFA_REQUIRED',
                        'CSRF_INVALID',
                      ].includes(code)
                    )
                      onFailure(error);
                  }}
                />
              )}
            </div>
            {list.isPending ? (
              <div role="status" aria-busy="true">
                <p className="mb-3 text-sm">正在加载账号…</p>
                <div aria-hidden="true" className="space-y-3">
                  {[1, 2, 3].map((n) => (
                    <div
                      key={n}
                      className="h-12 animate-pulse rounded bg-muted"
                    />
                  ))}
                </div>
              </div>
            ) : list.isError ? (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>账号加载失败</EmptyTitle>
                  <EmptyDescription>
                    检查连接后，点击刷新列表重试。
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : !all.length ? (
              <Empty className="min-h-64 border">
                <EmptyHeader>
                  <EmptyTitle>
                    {list.data && list.data.total > 0
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
            ) : (
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
                              all.length > 0 && all.every((a) => selected[a.id])
                            }
                            onChange={(e) =>
                              setSelected(
                                e.target.checked
                                  ? Object.fromEntries(
                                      all.map((a) => [a.id, true]),
                                    )
                                  : {},
                              )
                            }
                          />
                        </TableHead>
                      )}
                      <TableHead>编号 / Gmail 邮箱</TableHead>
                      {Object.entries(columnLabels)
                        .filter(([key]) => columns[key])
                        .map(([key, label]) => (
                          <TableHead key={key}>{label}</TableHead>
                        ))}
                      <TableHead className="sticky right-0 z-10 bg-card">
                        操作
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {all.map((a) => (
                      <TableRow
                        key={a.id}
                        className="cursor-pointer"
                        onClick={(e) => {
                          if (
                            !(e.target as HTMLElement).closest(
                              'button,input,a,summary,details',
                            )
                          )
                            void open(a);
                        }}
                      >
                        {!deleted && (
                          <TableCell>
                            <input
                              type="checkbox"
                              aria-label={`选择 ${a.account_no}`}
                              checked={!!selected[a.id]}
                              onChange={(e) =>
                                setSelected({
                                  ...selected,
                                  [a.id]: e.target.checked,
                                })
                              }
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
                              onClick={() => void open(a)}
                            >
                              {a.gmail_email}
                            </button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`复制邮箱 ${a.gmail_email}`}
                              onClick={() => void copy(a.gmail_email)}
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
                            <span
                              className="max-w-52 truncate"
                              title={a.recovery_email}
                            >
                              {a.recovery_email}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`复制辅助邮箱 ${a.recovery_email}`}
                              onClick={() => void copy(a.recovery_email)}
                            >
                              <Copy />
                            </Button>
                          </div>
                        </TableCell>
                        <TableCell hidden={!columns.status}>
                          <Badge
                            variant={
                              a.status === 'normal' ? 'default' : 'secondary'
                            }
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
                              onClick={() =>
                                void run(async () => {
                                  await accountsMarkVerified({
                                    path: { account_id: a.id },
                                    body: { row_version: a.row_version },
                                    headers,
                                    throwOnError: true,
                                  });
                                  await refresh();
                                  setNotice(`${a.account_no} 今天已验证。`);
                                })
                              }
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
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void open(a)}
                            >
                              详情
                            </Button>
                            {!deleted && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void open(a, true)}
                              >
                                编辑
                              </Button>
                            )}
                            {!deleted && a.status !== 'archived' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void open(a, false, 'archive')}
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
            )}
            {list.data && (
              <Pagination
                {...list.data}
                change={change}
                busy={list.isFetching}
              />
            )}
          </>
        )}
        <p className="text-sm text-muted-foreground">
          时间按浏览器时区显示 · Gmail 二步验证仅记录状态
        </p>
      </main>
      <Sheet
        open={drawer}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <SheetContent
          onCloseAutoFocus={restoreFocus}
          className="w-full overflow-y-auto sm:max-w-xl"
        >
          <SheetHeader>
            <SheetTitle>账号详情</SheetTitle>
            <SheetDescription>
              {detail?.account_no ?? '正在加载资料…'}
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-6 px-6 pb-8">
            {detail && (
              <>
                <div>
                  <h2 className="break-all text-xl font-semibold">
                    {detail.gmail_email}
                  </h2>
                  <div className="mt-3 flex gap-2">
                    <Badge>{statusLabels[detail.status]}</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void copy(detail.gmail_email)}
                    >
                      复制邮箱
                    </Button>
                  </div>
                </div>
                {!detail.deleted_at && (
                  <PasswordControl
                    key={`${detail.id}-${secretEpoch}`}
                    accountId={detail.id}
                    session={session}
                    onSession={onSession}
                    onFailure={fail}
                  />
                )}
                <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-4 text-sm">
                  {[
                    ['注册时间', localDate(detail.registered_at)],
                    [
                      '辅助邮箱',
                      <div
                        className="flex flex-wrap items-center gap-2"
                        key="recovery"
                      >
                        <span className="break-all">
                          {detail.recovery_email}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void copy(detail.recovery_email)}
                        >
                          复制辅助邮箱
                        </Button>
                      </div>,
                    ],
                    ['绑定手机号', detail.phone || '—'],
                    ['二步验证', factorLabels[detail.two_factor_status]],
                    ['用途', detail.purpose || '—'],
                    ['标签', detail.tags.map((t) => t.name).join('、') || '—'],
                    ['最后登录', localDate(detail.last_login_at)],
                    ['最后验证', localDate(detail.last_verified_at)],
                    ['密码修改', localDate(detail.password_changed_at)],
                    ['敏感备注', detail.notes || '—'],
                    ['归档时间', localDate(detail.archived_at)],
                    ['删除时间', localDate(detail.deleted_at)],
                    ['创建时间', localDate(detail.created_at)],
                    ['更新时间', localDate(detail.updated_at)],
                    ['记录版本', String(detail.row_version)],
                  ].map(([label, value]) => (
                    <div className="contents" key={String(label)}>
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="min-w-0 whitespace-pre-wrap break-words">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {conflict && (
                  <Alert variant="destructive">
                    <AlertDescription>
                      {notice}
                      <Button
                        variant="outline"
                        onClick={() => void open(detail)}
                      >
                        重新加载最新版本
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-wrap gap-2 border-t pt-5">
                  {detail.deleted_at ? (
                    <Button
                      disabled={busy || conflict}
                      onClick={() => void act('restore')}
                    >
                      恢复账号
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="outline"
                        disabled={busy || conflict}
                        onClick={() => void act('logged-in')}
                      >
                        今天已登录
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || conflict}
                        onClick={() => void act('verified')}
                      >
                        今天已验证
                      </Button>
                      <Button
                        disabled={busy || conflict}
                        onClick={() => {
                          setSecretEpoch((n) => n + 1);
                          setDrawer(false);
                          setForm('edit');
                        }}
                      >
                        编辑账号
                      </Button>
                      <Button
                        variant="outline"
                        disabled={busy || conflict}
                        onClick={() => {
                          setSecretEpoch((n) => n + 1);
                          setConfirm('archive');
                        }}
                      >
                        <Archive data-icon="inline-start" />
                        归档
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={busy || conflict}
                        onClick={() => {
                          setSecretEpoch((n) => n + 1);
                          setConfirm('delete');
                        }}
                      >
                        删除
                      </Button>
                    </>
                  )}
                </div>
              </>
            )}
            {!detail && notice && <p role="alert">{notice}</p>}
          </div>
        </SheetContent>
      </Sheet>
      <Dialog
        open={form !== null}
        onOpenChange={(value) => {
          if (!value) close();
        }}
      >
        <DialogContent
          onCloseAutoFocus={restoreFocus}
          className="flex max-h-[90vh] min-h-0 flex-col overflow-hidden sm:max-w-2xl"
        >
          <DialogHeader>
            <DialogTitle>
              {form === 'edit' ? '编辑账号' : '新增账号'}
            </DialogTitle>
            <DialogDescription>
              {form === 'edit'
                ? `${detail?.account_no} · 版本 ${detail?.row_version}`
                : '邮箱、密码、注册时间和辅助邮箱为必填项。'}
            </DialogDescription>
          </DialogHeader>
          {notice && (
            <Alert variant="destructive">
              <AlertDescription>{notice}</AlertDescription>
            </Alert>
          )}
          {conflict && detail && (
            <Button variant="outline" onClick={() => void open(detail, true)}>
              重新加载最新版本（放弃当前编辑）
            </Button>
          )}
          {form && (
            <AccountForm
              key={`${form}-${detail?.row_version ?? 'new'}`}
              account={form === 'edit' && detail ? detail : undefined}
              onFailure={fail}
              tags={tags.data ?? []}
              busy={busy}
              conflict={conflict}
              onSubmit={save}
              onCancel={close}
            />
          )}
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirm !== null}
        onOpenChange={(value) => {
          if (!value) setConfirm(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              确认{confirm && actionLabels[confirm]}账号？
            </AlertDialogTitle>
            <AlertDialogDescription>
              {detail?.gmail_email}。
              {confirm === 'delete'
                ? '仅软删除，不释放邮箱唯一性，之后可在已删除记录中恢复。'
                : '归档后保留资料，可通过编辑状态取消归档。'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {conflict && <p role="alert">{notice}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={confirm === 'delete' ? 'destructive' : 'default'}
              disabled={busy || conflict}
              onClick={(e) => {
                e.preventDefault();
                if (confirm) void act(confirm);
              }}
            >
              确认{confirm && actionLabels[confirm]}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={tagOpen} onOpenChange={setTagOpen}>
        <DialogContent onCloseAutoFocus={restoreFocus}>
          <DialogHeader>
            <DialogTitle>管理标签</DialogTitle>
            <DialogDescription>
              标签用于整理账号，删除标签不会删除账号。
            </DialogDescription>
          </DialogHeader>
          {notice && <p role="status">{notice}</p>}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                if (tagTarget)
                  await tagsPatch({
                    path: { tag_id: tagTarget.id },
                    body: { name: tagName },
                    headers,
                    throwOnError: true,
                  });
                else
                  await tagsCreate({
                    body: { name: tagName },
                    headers,
                    throwOnError: true,
                  });
                setTagName('');
                setTagTarget(null);
                await refresh();
              });
            }}
          >
            <Input
              aria-label="标签名称"
              required
              maxLength={50}
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
            />
            <Button disabled={busy}>
              {tagTarget ? '保存标签' : '添加标签'}
            </Button>
            {tagTarget && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setTagTarget(null);
                  setTagName('');
                }}
              >
                取消
              </Button>
            )}
          </form>
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {tags.data?.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 border-b py-2"
              >
                <span className="break-all">{t.name}</span>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setTagTarget(t);
                      setTagName(t.name);
                    }}
                  >
                    重命名
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setTagDelete(t)}
                  >
                    删除标签
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!tagDelete}
        onOpenChange={(value) => {
          if (!value) setTagDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除标签“{tagDelete?.name}”？</AlertDialogTitle>
            <AlertDialogDescription>
              仅解除账号关联，不会删除任何账号。关联账号的记录版本将递增。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void run(async () => {
                  await tagsDelete({
                    path: { tag_id: tagDelete!.id },
                    headers,
                    throwOnError: true,
                  });
                  setTagDelete(null);
                  await refresh();
                });
              }}
            >
              确认删除标签
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
