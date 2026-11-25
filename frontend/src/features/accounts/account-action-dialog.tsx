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
  return (
    <AlertDialog
      open={confirm !== null}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <AlertDialogContent className="macos-glass-modal rounded-[20px]">
        <AlertDialogHeader>
          <AlertDialogTitle>
            确认{confirm && actionLabels[confirm]}账号？
          </AlertDialogTitle>
          <AlertDialogDescription>
            {detail?.gmail_email}。
            {confirm === 'delete'
              ? '仅软删除，不释放邮箱唯一性，之后可在回收站中恢复。'
              : confirm === 'restore'
                ? '恢复后账号将重新回到正常列表并保留原有资料。'
                : '归档后保留资料，可通过编辑状态取消归档。'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {conflict && <p role="alert">{notice}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            variant={confirm === 'delete' ? 'destructive' : 'default'}
            disabled={busy || conflict}
            onClick={(e) => {
              e.preventDefault();
              if (confirm) onConfirm(confirm);
            }}
          >
            确认{confirm && actionLabels[confirm]}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
