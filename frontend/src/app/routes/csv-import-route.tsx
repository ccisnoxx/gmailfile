import { useWorkspaceContext } from '@/features/auth/workspace-context';
import { CsvImportPage } from '@/features/transfers';

export default function CsvImportRoute() {
  const workspace = useWorkspaceContext();
  return (
    <CsvImportPage
      key={workspace.epoch}
      mode="live"
      session={workspace.session}
      onFailure={workspace.onOperationsFailure}
      onLogout={() => workspace.onLogout(true)}
    />
  );
}
