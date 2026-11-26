import { useRef } from 'react';
import type { AccountDetail } from '@/api/generated';
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
import { actionLabels, type AccountAction } from './constants';

export function AccountActionDialog({
  confirm,
  detail,
  busy,
  conflict,
  notice,
  onClose,
  onConfirm,
}: {
  confirm: AccountAction | null;
  detail: AccountDetail | null;
  busy: boolean;
  conflict: boolean;
  notice: string;
  onClose: () => void;
  onConfirm: (action: AccountAction) => void;
}) {
  const lastActionRef = useRef<AccountAction>('archive');
  if (confirm) {
    lastActionRef.current = confirm;
  }
  const activeAction = confirm ?? lastActionRef.current;

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
            {activeAction === 'delete'
              ? '仅软删除，不释放邮箱唯一性，之后可在回收站中恢复。'
              : activeAction === 'restore'
                ? '恢复后账号将重新回到正常列表并保留原有资料。'
                : activeAction === 'unarchive'
                  ? '取消归档后账号将恢复为正常状态，并保留原有资料与标签。'
                  : '归档后保留资料，后续可随时执行取消归档。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {notice && (
          <p role="alert" className="text-sm text-[var(--danger-text)]">
            {notice}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant={activeAction === 'delete' ? 'destructive' : 'default'}
            disabled={busy || conflict}
            onClick={(e) => {
              e.preventDefault();
              if (confirm) onConfirm(confirm);
            }}
          >
            {busy ? '处理中…' : `确认${actionLabels[activeAction]}`}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
