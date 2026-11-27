import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  resolveAccountSectionHref,
  resolveAppHref,
  resolveWorkspaceNavDestination,
} from '@/app/navigation';
import {
  AppWindowShell,
  DEFAULT_NAV_ALPHA,
  GlassToolbar,
  GlobalCommandPalette,
  isEditableElement,
  persistDisplaySettings,
  persistNavAlpha,
  PrimarySidebar,
  readDisplaySettings,
  readStoredNavAlpha,
  subscribeDisplaySettings,
  subscribeNavAlpha,
  useLiveSidebarData,
  type DisplaySettingsState,
  type SidebarSectionKey,
  type SidebarSystemStatus,
  type TopNavKey,
  type WorkspaceNavKey,
} from '@/components/macos';
import {
  WorkspaceFallback,
  type WorkspaceContextValue,
} from '@/features/auth/workspace-context';

function deriveActiveNavAndSection(
  pathname: string,
  search: string,
): {
  activeNav: WorkspaceNavKey;
  topNav: TopNavKey;
  activeSection: SidebarSectionKey | null;
  activeTagId: string | null;
} {
  const params = new URLSearchParams(search);
  if (pathname.startsWith('/apps')) {
    return {
      activeNav: 'apps',
      topNav: 'accounts',
      activeSection: null,
      activeTagId: null,
    };
  }
  if (pathname.startsWith('/recovery-emails')) {
    return {
      activeNav: 'recovery',
      topNav: 'accounts',
      activeSection: null,
      activeTagId: null,
    };
  }
  if (
    pathname.startsWith('/transfers/csv') ||
    pathname.startsWith('/imports/csv')
  ) {
    return {
      activeNav: 'transfer',
      topNav: 'transfer',
      activeSection: null,
      activeTagId: null,
    };
  }
  if (pathname.startsWith('/settings')) {
    if (pathname.startsWith('/settings/audit')) {
      return {
        activeNav: 'audit',
        topNav: 'audit',
        activeSection: null,
        activeTagId: null,
      };
    }
    if (pathname.startsWith('/settings/backup')) {
      return {
        activeNav: 'backup',
        topNav: 'settings',
        activeSection: null,
        activeTagId: null,
      };
    }
    return {
      activeNav: 'settings',
      topNav: 'settings',
      activeSection: null,
      activeTagId: null,
    };
  }

  const tagId = params.get('tag');
  const view = params.get('view');
  if (view === 'chart') {
    return {
      activeNav: 'dashboard',
      topNav: 'dashboard',
      activeSection: null,
      activeTagId: null,
    };
  }
  if (view === 'apps') {
    return {
      activeNav: 'apps',
      topNav: 'accounts',
      activeSection: null,
      activeTagId: null,
    };
  }
  if (view === 'recovery') {
    return {
      activeNav: 'recovery',
      topNav: 'accounts',
      activeSection: null,
      activeTagId: null,
    };
  }
  if (params.get('deleted') === 'true') {
    return {
      activeNav: 'trash',
      topNav: 'accounts',
      activeSection: 'trash',
      activeTagId: tagId,
    };
  }
  if (
    params.get('archived') === 'true' ||
    params.get('status') === 'archived'
  ) {
    return {
      activeNav: 'archived',
      topNav: 'accounts',
      activeSection: 'archived',
      activeTagId: tagId,
    };
  }
  const status = params.get('status');
  const statuses = (params.get('statuses') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  let activeSection: SidebarSectionKey = 'all';
  if (status === 'normal') activeSection = 'normal';
  else if (status === 'pending_verification') activeSection = 'pending';
  else if (
    status === 'restricted' ||
    status === 'login_failed' ||
    (statuses.length > 0 &&
      statuses.every((s) => s === 'restricted' || s === 'login_failed'))
  ) {
    activeSection = 'risk';
  } else if (status === 'disabled') {
    activeSection = 'disabled';
  }

  return {
    activeNav: 'accounts',
    topNav: 'accounts',
    activeSection: pathname.startsWith('/accounts/') ? null : activeSection,
    activeTagId: tagId,
  };
}

export function AuthenticatedWorkspaceLayout({
  workspace,
}: {
  workspace: WorkspaceContextValue;
}) {
  const location = useLocation();
  const navigate = useNavigate();

  const [navAlpha, setNavAlpha] = useState<number>(() =>
    readStoredNavAlpha(DEFAULT_NAV_ALPHA),
  );
  const [displaySettings, setDisplaySettings] = useState<DisplaySettingsState>(
    () => readDisplaySettings(),
  );
  const [commandOpen, setCommandOpen] = useState(false);
  const [notifications, setNotifications] = useState<string[]>([]);
  const [sidebarMeta, setSidebarMeta] = useState<{
    trashCount?: number;
    systemStatus?: SidebarSystemStatus;
  }>({});

  const handleSyncSidebarMeta = useCallback(
    (meta: { trashCount?: number; systemStatus?: SidebarSystemStatus }) => {
      setSidebarMeta((prev) => {
        if (
          prev.trashCount === meta.trashCount &&
          prev.systemStatus?.healthy === meta.systemStatus?.healthy &&
          prev.systemStatus?.headline === meta.systemStatus?.headline &&
          prev.systemStatus?.lastBackupLabel ===
            meta.systemStatus?.lastBackupLabel &&
          prev.systemStatus?.version === meta.systemStatus?.version
        ) {
          return prev;
        }
        return meta;
      });
    },
    [],
  );

  useEffect(() => subscribeNavAlpha(setNavAlpha), []);
  useEffect(() => subscribeDisplaySettings(setDisplaySettings), []);

  const handleNavAlphaChange = useCallback((next: number) => {
    setNavAlpha(next);
    persistNavAlpha(next);
  }, []);

  const handleDisplaySettingsChange = useCallback(
    (next: DisplaySettingsState) => {
      setDisplaySettings(next);
      persistDisplaySettings(next);
    },
    [],
  );

  const pushNotification = useCallback((msg: string) => {
    const trimmed = msg.trim();
    if (!trimmed) return;
    setNotifications((prev) =>
      prev[0] === trimmed ? prev : [trimmed, ...prev].slice(0, 8),
    );
  }, []);

  // 全局快捷键：⌘/Ctrl + K 唤起命令面板；「/」聚焦当前主视图内联搜索框
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen((open) => !open);
        return;
      }
      if (
        event.key === '/' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isEditableElement(event.target) &&
        !document.querySelector('[role="dialog"], [role="alertdialog"]')
      ) {
        const searchInput = document.querySelector<HTMLInputElement>(
          'main input[type="search"]',
        );
        if (searchInput) {
          event.preventDefault();
          searchInput.focus();
          searchInput.select();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const { counts, tags } = useLiveSidebarData(true);

  const navModel = useMemo(
    () => deriveActiveNavAndSection(location.pathname, location.search),
    [location.pathname, location.search],
  );

  const handleSelectWorkspaceNav = useCallback(
    (key: WorkspaceNavKey) => {
      void navigate(resolveAppHref(resolveWorkspaceNavDestination(key)));
    },
    [navigate],
  );

  const handleSelectSection = useCallback(
    (section: SidebarSectionKey) => {
      void navigate(resolveAccountSectionHref(section));
    },
    [navigate],
  );

  const handleSelectTag = useCallback(
    (tagId: string) => {
      const params = new URLSearchParams(location.search);
      const current = params.get('tag');
      if (
        (location.pathname === '/' || location.pathname === '/accounts') &&
        current === tagId
      ) {
        void navigate('/accounts');
        return;
      }
      void navigate(
        resolveAppHref({ kind: 'accounts', query: { tag: tagId } }),
      );
    },
    [location.pathname, location.search, navigate],
  );

  const handleAddTag = useCallback(() => {
    void navigate(
      resolveAppHref({ kind: 'accounts', query: { modal: 'tags' } }),
    );
  }, [navigate]);

  const handleTopNav = useCallback(
    (key: TopNavKey) => {
      if (key === 'dashboard') {
        void navigate(resolveAppHref({ kind: 'dashboard' }));
      } else if (key === 'tags') {
        handleAddTag();
      } else if (key === 'transfer') {
        void navigate(resolveAppHref({ kind: 'transfer', tab: 'import' }));
      } else if (key === 'audit') {
        void navigate(resolveAppHref({ kind: 'settings', section: 'audit' }));
      } else if (key === 'settings') {
        void navigate(
          resolveAppHref({ kind: 'settings', section: 'security' }),
        );
      } else {
        void navigate(resolveAppHref({ kind: 'accounts' }));
      }
    },
    [handleAddTag, navigate],
  );

  return (
    <AppWindowShell
      persistentShell
      navAlpha={navAlpha}
      flowingBackground={displaySettings.flowingBackground}
      animationsEnabled={displaySettings.animationsEnabled}
      compactMode={displaySettings.compactMode}
      onPushNotification={pushNotification}
      onOpenCommandPalette={() => setCommandOpen(true)}
      onSyncSidebarMeta={handleSyncSidebarMeta}
      toolbar={
        <GlassToolbar
          activeNav={navModel.topNav}
          navAlpha={navAlpha}
          onNavAlphaChange={handleNavAlphaChange}
          displaySettings={displaySettings}
          onDisplaySettingsChange={handleDisplaySettingsChange}
          onSelectNav={handleTopNav}
          onOpenSecurity={() =>
            void navigate(
              resolveAppHref({ kind: 'settings', section: 'security' }),
            )
          }
          onOpenRecoveryUsage={() =>
            void navigate(resolveAppHref({ kind: 'recovery-emails' }))
          }
          onOpenTransfer={() =>
            void navigate(resolveAppHref({ kind: 'transfer', tab: 'import' }))
          }
          onLogout={() => workspace.onLogout(true)}
          onLockSession={() => workspace.onLogout(true)}
          onOpenCommandPalette={() => setCommandOpen(true)}
          session={workspace.session}
          onSession={workspace.onSession}
          notifications={notifications}
          onClearNotifications={() => setNotifications([])}
        />
      }
      sidebar={
        <PrimarySidebar
          mode="workspace"
          activeNav={navModel.activeNav}
          activeSection={navModel.activeSection}
          activeTagId={navModel.activeTagId}
          counts={counts}
          tags={tags}
          trashCount={sidebarMeta.trashCount}
          systemStatus={sidebarMeta.systemStatus}
          onSelectNav={handleSelectWorkspaceNav}
          onSelectSection={handleSelectSection}
          onSelectTag={handleSelectTag}
          onAddTag={handleAddTag}
        />
      }
    >
      <Suspense fallback={<WorkspaceFallback />}>
        <Outlet />
      </Suspense>

      <GlobalCommandPalette
        open={commandOpen}
        onOpenChange={setCommandOpen}
        onOpenAccount={(account) => {
          void navigate(
            resolveAppHref({
              kind: 'accounts',
              query: { inspect: account.id },
            }),
          );
        }}
        onCreateAccount={() => {
          void navigate(
            resolveAppHref({ kind: 'accounts', query: { modal: 'create' } }),
          );
        }}
        onOpenTagManager={handleAddTag}
        onApplyViewQuery={(query) => {
          void navigate(resolveAppHref({ kind: 'accounts', query }));
        }}
        onNavigateHref={(href) => {
          void navigate(href);
        }}
        onToggleCompactMode={() => {
          handleDisplaySettingsChange({
            ...displaySettings,
            compactMode: !displaySettings.compactMode,
          });
        }}
        onToggleFlowingBg={() => {
          handleDisplaySettingsChange({
            ...displaySettings,
            flowingBackground: !displaySettings.flowingBackground,
          });
        }}
        onLockSession={() => workspace.onLogout(true)}
      />
    </AppWindowShell>
  );
}
