import { useEffect, useId, useRef, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import {
  accountsBatchPermanentDelete,
  accountsBatchRestore,
  accountsBatchStatus,
  accountsBatchTags,
} from '@/api/generated';
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
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import {
  StepUpVerifier,
  useStepUpActive,
} from '@/features/auth/step-up-verifier';
import { statusLabels } from './constants';

export function BatchBar({
  selected,
  tags,
  session,
  deleted = false,
  onSession,
  complete,
  onFailure,
}: {
  selected: AccountSummary[];
  tags: TagResponse[];
  session: SessionResponse;
  deleted?: boolean;
  onSession?: (next: SessionResponse) => void;
  complete: (
    kind?: 'status' | 'tags' | 'restore' | 'permanent-delete',
  ) => Promise<void>;
  onFailure: (e: unknown) => void;
}) {
  const phraseId = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  const [activeSession, setActiveSession] = useState<SessionResponse>(session);
  const [status, setStatus] = useState<AccountSummary['status']>('normal');
  const [tag, setTag] = useState('');
  const [confirmation, setConfirmation] = useState<
    'status' | 'tags' | 'restore' | 'permanent-delete' | null
  >(null);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [reauthRequired, setReauthRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setActiveSession(session);
  }, [session]);

  useEffect(() => {
    if (confirmation === null) {
      setConfirmPhrase('');
      setReauthRequired(false);
    }
  }, [confirmation, selected.length]);

  const selectedTag = tags.find((t) => t.id === tag) ?? null;
  const effectiveTagId = selectedTag ? selectedTag.id : '';
  const isPermanentDelete = confirmation === 'permanent-delete';
  const expectedPhrase = `DELETE ${selected.length}`;
  const stepUpActive = useStepUpActive(activeSession, true);
  const stepUpReady = !reauthRequired && stepUpActive;
  const phraseMatched = confirmPhrase.trim() === expectedPhrase;
  const canSubmitPermanentDelete = stepUpReady && phraseMatched;

  const batchPreview = (() => {
    if (!confirmation) return null;
    if (confirmation === 'status') {
      const willChange = selected.filter((a) => a.status !== status);
      const unchangedCount = selected.length - willChange.length;
      return {
        summary: `预计变更 ${willChange.length} 条${unchangedCount > 0 ? `，另有 ${unchangedCount} 条已处于「${statusLabels[status]}」` : ''}`,
        reversibility: '可逆操作：提交后可再次通过批量修改状态调整。',
        rows: selected.slice(0, 5).map((a) => ({
          id: a.id,
          label: `${a.account_no} · ${a.gmail_email}`,
          diff:
            a.status === status
              ? `保持「${statusLabels[status]}」`
              : `${statusLabels[a.status]} → ${statusLabels[status]}`,
        })),
      };
    }
    if (confirmation === 'tags' && selectedTag) {
      const willAppend = selected.filter(
        (a) => !a.tags.some((t) => t.id === selectedTag.id),
      );
      const existingCount = selected.length - willAppend.length;
      return {
        summary: `预计为 ${willAppend.length} 条追加标签「${selectedTag.name}」${existingCount > 0 ? `，${existingCount} 条已含该标签` : ''}`,
        reversibility: '可逆操作：仅追加新标签，保留各账号原有标签。',
        rows: selected.slice(0, 5).map((a) => {
          const alreadyHas = a.tags.some((t) => t.id === selectedTag.id);
          return {
            id: a.id,
            label: `${a.account_no} · ${a.gmail_email}`,
            diff: alreadyHas
              ? `已含「${selectedTag.name}」`
              : `+ ${selectedTag.name}`,
          };
        }),
      };
    }
    if (confirmation === 'restore') {
      return {
        summary: `将从回收站原子恢复 ${selected.length} 条账号`,
        reversibility: '恢复后回到主列表并保留原状态、归档与标签。',
        rows: selected.slice(0, 5).map((a) => ({
          id: a.id,
          label: `${a.account_no} · ${a.gmail_email}`,
          diff: `恢复为「${statusLabels[a.status]}」`,
        })),
      };
    }
    return {
      summary: `将不可逆永久清除 ${selected.length} 条已删除账号（需最近 MFA 二次验证）`,
      reversibility: '不可撤销：密文凭据与关联记录将被彻底删除。',
      rows: selected.slice(0, 5).map((a) => ({
        id: a.id,
        label: `${a.account_no} · ${a.gmail_email}`,
        diff: '永久删除',
      })),
    };
  })();

  async function submit() {
    if (!confirmation) return;
    const actionKind = confirmation;
    if (actionKind === 'permanent-delete' && !canSubmitPermanentDelete) return;
    setBusy(true);
    setMessage('');
    const base = {
      accounts: selected.map((a) => ({ id: a.id, row_version: a.row_version })),
    };
    const options = {
      headers: { 'X-CSRF-Token': activeSession.csrf_token },
      throwOnError: true as const,
    };
    try {
      if (actionKind === 'restore') {
        await accountsBatchRestore({ ...options, body: base });
      } else if (actionKind === 'permanent-delete') {
        await accountsBatchPermanentDelete({
          ...options,
          body: { ...base, confirmation: confirmPhrase.trim() },
        });
      } else if (actionKind === 'status') {
        await accountsBatchStatus({ ...options, body: { ...base, status } });
      } else {
        if (!effectiveTagId) return;
        await accountsBatchTags({
          ...options,
          body: { ...base, tag_ids: [effectiveTagId] },
        });
      }
      setConfirmation(null);
      setConfirmPhrase('');
      setReauthRequired(false);
      await complete(actionKind);
    } catch (e) {
      const error = e as ErrorResponse;
      if (error.error?.code === 'REAUTH_REQUIRED') {
        setReauthRequired(true);
        setMessage(
          '二次验证已过期，请先完成管理员二次验证后再手动确认提交（整批未提交，不会自动重放）。',
        );
        return;
      }
      const target = error.error?.details?.account_id;
      const row = target
        ? selected.find((a) => a.id === target)
        : error.error?.details?.account_index !== undefined
          ? selected[Number(error.error.details.account_index)]
          : undefined;
      const rejected = [
        'ROW_VERSION_CONFLICT',
        'ACCOUNT_DELETED',
        'ACCOUNT_NOT_DELETED',
        'ACCOUNT_NOT_FOUND',
        'TAG_INVALID',
        'INVALID_CONFIRMATION',
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
      aria-label={deleted ? '回收站批量操作' : '批量操作'}
      className="macos-glass-panel flex min-w-0 flex-1 flex-wrap items-center gap-3 px-4 py-2.5"
    >
      <p className="text-sm">已选当前页 {selected.length} 条（不跨页）</p>
      {deleted ? (
        <>
          <Button
            variant="default"
            disabled={!selected.length || busy || failed}
            onClick={() => {
              returnFocus.current = document.activeElement as HTMLElement;
              setConfirmation('restore');
            }}
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            批量恢复所选账号
          </Button>
          <Button
            variant="destructive"
            disabled={!selected.length || busy || failed}
            onClick={() => {
              returnFocus.current = document.activeElement as HTMLElement;
              setConfirmPhrase('');
              setReauthRequired(false);
              setMessage('');
              setConfirmation('permanent-delete');
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            批量永久删除
          </Button>
        </>
      ) : (
        <>
          <NativeSelect
            aria-label="批量目标状态"
            value={status}
            onChange={(e) => setStatus(e.target.value as typeof status)}
            className="w-auto min-w-[120px]"
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
            value={effectiveTagId}
            onChange={(e) => setTag(e.target.value)}
            className="w-auto min-w-[140px]"
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
            disabled={!selected.length || !effectiveTagId || busy || failed}
            onClick={() => {
              returnFocus.current = document.activeElement as HTMLElement;
              setConfirmation('tags');
            }}
          >
            添加到所选账号
          </Button>
        </>
      )}
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <AlertDialogContent
          className="macos-glass-modal rounded-[20px]"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isPermanentDelete
                ? '确认批量永久删除账号？'
                : confirmation === 'restore'
                  ? '确认批量恢复账号'
                  : '确认批量操作'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              对当前页选中的 {selected.length} 条
              {isPermanentDelete
                ? '已删除账号执行不可逆永久删除（彻底清除密码、备注、标签与应用关联，释放邮箱占用；若被其他账号用作站内辅助邮箱将自动转为外部文本保留）'
                : confirmation === 'restore'
                  ? '已删除账号执行原子恢复（保留原状态、归档标记与标签）'
                  : confirmation === 'status'
                    ? `修改为“${statusLabels[status]}”`
                    : `追加标签“${selectedTag?.name ?? ''}”（保留原标签）`}
              。整批成功或整批回滚，不包含其他页面的账号。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {batchPreview && (
            <div
              data-slot="batch-preview-box"
              className="space-y-2 rounded-2xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] p-3 text-xs"
            >
              <p className="font-semibold text-[var(--text-primary)]">
                {batchPreview.summary}
              </p>
              <ul className="space-y-1 text-[11.5px]">
                {batchPreview.rows.map((row) => (
                  <li
                    key={row.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="truncate font-mono text-[var(--text-primary)]">
                      {row.label}
                    </span>
                    <span className="shrink-0 font-medium text-[var(--text-secondary)]">
                      {row.diff}
                    </span>
                  </li>
                ))}
              </ul>
              {selected.length > 5 && (
                <p className="text-[11px] text-[var(--text-secondary)]">
                  其余 {selected.length - 5} 条同批原子提交…
                </p>
              )}
              <p className="border-t border-[var(--table-divider)] pt-1.5 text-[11px] text-[var(--text-secondary)]">
                {batchPreview.reversibility}
              </p>
            </div>
          )}
          {isPermanentDelete && (
            <div className="space-y-3">
              <StepUpVerifier
                session={activeSession}
                requireMfa
                forceVerify={reauthRequired}
                disabled={busy}
                actionLabel="执行批量永久删除"
                onVerified={(next) => {
                  setActiveSession(next);
                  setReauthRequired(false);
                  setMessage('');
                  onSession?.(next);
                }}
                onFailure={onFailure}
              />
              <div className="space-y-1.5">
                <label htmlFor={phraseId} className="block text-xs font-medium">
                  请输入{' '}
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                    {expectedPhrase}
                  </code>{' '}
                  以确认永久删除选中的 {selected.length} 条账号
                </label>
                <Input
                  id={phraseId}
                  type="text"
                  autoComplete="off"
                  disabled={busy}
                  value={confirmPhrase}
                  onChange={(e) => setConfirmPhrase(e.target.value)}
                  placeholder={expectedPhrase}
                />
              </div>
            </div>
          )}
          {message && (
            <p role="alert" className="text-sm text-destructive">
              {message}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消批量操作</AlertDialogCancel>
            <AlertDialogAction
              variant={isPermanentDelete ? 'destructive' : 'default'}
              disabled={
                busy ||
                failed ||
                (isPermanentDelete && !canSubmitPermanentDelete)
              }
              onClick={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              {isPermanentDelete
                ? '确认整批永久删除'
                : confirmation === 'restore'
                  ? '确认整批恢复'
                  : '确认整批提交'}
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
