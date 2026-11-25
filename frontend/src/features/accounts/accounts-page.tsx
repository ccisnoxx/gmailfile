import { lazy, Suspense, useCallback, useRef } from 'react';
import { Mail, Plus, ShieldCheck, Tag, Trash2 } from 'lucide-react';
import type { ErrorResponse, SessionResponse } from '@/api/generated';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AccountActionDialog } from './account-action-dialog';
import { BatchBar } from './account-batch-bar';
import { Filters } from './account-filters';
import { Pagination } from './account-pagination';
import { Summary } from './account-summary';
import { AccountTable, ColumnToggle } from './account-table';
import { useAccountQueryState } from './query-state';
import { useAccountDetail } from './use-account-detail';
import { useAccountsList } from './use-accounts-list';
import { useTagManager } from './use-tag-manager';

const RecoveryPage = lazy(() =>
  import('./recovery-usage-view').then((m) => ({ default: m.RecoveryPage })),
);
const AccountDetailDrawer = lazy(() =>
  import('./account-detail-drawer').then((m) => ({
    default: m.AccountDetailDrawer,
  })),
);
const AccountFormDialog = lazy(() =>
  import('./account-form-dialog').then((m) => ({
    default: m.AccountFormDialog,
  })),
);
const TagManagerDialog = lazy(() =>
  import('./tag-manager-dialog').then((m) => ({
    default: m.TagManagerDialog,
  })),
);

export function AccountsPage({
  session,
  onSession,
  onFailure,
  onSecurity,
  onLogout,
}: {
  session: SessionResponse;
  onSession: (value: SessionResponse) => void;
  onFailure: (error: unknown) => void;
  onSecurity: () => void;
  onLogout: () => void;
}) {
  const queryState = useAccountQueryState();
  const refreshRef = useRef<() => Promise<void>>(async () => {});
  const stableRefresh = useCallback(() => refreshRef.current(), []);

  const detailState = useAccountDetail({
    session,
    search: queryState.search,
    onFailure,
    onRefresh: stableRefresh,
  });

  const listState = useAccountsList({
    query: queryState.query,
    search: queryState.search,
    recoveryView: queryState.recoveryView,
    onFailure: detailState.fail,
  });
  refreshRef.current = listState.refresh;

  const tagState = useTagManager({
    headers: detailState.headers,
    run: detailState.run,
    onRefresh: listState.refresh,
    onCaptureFocus: detailState.captureFocus,
  });

  const handleBatchFailure = useCallback(
    (error: unknown) => {
      const code = (error as ErrorResponse)?.error?.code;
      if (['AUTH_REQUIRED', 'MFA_REQUIRED', 'CSRF_INVALID'].includes(code))
        onFailure(error);
    },
    [onFailure],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b bg-card">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-6 py-5 lg:px-10">
          <div className="flex items-center gap-3 font-semibold">
            <Mail className="size-5 text-primary" aria-hidden="true" />
            Gmail 账号管理
          </div>
          <nav aria-label="工作区" className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                detailState.close();
                onSecurity();
              }}
            >
              <ShieldCheck data-icon="inline-start" />
              安全设置
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                detailState.close();
                onLogout();
              }}
            >
              退出
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto flex min-w-0 max-w-[1500px] flex-col gap-4 px-6 py-6 lg:px-10">
        <Summary onFailure={detailState.fail} />
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {queryState.deleted ? '已删除账号' : '账号管理'}
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              {queryState.deleted
                ? '邮箱唯一性和关联仍然保留，可逐条恢复。'
                : '维护账号资料与使用状态。密码仅在单独验证后按需显示。'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={tagState.openDialog}>
              <Tag data-icon="inline-start" />
              管理标签
            </Button>
            {!queryState.deleted && (
              <Button onClick={detailState.openNew}>
                <Plus data-icon="inline-start" />
                新增账号
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b pb-4">
          <nav aria-label="账号记录" className="flex flex-wrap gap-2">
            <Button
              variant={
                !queryState.deleted && !queryState.recoveryView
                  ? 'secondary'
                  : 'ghost'
              }
              aria-pressed={!queryState.deleted && !queryState.recoveryView}
              onClick={() => {
                detailState.close();
                queryState.setDeleted(false);
              }}
            >
              全部账号
            </Button>
            <Button
              variant={queryState.deleted ? 'secondary' : 'ghost'}
              aria-pressed={queryState.deleted}
              onClick={() => {
                detailState.close();
                queryState.setDeleted(true);
              }}
            >
              <Trash2 data-icon="inline-start" />
              已删除记录
            </Button>
            <Button
              variant={queryState.recoveryView ? 'secondary' : 'ghost'}
              aria-pressed={queryState.recoveryView}
              onClick={queryState.openRecoveryView}
            >
              辅助邮箱使用情况
            </Button>
          </nav>
          <Button variant="ghost" onClick={() => void listState.refresh()}>
            刷新列表
          </Button>
        </div>
        {detailState.notice && (
          <Alert
            variant={detailState.conflict ? 'destructive' : 'default'}
            role="status"
          >
            <AlertDescription>{detailState.notice}</AlertDescription>
          </Alert>
        )}
        {queryState.recoveryView ? (
          <Suspense fallback={<p role="status">正在加载辅助邮箱使用情况…</p>}>
            <RecoveryPage
              params={queryState.params}
              change={queryState.change}
              onFailure={detailState.fail}
            />
          </Suspense>
        ) : (
          <>
            <Filters
              params={queryState.params}
              change={queryState.change}
              tags={listState.tags.data ?? []}
            />
            <div className="flex flex-wrap items-start gap-3">
              <ColumnToggle
                columns={listState.columns}
                onToggle={listState.toggleColumn}
              />
              {!queryState.deleted && (
                <BatchBar
                  key={queryState.search + ':' + listState.list.dataUpdatedAt}
                  selected={listState.selectedItems}
                  tags={listState.tags.data ?? []}
                  session={session}
                  complete={async () => {
                    await listState.refresh();
                    detailState.setNotice('整批操作已提交。');
                  }}
                  onFailure={handleBatchFailure}
                />
              )}
            </div>
            <AccountTable
              items={listState.items}
              total={listState.list.data?.total ?? 0}
              isPending={listState.list.isPending}
              isError={listState.list.isError}
              deleted={queryState.deleted}
              busy={detailState.busy}
              columns={listState.columns}
              selected={listState.selected}
              onToggleAll={listState.toggleAll}
              onToggleOne={listState.toggleOne}
              onOpen={(account, edit, action) =>
                void detailState.open(account, edit, action)
              }
              onCopy={(value) => void detailState.copy(value)}
              onMarkVerified={detailState.markVerifiedQuick}
            />
            {listState.list.data && (
              <Pagination
                {...listState.list.data}
                change={queryState.change}
                busy={listState.list.isFetching}
              />
            )}
          </>
        )}
        <p className="text-sm text-muted-foreground">
          时间按浏览器时区显示 · Gmail 二步验证仅记录状态
        </p>
      </main>
      {detailState.drawerLoaded && (
        <Suspense fallback={null}>
          <AccountDetailDrawer
            open={detailState.drawer}
            detail={detailState.detail}
            session={session}
            secretEpoch={detailState.secretEpoch}
            busy={detailState.busy}
            conflict={detailState.conflict}
            notice={detailState.notice}
            onClose={detailState.close}
            onRestoreFocus={detailState.restoreFocus}
            onSession={onSession}
            onFailure={detailState.fail}
            onCopy={(value) => void detailState.copy(value)}
            onReload={(account) => void detailState.open(account)}
            onAction={(action) => void detailState.act(action)}
            onEdit={detailState.openEditFromDrawer}
            onRequestConfirm={detailState.requestAction}
          />
        </Suspense>
      )}
      {detailState.formLoaded && (
        <Suspense fallback={null}>
          <AccountFormDialog
            form={detailState.form}
            detail={detailState.detail}
            tags={listState.tags.data ?? []}
            busy={detailState.busy}
            conflict={detailState.conflict}
            notice={detailState.notice}
            onClose={detailState.close}
            onRestoreFocus={detailState.restoreFocus}
            onReload={(account) => void detailState.open(account, true)}
            onFailure={detailState.fail}
            onSubmit={detailState.save}
          />
        </Suspense>
      )}
      <AccountActionDialog
        confirm={detailState.confirm}
        detail={detailState.detail}
        busy={detailState.busy}
        conflict={detailState.conflict}
        notice={detailState.notice}
        onClose={() => detailState.setConfirm(null)}
        onConfirm={(action) => void detailState.act(action)}
      />
      {tagState.loaded && (
        <Suspense fallback={null}>
          <TagManagerDialog
            open={tagState.open}
            tags={listState.tags.data ?? []}
            target={tagState.target}
            name={tagState.name}
            deleteTarget={tagState.deleteTarget}
            busy={detailState.busy}
            notice={detailState.notice}
            onOpenChange={tagState.setOpen}
            onRestoreFocus={detailState.restoreFocus}
            onNameChange={tagState.setName}
            onSave={tagState.saveTag}
            onStartRename={tagState.startRename}
            onCancelRename={tagState.cancelRename}
            onRequestDelete={tagState.setDeleteTarget}
            onConfirmDelete={tagState.confirmDelete}
          />
        </Suspense>
      )}
    </div>
  );
}
