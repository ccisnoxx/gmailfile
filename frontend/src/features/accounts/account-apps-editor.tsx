import { useState } from 'react';
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Globe,
  Loader2,
  Plus,
  X,
} from 'lucide-react';
import type { AccountAppInput, RegisteredAppResponse } from '@/api/generated';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { AppBrandIcon, inferDefaultDomain } from './app-brand-icon';
import { appStatusLabels, type AppStatus } from './constants';

export type CreateAppOptions = {
  domain?: string | null;
  icon_data?: string | null;
};

export type CreateAppHandler = (
  name: string,
  options?: CreateAppOptions,
) => Promise<RegisteredAppResponse | null>;

export type FetchAppIconHandler = (
  domain: string,
) => Promise<{ domain: string; icon_data: string } | null>;

const statusOptions: readonly {
  value: AppStatus;
  label: string;
  activeClass: string;
  icon: typeof CheckCircle2;
}[] = [
  {
    value: 'active',
    label: appStatusLabels.active,
    activeClass:
      'border-[var(--badge-green-border)] bg-[var(--badge-green-bg)] text-[var(--badge-green-text)] font-semibold',
    icon: CheckCircle2,
  },
  {
    value: 'restricted',
    label: appStatusLabels.restricted,
    activeClass:
      'border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)] text-[var(--badge-orange-text)] font-semibold',
    icon: AlertTriangle,
  },
  {
    value: 'banned',
    label: appStatusLabels.banned,
    activeClass:
      'border-[var(--badge-red-border)] bg-[var(--badge-red-bg)] text-[var(--badge-red-text)] font-semibold',
    icon: Ban,
  },
];

export function AccountAppsEditor({
  catalog,
  value,
  onChange,
  onCreateApp,
  onFetchAppIcon,
  disabled = false,
}: {
  catalog: RegisteredAppResponse[];
  value: AccountAppInput[];
  onChange: (next: AccountAppInput[]) => void;
  onCreateApp?: CreateAppHandler;
  onFetchAppIcon?: FetchAppIconHandler;
  disabled?: boolean;
}) {
  const [newName, setNewName] = useState('');
  const [newDomain, setNewDomain] = useState('');
  const [fetchedIcon, setFetchedIcon] = useState<string | null>(null);
  const [fetchingIcon, setFetchingIcon] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const safeCatalog = Array.isArray(catalog) ? catalog : [];
  const selectedIds = new Set(value.map((item) => item.app_id));
  const catalogById = new Map(safeCatalog.map((app) => [app.id, app]));
  const availableApps = safeCatalog.filter((app) => !selectedIds.has(app.id));

  const addApp = (appId: string) => {
    if (disabled || selectedIds.has(appId)) return;
    onChange([...value, { app_id: appId, status: 'active', note: null }]);
  };

  const removeApp = (appId: string) => {
    if (disabled) return;
    onChange(value.filter((item) => item.app_id !== appId));
  };

  const updateItem = (appId: string, patch: Partial<AccountAppInput>) => {
    if (disabled) return;
    onChange(
      value.map((item) =>
        item.app_id === appId ? { ...item, ...patch } : item,
      ),
    );
  };

  const handleFetchIcon = async () => {
    if (!onFetchAppIcon || disabled || fetchingIcon) return;
    const candidate = newDomain.trim() || inferDefaultDomain(newName) || '';
    if (!candidate) {
      setCreateError('请先填写应用域名（如 perplexity.ai）再获取图标。');
      return;
    }
    setFetchingIcon(true);
    setCreateError('');
    try {
      const result = await onFetchAppIcon(candidate);
      if (result) {
        setNewDomain(result.domain);
        setFetchedIcon(result.icon_data);
      }
    } catch (error) {
      const msg = (error as { error?: { message?: string } })?.error?.message;
      setCreateError(msg || '获取图标失败，仍可直接保存并使用默认品牌图标。');
    } finally {
      setFetchingIcon(false);
    }
  };

  const handleQuickCreate = async () => {
    const cleaned = newName.trim();
    if (!cleaned || disabled || creating) return;
    const existing = safeCatalog.find(
      (app) => app.name.trim().toLowerCase() === cleaned.toLowerCase(),
    );
    if (existing) {
      addApp(existing.id);
      setNewName('');
      setNewDomain('');
      setFetchedIcon(null);
      setCreateError('');
      return;
    }
    if (!onCreateApp) return;
    setCreating(true);
    setCreateError('');
    try {
      const cleanedDomain = newDomain.trim();
      const created =
        cleanedDomain || fetchedIcon
          ? await onCreateApp(cleaned, {
              domain: cleanedDomain || null,
              icon_data: fetchedIcon,
            })
          : await onCreateApp(cleaned);
      if (created) {
        onChange([
          ...value,
          { app_id: created.id, status: 'active', note: null },
        ]);
        setNewName('');
        setNewDomain('');
        setFetchedIcon(null);
      }
    } catch (error) {
      const msg = (error as { error?: { message?: string } })?.error?.message;
      setCreateError(msg || '添加应用失败，请重试。');
    } finally {
      setCreating(false);
    }
  };

  const suggestedDomain = inferDefaultDomain(newName);
  const previewDomain = newDomain.trim() || suggestedDomain;

  return (
    <div className="space-y-3" data-slot="account-apps-editor">
      {/* 已选应用及独立状态标注 */}
      {value.length > 0 ? (
        <ul className="space-y-2" aria-label="已注册应用列表">
          {value.map((entry) => {
            const appMeta = catalogById.get(entry.app_id);
            const appName = appMeta?.name ?? '未知应用';
            const status = entry.status ?? 'active';
            return (
              <li
                key={entry.app_id}
                className={cn(
                  'rounded-xl border px-3 py-2.5 transition-colors',
                  status === 'banned'
                    ? 'border-[var(--badge-red-border)] bg-[var(--badge-red-bg)]/45'
                    : status === 'restricted'
                      ? 'border-[var(--badge-orange-border)] bg-[var(--badge-orange-bg)]/40'
                      : 'border-[var(--border)] bg-[var(--surface-control)]',
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <AppBrandIcon
                      name={appName}
                      domain={appMeta?.domain}
                      iconData={appMeta?.icon_data}
                      size="md"
                      className={cn(status === 'banned' && 'opacity-70 grayscale-[35%]')}
                    />
                    <span
                      className={cn(
                        'truncate text-[13px] font-semibold text-[var(--text-primary)]',
                        status === 'banned' &&
                          'text-[var(--badge-red-text)] line-through decoration-current/70',
                      )}
                    >
                      {appName}
                    </span>
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <div
                      role="group"
                      aria-label={`${appName} 应用状态`}
                      className="inline-flex items-center gap-1"
                    >
                      {statusOptions.map((opt) => {
                        const active = status === opt.value;
                        const Icon = opt.icon;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            disabled={disabled}
                            aria-pressed={active}
                            onClick={() =>
                              updateItem(entry.app_id, { status: opt.value })
                            }
                            className={cn(
                              'inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-[11.5px] transition-colors',
                              active
                                ? opt.activeClass
                                : 'border-[var(--border)] bg-[var(--surface-control)] text-[var(--text-secondary)] hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]',
                            )}
                          >
                            <Icon className="size-3" aria-hidden="true" />
                            <span>{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`移除应用 ${appName}`}
                      onClick={() => removeApp(entry.app_id)}
                      className="inline-flex size-7 items-center justify-center rounded-lg text-[var(--text-secondary)] transition-colors hover:bg-[var(--danger-soft)] hover:text-[var(--danger-text)]"
                    >
                      <X className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                <div className="mt-2">
                  <Input
                    type="text"
                    disabled={disabled}
                    maxLength={200}
                    aria-label={`${appName} 备注`}
                    placeholder={
                      status === 'banned'
                        ? '可选：记录封号原因或时间…'
                        : '可选：记录套餐、账号说明…'
                    }
                    value={entry.note ?? ''}
                    onChange={(e) =>
                      updateItem(entry.app_id, { note: e.target.value })
                    }
                    className="h-8 text-xs"
                  />
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-xl border border-dashed border-[var(--border)] px-3 py-2.5 text-xs text-[var(--text-secondary)]">
          尚未选择注册应用，点击下方应用胶囊即可快速添加，并单独标注正常 / 受限
          / 已封禁状态。
        </p>
      )}

      {/* 快捷点选应用目录 */}
      {availableApps.length > 0 && (
        <div className="flex flex-wrap gap-1.5" aria-label="可添加的应用">
          {availableApps.map((app) => (
            <button
              key={app.id}
              type="button"
              disabled={disabled}
              onClick={() => addApp(app.id)}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface-control)] px-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:border-[var(--accent)]/40 hover:bg-[var(--accent-soft)] hover:text-[var(--accent-text)]"
            >
              <AppBrandIcon
                name={app.name}
                domain={app.domain}
                iconData={app.icon_data}
                size="sm"
              />
              <span>{app.name}</span>
              <Plus className="size-3 opacity-60" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {/* 快捷新建自定义应用并勾选 */}
      {onCreateApp && (
        <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface-control)]/70 p-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <AppBrandIcon
              name={newName.trim() || 'App'}
              domain={previewDomain}
              iconData={fetchedIcon}
              size="md"
            />
            <Input
              type="text"
              disabled={disabled || creating}
              maxLength={64}
              aria-label="自定义应用名称"
              placeholder="新增自定义应用（如 Perplexity、Midjourney）…"
              value={newName}
              onChange={(e) => {
                setNewName(e.target.value);
                setFetchedIcon(null);
                if (createError) setCreateError('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleQuickCreate();
                }
              }}
              className="h-8 min-w-[160px] flex-1 text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || creating || !newName.trim()}
              onClick={() => void handleQuickCreate()}
              className="h-8 shrink-0 text-xs"
            >
              {creating ? '添加中…' : '新增并选择'}
            </Button>
          </div>
          {onFetchAppIcon && (
            <div className="flex flex-wrap items-center gap-2 pl-7">
              <Input
                type="text"
                disabled={disabled || creating || fetchingIcon}
                maxLength={255}
                aria-label="应用官网域名"
                placeholder={
                  suggestedDomain
                    ? `可选域名（默认匹配 ${suggestedDomain}）`
                    : '可选：官网域名（如 perplexity.ai）用于抓取 Logo'
                }
                value={newDomain}
                onChange={(e) => {
                  setNewDomain(e.target.value);
                  setFetchedIcon(null);
                  if (createError) setCreateError('');
                }}
                className="h-7 min-w-[160px] flex-1 text-xs"
              />
              <Button
                type="button"
                size="xs"
                variant="outline"
                disabled={
                  disabled ||
                  creating ||
                  fetchingIcon ||
                  !(newDomain.trim() || suggestedDomain)
                }
                onClick={() => void handleFetchIcon()}
                className="h-7 shrink-0 text-[11.5px]"
              >
                {fetchingIcon ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                ) : (
                  <Globe className="size-3" aria-hidden="true" />
                )}
                <span>{fetchingIcon ? '获取中…' : '获取图标'}</span>
              </Button>
              {fetchedIcon && (
                <button
                  type="button"
                  onClick={() => setFetchedIcon(null)}
                  className="text-[11px] text-[var(--text-secondary)] underline hover:text-[var(--text-primary)]"
                >
                  重置默认
                </button>
              )}
            </div>
          )}
          {createError && (
            <p role="alert" className="text-xs text-[var(--danger-text)]">
              {createError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
