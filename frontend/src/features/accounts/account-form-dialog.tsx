import type {
  AccountCreateWritable,
  AccountDetail,
  RegisteredAppResponse,
  TagResponse,
} from '@/api/generated';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AccountForm } from './account-form';

export function AccountFormDialog({
  form,
  detail,
  tags,
  appsCatalog = [],
  onCreateApp,
  busy,
  conflict,
  notice,
  onClose,
  onRestoreFocus,
  onReload,
  onFailure,
  onSubmit,
}: {
  form: 'new' | 'edit' | null;
  detail: AccountDetail | null;
  tags: TagResponse[];
  appsCatalog?: RegisteredAppResponse[];
  onCreateApp?: (name: string) => Promise<RegisteredAppResponse | null>;
  busy: boolean;
  conflict: boolean;
  notice: string;
  onClose: () => void;
  onRestoreFocus: (event: Event) => void;
  onReload: (account: AccountDetail) => void;
  onFailure: (error: unknown) => void;
  onSubmit: (body: AccountCreateWritable) => Promise<void>;
}) {
  return (
    <Dialog
      open={form !== null}
      onOpenChange={(value) => {
        if (!value && !busy) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={onRestoreFocus}
        className="macos-glass-modal flex max-h-[90vh] min-h-0 flex-col overflow-hidden rounded-[22px] sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>{form === 'edit' ? '编辑账号' : '新建账号'}</DialogTitle>
          <DialogDescription>
            {form === 'edit'
              ? `${detail?.account_no} · 版本 ${detail?.row_version}`
              : '邮箱、密码、注册时间和辅助邮箱为必填项。'}
          </DialogDescription>
        </DialogHeader>
        {notice && (
          <Alert variant="destructive">
            <AlertDescription>{notice}</AlertDescription>
          </Alert>
        )}
        {conflict && detail && (
          <Button variant="outline" onClick={() => onReload(detail)}>
            重新加载最新版本（放弃当前编辑）
          </Button>
        )}
        {form && (
          <AccountForm
            key={`${form}-${detail?.row_version ?? 'new'}`}
            account={form === 'edit' && detail ? detail : undefined}
            onFailure={onFailure}
            tags={tags}
            appsCatalog={appsCatalog}
            onCreateApp={onCreateApp}
            busy={busy}
            conflict={conflict}
            onSubmit={onSubmit}
            onCancel={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
