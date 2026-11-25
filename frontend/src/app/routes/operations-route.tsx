import { OperationsPage } from '@/features/operations/operations-page';
import { useWorkspaceContext } from '@/features/auth/workspace-context';

export default function OperationsRoute() {
  const workspace = useWorkspaceContext();
  return (
    <OperationsPage
      key={workspace.epoch}
      session={workspace.session}
      onBack={() => workspace.onNavigate('accounts')}
      onSecurity={() => workspace.onNavigate('security')}
      onFailure={workspace.onOperationsFailure}
      onRefreshSession={workspace.onRefreshSession}
      onSignedOut={workspace.onSignedOut}
    />
  );
}
