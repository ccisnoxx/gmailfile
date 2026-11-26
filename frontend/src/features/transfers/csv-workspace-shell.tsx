import {
  AppWindowShell,
  GlassToolbar,
  MobilePrimaryNavMenu,
  PrimarySidebar,
  type DisplaySettingsState,
  type SidebarSystemStatus,
  type TopNavKey,
  type WorkspaceNavKey,
} from '@/components/macos';
import type { SidebarCounts, TransferSubTab } from './types';

export type TransferTopNavKey =
  | 'dashboard'
  | 'accounts'
  | 'tags'
  | 'transfer'
  | 'batch';

export type TransferSidebarKey =
  | 'accounts'
  | 'tags'
  | 'archived'
  | 'trash'
  | 'transfer'
  | 'batch'
  | 'audit'
  | 'backup'
  | 'settings';

export function CsvWorkspaceShell({
  navAlpha,
  onNavAlphaChange,
  displaySettings,
  onDisplaySettingsChange,
  sidebarCounts,
  systemStatus,
  notifications = [],
  onSelectTopNav,
  onSelectSidebarNav,
  onOpenSecurity,
  onOpenAuditLog,
  onOpenRecoveryUsage,
  onLogout,
  children,
}: {
  navAlpha: number;
  onNavAlphaChange: (next: number) => void;
  displaySettings: DisplaySettingsState;
  onDisplaySettingsChange?: (next: DisplaySettingsState) => void;
  activeSubTab?: TransferSubTab;
  sidebarCounts: SidebarCounts;
  globalSearch?: string;
  onGlobalSearchChange?: (value: string) => void;
  systemStatus?: SidebarSystemStatus;
  notifications?: readonly string[];
  onSelectTopNav: (key: TransferTopNavKey) => void;
  onSelectSidebarNav: (key: TransferSidebarKey) => void;
  onOpenSecurity: () => void;
  onOpenAuditLog: () => void;
  onOpenRecoveryUsage?: () => void;
  onLogout: () => void;
  children: React.ReactNode;
}) {
  const handleGlobalTopNav = (key: TopNavKey) => {
    if (key === 'transfer') {
      onSelectTopNav('transfer');
    } else if (key === 'audit') {
      onOpenAuditLog();
    } else if (key === 'settings') {
      onOpenSecurity();
    } else if (key === 'tags') {
      onSelectSidebarNav('tags');
    } else {
      onSelectTopNav('accounts');
    }
  };

  const handleWorkspaceSidebarNav = (key: WorkspaceNavKey) => {
    if (key === 'dashboard') {
      onSelectTopNav('dashboard');
      return;
    }
    onSelectSidebarNav(key);
  };

  const toolbar = (
    <GlassToolbar
      activeNav="transfer"
      navAlpha={navAlpha}
      onNavAlphaChange={onNavAlphaChange}
      displaySettings={displaySettings}
      onDisplaySettingsChange={onDisplaySettingsChange}
      onSelectNav={handleGlobalTopNav}
      onOpenSecurity={onOpenSecurity}
      onOpenRecoveryUsage={onOpenRecoveryUsage}
      onOpenTransfer={() => onSelectTopNav('transfer')}
      onLogout={onLogout}
      notifications={notifications}
    />
  );

  return (
    <AppWindowShell
      navAlpha={navAlpha}
      flowingBackground={displaySettings.flowingBackground}
      animationsEnabled={displaySettings.animationsEnabled}
      compactMode={displaySettings.compactMode}
      toolbar={toolbar}
      mobileDrawerHeader={
        <MobilePrimaryNavMenu
          activeNav="transfer"
          onSelectNav={handleGlobalTopNav}
        />
      }
      sidebar={
        <PrimarySidebar
          mode="workspace"
          activeNav="transfer"
          trashCount={sidebarCounts.trash}
          systemStatus={systemStatus}
          onSelectNav={handleWorkspaceSidebarNav}
        />
      }
      mainClassName="flex-col gap-4 p-4 sm:p-5 lg:p-6"
    >
      {children}
    </AppWindowShell>
  );
}
