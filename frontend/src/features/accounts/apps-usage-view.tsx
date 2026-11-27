import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  AppWindow,
  Ban,
  CheckCircle2,
  Globe,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  appsCreate,
  appsDelete,
  appsFetchIcon,
  appsPatch,
  appsUsage,
  type ErrorResponse,
  type RegisteredAppUsage,
} from '@/api/generated';
import { GlassPanel } from '@/components/macos';
import { AppBrandIcon, inferDefaultDomain } from './app-brand-icon';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

export function AppsUsageView({
  csrfToken,
  onFailure,
  onOpenRegisteredAccounts,
  onOpenBannedAccounts,
  onOpenAvailableAccounts,
}: {
  csrfToken: string;
  onFailure: (error: unknown) => void;
  onOpenRegisteredAccounts: (appId: string) => void;
  onOpenBannedAccounts: (appId: string) => void;
  onOpenAvailableAccounts: (appId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newIconData, setNewIconData] = useState<string | null>(null);
  const [fetchingNewIcon, setFetchingNewIcon] = useState(false);
  const [editing, setEditing] = useState<RegisteredAppUsage | null>(null);
  const [editName, setEditName] = useState('');
  const [editDomain, setEditDomain] = useState('');
  const [editIconData, setEditIconData] = useState<string | null>(null);
  const [fetchingEditIcon, setFetchingEditIcon] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<RegisteredAppUsage | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const headers = { 'X-CSRF-Token': csrfToken };

  const usageQuery = useQuery({
    queryKey: ['apps-usage'],
    queryFn: async ({ signal }) =>
      (await appsUsage({ signal, throwOnError: true })).data,
  });

  useEffect(() => {
    if (usageQuery.error) onFailure(usageQuery.error);
  }, [usageQuery.error, onFailure]);

  const invalidateApps = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['apps-usage'] }),
      queryClient.invalidateQueries({ queryKey: ['apps'] }),
      queryClient.invalidateQueries({ queryKey: ['accounts'] }),
    ]);
  };

  const handleFetchNewIcon = async () => {
    const candidate = newDomain.trim() || inferDefaultDomain(newName) || '';
    if (!candidate || fetchingNewIcon) return;
    setFetchingNewIcon(true);
    setNotice('');
    try {
      const { data } = await appsFetchIcon({
        body: { domain: candidate },
        headers,
        throwOnError: true,
      });
      setNewDomain(data.domain);
      setNewIconData(data.icon_data);
      setNotice(`已从 ${data.domain} 获取到应用图标。`);
    } catch (error) {
      const msg = (error as Partial<ErrorResponse>)?.error?.message;
      setNotice(msg || '获取图标失败，可留空使用默认品牌图标。');
      onFailure(error);
    } finally {
      setFetchingNewIcon(false);
    }
  };

  const handleFetchEditIcon = async () => {
    if (!editing || fetchingEditIcon) return;
    const candidate = editDomain.trim() || inferDefaultDomain(editName) || '';
    if (!candidate) {
      setNotice('请先输入应用官网域名后再获取图标。');
      return;
    }
    setFetchingEditIcon(true);
    setNotice('');
    try {
      const { data } = await appsFetchIcon({
        body: { domain: candidate },
        headers,
        throwOnError: true,
      });
      setEditDomain(data.domain);
      setEditIconData(data.icon_data);
      setNotice(`已从 ${data.domain} 获取到最新图标，点击保存生效。`);
    } catch (error) {
      const msg = (error as Partial<ErrorResponse>)?.error?.message;
      setNotice(msg || '获取图标失败，请检查域名是否可公开访问。');
      onFailure(error);
    } finally {
      setFetchingEditIcon(false);
    }
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const cleaned = newName.trim();
    if (!cleaned || busy) return;
    setBusy(true);
    setNotice('');
    try {
      const cleanedDomain = newDomain.trim() || inferDefaultDomain(cleaned);
      await appsCreate({
        body: {
          name: cleaned,
          domain: cleanedDomain || null,
          icon_data: newIconData,
        },
        headers,
        throwOnError: true,
      });
      setNewName('');
      setNewDomain('');
      setNewIconData(null);
      setNotice(`已添加应用「${cleaned}」。`);
      await invalidateApps();
    } catch (error) {
      const msg = (error as Partial<ErrorResponse>)?.error?.message;
      setNotice(msg || '添加应用失败，请重试。');
      onFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editing || !editName.trim() || busy) return;
    setBusy(true);
    setNotice('');
    try {
      await appsPatch({
        path: { app_id: editing.id },
        body: {
          name: editName.trim(),
          domain: editDomain.trim() || null,
          icon_data: editIconData,
        },
        headers,
        throwOnError: true,
      });
      setNotice(`已更新应用「${editName.trim()}」。`);
      setEditing(null);
      setEditName('');
      setEditDomain('');
      setEditIconData(null);
      await invalidateApps();
    } catch (error) {
      const msg = (error as Partial<ErrorResponse>)?.error?.message;
      setNotice(msg || '更新应用失败，请重试。');
      onFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || busy) return;
    setBusy(true);
    setNotice('');
    try {
      await appsDelete({
        path: { app_id: deleteTarget.id },
        headers,
        throwOnError: true,
      });
      setNotice(`已删除应用「${deleteTarget.name}」。`);
      setDeleteTarget(null);
      await invalidateApps();
    } catch (error) {
      const msg = (error as Partial<ErrorResponse>)?.error?.message;
      setNotice(msg || '删除应用失败，请重试。');
      onFailure(error);
    } finally {
      setBusy(false);
    }
  };

  const items = usageQuery.data ?? [];
  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((item) => item.name.toLowerCase().includes(term));
  }, [items, search]);

  const totals = useMemo(
    () =>
      items.reduce(
        (acc, item) => ({
          registered: acc.registered + item.total_count,
          active: acc.active + item.active_count,
          restricted: acc.restricted + item.restricted_count,
          banned: acc.banned + item.banned_count,
        }),
        { registered: 0, active: 0, restricted: 0, banned: 0 },
      ),
    [items],
  );

  return (
    <section aria-label="已注册应用统计与管理" className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">
            已注册应用与封禁统计
          </h2>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            管理 Claude、ChatGPT
            等第三方应用目录，直观查看各应用注册规模、封禁情况，并一键筛选「尚未注册该应用的可用
            Gmail」。
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-3 size-3.5 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <input
              type="search"
              aria-label="搜索应用"
              placeholder="筛选应用名称…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              maxLength={64}
              className="h-9 w-48 rounded-xl border border-white/80 bg-white/65 pr-3 pl-8 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            />
          </div>
          <form
            onSubmit={(e) => void handleCreate(e)}
            className="flex flex-wrap items-center gap-1.5"
          >
            <AppBrandIcon
              name={newName.trim() || 'App'}
              domain={newDomain.trim() || inferDefaultDomain(newName)}
              iconData={newIconData}
              size="md"
            />
            <Input
              aria-label="新增应用名称"
              placeholder="输入新应用名…"
              maxLength={64}
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setNewIconData(null);
              }}
              className="h-9 w-36 rounded-xl text-[13px]"
            />
            <Input
              aria-label="新增应用域名"
              placeholder="官网域名（可选）"
              maxLength={255}
              value={newDomain}
              onChange={(e) => {
                setNewDomain(e.target.value);
                setNewIconData(null);
              }}
              className="h-9 w-40 rounded-xl text-[13px]"
            />
            <Button
              type="button"
              variant="outline"
              disabled={
                busy ||
                fetchingNewIcon ||
                !(newDomain.trim() || inferDefaultDomain(newName))
              }
              onClick={() => void handleFetchNewIcon()}
              className="h-9 rounded-xl"
            >
              {fetchingNewIcon ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Globe className="size-3.5" aria-hidden="true" />
              )}
              <span>{fetchingNewIcon ? '获取中…' : '获取图标'}</span>
            </Button>
            <Button
              type="submit"
              disabled={busy || !newName.trim()}
              className="h-9 rounded-xl"
            >
              <Plus className="size-4" aria-hidden="true" />
              <span>新增应用</span>
            </Button>
          </form>
        </div>
      </div>

      {notice && (
        <p
          role="status"
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-control)] px-3.5 py-2 text-xs text-[var(--text-primary)]"
        >
          {notice}
        </p>
      )}

      {/* 顶部统计汇总 */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <GlassPanel className="flex items-center gap-3 p-3.5">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent)]">
            <AppWindow className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs text-[var(--text-secondary)]">应用目录数</p>
            <p className="text-lg font-bold tabular-nums text-[var(--text-primary)]">
              {items.length}
            </p>
          </div>
        </GlassPanel>
        <GlassPanel className="flex items-center gap-3 p-3.5">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--success-soft)] text-[var(--success-text)]">
            <CheckCircle2 className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs text-[var(--text-secondary)]">正常使用中</p>
            <p className="text-lg font-bold tabular-nums text-[var(--text-primary)]">
              {totals.active}
            </p>
          </div>
        </GlassPanel>
        <GlassPanel className="flex items-center gap-3 p-3.5">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--warning-soft)] text-[var(--warning-text)]">
            <AlertTriangle className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs text-[var(--text-secondary)]">受限 / 风控</p>
            <p className="text-lg font-bold tabular-nums text-[var(--text-primary)]">
              {totals.restricted}
            </p>
          </div>
        </GlassPanel>
        <GlassPanel className="flex items-center gap-3 p-3.5">
          <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--danger-soft)] text-[var(--danger-text)]">
            <Ban className="size-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-xs text-[var(--text-secondary)]">累计已封禁</p>
            <p className="text-lg font-bold tabular-nums text-[var(--danger-text)]">
              {totals.banned}
            </p>
          </div>
        </GlassPanel>
      </div>

      {usageQuery.isPending ? (
        <p role="status" className="text-sm text-[var(--text-secondary)]">
          正在加载已注册应用统计…
        </p>
      ) : usageQuery.isError ? (
        <div role="alert" className="flex items-center gap-2 text-sm">
          <span>应用统计加载失败。</span>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void usageQuery.refetch()}
          >
            重试
          </Button>
        </div>
      ) : (
        <Table aria-label="已注册应用统计表">
          <TableHeader>
            <TableRow>
              {[
                '应用名称',
                '已注册账号',
                '正常',
                '受限',
                '已封禁',
                '快捷筛选与管理',
              ].map((title) => (
                <TableHead key={title} className="whitespace-nowrap">
                  {title}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredItems.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-[var(--text-primary)]">
                  {editing?.id === row.id ? (
                    <form
                      onSubmit={(e) => void handleRename(e)}
                      className="flex flex-wrap items-center gap-1.5"
                    >
                      <AppBrandIcon
                        name={editName.trim() || row.name}
                        domain={
                          editDomain.trim() || inferDefaultDomain(editName)
                        }
                        iconData={editIconData}
                        size="md"
                      />
                      <Input
                        aria-label={`重命名 ${row.name}`}
                        maxLength={64}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="h-8 w-32 text-xs"
                      />
                      <Input
                        aria-label={`编辑域名 ${row.name}`}
                        placeholder="官网域名"
                        maxLength={255}
                        value={editDomain}
                        onChange={(e) => setEditDomain(e.target.value)}
                        className="h-8 w-36 text-xs"
                      />
                      <Button
                        type="button"
                        size="xs"
                        variant="outline"
                        disabled={
                          busy ||
                          fetchingEditIcon ||
                          !(editDomain.trim() || inferDefaultDomain(editName))
                        }
                        onClick={() => void handleFetchEditIcon()}
                      >
                        {fetchingEditIcon ? (
                          <Loader2
                            className="size-3 animate-spin"
                            aria-hidden="true"
                          />
                        ) : (
                          <Globe className="size-3" aria-hidden="true" />
                        )}
                        <span>抓取图标</span>
                      </Button>
                      {editIconData && (
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          onClick={() => setEditIconData(null)}
                        >
                          恢复默认
                        </Button>
                      )}
                      <Button
                        type="submit"
                        size="xs"
                        disabled={busy || !editName.trim()}
                      >
                        保存
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        variant="ghost"
                        onClick={() => {
                          setEditing(null);
                          setEditName('');
                          setEditDomain('');
                          setEditIconData(null);
                        }}
                      >
                        取消
                      </Button>
                    </form>
                  ) : (
                    <div className="flex items-center gap-2.5">
                      <AppBrandIcon
                        name={row.name}
                        domain={row.domain}
                        iconData={row.icon_data}
                        size="md"
                      />
                      <div className="min-w-0">
                        <div className="truncate font-semibold">{row.name}</div>
                        {row.domain && (
                          <div className="truncate text-[11px] font-normal text-[var(--text-secondary)]">
                            {row.domain}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </TableCell>
                <TableCell className="tabular-nums font-semibold">
                  {row.total_count}
                </TableCell>
                <TableCell className="tabular-nums text-[var(--success-text)]">
                  {row.active_count}
                </TableCell>
                <TableCell className="tabular-nums text-[var(--warning-text)]">
                  {row.restricted_count}
                </TableCell>
                <TableCell className="tabular-nums">
                  {row.banned_count > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-2 py-0.5 text-xs font-semibold text-[var(--badge-red-text)]">
                      <Ban className="size-3" aria-hidden="true" />
                      {row.banned_count}
                    </span>
                  ) : (
                    <span className="text-[var(--text-secondary)]">0</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onOpenRegisteredAccounts(row.id)}
                    >
                      查看已注册
                    </Button>
                    {row.banned_count > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-[var(--badge-red-border)] text-[var(--badge-red-text)] hover:bg-[var(--badge-red-bg)]"
                        onClick={() => onOpenBannedAccounts(row.id)}
                      >
                        仅看封禁
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onOpenAvailableAccounts(row.id)}
                    >
                      <Sparkles className="size-3.5" aria-hidden="true" />
                      找未注册可用号
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`编辑应用 ${row.name}`}
                      disabled={busy}
                      onClick={() => {
                        setEditing(row);
                        setEditName(row.name);
                        setEditDomain(row.domain ?? '');
                        setEditIconData(row.icon_data ?? null);
                      }}
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`删除应用 ${row.name}`}
                      disabled={busy}
                      className="text-[var(--danger-text)] hover:bg-[var(--danger-soft)]"
                      onClick={() => setDeleteTarget(row)}
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredItems.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-6 text-center text-sm text-[var(--text-secondary)]"
                >
                  {search.trim()
                    ? '未找到匹配的应用名称。'
                    : '暂无应用目录，请在右上角新增。'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open && !busy) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="macos-glass-modal rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除应用「{deleteTarget?.name}」？
            </AlertDialogTitle>
            <AlertDialogDescription>
              删除后仅解除该应用与 Gmail 账号的注册关联记录，不会删除任何 Gmail
              账号。受影响账号的记录版本将自动递增。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
            >
              {busy ? '删除中…' : '确认删除应用'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
