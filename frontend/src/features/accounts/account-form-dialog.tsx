import type {
  AccountCreateWritable,
  AccountDetail,
  RegisteredAppResponse,
  SessionResponse,
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
import { StepUpVerifier } from '@/features/auth/step-up-verifier';
import type {
  CreateAppHandler,
  FetchAppIconHandler,
} from './account-apps-editor';
import { AccountForm } from './account-form';

export function AccountFormDialog({
  form,
  detail,
  session,
  reauthRequired = false,
  tags,
  appsCatalog = [],
  onCreateApp,
  onFetchAppIcon,
  busy,
  conflict,
  notice,
  onClose,
  onRestoreFocus,
  onReload,
  onSession,
  onFailure,
  onSubmit,
}: {
  form: 'new' | 'edit' | null;
  detail: AccountDetail | null;
  session?: SessionResponse;
  reauthRequired?: boolean;
  tags: TagResponse[];
  appsCatalog?: RegisteredAppResponse[];
  onCreateApp?: CreateAppHandler;
  onFetchAppIcon?: FetchAppIconHandler;
  busy: boolean;
  conflict: boolean;
  notice: string;
  onClose: () => void;
  onRestoreFocus: (event: Event) => void;
  onReload: (account: AccountDetail) => void;
  onSession?: (next: SessionResponse) => void;
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
        {reauthRequired && session && (
          <StepUpVerifier
            session={session}
            requireMfa={Boolean(session.step_up_totp_required)}
            forceVerify
            disabled={busy}
            actionLabel="保存密码修改"
            onVerified={(next) => onSession?.(next)}
            onFailure={onFailure}
          />
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
            onFetchAppIcon={onFetchAppIcon}
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
