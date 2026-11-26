import { Archive, RotateCcw, Trash2 } from 'lucide-react';
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
import { AccountAppPill } from './account-app-pill';
import {
  factorLabels,
  localDate,
  statusLabels,
  type AccountAction,
} from './constants';
import { PasswordControl } from './password-control';

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
  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <SheetContent
        onCloseAutoFocus={onRestoreFocus}
        className="macos-glass-modal w-full overflow-y-auto border-l border-white/80 sm:max-w-xl"
      >
        <SheetHeader>
          <SheetTitle>账号详情</SheetTitle>
          <SheetDescription>
            {detail?.account_no ?? '正在加载资料…'}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 px-6 pb-8">
          {detail && (
            <>
              <div>
                <h2 className="break-all text-xl font-semibold">
                  {detail.gmail_email}
                </h2>
                <div className="mt-3 flex gap-2">
                  <Badge>{statusLabels[detail.status]}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => onCopy(detail.gmail_email)}
                  >
                    复制邮箱
                  </Button>
                </div>
              </div>
              {!detail.deleted_at && (
                <PasswordControl
                  key={`${detail.id}-${secretEpoch}`}
                  accountId={detail.id}
                  session={session}
                  onSession={onSession}
                  onFailure={onFailure}
                />
              )}
              <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-4 text-sm">
                {[
                  ['注册时间', localDate(detail.registered_at)],
                  [
                    '辅助邮箱',
                    <div
                      className="flex flex-wrap items-center gap-2"
                      key="recovery"
                    >
                      <span className="break-all">{detail.recovery_email}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onCopy(detail.recovery_email)}
                      >
                        复制辅助邮箱
                      </Button>
                    </div>,
                  ],
                  ['绑定手机号', detail.phone || '—'],
                  ['二步验证', factorLabels[detail.two_factor_status]],
                  ['用途', detail.purpose || '—'],
                  [
                    '已注册应用',
                    detail.apps && detail.apps.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5" key="apps">
                        {detail.apps.map((app) => (
                          <AccountAppPill key={app.app_id} app={app} />
                        ))}
                      </div>
                    ) : (
                      '—'
                    ),
                  ],
                  ['标签', detail.tags.map((t) => t.name).join('、') || '—'],
                  ['最后登录', localDate(detail.last_login_at)],
                  ['最后验证', localDate(detail.last_verified_at)],
                  ['密码修改', localDate(detail.password_changed_at)],
                  ['敏感备注', detail.notes || '—'],
                  ['归档时间', localDate(detail.archived_at)],
                  ['删除时间', localDate(detail.deleted_at)],
                  ['创建时间', localDate(detail.created_at)],
                  ['更新时间', localDate(detail.updated_at)],
                  ['记录版本', String(detail.row_version)],
                ].map(([label, value]) => (
                  <div className="contents" key={String(label)}>
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 whitespace-pre-wrap break-words">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
              {notice && (
                <Alert variant={conflict ? 'destructive' : 'default'}>
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
              <div className="flex flex-wrap gap-2 border-t pt-5">
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
                    <Button
                      variant="outline"
                      disabled={busy || conflict}
                      onClick={() => onAction('logged-in')}
                    >
                      今天已登录
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy || conflict}
                      onClick={() => onAction('verified')}
                    >
                      今天已验证
                    </Button>
                    <Button disabled={busy || conflict} onClick={onEdit}>
                      编辑账号
                    </Button>
                    {detail.status === 'archived' ? (
                      <Button
                        variant="outline"
                        disabled={busy || conflict}
                        onClick={() => onRequestConfirm('unarchive')}
                      >
                        <RotateCcw data-icon="inline-start" />
                        取消归档
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        disabled={busy || conflict}
                        onClick={() => onRequestConfirm('archive')}
                      >
                        <Archive data-icon="inline-start" />
                        归档
                      </Button>
                    )}
                    <Button
                      variant="destructive"
                      disabled={busy || conflict}
                      onClick={() => onRequestConfirm('delete')}
                    >
                      删除
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
          {!detail && notice && <p role="alert">{notice}</p>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
