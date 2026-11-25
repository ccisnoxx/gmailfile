import { useMemo, useState } from 'react';
import {
  Archive,
  CheckCircle2,
  Layers,
  Loader2,
  ShieldCheck,
  Tag as TagIcon,
} from 'lucide-react';
import type { AccountSummary, TagResponse } from '@/api/generated';
import { GlassPanel, StatusPill, TagPill } from '@/components/macos';
import type { BatchAccountItem } from './types';

export function BatchOperationsPanel({
  accounts,
  tags,
  searchQuery,
  busy,
  onApplyStatus,
  onApplyTags,
}: {
  accounts: readonly BatchAccountItem[];
  tags: readonly TagResponse[];
  searchQuery: string;
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

  const allSelected =
    filtered.length > 0 && filtered.every((item) => selectedIds.has(item.id));

  const selectedTargets = useMemo(
    () =>
      accounts
        .filter((item) => selectedIds.has(item.id))
        .map((item) => ({ id: item.id, rowVersion: item.rowVersion })),
    [accounts, selectedIds],
  );

  const toggleAll = (checked: boolean) => {
    if (!checked) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map((item) => item.id)));
    }
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

  const handleStatusSubmit = async () => {
    if (selectedTargets.length === 0 || busy) return;
    setFeedback('');
    await onApplyStatus(selectedTargets, nextStatus);
    setFeedback(`已原子更新 ${selectedTargets.length} 个账号的状态。`);
    setSelectedIds(new Set());
  };

  const handleArchiveSubmit = async () => {
    if (selectedTargets.length === 0 || busy) return;
    setFeedback('');
    await onApplyStatus(selectedTargets, 'archived');
    setFeedback(`已批量归档 ${selectedTargets.length} 个账号。`);
    setSelectedIds(new Set());
  };

  const handleTagsSubmit = async () => {
    if (selectedTargets.length === 0 || selectedTagIds.size === 0 || busy) {
      return;
    }
    setFeedback('');
    await onApplyTags(selectedTargets, Array.from(selectedTagIds));
    setFeedback(`已为 ${selectedTargets.length} 个账号同步标签配置。`);
    setSelectedIds(new Set());
  };

  return (
    <div data-slot="batch-operations-panel" className="space-y-4">
      {/* 批量操作控制面板 */}
      <GlassPanel variant="strong" className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--table-divider)] pb-3">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-xl bg-[#eaf3ff] text-[var(--accent)]">
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
          <span className="rounded-full border border-[#1677ff]/22 bg-[#eaf3ff]/80 px-3 py-1 text-[12px] font-semibold tabular-nums text-[#1158c7]">
            已选 {selectedTargets.length} 个账号
          </span>
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
                className="h-9 flex-1 rounded-xl border border-[#b9d0ec]/80 bg-white/88 px-3 text-[13px] font-medium text-[var(--text-primary)]"
              >
                <option value="normal">正常</option>
                <option value="pending_verification">待验证</option>
                <option value="restricted">风险</option>
                <option value="disabled">停用</option>
                <option value="archived">已归档</option>
              </select>
              <button
                type="button"
                disabled={selectedTargets.length === 0 || busy}
                onClick={() => void handleStatusSubmit()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-3.5 text-[12.5px] font-semibold text-white hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {busy && <Loader2 className="macos-spinner size-3.5" />}
                应用状态
              </button>
              <button
                type="button"
                disabled={selectedTargets.length === 0 || busy}
                onClick={() => void handleArchiveSubmit()}
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
                {tags.map((tag) => {
                  const picked = selectedTagIds.has(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      aria-pressed={picked}
                      onClick={() => toggleTag(tag.id)}
                      className={
                        picked
                          ? 'inline-flex h-7 items-center gap-1 rounded-full border border-[#1677ff]/35 bg-[#eaf3ff] px-2.5 text-[11.5px] font-semibold text-[#1158c7]'
                          : 'inline-flex h-7 items-center gap-1 rounded-full border border-white/85 bg-white/72 px-2.5 text-[11.5px] font-medium text-[var(--text-secondary)] hover:bg-white'
                      }
                    >
                      <TagIcon className="size-3" aria-hidden="true" />
                      {tag.name}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                disabled={
                  selectedTargets.length === 0 ||
                  selectedTagIds.size === 0 ||
                  busy
                }
                onClick={() => void handleTagsSubmit()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[#1677ff]/25 bg-[#eaf3ff] px-3.5 text-[12.5px] font-semibold text-[#1158c7] hover:bg-[#dcebff] disabled:cursor-not-allowed disabled:opacity-45"
              >
                同步所选标签
              </button>
            </div>
          </div>
        </div>

        {feedback && (
          <div
            role="status"
            className="mt-3 flex items-center gap-2 rounded-xl border border-[#2fbf71]/28 bg-[#e7f8ef]/85 px-3.5 py-2 text-[12.5px] font-medium text-[#186e40]"
          >
            <CheckCircle2 className="size-4 text-[var(--success)]" />
            <span>{feedback}</span>
          </div>
        )}
      </GlassPanel>

      {/* 待批量处理账号表格 */}
      <GlassPanel className="overflow-hidden p-4">
        <div className="overflow-x-auto rounded-2xl border border-white/82 bg-white/52">
          <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
            <thead className="border-b border-[var(--table-divider)] bg-white/65 text-[11.5px] font-semibold text-[var(--text-secondary)]">
              <tr>
                <th scope="col" className="w-10 px-3 py-2.5 text-center">
                  <input
                    type="checkbox"
                    aria-label="全选批量操作账号"
                    checked={allSelected}
                    onChange={(e) => toggleAll(e.target.checked)}
                    className="size-4 rounded border-[#9bb8dc] accent-[var(--accent)]"
                  />
                </th>
                <th scope="col" className="px-3 py-2.5">
                  编号
                </th>
                <th scope="col" className="px-3 py-2.5">
                  Gmail 地址
                </th>
                <th scope="col" className="px-3 py-2.5">
                  状态
                </th>
                <th scope="col" className="px-3 py-2.5">
                  二步验证
                </th>
                <th scope="col" className="px-3 py-2.5">
                  标签
                </th>
                <th scope="col" className="px-3 py-2.5 text-right">
                  版本
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--table-divider)]">
              {filtered.map((acc) => {
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
                    <td className="px-3 py-2.5 font-mono text-[12px] text-[var(--text-secondary)]">
                      {acc.accountNo}
                    </td>
                    <td className="px-3 py-2.5 font-medium text-[var(--text-primary)]">
                      {acc.gmailEmail}
                    </td>
                    <td className="px-3 py-2.5">
                      <StatusPill status={acc.status} />
                    </td>
                    <td className="px-3 py-2.5 text-[12px]">
                      {acc.twoFactorStatus === 'enabled' ? (
                        <span className="inline-flex items-center gap-1 text-[#1b8a4e]">
                          <ShieldCheck className="size-3.5 text-[var(--success)]" />
                          已启用
                        </span>
                      ) : (
                        <span className="text-[var(--text-secondary)]">
                          未启用
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
              })}
            </tbody>
          </table>
        </div>
      </GlassPanel>
    </div>
  );
}
