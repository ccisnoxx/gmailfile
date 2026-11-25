import { useMemo, useState } from 'react';
import { Filter, Plus, Star } from 'lucide-react';
import type { AccountSummary } from '@/api/generated';
import {
  EmptyState,
  GlassPanel,
  GmailMark,
  LoadingState,
  TagPill,
} from '@/components/macos';
import { cn } from '@/lib/utils';
import { compactListTagLabel } from './detail-mock-fixtures';

export type AccountListFilterTab = 'all' | 'normal' | 'disabled' | 'archived';

const filterTabs: readonly { key: AccountListFilterTab; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'normal', label: '正常' },
  { key: 'disabled', label: '停用' },
  { key: 'archived', label: '已归档' },
];

function ListItemStatusMeta({ status }: { status: AccountSummary['status'] }) {
  switch (status) {
    case 'normal':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#1b8a4e]">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-[var(--success)]"
          />
          正常
        </span>
      );
    case 'disabled':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#667085]">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-[#98a2b3]"
          />
          停用
        </span>
      );
    case 'archived':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#667085]">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full border border-[#8492a6] bg-transparent"
          />
          已归档
        </span>
      );
    case 'pending_verification':
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#9a6700]">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-[#f5a623]"
          />
          待验证
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-[#b76e08]">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-[var(--warning)]"
          />
          风险
        </span>
      );
  }
}

export function AccountListPane({
  accounts,
  totalCount,
  selectedAccountId,
  filterTab,
  onFilterTabChange,
  favorites,
  onToggleFavorite,
  onSelectAccount,
  onCreateAccount,
  isLoading = false,
  className,
}: {
  accounts: AccountSummary[];
  totalCount: number;
  selectedAccountId: string | null;
  filterTab: AccountListFilterTab;
  onFilterTabChange: (tab: AccountListFilterTab) => void;
  favorites: Record<string, boolean>;
  onToggleFavorite: (accountId: string) => void;
  onSelectAccount: (accountId: string) => void;
  onCreateAccount: () => void;
  isLoading?: boolean;
  className?: string;
}) {
  const [funnelOpen, setFunnelOpen] = useState(false);
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [only2Fa, setOnly2Fa] = useState(false);

  const visibleAccounts = useMemo(() => {
    return accounts.filter((account) => {
      if (onlyFavorites && !favorites[account.id]) return false;
      if (only2Fa && account.two_factor_status !== 'enabled') return false;
      return true;
    });
  }, [accounts, favorites, only2Fa, onlyFavorites]);

  const activeExtraCount = Number(onlyFavorites) + Number(only2Fa);

  return (
    <GlassPanel
      variant="strong"
      data-slot="account-list-pane"
      aria-label="账号列表面板"
      className={cn(
        'flex w-full shrink-0 flex-col overflow-hidden rounded-[20px] xl:w-[300px] min-[1400px]:w-[320px]',
        className,
      )}
    >
      {/* 头部：Gmail 账号（1,248）+ 新建账号 */}
      <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-3">
        <h2 className="truncate text-[15px] font-semibold tracking-tight text-[var(--text-primary)]">
          <span>Gmail 账号</span>
          <span className="ml-0.5 font-medium tabular-nums text-[var(--text-secondary)]">
            （{totalCount.toLocaleString('en-US')}）
          </span>
        </h2>
        <button
          type="button"
          onClick={onCreateAccount}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-xl bg-[linear-gradient(180deg,#348dff_0%,#1677ff_100%)] px-3 text-xs font-medium text-white shadow-[0_6px_14px_rgba(22,119,255,0.26),inset_0_1px_0_rgba(255,255,255,0.32)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:brightness-105"
        >
          <Plus className="size-3.5" aria-hidden="true" />
          <span>新建账号</span>
        </button>
      </div>

      {/* 筛选标签与右侧漏斗筛选按钮 */}
      <div className="px-4 pb-3">
        <div className="flex items-center gap-2">
          <div
            role="tablist"
            aria-label="账号状态筛选"
            className="grid flex-1 grid-cols-4 gap-0.5 rounded-xl border border-white/75 bg-white/45 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]"
          >
            {filterTabs.map((tab) => {
              const active = filterTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => onFilterTabChange(tab.key)}
                  className={cn(
                    'h-7 rounded-[9px] px-1.5 text-[12px] font-medium whitespace-nowrap transition-all duration-[160ms] ease-out',
                    active
                      ? 'bg-white/92 font-semibold text-[var(--accent)] shadow-[0_2px_8px_rgba(32,68,118,0.1)]'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            aria-label="更多筛选"
            aria-expanded={funnelOpen}
            onClick={() => setFunnelOpen((open) => !open)}
            className={cn(
              'relative inline-flex size-8 shrink-0 items-center justify-center rounded-xl border transition-all duration-[160ms] ease-out',
              funnelOpen || activeExtraCount > 0
                ? 'border-[#1677ff]/35 bg-[#eaf3ff] text-[var(--accent)]'
                : 'border-white/75 bg-white/55 text-[var(--text-secondary)] hover:bg-white/85 hover:text-[var(--text-primary)]',
            )}
          >
            <Filter className="size-3.5" aria-hidden="true" />
            {activeExtraCount > 0 && (
              <span
                aria-hidden="true"
                className="absolute -top-1 -right-1 inline-flex size-4 items-center justify-center rounded-full bg-[var(--accent)] text-[10px] font-semibold text-white"
              >
                {activeExtraCount}
              </span>
            )}
          </button>
        </div>

        {/* 漏斗高级筛选面板 */}
        {funnelOpen && (
          <div
            aria-label="附加筛选条件"
            className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-white/80 bg-white/65 px-2.5 py-2 text-xs"
          >
            <label className="flex cursor-pointer items-center gap-1.5 text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={onlyFavorites}
                onChange={(e) => setOnlyFavorites(e.target.checked)}
                className="size-3.5 rounded accent-[var(--accent)]"
              />
              <span>仅收藏</span>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={only2Fa}
                onChange={(e) => setOnly2Fa(e.target.checked)}
                className="size-3.5 rounded accent-[var(--accent)]"
              />
              <span>仅已启用 2FA</span>
            </label>
            {activeExtraCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setOnlyFavorites(false);
                  setOnly2Fa(false);
                }}
                className="ml-auto text-[11px] font-medium text-[var(--accent)] hover:underline"
              >
                清空
              </button>
            )}
          </div>
        )}
      </div>

      {/* 可滚动账号列表区域（macOS 细滚动条） */}
      <div
        role="list"
        aria-label="Gmail 账号列表"
        className="macos-thin-scrollbar max-h-[260px] flex-1 space-y-2 overflow-y-auto px-3 pt-0.5 pb-4 xl:max-h-[calc(100vh-14rem)]"
      >
        {isLoading ? (
          <LoadingState
            title="正在加载账号…"
            description="请稍候…"
            className="border-0 bg-transparent px-3 py-8 shadow-none"
          />
        ) : visibleAccounts.length === 0 ? (
          <EmptyState
            title="未找到匹配账号"
            description="尝试调整筛选条件或新建账号。"
            onCreate={onCreateAccount}
            className="border-0 bg-transparent px-3 py-8 shadow-none"
          />
        ) : (
          visibleAccounts.map((account) => {
            const isSelected = account.id === selectedAccountId;
            const isStarred = Boolean(favorites[account.id]);
            const displayTags = account.tags.slice(0, 2);

            return (
              <div
                key={account.id}
                role="listitem"
                data-selected={isSelected ? 'true' : 'false'}
                className={cn(
                  'group relative flex items-center gap-2 rounded-2xl border p-2.5 transition-all duration-[180ms] ease-out',
                  isSelected
                    ? 'border-[#1677ff]/48 bg-[#eaf3ff]/82 shadow-[0_6px_18px_rgba(22,119,255,0.12),inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-[#1677ff]/18'
                    : 'border-white/75 bg-white/52 hover:border-white/95 hover:bg-white/76',
                )}
              >
                <button
                  type="button"
                  aria-current={isSelected ? 'true' : undefined}
                  onClick={() => onSelectAccount(account.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
                >
                  <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/90 bg-white/88 shadow-[0_2px_6px_rgba(45,86,138,0.08)]">
                    <GmailMark size="sm" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        'truncate text-[13px] leading-snug font-semibold',
                        isSelected
                          ? 'text-[#0e2a55]'
                          : 'text-[var(--text-primary)]',
                      )}
                    >
                      {account.gmail_email}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <ListItemStatusMeta status={account.status} />
                      {displayTags.map((tag) => (
                        <TagPill
                          key={tag.id}
                          name={compactListTagLabel(tag.name)}
                          className="rounded-md px-1.5 py-0 text-[10.5px] leading-4"
                        />
                      ))}
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  aria-label={
                    isStarred
                      ? `取消收藏 ${account.gmail_email}`
                      : `收藏 ${account.gmail_email}`
                  }
                  aria-pressed={isStarred}
                  onClick={() => onToggleFavorite(account.id)}
                  className={cn(
                    'inline-flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors',
                    isStarred
                      ? 'text-[#f5a623] hover:bg-white/70'
                      : 'text-[#8c9ab0] hover:bg-white/70 hover:text-[#f5a623]',
                  )}
                >
                  <Star
                    className={cn('size-4', isStarred && 'fill-[#f5a623]')}
                    aria-hidden="true"
                  />
                </button>
              </div>
            );
          })
        )}
      </div>
    </GlassPanel>
  );
}
