import {
  AppWindowShell,
  GlassToolbar,
  PrimarySidebar,
  type DisplaySettingsState,
  type SidebarCounts as PrimarySidebarCounts,
  type SidebarSectionKey,
  type SidebarSystemStatus,
  type SidebarTagItem,
  type TopNavKey,
  type WorkspaceNavKey,
} from '@/components/macos';
import type { SidebarCounts, TransferSubTab } from './types';

export type TransferTopNavKey =
  'dashboard' | 'accounts' | 'tags' | 'transfer' | 'batch';

export type TransferSidebarKey =
  | 'dashboard'
  | 'accounts'
  | 'apps'
  | 'recovery'
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
  primarySidebarCounts,
  sidebarTags,
  systemStatus,
  notifications = [],
  onSelectTopNav,
  onSelectSidebarNav,
  onSelectAccountSection,
  onSelectTag,
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
  primarySidebarCounts?: PrimarySidebarCounts;
  sidebarTags?: SidebarTagItem[];
  globalSearch?: string;
  onGlobalSearchChange?: (value: string) => void;
  systemStatus?: SidebarSystemStatus;
  notifications?: readonly string[];
  onSelectTopNav: (key: TransferTopNavKey) => void;
  onSelectSidebarNav: (key: TransferSidebarKey) => void;
  onSelectAccountSection?: (section: SidebarSectionKey) => void;
  onSelectTag?: (tagId: string) => void;
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
      onSelectSidebarNav('dashboard');
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
      sidebar={
        <PrimarySidebar
          mode="workspace"
          activeNav="transfer"
          counts={primarySidebarCounts}
          tags={sidebarTags}
          trashCount={sidebarCounts.trash}
          systemStatus={systemStatus}
          onSelectNav={handleWorkspaceSidebarNav}
          onSelectSection={onSelectAccountSection}
          onSelectTag={onSelectTag}
        />
      }
      mainClassName="flex-col gap-4 p-4 sm:p-5 lg:p-6"
    >
      {children}
    </AppWindowShell>
  );
}
