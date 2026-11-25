import { useRef, useState } from 'react';
import { accountsBatchStatus, accountsBatchTags } from '@/api/generated';
import type {
  AccountSummary,
  ErrorResponse,
  SessionResponse,
  TagResponse,
} from '@/api/generated';
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
import { NativeSelect } from '@/components/ui/native-select';
import { statusLabels } from './constants';

export function BatchBar({
  selected,
  tags,
  session,
  complete,
  onFailure,
}: {
  selected: AccountSummary[];
  tags: TagResponse[];
  session: SessionResponse;
  complete: () => Promise<void>;
  onFailure: (e: unknown) => void;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<AccountSummary['status']>('normal');
  const [tag, setTag] = useState('');
  const [confirmation, setConfirmation] = useState<'status' | 'tags' | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  async function submit() {
    setBusy(true);
    setMessage('');
    const base = {
      accounts: selected.map((a) => ({ id: a.id, row_version: a.row_version })),
    };
    const options = {
      headers: { 'X-CSRF-Token': session.csrf_token },
      throwOnError: true as const,
    };
    try {
      if (confirmation === 'status')
        await accountsBatchStatus({ ...options, body: { ...base, status } });
      else
        await accountsBatchTags({
          ...options,
          body: { ...base, tag_ids: [tag] },
        });
      setConfirmation(null);
      await complete();
    } catch (e) {
      const error = e as ErrorResponse;
      const target = error.error?.details?.account_id;
      const row = target
        ? selected.find((a) => a.id === target)
        : error.error?.details?.account_index !== undefined
          ? selected[Number(error.error.details.account_index)]
          : undefined;
      const rejected = [
        'ROW_VERSION_CONFLICT',
        'ACCOUNT_DELETED',
        'ACCOUNT_NOT_FOUND',
        'TAG_INVALID',
        'VALIDATION_ERROR',
        'AUTH_REQUIRED',
        'MFA_REQUIRED',
        'CSRF_INVALID',
      ].includes(error.error?.code);
      setMessage(
        rejected
          ? `整批未提交${row ? '（' + row.account_no + '）' : ''}：${error.error.message}。请刷新并重新选择，不会自动重放。`
          : '提交结果未知。请刷新确认，不会自动重放。',
      );
      setFailed(true);
      onFailure(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="批量操作"
      className="flex min-w-0 flex-1 flex-wrap items-center gap-3 rounded-lg border bg-muted/40 p-3"
    >
      <p className="text-sm">已选当前页 {selected.length} 条（不跨页）</p>
      <NativeSelect
        aria-label="批量目标状态"
        value={status}
        onChange={(e) => setStatus(e.target.value as typeof status)}
      >
        {Object.entries(statusLabels).map(([v, label]) => (
          <option value={v} key={v}>
            {label}
          </option>
        ))}
      </NativeSelect>
      <Button
        variant="outline"
        disabled={!selected.length || busy || failed}
        onClick={() => {
          returnFocus.current = document.activeElement as HTMLElement;
          setConfirmation('status');
        }}
      >
        批量修改状态
      </Button>
      <NativeSelect
        aria-label="批量添加标签"
        value={tag}
        onChange={(e) => setTag(e.target.value)}
      >
        <option value="">请选择标签</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </NativeSelect>
      <Button
        variant="outline"
        disabled={!selected.length || !tag || busy || failed}
        onClick={() => {
          returnFocus.current = document.activeElement as HTMLElement;
          setConfirmation('tags');
        }}
      >
        添加到所选账号
      </Button>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <AlertDialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>确认批量操作</AlertDialogTitle>
            <AlertDialogDescription>
              对当前页选中的 {selected.length} 条
              {confirmation === 'status'
                ? `修改为“${statusLabels[status]}”`
                : '追加标签（保留原标签）'}
              。整批成功或整批回滚，不包含其他页面的账号。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消批量操作</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || failed}
              onClick={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              确认整批提交
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {message && !confirmation && (
        <p role="alert" className="w-full text-sm text-destructive">
          {message}
        </p>
      )}
    </section>
  );
}
