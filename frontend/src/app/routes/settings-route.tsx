import { useNavigate } from 'react-router-dom';
import {
  resolveAccountFilterToken,
  resolveAppHref,
  resolveOperationsDestination,
} from '@/app/navigation';
import { useWorkspaceContext } from '@/features/auth/workspace-context';
import { SettingsPage } from '@/features/settings/settings-page';
import type { SettingsSectionKey } from '@/features/settings/types';

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
        if (!filter) {
          workspace.onNavigate('accounts');
          return;
        }
        void navigate(resolveAppHref(resolveAccountFilterToken(filter)));
      }}
      onNavigateOperations={(tab) => {
        void navigate(resolveAppHref(resolveOperationsDestination(tab)));
      }}
      onNavigateRecoveryUsage={() =>
        void navigate(resolveAppHref({ kind: 'recovery-emails' }))
      }
      onLogout={() => workspace.onLogout(true)}
    />
  );
}
