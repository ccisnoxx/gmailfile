import type { TagResponse } from '@/api/generated';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function TagManagerDialog({
  open,
  tags,
  target,
  name,
  deleteTarget,
  busy,
  notice,
  onOpenChange,
  onRestoreFocus,
  onNameChange,
  onSave,
  onStartRename,
  onCancelRename,
  onRequestDelete,
  onConfirmDelete,
}: {
  open: boolean;
  tags: TagResponse[];
  target: TagResponse | null;
  name: string;
  deleteTarget: TagResponse | null;
  busy: boolean;
  notice: string;
  onOpenChange: (open: boolean) => void;
  onRestoreFocus: (event: Event) => void;
  onNameChange: (value: string) => void;
  onSave: () => void;
  onStartRename: (tag: TagResponse) => void;
  onCancelRename: () => void;
  onRequestDelete: (tag: TagResponse | null) => void;
  onConfirmDelete: () => void;
}) {
  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          onCloseAutoFocus={onRestoreFocus}
          className="macos-glass-modal rounded-[22px]"
        >
          <DialogHeader>
            <DialogTitle>管理标签</DialogTitle>
            <DialogDescription>
              标签用于整理账号，删除标签不会删除账号。
            </DialogDescription>
          </DialogHeader>
          {notice && (
            <p role="status" className="text-sm text-[var(--text-secondary)]">
              {notice}
            </p>
          )}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
          >
            <Input
              aria-label="标签名称"
              placeholder="输入标签名称…"
              required
              maxLength={50}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
            />
            <Button disabled={busy || !name.trim()}>
              {target ? '保存标签' : '添加标签'}
            </Button>
            {target && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={onCancelRename}
              >
                取消
              </Button>
            )}
          </form>
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {tags.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 border-b border-[var(--table-divider)] py-2"
              >
                <span className="break-all">{t.name}</span>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => onStartRename(t)}
                  >
                    重命名
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => onRequestDelete(t)}
                  >
                    删除标签
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(value) => {
          if (!value && !busy) onRequestDelete(null);
        }}
      >
        <AlertDialogContent className="macos-glass-modal rounded-[20px]">
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除标签“{deleteTarget?.name}”？
            </AlertDialogTitle>
            <AlertDialogDescription>
              仅解除账号关联，不会删除任何账号。关联账号的记录版本将递增。
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
              variant="destructive"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                onConfirmDelete();
              }}
            >
              {busy ? '删除中…' : '确认删除标签'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
