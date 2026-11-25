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
        <DialogContent onCloseAutoFocus={onRestoreFocus}>
          <DialogHeader>
            <DialogTitle>管理标签</DialogTitle>
            <DialogDescription>
              标签用于整理账号，删除标签不会删除账号。
            </DialogDescription>
          </DialogHeader>
          {notice && <p role="status">{notice}</p>}
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onSave();
            }}
          >
            <Input
              aria-label="标签名称"
              required
              maxLength={50}
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
            />
            <Button disabled={busy}>{target ? '保存标签' : '添加标签'}</Button>
            {target && (
              <Button type="button" variant="ghost" onClick={onCancelRename}>
                取消
              </Button>
            )}
          </form>
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {tags.map((t) => (
              <li
                key={t.id}
                className="flex items-center justify-between gap-2 border-b py-2"
              >
                <span className="break-all">{t.name}</span>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => onStartRename(t)}
                  >
                    重命名
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
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
          if (!value) onRequestDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              删除标签“{deleteTarget?.name}”？
            </AlertDialogTitle>
            <AlertDialogDescription>
              仅解除账号关联，不会删除任何账号。关联账号的记录版本将递增。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                onConfirmDelete();
              }}
            >
              确认删除标签
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
