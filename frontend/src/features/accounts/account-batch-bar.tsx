import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle2, RotateCcw, Trash2, X } from 'lucide-react';
import {
  accountsBatchDelete,
  accountsBatchPermanentDelete,
  accountsBatchRestore,
  accountsBatchStatus,
  accountsBatchTags,
  accountsBatchVerify,
} from '@/api/generated';
import type {
  AccountSummary,
  BatchTags,
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

type BatchTagMode = NonNullable<BatchTags['mode']>;

export type BatchCompleteKind =
  'status' | 'tags' | 'verify' | 'delete' | 'restore' | 'permanent-delete';

export function BatchBar({
  selected,
  tags,
  session,
  deleted = false,
  onSession,
  onClearSelection,
  complete,
  onFailure,
}: {
  selected: AccountSummary[];
  tags: TagResponse[];
  session: SessionResponse;
  deleted?: boolean;
  onSession?: (next: SessionResponse) => void;
  onClearSelection?: () => void;
  complete: (kind?: BatchCompleteKind) => Promise<void>;
  onFailure: (e: unknown) => void;
}) {
  const phraseId = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  const [activeSession, setActiveSession] = useState<SessionResponse>(session);
  const [status, setStatus] = useState<AccountSummary['status']>('normal');
  const [tagMode, setTagMode] = useState<BatchTagMode>('append');
  const [tag, setTag] = useState('');
  const [promotePending, setPromotePending] = useState(true);
  const [confirmation, setConfirmation] = useState<BatchCompleteKind | null>(
    null,
  );
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
  const pendingInSelectedCount = selected.filter(
    (a) => a.status === 'pending_verification',
  ).length;
  const canTriggerTags = tagMode === 'replace' ? true : Boolean(effectiveTagId);
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
    if (confirmation === 'tags') {
      if (tagMode === 'remove' && selectedTag) {
        const willRemove = selected.filter((a) =>
          a.tags.some((t) => t.id === selectedTag.id),
        );
        return {
          summary: `预计从 ${willRemove.length} 条移除标签「${selectedTag.name}」`,
          reversibility: '可逆操作：仅移除指定标签，保留其他原有标签。',
          rows: selected.slice(0, 5).map((a) => ({
            id: a.id,
            label: `${a.account_no} · ${a.gmail_email}`,
            diff: a.tags.some((t) => t.id === selectedTag.id)
              ? `- ${selectedTag.name}`
              : '不含该标签',
          })),
        };
      }
      if (tagMode === 'replace') {
        return {
          summary: selectedTag
            ? `预计将 ${selected.length} 条的标签统一替换为「${selectedTag.name}」`
            : `预计清空 ${selected.length} 条的全部标签`,
          reversibility: '可逆操作：将覆盖原有标签集合。',
          rows: selected.slice(0, 5).map((a) => ({
            id: a.id,
            label: `${a.account_no} · ${a.gmail_email}`,
            diff: selectedTag ? `替换为「${selectedTag.name}」` : '清空标签',
          })),
        };
      }
      if (selectedTag) {
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
    }
    if (confirmation === 'verify') {
      return {
        summary: `将更新 ${selected.length} 条账号的「最后验证时间」为当前时间${promotePending && pendingInSelectedCount > 0 ? `，并将 ${pendingInSelectedCount} 条待验证账号转为「正常」` : ''}`,
        reversibility: '可逆操作：记录人工巡检核验时间并写入审计链。',
        rows: selected.slice(0, 5).map((a) => ({
          id: a.id,
          label: `${a.account_no} · ${a.gmail_email}`,
          diff:
            promotePending && a.status === 'pending_verification'
              ? '待验证 → 正常（今天已验证）'
              : '标记今天已验证',
        })),
      };
    }
    if (confirmation === 'delete') {
      return {
        summary: `将把选中的 ${selected.length} 条账号批量移入回收站（软删除）`,
        reversibility: '可逆操作：可在回收站单条或批量恢复，且保留邮箱唯一性。',
        rows: selected.slice(0, 5).map((a) => ({
          id: a.id,
          label: `${a.account_no} · ${a.gmail_email}`,
          diff: '移入回收站',
        })),
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
      } else if (actionKind === 'delete') {
        await accountsBatchDelete({ ...options, body: base });
      } else if (actionKind === 'verify') {
        await accountsBatchVerify({
          ...options,
          body: { ...base, promote_pending: promotePending },
        });
      } else if (actionKind === 'status') {
        await accountsBatchStatus({ ...options, body: { ...base, status } });
      } else {
        if (tagMode !== 'replace' && !effectiveTagId) return;
        await accountsBatchTags({
          ...options,
          body:
            tagMode === 'append'
              ? { ...base, tag_ids: [effectiveTagId] }
              : {
                  ...base,
                  mode: tagMode,
                  tag_ids: effectiveTagId ? [effectiveTagId] : [],
                },
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
      className="macos-glass-modal flex min-w-0 flex-wrap items-center gap-2.5 rounded-2xl border border-[var(--modal-border)] bg-[var(--surface-popover)]/95 px-4 py-2.5 shadow-[0_14px_36px_rgba(15,30,58,0.22)] backdrop-blur-xl"
    >
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-semibold tabular-nums sm:text-sm">
          已选当前页 {selected.length} 条（不跨页）
        </p>
        {onClearSelection && (
          <button
            type="button"
            aria-label="取消当前页选择"
            onClick={onClearSelection}
            className="inline-flex size-6 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
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
            aria-label="批量标签操作模式"
            value={tagMode}
            onChange={(e) => setTagMode(e.target.value as BatchTagMode)}
            className="w-auto min-w-[96px]"
          >
            <option value="append">追加标签</option>
            <option value="remove">移除标签</option>
            <option value="replace">替换/清空</option>
          </NativeSelect>
          <NativeSelect
            aria-label="批量添加标签"
            value={effectiveTagId}
            onChange={(e) => setTag(e.target.value)}
            className="w-auto min-w-[132px]"
          >
            <option value="">
              {tagMode === 'replace' ? '清空全部标签' : '请选择标签'}
            </option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </NativeSelect>
          <Button
            variant="outline"
            disabled={!selected.length || !canTriggerTags || busy || failed}
            onClick={() => {
              returnFocus.current = document.activeElement as HTMLElement;
              setConfirmation('tags');
            }}
          >
            {tagMode === 'remove'
              ? '从所选账号移除'
              : tagMode === 'replace'
                ? selectedTag
                  ? '替换所选标签'
                  : '清空所选标签'
                : '添加到所选账号'}
          </Button>
          <Button
            variant="outline"
            disabled={!selected.length || busy || failed}
            onClick={() => {
              returnFocus.current = document.activeElement as HTMLElement;
              setConfirmation('verify');
            }}
          >
            <CheckCircle2 className="size-4" aria-hidden="true" />
            批量标记已核验
          </Button>
          <Button
            variant="outline"
            className="text-[var(--danger-text)] hover:bg-[var(--danger-soft)]"
            disabled={!selected.length || busy || failed}
            onClick={() => {
              returnFocus.current = document.activeElement as HTMLElement;
              setConfirmation('delete');
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" />
            批量移入回收站
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
                  : confirmation === 'delete'
                    ? '确认批量移入回收站？'
                    : confirmation === 'verify'
                      ? '确认批量标记已核验'
                      : '确认批量操作'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              对当前页选中的 {selected.length} 条
              {isPermanentDelete
                ? '已删除账号执行不可逆永久删除（彻底清除密码、备注、标签与应用关联，释放邮箱占用；若被其他账号用作站内辅助邮箱将自动转为外部文本保留）'
                : confirmation === 'restore'
                  ? '已删除账号执行原子恢复（保留原状态、归档标记与标签）'
                  : confirmation === 'delete'
                    ? '账号执行软删除并移入回收站（可在回收站随时恢复）'
                    : confirmation === 'verify'
                      ? '账号记录今天已完成可用性核验'
                      : confirmation === 'status'
                        ? `修改为“${statusLabels[status]}”`
                        : tagMode === 'remove'
                          ? `移除标签“${selectedTag?.name ?? ''}”`
                          : tagMode === 'replace'
                            ? selectedTag
                              ? `替换标签为“${selectedTag.name}”`
                              : '清空全部关联标签'
                            : `追加标签“${selectedTag?.name ?? ''}”（保留原标签）`}
              。整批成功或整批回滚，不包含其他页面的账号。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {confirmation === 'verify' && pendingInSelectedCount > 0 && (
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-[var(--surface-control-border)] bg-[var(--surface-control)] px-3 py-2 text-xs text-[var(--text-primary)]">
              <input
                type="checkbox"
                checked={promotePending}
                onChange={(e) => setPromotePending(e.target.checked)}
                className="size-4 rounded accent-[var(--accent)]"
              />
              <span>
                同时将选中的 {pendingInSelectedCount}{' '}
                条「待验证」账号状态更新为「正常」
              </span>
            </label>
          )}
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
              variant={
                isPermanentDelete || confirmation === 'delete'
                  ? 'destructive'
                  : 'default'
              }
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
                  : confirmation === 'delete'
                    ? '确认移入回收站'
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
