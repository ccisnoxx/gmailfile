import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  AppWindow,
  ArrowUpToLine,
  Ban,
  CheckCircle2,
  Globe,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserPlus,
} from 'lucide-react';
import {
  appsCreate,
  appsDelete,
  appsFetchIcon,
  appsPatch,
  appsUsage,
  type ErrorResponse,
  type RegisteredAppUsage,
  type SessionResponse,
} from '@/api/generated';
import { GlassPanel } from '@/components/macos';
import { AppAllocationDrawer } from './app-allocation-drawer';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
  session,
  onSession,
  onFailure,
  onOpenRegisteredAccounts,
  onOpenBannedAccounts,
  onOpenAvailableAccounts,
}: {
  csrfToken: string;
  session?: SessionResponse;
  onSession?: (next: SessionResponse) => void;
  onFailure: (error: unknown) => void;
  onOpenRegisteredAccounts: (appId: string) => void;
  onOpenBannedAccounts: (appId: string) => void;
  onOpenAvailableAccounts: (appId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [newIconData, setNewIconData] = useState<string | null>(null);
  const [newSortOrder, setNewSortOrder] = useState('100');
  const [fetchingNewIcon, setFetchingNewIcon] = useState(false);
  const [editing, setEditing] = useState<RegisteredAppUsage | null>(null);
  const [editName, setEditName] = useState('');
  const [editDomain, setEditDomain] = useState('');
  const [editIconData, setEditIconData] = useState<string | null>(null);
  const [editSortOrder, setEditSortOrder] = useState('100');
  const [fetchingEditIcon, setFetchingEditIcon] = useState(false);
  const [allocatingApp, setAllocatingApp] = useState<RegisteredAppUsage | null>(
    null,
  );
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
      const parsedOrder = Number(newSortOrder);
      await appsCreate({
        body: {
          name: cleaned,
          domain: cleanedDomain || null,
          icon_data: newIconData,
          sort_order:
            Number.isInteger(parsedOrder) &&
            parsedOrder >= 0 &&
            parsedOrder <= 9999
              ? parsedOrder
              : 100,
        },
        headers,
        throwOnError: true,
      });
      setNewName('');
      setNewDomain('');
      setNewIconData(null);
      setNewSortOrder('100');
      setCreateDialogOpen(false);
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
      const parsedOrder = Number(editSortOrder);
      await appsPatch({
        path: { app_id: editing.id },
        body: {
          name: editName.trim(),
          domain: editDomain.trim() || null,
          icon_data: editIconData,
          sort_order:
            Number.isInteger(parsedOrder) &&
            parsedOrder >= 0 &&
            parsedOrder <= 9999
              ? parsedOrder
              : editing.sort_order,
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

  const handleTogglePin = async (row: RegisteredAppUsage) => {
    if (busy) return;
    setBusy(true);
    setNotice('');
    const nextOrder = row.sort_order < 100 ? 100 : 10;
    try {
      await appsPatch({
        path: { app_id: row.id },
        body: {
          name: row.name,
          sort_order: nextOrder,
        },
        headers,
        throwOnError: true,
      });
      setNotice(
        nextOrder < 100
          ? `已置顶应用「${row.name}」。`
          : `已取消置顶应用「${row.name}」。`,
      );
      await invalidateApps();
    } catch (error) {
      const msg = (error as Partial<ErrorResponse>)?.error?.message;
      setNotice(msg || '调整应用排序失败，请重试。');
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-[var(--text-primary)]">
            已注册应用与封禁统计
          </h1>
          <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
            管理第三方应用目录，查看注册与封禁规模，支持一键置顶与「快速领号」一站式查密登记
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
              className="h-9 w-52 rounded-xl border border-white/80 bg-white/65 pr-3 pl-8 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
            />
          </div>
          <Button
            type="button"
            onClick={() => setCreateDialogOpen(true)}
            className="h-9 rounded-xl"
          >
            <Plus className="size-4" aria-hidden="true" />
            <span>新增应用</span>
          </Button>
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
                        className="h-8 w-32 text-xs"
                      />
                      <Input
                        type="number"
                        aria-label={`排序权重 ${row.name}`}
                        min={0}
                        max={9999}
                        value={editSortOrder}
                        onChange={(e) => setEditSortOrder(e.target.value)}
                        className="h-8 w-20 text-xs"
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
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-semibold">
                            {row.name}
                          </span>
                          {row.sort_order < 100 && (
                            <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-text)]">
                              置顶
                            </span>
                          )}
                        </div>
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
                    {session && onSession && (
                      <Button size="sm" onClick={() => setAllocatingApp(row)}>
                        <UserPlus className="size-3.5" aria-hidden="true" />
                        快速领号
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
                      aria-label={
                        row.sort_order < 100
                          ? `取消置顶 ${row.name}`
                          : `置顶应用 ${row.name}`
                      }
                      title={row.sort_order < 100 ? '取消置顶' : '置顶该应用'}
                      disabled={busy}
                      onClick={() => void handleTogglePin(row)}
                    >
                      <ArrowUpToLine
                        className={
                          row.sort_order < 100
                            ? 'size-3.5 text-[var(--accent)]'
                            : 'size-3.5'
                        }
                        aria-hidden="true"
                      />
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
                        setEditSortOrder(String(row.sort_order));
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

      {/* 新增应用弹窗 */}
      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          if (!open && !busy) setCreateDialogOpen(false);
        }}
      >
        <DialogContent className="macos-glass-modal rounded-[20px] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>新增第三方应用</DialogTitle>
            <DialogDescription>
              填写应用名称与可选官网域名，支持安全抓取官网品牌图标与设置排序权重（越小越靠前）。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleCreate(e)} className="space-y-3.5">
            <div className="flex items-center gap-3">
              <AppBrandIcon
                name={newName.trim() || 'App'}
                domain={newDomain.trim() || inferDefaultDomain(newName)}
                iconData={newIconData}
                size="md"
              />
              <Input
                aria-label="新增应用名称"
                placeholder="输入应用名称（如 Claude、Cursor）…"
                required
                maxLength={64}
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setNewIconData(null);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Input
                aria-label="新增应用域名"
                placeholder="官网域名（可选，如 claude.ai）"
                maxLength={255}
                value={newDomain}
                onChange={(e) => {
                  setNewDomain(e.target.value);
                  setNewIconData(null);
                }}
                className="flex-1"
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
              >
                {fetchingNewIcon ? (
                  <Loader2
                    className="size-3.5 animate-spin"
                    aria-hidden="true"
                  />
                ) : (
                  <Globe className="size-3.5" aria-hidden="true" />
                )}
                <span>{fetchingNewIcon ? '获取中…' : '获取图标'}</span>
              </Button>
            </div>
            <div className="flex items-center justify-between gap-2 text-xs">
              <label
                htmlFor="new-app-sort-order"
                className="text-[var(--text-secondary)]"
              >
                排序权重（默认 100，小于 100 自动置顶）
              </label>
              <Input
                id="new-app-sort-order"
                type="number"
                min={0}
                max={9999}
                value={newSortOrder}
                onChange={(e) => setNewSortOrder(e.target.value)}
                className="h-8 w-24 text-xs"
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setCreateDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={busy || !newName.trim()}>
                保存应用
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 快速领号抽屉 */}
      {session && onSession && (
        <AppAllocationDrawer
          app={allocatingApp}
          open={Boolean(allocatingApp)}
          session={session}
          onSession={onSession}
          onFailure={onFailure}
          onOpenChange={(open) => {
            if (!open) setAllocatingApp(null);
          }}
        />
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
