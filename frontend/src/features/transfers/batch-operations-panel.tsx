import { useMemo, useState } from 'react';
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  HelpCircle,
  Layers,
  Loader2,
  Search,
  ShieldCheck,
  Tag as TagIcon,
} from 'lucide-react';
import type {
  AccountSummary,
  ErrorResponse,
  TagResponse,
} from '@/api/generated';
import { GlassPanel, StatusPill, TagPill } from '@/components/macos';
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
import { statusLabels } from '@/features/accounts/constants';
import type { BatchAccountItem } from './types';

type PendingBatchConfirm =
  | { kind: 'status'; status: AccountSummary['status'] }
  | { kind: 'archive' }
  | { kind: 'tags' };

export function BatchOperationsPanel({
  accounts,
  totalAccounts,
  tags,
  searchQuery,
  onSearchQueryChange,
  busy,
  onApplyStatus,
  onApplyTags,
}: {
  accounts: readonly BatchAccountItem[];
  totalAccounts?: number;
  tags: readonly TagResponse[];
  searchQuery: string;
  onSearchQueryChange?: (value: string) => void;
  busy: boolean;
  onApplyStatus: (
    targets: { id: string; rowVersion: number }[],
    status: AccountSummary['status'],
  ) => Promise<void>;
  onApplyTags: (
    targets: { id: string; rowVersion: number }[],
    tagIds: string[],
  ) => Promise<void>;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [nextStatus, setNextStatus] =
    useState<AccountSummary['status']>('normal');
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [feedback, setFeedback] = useState('');
  const [errorFeedback, setErrorFeedback] = useState('');
  const [pendingConfirm, setPendingConfirm] =
    useState<PendingBatchConfirm | null>(null);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter(
      (item) =>
        item.gmailEmail.toLowerCase().includes(q) ||
        item.accountNo.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [accounts, searchQuery]);

  // 仅作用于当前可见列表中的已勾选账号，防止筛选隐藏掉的勾选项被静默修改。
  const visibleSelectedTargets = useMemo(
    () =>
      filtered
        .filter((item) => selectedIds.has(item.id))
        .map((item) => ({ id: item.id, rowVersion: item.rowVersion })),
    [filtered, selectedIds],
  );

  const allSelected =
    filtered.length > 0 &&
    filtered.every((item) => selectedIds.has(item.id));
  const someSelected =
    visibleSelectedTargets.length > 0 && !allSelected;

  const toggleAll = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const item of filtered) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
      return next;
    });
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  };

  const executeConfirmed = async () => {
    if (!pendingConfirm || visibleSelectedTargets.length === 0 || busy) return;
    const action = pendingConfirm;
    setFeedback('');
    setErrorFeedback('');
    try {
      if (action.kind === 'status') {
        await onApplyStatus(visibleSelectedTargets, action.status);
        setFeedback(
          `已原子更新 ${visibleSelectedTargets.length} 个账号的状态为“${statusLabels[action.status]}”。`,
        );
      } else if (action.kind === 'archive') {
        await onApplyStatus(visibleSelectedTargets, 'archived');
        setFeedback(`已批量归档 ${visibleSelectedTargets.length} 个账号。`);
      } else {
        const tagIds = Array.from(selectedTagIds);
        if (tagIds.length === 0) return;
        await onApplyTags(visibleSelectedTargets, tagIds);
        setFeedback(`已为 ${visibleSelectedTargets.length} 个账号同步标签配置。`);
      }
      setSelectedIds(new Set());
      setPendingConfirm(null);
    } catch (error) {
      const err = error as Partial<ErrorResponse> | undefined;
      setErrorFeedback(
        err?.error?.message ?? '批量操作失败，整批事务已回滚，请刷新后重试。',
      );
      setPendingConfirm(null);
    }
  };

  const selectedTagNames = tags
    .filter((t) => selectedTagIds.has(t.id))
    .map((t) => t.name);

  return (
    <div data-slot="batch-operations-panel" className="space-y-4">
      {/* 批量操作控制面板 */}
      <GlassPanel variant="strong" className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--table-divider)] pb-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]">
              <Layers className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">
                账号批量操作台
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)]">
                勾选目标账号后执行批量状态变更、归档或标签同步，自动校验行版本（CAS）防并发覆盖。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onSearchQueryChange && (
              <div className="relative flex items-center">
                <Search
                  className="pointer-events-none absolute left-2.5 size-3.5 text-[var(--text-secondary)]"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  aria-label="筛选批量操作账号"
                  placeholder="筛选邮箱、编号或标签…"
                  value={searchQuery}
                  onChange={(e) => onSearchQueryChange(e.target.value)}
                  className="h-8.5 w-52 rounded-xl border border-white/80 bg-white/70 pr-3 pl-8 text-[12.5px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                />
              </div>
            )}
            <span className="rounded-full border border-[var(--badge-blue-border)] bg-[var(--badge-blue-bg)] px-3 py-1 text-[12px] font-semibold tabular-nums text-[var(--badge-blue-text)]">
              已选 {visibleSelectedTargets.length} 个账号
            </span>
          </div>
        </div>

        <div className="mt-3.5 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* 批量状态修改 */}
          <div className="rounded-2xl border border-white/82 bg-white/54 p-3.5">
            <p className="mb-2 text-[12.5px] font-semibold text-[var(--text-primary)]">
              批量状态调整
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="目标账号状态"
                value={nextStatus}
                disabled={busy}
                onChange={(e) =>
                  setNextStatus(e.target.value as AccountSummary['status'])
                }
                className="h-9 flex-1 rounded-xl border border-[var(--border)] bg-white/88 px-3 text-[13px] font-medium text-[var(--text-primary)]"
              >
                <option value="normal">正常</option>
                <option value="pending_verification">待验证</option>
                <option value="restricted">受限</option>
                <option value="login_failed">无法登录</option>
                <option value="disabled">已停用</option>
                <option value="archived">已归档</option>
              </select>
              <button
                type="button"
                disabled={visibleSelectedTargets.length === 0 || busy}
                onClick={() =>
                  setPendingConfirm({ kind: 'status', status: nextStatus })
                }
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 text-[12.5px] font-semibold text-[var(--primary-foreground)] hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy && <Loader2 className="macos-spinner size-3.5" />}
                应用状态
              </button>
              <button
                type="button"
                disabled={visibleSelectedTargets.length === 0 || busy}
                onClick={() => setPendingConfirm({ kind: 'archive' })}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/85 bg-white/75 px-3 text-[12.5px] font-medium text-[var(--text-primary)] hover:bg-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Archive className="size-3.5 text-[var(--text-secondary)]" />
                批量归档
              </button>
            </div>
          </div>

          {/* 批量标签同步 */}
          <div className="rounded-2xl border border-white/82 bg-white/54 p-3.5">
            <p className="mb-2 text-[12.5px] font-semibold text-[var(--text-primary)]">
              批量标签分配
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {tags.length === 0 ? (
                  <span className="text-[12px] text-[var(--text-secondary)]">
                    暂无可用标签
                  </span>
                ) : (
                  tags.map((tag) => {
                    const picked = selectedTagIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        aria-pressed={picked}
                        onClick={() => toggleTag(tag.id)}
                        className={
                          picked
                            ? 'inline-flex h-7 items-center gap-1 rounded-full border border-[var(--badge-blue-border)] bg-[var(--badge-blue-bg)] px-2.5 text-[11.5px] font-semibold text-[var(--badge-blue-text)]'
                            : 'inline-flex h-7 items-center gap-1 rounded-full border border-white/85 bg-white/72 px-2.5 text-[11.5px] font-medium text-[var(--text-secondary)] hover:bg-white'
                        }
                      >
                        <TagIcon className="size-3" aria-hidden="true" />
                        {tag.name}
                      </button>
                    );
                  })
                )}
              </div>
              <button
                type="button"
                disabled={
                  visibleSelectedTargets.length === 0 ||
                  selectedTagIds.size === 0 ||
                  busy
                }
                onClick={() => setPendingConfirm({ kind: 'tags' })}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--badge-blue-border)] bg-[var(--badge-blue-bg)] px-3.5 text-[12.5px] font-semibold text-[var(--badge-blue-text)] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-45"
              >
                同步所选标签
              </button>
            </div>
          </div>
        </div>

        {errorFeedback && (
          <div
            role="alert"
            className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] px-3.5 py-2 text-[12.5px] font-medium text-[var(--badge-red-text)]"
          >
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>{errorFeedback}</span>
          </div>
        )}

        {feedback && (
          <div
            role="status"
            className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] px-3.5 py-2 text-[12.5px] font-medium text-[var(--badge-green-text)]"
          >
            <CheckCircle2
              className="size-4 shrink-0 text-[var(--success)]"
              aria-hidden="true"
            />
            <span>{feedback}</span>
          </div>
        )}
      </GlassPanel>

      {/* 待批量处理账号表格 */}
      <GlassPanel className="overflow-hidden p-4">
        {totalAccounts !== undefined && totalAccounts > accounts.length && (
          <p className="mb-2.5 text-[12px] text-[var(--text-secondary)]">
            当前已加载前 {accounts.length} 条账号（系统共 {totalAccounts}{' '}
            条）；如需筛选其余账号，可在账号管理页执行批量操作。
          </p>
        )}
        <div className="overflow-x-auto rounded-2xl border border-white/82 bg-white/52">
          <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
            <thead className="border-b border-[var(--table-divider)] bg-[var(--surface-table-head)] text-[11.5px] font-semibold text-[var(--text-secondary)]">
              <tr>
                <th
                  scope="col"
                  className="w-10 px-3 py-2.5 text-center whitespace-nowrap"
                >
                  <input
                    type="checkbox"
                    aria-label="全选批量操作账号"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="size-4 rounded border-[#9bb8dc] accent-[var(--accent)]"
                  />
                </th>
                <th scope="col" className="px-3 py-2.5 whitespace-nowrap">
                  编号
                </th>
                <th scope="col" className="px-3 py-2.5 whitespace-nowrap">
                  Gmail 地址
                </th>
                <th scope="col" className="px-3 py-2.5 whitespace-nowrap">
                  状态
                </th>
                <th scope="col" className="px-3 py-2.5 whitespace-nowrap">
                  二步验证
                </th>
                <th scope="col" className="px-3 py-2.5 whitespace-nowrap">
                  标签
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-right whitespace-nowrap"
                >
                  版本
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--table-divider)]">
              {filtered.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-[13px] text-[var(--text-secondary)]"
                  >
                    暂无匹配的账号记录。
                  </td>
                </tr>
              ) : (
                filtered.map((acc) => {
                  const checked = selectedIds.has(acc.id);
                  return (
                    <tr
                      key={acc.id}
                      className={
                        checked
                          ? 'bg-[var(--table-row-selected)]'
                          : 'hover:bg-white/60'
                      }
                    >
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          aria-label={`选择账号 ${acc.gmailEmail}`}
                          checked={checked}
                          onChange={() => toggleOne(acc.id)}
                          className="size-4 rounded border-[#9bb8dc] accent-[var(--accent)]"
                        />
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[12px] whitespace-nowrap text-[var(--text-secondary)]">
                        {acc.accountNo}
                      </td>
                      <td className="px-3 py-2.5 font-medium whitespace-nowrap text-[var(--text-primary)]">
                        {acc.gmailEmail}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <StatusPill status={acc.status} />
                      </td>
                      <td className="px-3 py-2.5 text-[12px] whitespace-nowrap">
                        {acc.twoFactorStatus === 'enabled' ? (
                          <span className="inline-flex items-center gap-1 text-[var(--success-text)]">
                            <ShieldCheck className="size-3.5 text-[var(--success)]" />
                            已启用
                          </span>
                        ) : acc.twoFactorStatus === 'disabled' ? (
                          <span className="text-[var(--text-secondary)]">
                            未启用
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[var(--text-secondary)]">
                            <HelpCircle className="size-3.5 opacity-70" />
                            未知
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {acc.tags.map((name) => (
                            <TagPill key={name} name={name} />
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-[11.5px] tabular-nums text-[var(--text-secondary)]">
                        v{acc.rowVersion}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </GlassPanel>

      {/* 二次确认对话框 */}
      <AlertDialog
        open={pendingConfirm !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPendingConfirm(null);
        }}
      >
        <AlertDialogContent className="macos-glass-modal rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>确认执行批量操作？</AlertDialogTitle>
            <AlertDialogDescription>
              即将对已选中的 {visibleSelectedTargets.length} 个账号
              {pendingConfirm?.kind === 'status'
                ? `统一修改状态为“${statusLabels[pendingConfirm.status]}”`
                : pendingConfirm?.kind === 'archive'
                  ? '执行批量归档'
                  : `追加标签（${selectedTagNames.join('、')}）`}
              。该操作以原子事务执行，如任一账号版本冲突将整批回滚。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                void executeConfirmed();
              }}
            >
              {busy ? '提交中…' : '确认提交'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
