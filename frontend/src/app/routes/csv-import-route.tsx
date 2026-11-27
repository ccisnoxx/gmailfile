import type { ErrorResponse } from '@/api/generated';
import { useWorkspaceContext } from '@/features/auth/workspace-context';
import { CsvImportPage } from '@/features/transfers/csv-import-page';

export default function CsvImportRoute() {
  const workspace = useWorkspaceContext();
  return (
    <CsvImportPage
      key={workspace.epoch}
      mode="live"
      session={workspace.session}
      onSession={workspace.onSession}
      onFailure={(error) => {
        const code = (error as Partial<ErrorResponse> | undefined)?.error?.code;
        // REAUTH_REQUIRED 由 CSV 工作区页内弹窗处理，避免跳走丢失内存中的上传文件。
        if (code === 'REAUTH_REQUIRED') return;
        workspace.onOperationsFailure(error);
      }}
      onLogout={() => workspace.onLogout(true)}
    />
  );
}
