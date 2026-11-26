import { createPortal } from 'react-dom';
import { ChevronRight, Home } from 'lucide-react';
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

export function AccountMasterDetailLayout({
  navAlpha,
  onNavAlphaChange,
  displaySettings,
  onDisplaySettingsChange,
  displaySettingsOpen,
  onDisplaySettingsOpenChange,
  activeNav = 'accounts',
  onSelectNav,
  trashCount = 0,
  systemStatus,
  notifications = [],
  onOpenSecurity,
  onOpenRecoveryUsage,
  onLogout,
  onNavigateAccountsList,
  breadcrumbCurrent = '账号详情',
  listPane,
  detailContent,
  toastMessage,
}: {
  navAlpha: number;
  onNavAlphaChange: (value: number) => void;
  displaySettings: DisplaySettingsState;
  onDisplaySettingsChange: (next: DisplaySettingsState) => void;
  displaySettingsOpen: boolean;
  onDisplaySettingsOpenChange: (open: boolean) => void;
  searchQuery?: string;
  onSearchQueryChange?: (value: string) => void;
  activeNav?: WorkspaceNavKey;
  onSelectNav: (key: WorkspaceNavKey) => void;
  trashCount?: number;
  systemStatus?: SidebarSystemStatus;
  notifications?: string[];
  onOpenSecurity: () => void;
  onOpenOperations?: () => void;
  onOpenRecoveryUsage?: () => void;
  onLogout: () => void;
  onNavigateAccountsList: () => void;
  breadcrumbCurrent?: string;
  listPane: React.ReactNode;
  detailContent: React.ReactNode;
  toastMessage?: string;
}) {
  const mapTopNav = (key: TopNavKey) => {
    if (key === 'accounts' || key === 'dashboard') {
      onNavigateAccountsList();
      return;
    }
    onSelectNav(key);
  };

  const toolbar = (
    <GlassToolbar
      activeNav="accounts"
      navAlpha={navAlpha}
      onNavAlphaChange={onNavAlphaChange}
      displaySettings={displaySettings}
      onDisplaySettingsChange={onDisplaySettingsChange}
      displaySettingsOpen={displaySettingsOpen}
      onDisplaySettingsOpenChange={onDisplaySettingsOpenChange}
      onSelectNav={mapTopNav}
      onOpenSecurity={onOpenSecurity}
      onOpenRecoveryUsage={onOpenRecoveryUsage}
      onOpenTransfer={() => onSelectNav('transfer')}
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
        <MobilePrimaryNavMenu activeNav="accounts" onSelectNav={mapTopNav} />
      }
      sidebar={
        <PrimarySidebar
          mode="workspace"
          activeNav={activeNav}
          trashCount={trashCount}
          systemStatus={systemStatus}
          onSelectNav={onSelectNav}
        />
      }
      mainClassName="flex-col gap-[var(--detail-gap,16px)] p-3.5 xl:flex-row lg:p-4"
    >
      {/* 中间栏：账号列表 */}
      {listPane}

      {/* 右侧栏：面包屑 + 账号详情 */}
      <div className="flex min-w-0 flex-1 flex-col gap-[var(--detail-gap,16px)]">
        <nav
          aria-label="面包屑导航"
          className="flex items-center gap-1.5 px-1 text-xs text-[var(--text-secondary)]"
        >
          <button
            type="button"
            aria-label="返回账号管理"
            onClick={onNavigateAccountsList}
            className="inline-flex size-6 items-center justify-center rounded-md transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]"
          >
            <Home className="size-3.5" aria-hidden="true" />
          </button>
          <ChevronRight className="size-3.5 opacity-60" aria-hidden="true" />
          <button
            type="button"
            onClick={onNavigateAccountsList}
            className="inline-flex min-h-6 items-center rounded-md px-1.5 py-0.5 font-medium transition-colors hover:bg-[var(--surface-control-hover)] hover:text-[var(--accent-text)]"
          >
            Gmail 账号
          </button>
          <ChevronRight className="size-3.5 opacity-60" aria-hidden="true" />
          <span
            aria-current="page"
            className="truncate font-semibold text-[var(--text-primary)]"
          >
            {breadcrumbCurrent}
          </span>
        </nav>

        {detailContent}
      </div>

      {/* 轻量玻璃 Toast（Portal 渲染于 body，z-[70] 确保位于确认弹窗之上不被遮挡） */}
      {toastMessage &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="status"
            aria-live="polite"
            data-slot="detail-toast"
            className="pointer-events-none fixed right-6 bottom-6 z-[70] flex max-w-[min(28rem,calc(100vw-3rem))] items-center gap-2 rounded-2xl border border-[var(--modal-border)] bg-[var(--surface-toast)] px-4 py-2.5 text-[13px] font-medium text-[var(--text-primary)] shadow-[0_14px_38px_rgba(15,30,58,0.28)] backdrop-blur-xl"
          >
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-[var(--accent)]"
            />
            <span>{toastMessage}</span>
          </div>,
          document.body,
        )}
    </AppWindowShell>
  );
}
