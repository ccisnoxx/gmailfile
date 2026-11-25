import { AccountsPage } from '@/features/accounts/accounts-page';
import { useWorkspaceContext } from '@/features/auth/workspace-context';

export default function AccountsRoute() {
  const workspace = useWorkspaceContext();
  return (
    <AccountsPage
      key={workspace.epoch}
      session={workspace.session}
      onSession={workspace.onSession}
      onFailure={workspace.onAccountFailure}
      onSecurity={() => workspace.onNavigate('security')}
      onLogout={() => workspace.onLogout(true)}
    />
  );
}
