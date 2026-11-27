import type { RefObject } from 'react';
import { BarChart3, Filter, List, Plus, RefreshCw, Search } from 'lucide-react';
import { IconTooltip } from '@/components/macos';
import { cn } from '@/lib/utils';
import { AccountSavedViews } from './account-saved-views';
import type { AccountColumnKey } from './constants';
import type { SavedAccountView } from './saved-views';

export function AccountsToolbar({
  isRecoveryView,
  isAppsView,
  isStandaloneSubView,
  isChartView,
  deleted,
  viewMode,
  searchInputRef,
  searchDraft,
  filtersOpen,
  activeFilterCount,
  params,
  columns,
  onSearchChange,
  onCommitSearch,
  onToggleFilters,
  onApplySavedView,
  onSetViewMode,
  onPreloadChartView,
  onRefresh,
  onCreateNew,
  onReturnToList,
}: {
  isRecoveryView: boolean;
  isAppsView: boolean;
  isStandaloneSubView: boolean;
  isChartView: boolean;
  deleted: boolean;
  viewMode: 'list' | 'chart';
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchDraft: string;
  filtersOpen: boolean;
  activeFilterCount: number;
  params: URLSearchParams;
  columns: Record<AccountColumnKey, boolean>;
  onSearchChange: (next: string) => void;
  onCommitSearch: (next: string) => void;
  onToggleFilters: () => void;
  onApplySavedView: (view: SavedAccountView) => void;
  onSetViewMode: (next: 'list' | 'chart') => void;
  onPreloadChartView: () => void;
  onRefresh: () => void;
  onCreateNew: () => void;
  onReturnToList: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-[var(--text-primary)]">
          {isRecoveryView
            ? '辅助邮箱统计'
            : isAppsView
              ? '已注册应用'
              : isChartView
                ? '数据概览'
                : deleted
                  ? '回收站'
                  : '账号管理'}
        </h1>
        <p className="mt-1 text-[13px] text-[var(--text-secondary)]">
          {isRecoveryView
            ? '统计每个辅助邮箱关联的账号规模与异常分布，快速排查集中风险'
            : isAppsView
              ? '统一管理各 Gmail 注册的第三方应用状态与封禁情况'
              : isChartView
                ? '实时查看风险待办、注册趋势、状态分布、二步验证覆盖与辅助邮箱占用'
                : deleted
                  ? '软删除账号保留在此处，支持单条或批量恢复，也可执行不可逆永久删除。'
                  : '集中管理 Gmail 账号资料、凭据、辅助邮箱与使用状态'}
        </p>
      </div>

      {isStandaloneSubView ? (
        <button
          type="button"
          onClick={onReturnToList}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/80 bg-white/70 px-3.5 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-white"
        >
          返回账号列表
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2.5">
          {/* 搜索框 + ⌘/Ctrl K */}
          <div className="relative flex items-center">
            <Search
              className="pointer-events-none absolute left-3 size-4 text-[var(--text-secondary)]"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="search"
              aria-label="搜索账号"
              placeholder="搜索编号、邮箱或辅助邮箱"
              value={searchDraft}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onCommitSearch(searchDraft);
                }
              }}
              maxLength={254}
              className="h-9 w-60 rounded-xl border border-white/80 bg-white/65 pr-[76px] pl-9 text-[13px] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-md transition-all duration-[180ms] ease-out placeholder:text-[var(--text-secondary)] focus:bg-white/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] sm:w-72"
            />
            <kbd
              aria-hidden="true"
              className="pointer-events-none absolute right-2.5 rounded-md border border-[var(--border)] bg-white/80 px-1.5 py-0.5 text-[10.5px] font-medium whitespace-nowrap text-[var(--text-secondary)]"
            >
              ⌘/Ctrl K
            </kbd>
          </div>

          {/* 筛选开关按钮 */}
          <IconTooltip label={filtersOpen ? '收起筛选条件' : '展开筛选条件'}>
            <button
              type="button"
              aria-expanded={filtersOpen}
              onClick={onToggleFilters}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3.5 text-[13px] font-medium transition-all duration-[180ms] ease-out',
                filtersOpen || activeFilterCount > 0
                  ? 'border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-text)]'
                  : 'border-white/80 bg-white/65 text-[var(--text-primary)] hover:-translate-y-[1px] hover:bg-white/85',
              )}
            >
              <Filter className="size-3.5" aria-hidden="true" />
              <span>筛选</span>
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-[var(--accent)] px-1.5 text-[10px] font-semibold text-[var(--primary-foreground)]">
                  {activeFilterCount}
                </span>
              )}
            </button>
          </IconTooltip>

          {/* 保存视图菜单 */}
          <AccountSavedViews
            params={params}
            columns={columns}
            onApplyView={onApplySavedView}
          />

          {/* 列表 / 图表视图切换 */}
          <div
            role="group"
            aria-label="视图切换"
            className="inline-flex h-9 items-center rounded-xl border border-white/80 bg-white/60 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
          >
            <IconTooltip label="列表视图">
              <button
                type="button"
                aria-label="列表视图"
                aria-pressed={viewMode === 'list'}
                onClick={() => onSetViewMode('list')}
                className={cn(
                  'inline-flex size-8 items-center justify-center rounded-[10px] transition-all duration-[160ms] ease-out',
                  viewMode === 'list'
                    ? 'bg-[var(--accent)] text-[var(--primary-foreground)] shadow-[0_4px_12px_rgba(22,119,255,0.28)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                <List className="size-4" aria-hidden="true" />
              </button>
            </IconTooltip>
            <IconTooltip label="图表视图">
              <button
                type="button"
                aria-label="图表视图"
                aria-pressed={viewMode === 'chart'}
                onMouseEnter={onPreloadChartView}
                onFocus={onPreloadChartView}
                onClick={() => onSetViewMode('chart')}
                className={cn(
                  'inline-flex size-8 items-center justify-center rounded-[10px] transition-all duration-[160ms] ease-out',
                  viewMode === 'chart'
                    ? 'bg-[var(--accent)] text-[var(--primary-foreground)] shadow-[0_4px_12px_rgba(22,119,255,0.28)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                )}
              >
                <BarChart3 className="size-4" aria-hidden="true" />
              </button>
            </IconTooltip>
          </div>

          <IconTooltip label="刷新列表">
            <button
              type="button"
              aria-label="刷新列表"
              onClick={onRefresh}
              className="inline-flex size-9 items-center justify-center rounded-xl border border-white/80 bg-white/65 text-[var(--text-secondary)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-white/90 hover:text-[var(--text-primary)]"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
            </button>
          </IconTooltip>

          {!deleted && (
            <button
              type="button"
              onClick={onCreateNew}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--accent)] px-4 text-[13px] font-medium text-[var(--primary-foreground)] shadow-[0_8px_20px_rgba(22,119,255,0.28)] transition-all duration-[180ms] ease-out hover:-translate-y-[1px] hover:bg-[var(--accent-hover)]"
            >
              <Plus className="size-4" aria-hidden="true" />
              <span>新建账号</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
