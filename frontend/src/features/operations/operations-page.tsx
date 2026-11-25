import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Mail, ArrowLeft, Download, RefreshCw } from 'lucide-react';
import {
  auditsList,
  backupStatus,
  csvCommit,
  csvExport,
  csvPreview,
  sessionsList,
  sessionsRevoke,
  sessionsRevokeOthers,
  settingsGet,
  settingsIdle,
  systemVersion,
} from '@/api/generated';
import type {
  CsvOptions,
  CsvPreview,
  CsvIssue,
  SessionResponse,
  ErrorResponse,
  AccountQuery,
  AuditsListData,
} from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
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
import { accountQuery, dateBoundary } from '@/features/accounts/query-state';
import { localDate } from '@/features/accounts/account-form';

type AuditQuery = NonNullable<AuditsListData['query']>;

type Props = {
  session: SessionResponse;
  onFailure: (error: unknown) => void;
  onBack: () => void;
  onSecurity: () => void;
  onRefreshSession: () => void;
  onSignedOut: (revocation: Promise<unknown>) => void;
};
const fieldLabels = {
  account_no: '账号编号',
  gmail_email: 'Gmail 地址',
  password: '密码（不预览）',
  registered_at: '注册时间',
  recovery_email: '外部辅助邮箱',
  recovery_account: '关联已有账号',
  phone: '手机号（不预览）',
  status: '状态代码',
  two_factor_status: '二步验证代码',
  last_login_at: '最后登录',
  last_verified_at: '最后验证',
  password_changed_at: '密码修改时间',
  purpose: '用途',
  tags: '标签（|分隔）',
  notes: '备注（不预览）',
} as const;
const backupLabels = {
  unconfigured: '未配置',
  never_run: '尚未运行',
  running: '正在备份',
  success: '成功',
  failed: '失败，需处理',
  stale: '已过期，需处理',
};
const sessionLabels = {
  valid: '有效',
  idle_expired: '闲置过期',
  absolute_expired: '绝对过期',
  revoked: '已撤销',
};
function failureText(error: unknown, modifying = false) {
  const result = error as Partial<ErrorResponse>;
  if (
    result?.error &&
    !['INTERNAL_ERROR', 'DECRYPTION_FAILED'].includes(result.error.code)
  )
    return result.error.message;
  return modifying
    ? '结果未知。请先检查账号、会话或审计记录，不要自动重试。'
    : '无法读取，请检查连接后手动刷新。';
}

export function OperationsPage(props: Props) {
  const [tab, setTab] = useState<
    'status' | 'import' | 'export' | 'sessions' | 'audit'
  >('status');
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div className="flex items-center gap-3 font-semibold">
            <Mail className="size-5 text-primary" />
            Gmail 账号管理
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={props.onSecurity}>
              安全设置
            </Button>
            <Button variant="outline" onClick={props.onBack}>
              <ArrowLeft />
              账号列表
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-7 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold">迁移与运维</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            导入资料、管理会话，查看真实运行记录。数据库恢复仅通过服务器 CLI。
          </p>
        </div>
        <nav aria-label="迁移与运维" className="flex flex-wrap gap-2">
          {(
            [
              ['status', '运行与设置'],
              ['import', 'CSV 导入'],
              ['export', 'CSV 导出'],
              ['sessions', 'Session 管理'],
              ['audit', '审计日志'],
            ] as const
          ).map(([id, label]) => (
            <Button
              key={id}
              variant={tab === id ? 'secondary' : 'ghost'}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </Button>
          ))}
        </nav>
        <section key={tab} className="rounded-xl border bg-card p-5 sm:p-7">
          {tab === 'status' ? (
            <StatusPanel {...props} />
          ) : tab === 'import' ? (
            <ImportPanel {...props} />
          ) : tab === 'export' ? (
            <ExportPanel {...props} />
          ) : tab === 'sessions' ? (
            <SessionsPanel {...props} />
          ) : (
            <AuditPanel {...props} />
          )}
        </section>
      </main>
    </div>
  );
}

function StatusPanel(props: Props) {
  const query = useQuery({
    queryKey: ['operations-status'],
    queryFn: async ({ signal }) => {
      const [v, b, s] = await Promise.all([
        systemVersion({ signal, throwOnError: true }),
        backupStatus({ signal, throwOnError: true }),
        settingsGet({ signal, throwOnError: true }),
      ]);
      return { version: v.data, backup: b.data, settings: s.data };
    },
  });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (query.error) props.onFailure(query.error);
  }, [query.error]);
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">运行与设置</h2>
        <Button
          variant="outline"
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          <RefreshCw />
          刷新
        </Button>
      </div>
      {query.error ? (
        <p role="alert">{failureText(query.error)}</p>
      ) : !query.data ? (
        <p>正在读取…</p>
      ) : (
        <>
          <dl className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-sm text-muted-foreground">
                应用 / 数据库版本
              </dt>
              <dd className="mt-2 font-medium">
                {query.data.version.version} /{' '}
                {query.data.version.schema_version}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">最近备份状态</dt>
              <dd className="mt-2 font-medium">
                {backupLabels[query.data.backup.state]}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">最近本地成功</dt>
              <dd className="mt-2">
                {localDate(query.data.backup.last_success_at)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">异地传输</dt>
              <dd className="mt-2">
                {
                  {
                    unconfigured: '未配置',
                    pending: '等待完成',
                    success: '成功',
                    failed: '失败',
                  }[query.data.backup.offsite ?? 'unconfigured']
                }
              </dd>
            </div>
          </dl>
          <p className="text-sm text-muted-foreground">
            每日任务超过 36
            小时无新成功记为过期。成功状态不代替恢复演练或生产验收。
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const minutes = Number(
                new FormData(e.currentTarget).get('minutes'),
              );
              setBusy(true);
              setNotice('');
              try {
                await settingsIdle({
                  body: { idle_minutes: minutes },
                  headers: { 'X-CSRF-Token': props.session.csrf_token },
                  throwOnError: true,
                });
                if (active.current) props.onRefreshSession();
              } catch (error) {
                if (active.current) {
                  setNotice(failureText(error, true));
                  props.onFailure(error);
                }
              } finally {
                if (active.current) setBusy(false);
              }
            }}
            className="max-w-xl space-y-3 border-t pt-6"
          >
            <label htmlFor="idle-minutes" className="font-medium">
              自动锁定时间（分钟）
            </label>
            <div className="flex gap-3">
              <Input
                id="idle-minutes"
                name="minutes"
                type="number"
                min={1}
                max={720}
                defaultValue={query.data.settings.idle_minutes}
                required
              />
              <Button disabled={busy}>保存</Button>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              需最近重新验证。立即应用于所有会话，按各自最近活动计算，不重置活动时间或绝对期限；缩短后可能立即退出当前会话。
            </p>
          </form>
        </>
      )}
      {notice && <p role="alert">{notice}</p>}
    </div>
  );
}

function ImportPanel(props: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<CsvOptions['mapping']>({});
  const [strategy, setStrategy] = useState<CsvOptions['strategy']>('skip');
  const [issues, setIssues] = useState<CsvIssue[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const generation = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  function clear(resetInput = true) {
    generation.current++;
    running.current = false;
    setBusy(false);
    setFile(null);
    setPreview(null);
    setMapping({});
    setIssues([]);
    setConfirmed(false);
    if (resetInput && input.current) input.current.value = '';
  }
  useEffect(() => {
    const hidden = () => {
      if (document.hidden) {
        clear();
        setMessage('导入内容已清除，请重新选择文件。');
      }
    };
    document.addEventListener('visibilitychange', hidden);
    return () => {
      generation.current++;
      document.removeEventListener('visibilitychange', hidden);
    };
  }, []);
  async function analyze(custom = false) {
    if (!file || running.current) return;
    running.current = true;
    setBusy(true);
    setMessage('');
    setIssues([]);
    setPreview(null);
    setConfirmed(false);
    const ticket = generation.current;
    try {
      const result = await csvPreview({
        body: file,
        query: {
          options: JSON.stringify({ strategy, ...(custom ? { mapping } : {}) }),
        },
        headers: { 'X-CSRF-Token': props.session.csrf_token },
        throwOnError: true,
      });
      if (ticket !== generation.current || document.hidden) return;
      setPreview(result.data);
      setMapping(result.data.mapping);
      setIssues(result.data.errors);
    } catch (error) {
      if (ticket === generation.current) {
        setMessage(failureText(error));
        props.onFailure(error);
      }
    } finally {
      if (ticket === generation.current) {
        setBusy(false);
        running.current = false;
      }
    }
  }
  async function submit() {
    if (!file || !preview?.receipt_id || !confirmed || running.current) return;
    const content = file;
    const receipt = preview.receipt_id;
    const ticket = generation.current;
    running.current = true;
    setBusy(true);
    setPreview(null);
    setFile(null);
    setConfirmed(false);
    if (input.current) input.current.value = '';
    try {
      const result = await csvCommit({
        body: content,
        query: { receipt_id: receipt },
        headers: { 'X-CSRF-Token': props.session.csrf_token },
      });
      if (ticket !== generation.current || document.hidden) return;
      if (result.data?.status === 'committed') {
        setMessage(
          `已提交：新增 ${result.data.created}，更新 ${result.data.updated}，跳过 ${result.data.skipped}。`,
        );
        setIssues([]);
      } else if (result.error && 'status' in result.error) {
        setIssues(result.error.errors ?? []);
        setMessage('校验或并发冲突，整批未提交。请重新选择文件并预览。');
      } else {
        setMessage(failureText(result.error, true));
        props.onFailure(result.error);
      }
    } catch (error) {
      if (ticket === generation.current) {
        setMessage(failureText(error, true));
        props.onFailure(error);
      }
    } finally {
      if (ticket === generation.current) {
        setBusy(false);
        running.current = false;
      }
    }
  }
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">CSV 两阶段导入</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          选择 UTF-8 CSV（支持 BOM，最大 10 MiB、10000
          条记录），映射字段并预览后再确认。密码、手机号和备注不展示；离开或隐藏页面会清除文件。
        </p>
      </div>
      <div className="grid items-end gap-4 sm:grid-cols-[1fr_14rem_auto]">
        <div className="space-y-2">
          <label htmlFor="csv-file">CSV 文件</label>
          <Input
            ref={input}
            id="csv-file"
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => {
              const next = e.target.files?.[0];
              clear(false);
              setMessage('');
              if (next) {
                if (
                  next.size > 10 * 1024 * 1024 ||
                  !next.name.toLowerCase().endsWith('.csv')
                )
                  setMessage('请选择不超过10 MiB的.csv文件。');
                else setFile(next);
              }
            }}
          />
        </div>
        <div className="space-y-2">
          <label htmlFor="csv-strategy">重复策略</label>
          <NativeSelect
            id="csv-strategy"
            disabled={busy}
            value={strategy}
            onChange={(e) => {
              setStrategy(e.target.value as CsvOptions['strategy']);
              setPreview(null);
              setConfirmed(false);
            }}
          >
            <option value="skip">跳过已有（默认）</option>
            <option value="update">更新已有</option>
            <option value="error">重复则拒绝整批</option>
          </NativeSelect>
        </div>
        <Button disabled={!file || busy} onClick={() => void analyze()}>
          上传并预览
        </Button>
      </div>
      <details className="text-sm leading-6">
        <summary className="cursor-pointer font-medium">字段与空值规则</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
          <li>
            update
            仅改映射字段；未映射字段保留。密码为空保留旧值，新账号必须提供密码。
          </li>
          <li>
            可选字段映射为空会清空；tags 用 |
            分隔并替换整组。新账号空注册时间/状态使用默认值。
          </li>
          <li>
            account_no 留空自动生成；已有账号只能填写匹配的 GM
            编号。软删除只允许跳过，不由导入恢复。
          </li>
          <li>
            recovery_email 始终是外部文本；recovery_account 按现有 GM
            编号或规范化邮箱关联，不能同时填写，不关联本批新建记录。
          </li>
          <li>
            文件内规范化重复：skip/update 使用第一行、其余跳过；error
            拒绝整批。预览后记录变化必须重新预览。
          </li>
        </ul>
      </details>
      {preview && (
        <div className="space-y-4">
          <h3 className="font-medium">字段映射</h3>
          <p className="text-sm text-muted-foreground">
            只显示标准字段名或列序号，不回显文件标题与原始数据。修改映射后必须重新预览。
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(fieldLabels).map(([field, label]) => (
              <label key={field} className="space-y-1 text-sm">
                <span>{label}</span>
                <NativeSelect
                  aria-label={`映射${label}`}
                  value={mapping?.[field as keyof typeof fieldLabels] ?? ''}
                  disabled={busy}
                  onChange={(e) => {
                    setMapping((current) => {
                      const next = { ...current };
                      if (e.target.value === '')
                        delete next[field as keyof typeof fieldLabels];
                      else
                        next[field as keyof typeof fieldLabels] = Number(
                          e.target.value,
                        );
                      return next;
                    });
                    setPreview((p) => (p ? { ...p, receipt_id: null } : p));
                    setConfirmed(false);
                  }}
                >
                  <option value="">不导入此字段</option>
                  {preview.columns.map((c) => (
                    <option key={c.index} value={c.index}>
                      第 {c.index + 1} 列
                      {c.suggested_field
                        ? ` · ${fieldLabels[c.suggested_field]}`
                        : ''}
                    </option>
                  ))}
                </NativeSelect>
              </label>
            ))}
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void analyze(true)}
          >
            按当前映射重新预览
          </Button>
          <div className="rounded-lg bg-muted/50 p-4">
            <p>
              共 {preview.rows.length} 行：新增{' '}
              {preview.rows.filter((r) => r.action === 'create').length} · 更新{' '}
              {preview.rows.filter((r) => r.action === 'update').length} · 跳过{' '}
              {preview.rows.filter((r) => r.action === 'skip').length} · 错误{' '}
              {preview.errors.length}
            </p>
            {preview.receipt_id && (
              <>
                <p className="mt-2 text-sm text-muted-foreground">
                  确认有效至 {localDate(preview.expires_at)}
                  。任一校验或并发冲突均回滚整批。
                </p>
                <label className="my-4 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  我确认当前文件、映射和重复策略
                </label>
                <Button
                  disabled={!confirmed || busy}
                  onClick={() => void submit()}
                >
                  确认提交整批导入
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {busy && <p role="status">正在处理，请勿重复提交…</p>}
      {message && (
        <Alert>
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}
      {issues.length > 0 && (
        <div role="alert" className="max-h-64 overflow-auto">
          <h3 className="font-medium">逐行错误（{issues.length}）</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {issues.map((e, i) => (
              <li key={i}>
                {e.row ? `第 ${e.row} 行` : '文件'} · {e.field}：{e.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button
        variant="ghost"
        disabled={busy}
        onClick={() => {
          clear();
          setMessage('导入内容已清除。');
        }}
      >
        清除导入内容
      </Button>
    </div>
  );
}

function ExportPanel(props: Props) {
  const [scope, setScope] = useState<'all' | 'filtered'>('all');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const filters = accountQuery(new URLSearchParams(window.location.search));
  return (
    <div className="max-w-3xl space-y-5">
      <h2 className="text-lg font-semibold">非敏感 CSV 导出</h2>
      <p className="text-sm leading-7 text-muted-foreground">
        导出编号、邮箱、注册/活动时间、辅助邮箱、状态、用途和标签；不包含密码、手机号、备注、TOTP、恢复码或
        Session 数据。UTF-8 BOM 可供 Excel 打开，公式前缀会加单引号。
      </p>
      <label className="block space-y-2">
        <span>导出范围</span>
        <NativeSelect
          value={scope}
          onChange={(e) => setScope(e.target.value as typeof scope)}
        >
          <option value="all">全部未删除账号（含归档）</option>
          <option value="filtered">
            账号列表当前筛选的全部结果（非当前页）
          </option>
        </NativeSelect>
      </label>
      {scope === 'filtered' && (
        <p className="break-all rounded-lg bg-muted p-3 text-sm">
          筛选：{window.location.search || '默认未删除，含归档'}
          。日期与列表相同，导出忽略页码和每页条数。
        </p>
      )}
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMessage('');
          try {
            const result = await csvExport({
              body:
                scope === 'all'
                  ? { scope }
                  : { scope, filters: filters as AccountQuery },
              headers: { 'X-CSRF-Token': props.session.csrf_token },
              parseAs: 'blob',
              throwOnError: true,
            });
            if (!alive.current || document.hidden) return;
            const url = URL.createObjectURL(result.data);
            const a = document.createElement('a');
            a.href = url;
            a.download =
              /filename="([^"]+)"/.exec(
                result.response.headers.get('Content-Disposition') || '',
              )?.[1] || 'gmail-accounts.csv';
            a.click();
            URL.revokeObjectURL(url);
            setMessage('导出文件已交给浏览器下载。');
          } catch (error) {
            if (alive.current) {
              setMessage(failureText(error));
              props.onFailure(error);
            }
          } finally {
            if (alive.current) setBusy(false);
          }
        }}
      >
        <Download />
        {busy ? '正在准备…' : '下载非敏感 CSV'}
      </Button>
      {message && <p role="status">{message}</p>}
    </div>
  );
}

function Pager({
  page,
  total,
  size,
  change,
}: {
  page: number;
  total: number;
  size: number;
  change: (n: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span>
        共 {total} 条 · 第 {page} 页
      </span>
      <Button
        variant="outline"
        disabled={page === 1}
        onClick={() => change(page - 1)}
      >
        上一页
      </Button>
      <Button
        variant="outline"
        disabled={page * size >= total}
        onClick={() => change(page + 1)}
      >
        下一页
      </Button>
    </div>
  );
}

function SessionsPanel(props: Props) {
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const query = useQuery({
    queryKey: ['sessions', page],
    queryFn: async ({ signal }) =>
      (
        await sessionsList({
          query: { page, page_size: 10 },
          signal,
          throwOnError: true,
        })
      ).data,
  });
  useEffect(() => {
    if (query.error) props.onFailure(query.error);
  }, [query.error]);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Session 管理</h2>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void query.refetch()}>
            刷新
          </Button>
          <Button variant="destructive" onClick={() => setTarget('others')}>
            撤销其他 Session
          </Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        状态由服务端判断。撤销需最近重新验证，撤销其他会话不会延长当前会话期限。
      </p>
      {query.error ? (
        <p role="alert">{failureText(query.error)}</p>
      ) : !query.data ? (
        <p>正在读取…</p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>会话</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>最近活动</TableHead>
                <TableHead>闲置 / 绝对截止</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>
                    <p className="font-medium">
                      {s.current ? '当前 Session' : '其他 Session'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.id.slice(0, 8)} · {s.ip_address || '未知来源'}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.auth_level === 'authenticated' ? '完整认证' : '待 MFA'}
                    </p>
                  </TableCell>
                  <TableCell>{sessionLabels[s.state]}</TableCell>
                  <TableCell>{localDate(s.last_seen_at)}</TableCell>
                  <TableCell>
                    {localDate(s.idle_expires_at)}
                    <br />
                    {localDate(s.expires_at)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      disabled={s.state === 'revoked'}
                      onClick={() => setTarget(s.id)}
                    >
                      {s.current ? '退出当前会话' : '撤销'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pager
            page={page}
            total={query.data.total}
            size={10}
            change={setPage}
          />
        </>
      )}
      {message && <p role="alert">{message}</p>}
      <AlertDialog
        open={target !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认撤销 Session？</AlertDialogTitle>
            <AlertDialogDescription>
              撤销后立即失效。当前 Session 被撤销时会退出并清除工作区。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={async (e) => {
                e.preventDefault();
                if (!target || busy) return;
                const selected = target;
                setBusy(true);
                setMessage('');
                try {
                  const options = {
                    headers: { 'X-CSRF-Token': props.session.csrf_token },
                    throwOnError: true as const,
                  };
                  if (
                    query.data?.items.some(
                      (s) => s.id === selected && s.current,
                    )
                  ) {
                    // Clear the workspace immediately, without racing a CSRF refresh against DELETE.
                    props.onSignedOut(
                      sessionsRevoke({
                        ...options,
                        path: { session_id: selected },
                      }),
                    );
                    return;
                  }
                  if (selected === 'others')
                    await sessionsRevokeOthers(options);
                  else
                    await sessionsRevoke({
                      ...options,
                      path: { session_id: selected },
                    });
                  if (!alive.current) return;
                  setTarget(null);
                  void query.refetch();
                } catch (error) {
                  if (alive.current) {
                    setTarget(null);
                    setMessage(failureText(error, true));
                    props.onFailure(error);
                  }
                } finally {
                  if (alive.current) setBusy(false);
                }
              }}
            >
              确认撤销
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AuditPanel(props: Props) {
  const [params, setParams] = useState<AuditQuery>({ page: 1, page_size: 30 });
  const query = useQuery({
    queryKey: ['audits', params],
    queryFn: async ({ signal }) =>
      (await auditsList({ query: params, signal, throwOnError: true })).data,
  });
  useEffect(() => {
    if (query.error) props.onFailure(query.error);
  }, [query.error]);
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
          <Pager
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
