import { AccountsPage } from '@/features/accounts/accounts-page';
import { useWorkspaceContext } from '@/features/auth/workspace-context';

export default function AppsRoute() {
  const workspace = useWorkspaceContext();
  return (
    <AccountsPage
      key={`${workspace.epoch}-apps`}
      initialAppsView
      session={workspace.session}
      onSession={workspace.onSession}
      onFailure={workspace.onAccountFailure}
      onSecurity={() => workspace.onNavigate('security')}
      onOperations={(tab) => workspace.onNavigate('operations', tab)}
      onLogout={() => workspace.onLogout(true)}
    />
  );
}
