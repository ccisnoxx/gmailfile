import { useEffect, useRef, useState } from 'react';
import type { AccountDetail, SessionResponse } from '@/api/generated';
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
import {
  StepUpVerifier,
  useStepUpActive,
} from '@/features/auth/step-up-verifier';
import { actionLabels, type AccountAction } from './constants';

export function AccountActionDialog({
  confirm,
  detail,
  session,
  reauthRequired = false,
  busy,
  conflict,
  notice,
  onClose,
  onSession,
  onFailure,
  onConfirm,
}: {
  confirm: AccountAction | null;
  detail: AccountDetail | null;
  session?: SessionResponse;
  reauthRequired?: boolean;
  busy: boolean;
  conflict: boolean;
  notice: string;
  onClose: () => void;
  onSession?: (next: SessionResponse) => void;
  onFailure?: (error: unknown) => void;
  onConfirm: (action: AccountAction) => void;
}) {
  const lastActionRef = useRef<AccountAction>('archive');
  if (confirm) {
    lastActionRef.current = confirm;
  }
  const activeAction = confirm ?? lastActionRef.current;
  const [localSession, setLocalSession] = useState<SessionResponse | undefined>(
    session,
  );
  const [localForceVerify, setLocalForceVerify] = useState(false);

  useEffect(() => {
    setLocalSession(session);
  }, [session]);

  useEffect(() => {
    setLocalForceVerify(reauthRequired);
  }, [reauthRequired]);

  useEffect(() => {
    if (confirm === null) {
      setLocalForceVerify(false);
    }
  }, [confirm]);

  const isPermanentDelete = activeAction === 'permanent-delete';
  const stepUpActive = useStepUpActive(localSession, true);
  const requiresStepUp = isPermanentDelete && Boolean(localSession);
  const stepUpReady =
    !requiresStepUp || (!localForceVerify && !reauthRequired && stepUpActive);

  return (
    <AlertDialog
      open={confirm !== null}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <AlertDialogContent className="macos-glass-modal rounded-[20px]">
        <AlertDialogHeader>
          <AlertDialogTitle>
            确认{actionLabels[activeAction]}账号？
          </AlertDialogTitle>
          <AlertDialogDescription>
            {detail?.gmail_email}。
            {isPermanentDelete
              ? '此操作不可逆：将彻底清除该账号密码、敏感备注、标签与应用关联且无法恢复；若其他账号将其设为站内辅助邮箱，将自动转为外部辅助邮箱文本保留，并释放该邮箱地址占用。'
              : activeAction === 'delete'
                ? '仅软删除，不释放邮箱唯一性，之后可在回收站中恢复。'
                : activeAction === 'restore'
                  ? '恢复后账号将重新回到正常列表并保留原有资料。'
                  : activeAction === 'unarchive'
                    ? '取消归档后账号将恢复为正常状态，并保留原有资料与标签。'
                    : '归档后保留资料，后续可随时执行取消归档。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {isPermanentDelete && localSession && (
          <StepUpVerifier
            session={localSession}
            requireMfa
            forceVerify={localForceVerify || reauthRequired}
            disabled={busy}
            actionLabel="确认永久删除"
            onVerified={(next) => {
              setLocalSession(next);
              setLocalForceVerify(false);
              onSession?.(next);
            }}
            onFailure={onFailure}
          />
        )}
        {notice && (
          <p role="alert" className="text-sm text-[var(--danger-text)]">
            {notice}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant={
              activeAction === 'delete' || isPermanentDelete
                ? 'destructive'
                : 'default'
            }
            disabled={busy || conflict || !stepUpReady}
            onClick={(e) => {
              e.preventDefault();
              if (confirm && stepUpReady) onConfirm(confirm);
            }}
          >
            {busy ? '处理中…' : `确认${actionLabels[activeAction]}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
