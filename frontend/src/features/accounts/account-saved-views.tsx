import { useEffect, useState } from 'react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import { Bookmark, Check, Plus, Star, Trash2 } from 'lucide-react';
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
import { cn } from '@/lib/utils';
import type { AccountColumnKey } from './constants';
import {
  BUILTIN_ACCOUNT_VIEWS,
  createSavedViewId,
  doesParamsMatchView,
  extractViewQueryFromParams,
  persistSavedViewsStore,
  readSavedViewsStore,
  subscribeSavedViewsStore,
  type SavedAccountView,
  type SavedViewsStore,
} from './saved-views';

export function AccountSavedViews({
  params,
  columns,
  onApplyView,
}: {
  params: URLSearchParams;
  columns: Record<AccountColumnKey, boolean>;
  onApplyView: (view: SavedAccountView) => void;
}) {
  const [store, setStore] = useState<SavedViewsStore>(() =>
    readSavedViewsStore(),
  );
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [includeColumns, setIncludeColumns] = useState(true);
  const [setAsDefault, setSetAsDefault] = useState(false);

  useEffect(() => subscribeSavedViewsStore(setStore), []);

  const allViews = [...BUILTIN_ACCOUNT_VIEWS, ...store.views];
  const matchedView = allViews.find((view) =>
    doesParamsMatchView(params, view),
  );

  const updateStore = (next: SavedViewsStore) => {
    setStore(next);
    persistSavedViewsStore(next);
  };

  const handleSaveCurrent = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = viewName.trim();
    if (!trimmed) return;
    const id = createSavedViewId();
    const nextView: SavedAccountView = {
      id,
      name: trimmed.slice(0, 40),
      query: extractViewQueryFromParams(params),
      ...(includeColumns ? { columns: { ...columns } } : {}),
      createdAt: new Date().toISOString(),
    };
    updateStore({
      version: 1,
      defaultViewId: setAsDefault ? id : store.defaultViewId,
      views: [...store.views, nextView],
    });
    setViewName('');
    setSetAsDefault(false);
    setSaveDialogOpen(false);
  };

  const handleToggleDefault = (viewId: string) => {
    updateStore({
      ...store,
      defaultViewId: store.defaultViewId === viewId ? null : viewId,
    });
  };

  const handleDeleteCustom = (viewId: string) => {
    updateStore({
      version: 1,
      defaultViewId:
        store.defaultViewId === viewId ? null : store.defaultViewId,
      views: store.views.filter((v) => v.id !== viewId),
    });
  };

  const itemClass =
    'flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] outline-none transition-colors data-[highlighted]:bg-[var(--accent-soft)] focus:bg-[var(--accent-soft)]';

  return (
    <>
      <DropdownMenuPrimitive.Root>
        <DropdownMenuPrimitive.Trigger asChild>
          <button
            type="button"
            aria-label="保存视图"
            className={cn(
              'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-medium transition-all duration-[180ms] ease-out',
              matchedView
                ? 'border-[var(--accent)]/30 bg-[var(--accent-soft)] text-[var(--accent-text)]'
                : 'border-white/80 bg-white/65 text-[var(--text-primary)] hover:-translate-y-[1px] hover:bg-white/85',
            )}
          >
            <Bookmark className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="max-w-[92px] truncate">
              {matchedView ? matchedView.name : '视图'}
            </span>
          </button>
        </DropdownMenuPrimitive.Trigger>
        <DropdownMenuPrimitive.Portal>
          <DropdownMenuPrimitive.Content
            align="end"
            sideOffset={6}
            aria-label="视图菜单"
            className="macos-glass-modal macos-thin-scrollbar z-50 max-h-[72vh] w-72 overflow-y-auto rounded-2xl p-1.5 text-[var(--text-primary)]"
          >
            <DropdownMenuPrimitive.Label className="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
              风险智能视图
            </DropdownMenuPrimitive.Label>
            {BUILTIN_ACCOUNT_VIEWS.filter((v) => v.category === 'risk').map(
              (view) => {
                const active = matchedView?.id === view.id;
                const isDefault = store.defaultViewId === view.id;
                return (
                  <div key={view.id} className="flex items-center gap-0.5">
                    <DropdownMenuPrimitive.Item
                      onSelect={() => onApplyView(view)}
                      title={view.description}
                      className={cn(itemClass, 'flex-1')}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Check
                          className={cn(
                            'size-3.5 shrink-0',
                            active
                              ? 'text-[var(--accent)] opacity-100'
                              : 'opacity-0',
                          )}
                          aria-hidden="true"
                        />
                        <span className="truncate">{view.name}</span>
                      </span>
                      {isDefault && (
                        <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-text)]">
                          默认
                        </span>
                      )}
                    </DropdownMenuPrimitive.Item>
                    <button
                      type="button"
                      aria-label={
                        isDefault
                          ? `取消默认视图 ${view.name}`
                          : `设为默认视图 ${view.name}`
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleDefault(view.id);
                      }}
                      className={cn(
                        'inline-flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-control-hover)]',
                        isDefault
                          ? 'text-[var(--warning)]'
                          : 'text-[var(--text-secondary)]',
                      )}
                    >
                      <Star
                        className={cn('size-3.5', isDefault && 'fill-current')}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                );
              },
            )}

            <DropdownMenuPrimitive.Separator className="my-1.5 h-px bg-[var(--table-divider)]" />
            <DropdownMenuPrimitive.Label className="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
              数据质量与归档
            </DropdownMenuPrimitive.Label>
            {BUILTIN_ACCOUNT_VIEWS.filter((v) => v.category === 'quality').map(
              (view) => {
                const active = matchedView?.id === view.id;
                const isDefault = store.defaultViewId === view.id;
                return (
                  <div key={view.id} className="flex items-center gap-0.5">
                    <DropdownMenuPrimitive.Item
                      onSelect={() => onApplyView(view)}
                      title={view.description}
                      className={cn(itemClass, 'flex-1')}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Check
                          className={cn(
                            'size-3.5 shrink-0',
                            active
                              ? 'text-[var(--accent)] opacity-100'
                              : 'opacity-0',
                          )}
                          aria-hidden="true"
                        />
                        <span className="truncate">{view.name}</span>
                      </span>
                      {isDefault && (
                        <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-text)]">
                          默认
                        </span>
                      )}
                    </DropdownMenuPrimitive.Item>
                    <button
                      type="button"
                      aria-label={
                        isDefault
                          ? `取消默认视图 ${view.name}`
                          : `设为默认视图 ${view.name}`
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleDefault(view.id);
                      }}
                      className={cn(
                        'inline-flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-control-hover)]',
                        isDefault
                          ? 'text-[var(--warning)]'
                          : 'text-[var(--text-secondary)]',
                      )}
                    >
                      <Star
                        className={cn('size-3.5', isDefault && 'fill-current')}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                );
              },
            )}

            {store.views.length > 0 && (
              <>
                <DropdownMenuPrimitive.Separator className="my-1.5 h-px bg-[var(--table-divider)]" />
                <DropdownMenuPrimitive.Label className="px-2.5 py-1 text-[11px] font-semibold tracking-wide text-[var(--text-secondary)]">
                  已保存视图
                </DropdownMenuPrimitive.Label>
                {store.views.map((view) => {
                  const active = matchedView?.id === view.id;
                  const isDefault = store.defaultViewId === view.id;
                  return (
                    <div key={view.id} className="flex items-center gap-0.5">
                      <DropdownMenuPrimitive.Item
                        onSelect={() => onApplyView(view)}
                        className={cn(itemClass, 'flex-1')}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Check
                            className={cn(
                              'size-3.5 shrink-0',
                              active
                                ? 'text-[var(--accent)] opacity-100'
                                : 'opacity-0',
                            )}
                            aria-hidden="true"
                          />
                          <span className="truncate">{view.name}</span>
                        </span>
                        {isDefault && (
                          <span className="shrink-0 rounded bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-text)]">
                            默认
                          </span>
                        )}
                      </DropdownMenuPrimitive.Item>
                      <button
                        type="button"
                        aria-label={
                          isDefault
                            ? `取消默认视图 ${view.name}`
                            : `设为默认视图 ${view.name}`
                        }
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleDefault(view.id);
                        }}
                        className={cn(
                          'inline-flex size-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-[var(--surface-control-hover)]',
                          isDefault
                            ? 'text-[var(--warning)]'
                            : 'text-[var(--text-secondary)]',
                        )}
                      >
                        <Star
                          className={cn(
                            'size-3.5',
                            isDefault && 'fill-current',
                          )}
                          aria-hidden="true"
                        />
                      </button>
                      <button
                        type="button"
                        aria-label={`删除视图 ${view.name}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteCustom(view.id);
                        }}
                        className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger-text)]"
                      >
                        <Trash2 className="size-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </>
            )}

            <DropdownMenuPrimitive.Separator className="my-1.5 h-px bg-[var(--table-divider)]" />
            <DropdownMenuPrimitive.Item
              onSelect={() => setSaveDialogOpen(true)}
              className={cn(itemClass, 'font-medium text-[var(--accent-text)]')}
            >
              <span className="flex items-center gap-2">
                <Plus className="size-3.5" aria-hidden="true" />
                <span>保存当前条件为视图…</span>
              </span>
            </DropdownMenuPrimitive.Item>
          </DropdownMenuPrimitive.Content>
        </DropdownMenuPrimitive.Portal>
      </DropdownMenuPrimitive.Root>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent className="macos-glass-modal rounded-[20px] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>保存当前筛选视图</DialogTitle>
            <DialogDescription>
              仅在本地保存当前筛选条件、排序与非敏感列显示偏好，不包含任何凭据。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSaveCurrent} className="space-y-4">
            <label className="flex flex-col gap-1.5 text-xs font-medium text-[var(--text-secondary)]">
              <span>视图名称</span>
              <Input
                aria-label="视图名称"
                placeholder="例如：近 30 天未开启 2FA"
                value={viewName}
                onChange={(e) => setViewName(e.target.value)}
                maxLength={40}
                required
                autoFocus
              />
            </label>
            <div className="space-y-2 text-xs text-[var(--text-primary)]">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeColumns}
                  onChange={(e) => setIncludeColumns(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                <span>同时保存当前表格列显示配置</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={setAsDefault}
                  onChange={(e) => setSetAsDefault(e.target.checked)}
                  className="accent-[var(--accent)]"
                />
                <span>设为进入账号页时的默认视图</span>
              </label>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSaveDialogOpen(false)}
              >
                取消
              </Button>
              <Button type="submit" disabled={!viewName.trim()}>
                保存视图
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
