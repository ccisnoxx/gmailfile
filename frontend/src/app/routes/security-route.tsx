import { AuthShell } from '@/features/auth/auth-shell';
import { SecuritySettingsPanel } from '@/features/auth/security-settings-panel';
import { useWorkspaceContext } from '@/features/auth/workspace-context';

export default function SecurityRoute() {
  const workspace = useWorkspaceContext();
  return (
    <AuthShell
      title="安全设置"
      showLogout
      busy={workspace.busy}
      notice={workspace.notice}
      onLogout={() => workspace.onLogout(false)}
    >
      <SecuritySettingsPanel
        panel={workspace.panel}
        epoch={workspace.epoch}
        busy={workspace.busy}
        onSelectPanel={workspace.onSelectPanel}
        onOpenAccounts={() => workspace.onNavigate('accounts')}
        onOpenOperations={() => workspace.onNavigate('operations')}
        onSubmit={workspace.onSecuritySubmit}
      />
    </AuthShell>
  );
}
