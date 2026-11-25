import { useNavigate } from 'react-router-dom';
import { useWorkspaceContext } from '@/features/auth/workspace-context';
import { SettingsPage, type SettingsSectionKey } from '@/features/settings';

export default function SettingsRoute({
  initialSection = 'security',
}: {
  initialSection?: SettingsSectionKey;
}) {
  const workspace = useWorkspaceContext();
  const navigate = useNavigate();

  return (
    <SettingsPage
      key={workspace.epoch}
      mode="live"
      initialSection={initialSection}
      session={workspace.session}
      onSession={workspace.onSession}
      onFailure={workspace.onOperationsFailure}
      onRefreshSession={workspace.onRefreshSession}
      onSignedOut={workspace.onSignedOut}
      onNavigateAccounts={(filter) => {
        if (filter === 'archived') {
          void navigate('/accounts?archived=true');
        } else if (filter === 'trash') {
          void navigate('/accounts?deleted=true');
        } else {
          workspace.onNavigate('accounts');
        }
      }}
      onNavigateOperations={(tab) => workspace.onNavigate('operations', tab)}
      onLogout={() => workspace.onLogout(true)}
    />
  );
}
