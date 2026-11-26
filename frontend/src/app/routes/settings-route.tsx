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
        if (filter === 'dashboard') {
          void navigate('/accounts?view=chart');
        } else if (filter === 'apps') {
          void navigate('/apps');
        } else if (filter === 'normal') {
          void navigate('/accounts?status=normal');
        } else if (filter === 'pending') {
          void navigate('/accounts?status=pending_verification');
        } else if (filter === 'risk') {
          void navigate('/accounts?statuses=restricted,login_failed');
        } else if (filter === 'disabled') {
          void navigate('/accounts?status=disabled');
        } else if (filter === 'archived') {
          void navigate('/accounts?archived=true');
        } else if (filter === 'trash') {
          void navigate('/accounts?deleted=true');
        } else if (filter === 'tags') {
          void navigate('/accounts?modal=tags');
        } else if (filter?.startsWith('tag:')) {
          const tagId = filter.slice(4);
          void navigate(
            `/accounts?${new URLSearchParams({ tag: tagId }).toString()}`,
          );
        } else {
          workspace.onNavigate('accounts');
        }
      }}
      onNavigateOperations={(tab) => {
        if (tab === 'import') {
          void navigate('/transfers/csv');
        } else if (tab === 'export') {
          void navigate('/transfers/csv?tab=export');
        } else if (tab === 'audit') {
          void navigate('/settings/audit');
        } else {
          void navigate('/settings/backup');
        }
      }}
      onNavigateRecoveryUsage={() => void navigate('/recovery-emails')}
      onLogout={() => workspace.onLogout(true)}
    />
  );
}
