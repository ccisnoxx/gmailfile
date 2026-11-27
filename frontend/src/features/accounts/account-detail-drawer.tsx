import { useEffect, useRef, useState } from 'react';
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui';
import {
  Archive,
  CheckCircle2,
  Clock,
  Copy,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { AccountDetail, SessionResponse } from '@/api/generated';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { AccountAppPill } from './account-app-pill';
import {
  factorLabels,
  localDate,
  statusLabels,
  type AccountAction,
} from './constants';
import { PasswordControl } from './password-control';
import { SensitiveFieldsControl } from './sensitive-fields-control';

type DrawerTabKey = 'overview' | 'security' | 'relations' | 'activity';

const DRAWER_TABS: readonly { key: DrawerTabKey; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'security', label: '安全' },
  { key: 'relations', label: '关系' },
  { key: 'activity', label: '活动' },
];

export function AccountDetailDrawer({
  open,
  detail,
  session,
  secretEpoch,
  busy,
  conflict,
  notice,
  onClose,
  onRestoreFocus,
  onSession,
  onFailure,
  onCopy,
  onReload,
  onAction,
  onEdit,
  onRequestConfirm,
}: {
  open: boolean;
  detail: AccountDetail | null;
  session: SessionResponse;
  secretEpoch: number;
  busy: boolean;
  conflict: boolean;
  notice: string;
  onClose: () => void;
  onRestoreFocus: (event: Event) => void;
  onSession: (value: SessionResponse) => void;
  onFailure: (error: unknown) => void;
  onCopy: (value: string) => void;
  onReload: (account: AccountDetail) => void;
  onAction: (action: AccountAction) => void;
  onEdit: () => void;
  onRequestConfirm: (action: AccountAction) => void;
}) {
  const [activeTab, setActiveTab] = useState<DrawerTabKey>('overview');
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    setActiveTab('overview');
  }, [detail?.id]);

  const selectTabByIndex = (index: number) => {
    const target = DRAWER_TABS[index];
    if (!target) return;
    setActiveTab(target.key);
    tabRefs.current[index]?.focus();
  };

  const menuItemClass =
    'flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] outline-none transition-colors data-[highlighted]:bg-[var(--accent-soft)] focus:bg-[var(--accent-soft)]';

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <SheetContent
        onCloseAutoFocus={onRestoreFocus}
        className="macos-glass-modal flex w-full flex-col overflow-hidden border-l border-white/80 p-0 sm:max-w-xl"
      >
        <SheetHeader className="shrink-0 border-b border-[var(--table-divider)] px-6 pt-6 pb-4">
          <SheetTitle>账号详情</SheetTitle>
          <SheetDescription>
            {detail?.account_no ?? '正在加载资料…'}
          </SheetDescription>
          {detail && (
            <div className="pt-2">
              <h2 className="break-all text-lg font-semibold text-[var(--text-primary)]">
                {detail.gmail_email}
              </h2>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Badge>{statusLabels[detail.status]}</Badge>
                <Badge variant="outline">
                  2FA：{factorLabels[detail.two_factor_status]}
                </Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onCopy(detail.gmail_email)}
                >
                  <Copy className="size-3.5" aria-hidden="true" />
                  复制邮箱
                </Button>
              </div>
            </div>
          )}
        </SheetHeader>

        {detail ? (
          <>
            {/* 任务分区 Tabs：概览 / 安全 / 关系 / 活动 */}
            <div className="shrink-0 border-b border-[var(--table-divider)] px-6 py-2.5">
              <div
                role="tablist"
                aria-label="账号详情分区"
                className="grid grid-cols-4 gap-1 rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] p-1"
              >
                {DRAWER_TABS.map((tab, index) => {
                  const selected = activeTab === tab.key;
                  return (
                    <button
                      key={tab.key}
                      ref={(el) => {
                        tabRefs.current[index] = el;
                      }}
                      type="button"
                      role="tab"
                      id={`drawer-tab-${tab.key}`}
                      aria-selected={selected}
                      aria-controls={`drawer-panel-${tab.key}`}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => setActiveTab(tab.key)}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowRight') {
                          e.preventDefault();
                          selectTabByIndex((index + 1) % DRAWER_TABS.length);
                        } else if (e.key === 'ArrowLeft') {
                          e.preventDefault();
                          selectTabByIndex(
                            (index - 1 + DRAWER_TABS.length) %
                              DRAWER_TABS.length,
                          );
                        } else if (e.key === 'Home') {
                          e.preventDefault();
                          selectTabByIndex(0);
                        } else if (e.key === 'End') {
                          e.preventDefault();
                          selectTabByIndex(DRAWER_TABS.length - 1);
                        }
                      }}
                      className={cn(
                        'min-h-8 rounded-lg px-2 text-xs font-medium transition-colors',
                        selected
                          ? 'bg-[var(--accent)] text-[var(--primary-foreground)] shadow-sm'
                          : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
                      )}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {notice && (
                <Alert
                  variant={conflict ? 'destructive' : 'default'}
                  className="mb-4"
                >
                  <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                    <span>{notice}</span>
                    {conflict && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onReload(detail)}
                      >
                        重新加载最新版本
                      </Button>
                    )}
                  </AlertDescription>
                </Alert>
              )}

              {activeTab === 'overview' && (
                <div
                  role="tabpanel"
                  id="drawer-panel-overview"
                  aria-labelledby="drawer-tab-overview"
                  className="space-y-4"
                >
                  <dl className="grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-3.5 text-sm">
                    <dt className="text-muted-foreground">账号状态</dt>
                    <dd>{statusLabels[detail.status]}</dd>
                    <dt className="text-muted-foreground">用途</dt>
                    <dd className="min-w-0 break-words">
                      {detail.purpose || '—'}
                    </dd>
                    <dt className="text-muted-foreground">标签</dt>
                    <dd className="min-w-0 break-words">
                      {detail.tags.map((t) => t.name).join('、') || '—'}
                    </dd>
                    <dt className="text-muted-foreground">注册时间</dt>
                    <dd className="tabular-nums">
                      {localDate(detail.registered_at)}
                    </dd>
                    <dt className="text-muted-foreground">辅助邮箱</dt>
                    <dd className="min-w-0 break-all">
                      {detail.recovery_email || '—'}
                    </dd>
                  </dl>
                </div>
              )}

              {activeTab === 'security' && (
                <div
                  role="tabpanel"
                  id="drawer-panel-security"
                  aria-labelledby="drawer-tab-security"
                  className="space-y-5"
                >
                  {!detail.deleted_at ? (
                    <>
                      <PasswordControl
                        key={`${detail.id}-${secretEpoch}`}
                        accountId={detail.id}
                        session={session}
                        onSession={onSession}
                        onFailure={onFailure}
                      />
                      <SensitiveFieldsControl
                        key={`${detail.id}-sensitive-${secretEpoch}`}
                        detail={detail}
                        session={session}
                        onSession={onSession}
                        onFailure={onFailure}
                        onCopy={onCopy}
                      />
                    </>
                  ) : (
                    <p className="rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-3.5 py-3 text-xs text-[var(--text-secondary)]">
                      账号位于回收站，恢复后可按需查看密码与敏感资料。
                    </p>
                  )}
                  <dl className="grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-3.5 border-t border-[var(--table-divider)] pt-4 text-sm">
                    <dt className="text-muted-foreground">二步验证</dt>
                    <dd>{factorLabels[detail.two_factor_status]}</dd>
                    <dt className="text-muted-foreground">密码修改</dt>
                    <dd className="tabular-nums">
                      {localDate(detail.password_changed_at)}
                    </dd>
                    <dt className="text-muted-foreground">绑定手机号</dt>
                    <dd>
                      {detail.has_phone || detail.phone
                        ? '已加密保存（可在上方按需查看）'
                        : '—'}
                    </dd>
                    <dt className="text-muted-foreground">敏感备注</dt>
                    <dd>
                      {detail.has_notes || detail.notes
                        ? '已加密保存（可在上方按需查看）'
                        : '—'}
                    </dd>
                  </dl>
                </div>
              )}

              {activeTab === 'relations' && (
                <div
                  role="tabpanel"
                  id="drawer-panel-relations"
                  aria-labelledby="drawer-tab-relations"
                  className="space-y-5"
                >
                  <dl className="grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-4 text-sm">
                    <dt className="text-muted-foreground">辅助邮箱</dt>
                    <dd className="min-w-0">
                      {detail.recovery_email ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="break-all">
                            {detail.recovery_email}
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              detail.recovery_email &&
                              onCopy(detail.recovery_email)
                            }
                          >
                            复制辅助邮箱
                          </Button>
                        </div>
                      ) : (
                        '—'
                      )}
                    </dd>
                    <dt className="text-muted-foreground">已注册应用</dt>
                    <dd className="min-w-0">
                      {detail.apps && detail.apps.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {detail.apps.map((app) => (
                            <AccountAppPill key={app.app_id} app={app} />
                          ))}
                        </div>
                      ) : (
                        '—'
                      )}
                    </dd>
                  </dl>
                </div>
              )}

              {activeTab === 'activity' && (
                <div
                  role="tabpanel"
                  id="drawer-panel-activity"
                  aria-labelledby="drawer-tab-activity"
                >
                  <dl className="grid grid-cols-[6.5rem_1fr] gap-x-4 gap-y-3.5 text-sm">
                    <dt className="text-muted-foreground">最后登录</dt>
                    <dd className="tabular-nums">
                      {localDate(detail.last_login_at)}
                    </dd>
                    <dt className="text-muted-foreground">最后验证</dt>
                    <dd className="tabular-nums">
                      {localDate(detail.last_verified_at)}
                    </dd>
                    <dt className="text-muted-foreground">归档时间</dt>
                    <dd className="tabular-nums">
                      {localDate(detail.archived_at)}
                    </dd>
                    <dt className="text-muted-foreground">删除时间</dt>
                    <dd className="tabular-nums">
                      {localDate(detail.deleted_at)}
                    </dd>
                    <dt className="text-muted-foreground">创建时间</dt>
                    <dd className="tabular-nums">
                      {localDate(detail.created_at)}
                    </dd>
                    <dt className="text-muted-foreground">更新时间</dt>
                    <dd className="tabular-nums">
                      {localDate(detail.updated_at)}
                    </dd>
                    <dt className="text-muted-foreground">记录版本</dt>
                    <dd className="font-mono tabular-nums">
                      v{detail.row_version}
                    </dd>
                  </dl>
                </div>
              )}
            </div>

            {/* 底部固定操作栏：仅保留主操作，其余操作收纳至更多菜单 */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--table-divider)] bg-[var(--surface-popover)]/90 px-6 py-4 backdrop-blur-md">
              {detail.deleted_at ? (
                <>
                  <Button
                    disabled={busy || conflict}
                    onClick={() => onAction('restore')}
                  >
                    <RotateCcw data-icon="inline-start" />
                    恢复账号
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy || conflict}
                    onClick={() => onRequestConfirm('permanent-delete')}
                  >
                    <Trash2 data-icon="inline-start" />
                    永久删除
                  </Button>
                </>
              ) : (
                <>
                  <Button disabled={busy || conflict} onClick={onEdit}>
                    <Pencil data-icon="inline-start" />
                    编辑账号
                  </Button>

                  <DropdownMenuPrimitive.Root>
                    <DropdownMenuPrimitive.Trigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        disabled={busy || conflict}
                        aria-label="详情更多操作"
                      >
                        <MoreHorizontal className="size-4" aria-hidden="true" />
                        <span>更多操作</span>
                      </Button>
                    </DropdownMenuPrimitive.Trigger>
                    <DropdownMenuPrimitive.Portal>
                      <DropdownMenuPrimitive.Content
                        align="end"
                        sideOffset={6}
                        aria-label="账号详情更多操作菜单"
                        className="macos-glass-modal z-50 w-44 rounded-2xl p-1.5 text-[var(--text-primary)]"
                      >
                        <DropdownMenuPrimitive.Item
                          onSelect={() => onAction('logged-in')}
                          className={menuItemClass}
                        >
                          <Clock
                            className="size-3.5 text-[var(--text-secondary)]"
                            aria-hidden="true"
                          />
                          <span>今天已登录</span>
                        </DropdownMenuPrimitive.Item>
                        <DropdownMenuPrimitive.Item
                          onSelect={() => onAction('verified')}
                          className={menuItemClass}
                        >
                          <CheckCircle2
                            className="size-3.5 text-[var(--success)]"
                            aria-hidden="true"
                          />
                          <span>今天已验证</span>
                        </DropdownMenuPrimitive.Item>
                        <DropdownMenuPrimitive.Separator className="my-1 h-px bg-[var(--table-divider)]" />
                        {detail.status === 'archived' ? (
                          <DropdownMenuPrimitive.Item
                            onSelect={() => onRequestConfirm('unarchive')}
                            className={cn(
                              menuItemClass,
                              'text-[var(--accent-text)]',
                            )}
                          >
                            <RotateCcw
                              className="size-3.5"
                              aria-hidden="true"
                            />
                            <span>取消归档</span>
                          </DropdownMenuPrimitive.Item>
                        ) : (
                          <DropdownMenuPrimitive.Item
                            onSelect={() => onRequestConfirm('archive')}
                            className={menuItemClass}
                          >
                            <Archive
                              className="size-3.5 text-[var(--text-secondary)]"
                              aria-hidden="true"
                            />
                            <span>归档</span>
                          </DropdownMenuPrimitive.Item>
                        )}
                        <DropdownMenuPrimitive.Item
                          onSelect={() => onRequestConfirm('delete')}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-[13px] text-[var(--danger-text)] outline-none transition-colors data-[highlighted]:bg-[var(--danger-soft)] focus:bg-[var(--danger-soft)]"
                        >
                          <Trash2 className="size-3.5" aria-hidden="true" />
                          <span>删除</span>
                        </DropdownMenuPrimitive.Item>
                      </DropdownMenuPrimitive.Content>
                    </DropdownMenuPrimitive.Portal>
                  </DropdownMenuPrimitive.Root>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="px-6 py-6">
            {notice && <p role="alert">{notice}</p>}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
